"""
Compare CSV outputs in `ml/data/processed` against baseline copies.

Validation levels:
1) Existence + column order + row count
2) Hash comparison after deterministic sorting
   - strict hash (no float rounding)
   - rounded hash (float rounded to configured digits)
"""

from __future__ import annotations

import argparse
import hashlib
import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Optional

import pandas as pd
from pandas.api.types import is_float_dtype

from .config import BASELINE_PROCESSED_DIR, OUTPUT_DIR, PROCESSED_DIR


@dataclass
class FileResult:
    filename: str
    status: str
    baseline_rows: int
    processed_rows: int
    baseline_columns: list[str]
    processed_columns: list[str]
    strict_hash_baseline: Optional[str] = None
    strict_hash_processed: Optional[str] = None
    rounded_hash_baseline: Optional[str] = None
    rounded_hash_processed: Optional[str] = None
    message: str = ""


def list_csv_files(folder: Path) -> set[str]:
    return {p.name for p in folder.glob("*.csv") if p.is_file()}


def normalize_for_hash(df: pd.DataFrame, round_digits: Optional[int]) -> pd.DataFrame:
    out = df.copy()
    if round_digits is not None:
        for col in out.columns:
            if is_float_dtype(out[col]):
                out[col] = out[col].round(round_digits)
    return out


def frame_hash(df: pd.DataFrame, round_digits: Optional[int]) -> str:
    normalized = normalize_for_hash(df, round_digits)
    sort_cols = list(normalized.columns)
    if sort_cols:
        normalized = normalized.sort_values(by=sort_cols, kind="mergesort", na_position="last")
    normalized = normalized.where(pd.notna(normalized), "<NA>")
    csv_text = normalized.to_csv(index=False, lineterminator="\n")
    return hashlib.sha256(csv_text.encode("utf-8")).hexdigest()


def compare_file(filename: str, baseline_dir: Path, processed_dir: Path, round_digits: int) -> FileResult:
    baseline_path = baseline_dir / filename
    processed_path = processed_dir / filename

    bdf = pd.read_csv(baseline_path)
    pdf = pd.read_csv(processed_path)

    result = FileResult(
        filename=filename,
        status="FAIL",
        baseline_rows=len(bdf),
        processed_rows=len(pdf),
        baseline_columns=list(bdf.columns),
        processed_columns=list(pdf.columns),
    )

    if list(bdf.columns) != list(pdf.columns):
        result.message = "column mismatch"
        return result

    if len(bdf) != len(pdf):
        result.message = "row count mismatch"
        return result

    b_strict = frame_hash(bdf, round_digits=None)
    p_strict = frame_hash(pdf, round_digits=None)
    result.strict_hash_baseline = b_strict
    result.strict_hash_processed = p_strict

    if b_strict == p_strict:
        result.status = "PASS"
        result.message = "strict hash match"
        return result

    b_round = frame_hash(bdf, round_digits=round_digits)
    p_round = frame_hash(pdf, round_digits=round_digits)
    result.rounded_hash_baseline = b_round
    result.rounded_hash_processed = p_round

    if b_round == p_round:
        result.status = "PASS_TOLERANCE"
        result.message = f"rounded hash match (round_digits={round_digits})"
    else:
        result.status = "FAIL"
        result.message = "hash mismatch"
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate processed CSVs against baseline CSVs.")
    parser.add_argument("--baseline-dir", type=Path, default=BASELINE_PROCESSED_DIR)
    parser.add_argument("--processed-dir", type=Path, default=PROCESSED_DIR)
    parser.add_argument("--round-digits", type=int, default=6)
    parser.add_argument(
        "--report",
        type=Path,
        default=OUTPUT_DIR / "processed_validation_report.json",
    )
    args = parser.parse_args()

    baseline_dir = args.baseline_dir
    processed_dir = args.processed_dir

    if not baseline_dir.exists():
        raise FileNotFoundError(f"baseline directory not found: {baseline_dir}")
    if not processed_dir.exists():
        raise FileNotFoundError(f"processed directory not found: {processed_dir}")

    baseline_files = list_csv_files(baseline_dir)
    processed_files = list_csv_files(processed_dir)

    missing_in_processed = sorted(baseline_files - processed_files)
    extra_in_processed = sorted(processed_files - baseline_files)
    common = sorted(baseline_files & processed_files)

    results = [compare_file(name, baseline_dir, processed_dir, args.round_digits) for name in common]

    summary = {
        "baseline_dir": str(baseline_dir),
        "processed_dir": str(processed_dir),
        "round_digits": args.round_digits,
        "baseline_file_count": len(baseline_files),
        "processed_file_count": len(processed_files),
        "missing_in_processed": missing_in_processed,
        "extra_in_processed": extra_in_processed,
        "pass_count": sum(1 for r in results if r.status == "PASS"),
        "pass_tolerance_count": sum(1 for r in results if r.status == "PASS_TOLERANCE"),
        "fail_count": sum(1 for r in results if r.status == "FAIL"),
    }

    report = {
        "summary": summary,
        "files": [asdict(r) for r in results],
    }
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    print("=== Processed Equivalence Validation ===")
    print(f"baseline files:  {len(baseline_files)}")
    print(f"processed files: {len(processed_files)}")
    print(f"missing:         {len(missing_in_processed)}")
    print(f"extra:           {len(extra_in_processed)}")
    print(f"PASS:            {summary['pass_count']}")
    print(f"PASS_TOLERANCE:  {summary['pass_tolerance_count']}")
    print(f"FAIL:            {summary['fail_count']}")
    print(f"report:          {args.report}")

    has_file_set_diff = bool(missing_in_processed or extra_in_processed)
    has_fail = summary["fail_count"] > 0
    return 1 if (has_file_set_diff or has_fail) else 0


if __name__ == "__main__":
    raise SystemExit(main())

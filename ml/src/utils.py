"""
utils.py - 공통 유틸리티 함수

노트북에서 반복되는 패턴을 함수로 추출.

사용:
    from src.utils import load_cohort, save_csv, print_missing, print_label_dist

참고:
    - 경로 및 임상 범위는 노트북에서 직접 정의하거나 docs/ 문서 참조
    - MIMIC Item IDs: docs/MIMIC_ITEMIDS.md
    - Clinical Parameters: docs/CLINICAL_PARAMETERS.md
    - Aggregation Rules: docs/AGGREGATION_RULES.md
"""

import pandas as pd
import numpy as np

from .config import PROCESSED_DIR


# ============================================================
# 데이터 로드/저장
# ============================================================

def load_cohort(filename: str = 'sepsis_cohort.csv', parse_dates: list = None) -> pd.DataFrame:
    """
    processed/ 폴더에서 코호트 CSV 로드
    
    Args:
        filename: 파일명
        parse_dates: datetime으로 파싱할 컬럼 리스트
    
    Returns:
        DataFrame
    """
    if parse_dates is None:
        parse_dates = ['intime', 'outtime']
    
    filepath = PROCESSED_DIR / filename
    
    if not filepath.exists():
        raise FileNotFoundError(f"파일 없음: {filepath}")

    # 존재하지 않는 컬럼이 parse_dates에 있으면 pandas가 에러를 내므로 사전 필터링
    original_parse_dates = list(parse_dates) if parse_dates else []
    try:
        header_cols = pd.read_csv(filepath, nrows=0).columns.tolist()
    except Exception:
        header_cols = None

    if header_cols is not None and original_parse_dates:
        parse_dates = [c for c in original_parse_dates if c in header_cols]
        missing = [c for c in original_parse_dates if c not in header_cols]
        if missing:
            print(f"⚠️ parse_dates 컬럼 없음: {', '.join(missing)}")

    if parse_dates:
        df = pd.read_csv(filepath, parse_dates=parse_dates)
    else:
        df = pd.read_csv(filepath)
    print(f"✓ {filename} 로드: {len(df):,} rows")
    return df


def save_csv(df: pd.DataFrame, filename: str) -> str:
    """
    processed/ 폴더에 CSV 저장 + 파일 크기 출력
    
    Args:
        df: 저장할 DataFrame
        filename: 파일명
    
    Returns:
        저장 경로
    """
    filepath = PROCESSED_DIR / filename
    df.to_csv(filepath, index=False)
    
    size_mb = filepath.stat().st_size / (1024 * 1024)
    print(f"✓ 저장: {filename}")
    print(f"  - {len(df):,} rows, {len(df.columns)} cols")
    print(f"  - {size_mb:.2f} MB")
    
    return filepath


# ============================================================
# 데이터 품질
# ============================================================

def print_missing(df: pd.DataFrame, cols: list = None, title: str = "결측률"):
    """
    피처별 결측률 출력
    
    Args:
        df: DataFrame
        cols: 확인할 컬럼 리스트 (None이면 전체)
        title: 출력 제목
    """
    if cols is None:
        cols = df.columns.tolist()
    
    print(f"\n=== {title} ===")
    for col in cols:
        if col in df.columns:
            rate = df[col].isna().mean() * 100
            symbol = "✓" if rate == 0 else "✗" if rate > 50 else "△"
            print(f"  {symbol} {col}: {rate:.1f}%")
        else:
            print(f"  - {col}: (컬럼 없음)")


def print_label_dist(df: pd.DataFrame, label_prefix: str = 'next_'):
    """
    레이블 분포 출력
    
    Args:
        df: DataFrame
        label_prefix: 레이블 컬럼 식별자
    """
    label_cols = sorted([c for c in df.columns if label_prefix in c])
    
    if not label_cols:
        print("레이블 컬럼 없음")
        return
    
    print("\n=== 레이블 분포 ===")
    for col in label_cols:
        pos = df[col].sum()
        rate = df[col].mean() * 100
        print(f"  {col}: {pos:,} ({rate:.2f}%)")


def check_duplicates(df: pd.DataFrame, key_cols: list) -> int:
    """
    중복 행 확인
    
    Args:
        df: DataFrame
        key_cols: 중복 판단 기준 컬럼
    
    Returns:
        중복 행 수
    """
    n_dup = df.duplicated(subset=key_cols).sum()
    if n_dup > 0:
        print(f"⚠️ 중복 {n_dup:,}건 ({key_cols})")
    else:
        print(f"✓ 중복 없음 ({key_cols})")
    return n_dup


# ============================================================
# 이상치 클리핑
# ============================================================

def clip_clinical(df: pd.DataFrame, col: str, ranges: dict) -> pd.Series:
    """
    임상 범위 기반 이상치 클리핑 (범위 밖 → NaN)

    Args:
        df: DataFrame
        col: 클리핑할 컬럼명
        ranges: {컬럼명: (min, max)} 딕셔너리
                docs/CLINICAL_PARAMETERS.md 참조

    Returns:
        클리핑된 Series

    사용 예:
        CLINICAL_RANGES = {
            'hr': (20, 300),
            'spo2': (50, 100),
            # ... (docs/CLINICAL_PARAMETERS.md 참조)
        }
        df['hr'] = clip_clinical(df, 'hr', CLINICAL_RANGES)
    """
    if col not in ranges:
        return df[col]

    lo, hi = ranges[col]
    result = df[col].copy()
    out_of_range = ~result.between(lo, hi)
    n_clipped = out_of_range.sum()

    if n_clipped > 0:
        result[out_of_range] = np.nan

    return result


# ============================================================
# 결측 처리 헬퍼
# ============================================================

def ffill_bfill(df: pd.DataFrame, col: str, group_col: str = 'stay_id') -> pd.Series:
    """
    환자별 Forward Fill → Backward Fill
    
    Args:
        df: DataFrame (stay_id, observation_hour로 정렬되어 있어야 함)
        col: 처리할 컬럼
        group_col: 그룹 기준 (기본: stay_id)
    
    Returns:
        처리된 Series
    """
    return df.groupby(group_col)[col].ffill().bfill()


def ffill_with_limit(df: pd.DataFrame, col: str, limit: int, 
                     group_col: str = 'stay_id') -> pd.Series:
    """
    환자별 Forward Fill (제한 있음)
    
    Args:
        df: DataFrame
        col: 처리할 컬럼
        limit: ffill 최대 시점 수
        group_col: 그룹 기준
    
    Returns:
        처리된 Series
    """
    return df.groupby(group_col)[col].ffill(limit=limit)


def impute_pipeline(df: pd.DataFrame, col: str, 
                    strategy: str = 'ffill_bfill_median',
                    ffill_limit: int = None,
                    default_value: float = None,
                    group_col: str = 'stay_id') -> pd.Series:
    """
    통합 결측 처리 파이프라인
    
    strategy 옵션:
        'ffill_bfill_median' : FFill → BFill → 전체 Median (vitals, GCS)
        'ffill_limit_median' : FFill(limit) → 전체 Median (labs)
        'ffill_limit_default': FFill(limit) → 고정값 (lactate, temp)
        'median_only'        : 전체 Median만 (urine)
    
    Returns:
        처리된 Series
    """
    series = df[col].copy()
    before = series.isna().sum()
    
    if strategy == 'ffill_bfill_median':
        series = df.groupby(group_col)[col].ffill().bfill()
        series = series.fillna(series.median())
    
    elif strategy == 'ffill_limit_median':
        series = df.groupby(group_col)[col].ffill(limit=ffill_limit or 24)
        series = series.fillna(series.median())
    
    elif strategy == 'ffill_limit_default':
        series = df.groupby(group_col)[col].ffill(limit=ffill_limit or 12)
        series = series.fillna(default_value or 0)
    
    elif strategy == 'median_only':
        series = series.fillna(series.median())
    
    after = series.isna().sum()
    print(f"  {col}: {before:,} → {after:,}")
    
    return series


# ============================================================
# 시간 계산
# ============================================================

def hours_since_admit(df: pd.DataFrame, time_col: str = 'charttime_h',
                      admit_col: str = 'intime') -> pd.Series:
    """
    입실 시점 대비 경과 시간 계산
    
    Returns:
        경과 시간 (hours, 정수)
    """
    return (
        (df[time_col] - df[admit_col]).dt.total_seconds() / 3600
    ).round().astype(int)


# ============================================================
# SQL 헬퍼 (Item ID 리스트 → SQL IN절)
# ============================================================

def items_to_sql(items) -> str:
    """
    Item ID 리스트를 SQL IN절 문자열로 변환
    
    Args:
        items: str 또는 list of str
    
    Returns:
        "'221906', '221289', ..." 형태 문자열
    
    사용 예:
        f"WHERE itemid IN ({items_to_sql(VASOPRESSOR_ITEMS)})"
    """
    if isinstance(items, str):
        items = [items]
    return ', '.join(f"'{i}'" for i in items)

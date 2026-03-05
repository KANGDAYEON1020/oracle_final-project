#!/usr/bin/env python3
"""
EMR Generator v2 - Validation Module (Rule-based Only)
생성된 합성 EMR 데이터를 시나리오와 비교하여 구조적/수치적 일관성 검증

사용법:
    python validation_v2.py <patient_id>
    python validation_v2.py <patient_id> --output-dir <dir>
"""
import json
import re
from pathlib import Path
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional
from dataclasses import dataclass, field
import argparse

import config
from timeline_loader import TimelineLoader


@dataclass
class ValidationResult:
    """검증 결과"""
    rule: str
    passed: bool
    message: str
    severity: str = "INFO"  # INFO, WARNING, ERROR
    details: Dict = field(default_factory=dict)


@dataclass
class ValidationReport:
    """전체 검증 리포트"""
    patient_id: str
    total_checks: int = 0
    passed: int = 0
    warnings: int = 0
    errors: int = 0
    results: List[ValidationResult] = field(default_factory=list)

    def add(self, result: ValidationResult):
        self.results.append(result)
        self.total_checks += 1
        if result.passed:
            self.passed += 1
        elif result.severity == "WARNING":
            self.warnings += 1
        else:
            self.errors += 1

    def summary(self) -> str:
        return f"Total: {self.total_checks}, Passed: {self.passed}, Warnings: {self.warnings}, Errors: {self.errors}"


class RuleBasedValidator:
    """Rule-based 검증기"""

    def __init__(self, patient_id: str, output_dir: Path, scenario_data: Dict):
        self.patient_id = patient_id
        self.output_dir = output_dir
        self.scenario_data = scenario_data
        self.generated_records = self._load_generated_records()

        # 타임라인 로더 (실제 환자 데이터)
        try:
            self.timeline = TimelineLoader(patient_id)
            self.has_timeline = True
        except FileNotFoundError:
            self.timeline = None
            self.has_timeline = False

    def _load_generated_records(self) -> Dict[int, Dict]:
        """생성된 기록 로드 (HD 기반)"""
        records = {}

        # 새 형식: hd_XX_dYY.json
        for json_file in self.output_dir.glob("hd_*.json"):
            try:
                hd_match = re.search(r'hd_(\d+)_d([+-]?\d+)', json_file.name)
                if hd_match:
                    hd = int(hd_match.group(1))
                    d_number = int(hd_match.group(2))
                    with open(json_file, 'r', encoding='utf-8') as f:
                        data = json.load(f)
                        if isinstance(data, dict) and 'documents' in data:
                            records[hd] = {
                                'hd': hd,
                                'd_number': d_number,
                                'documents': data['documents']
                            }
                        elif isinstance(data, list):
                            records[hd] = {
                                'hd': hd,
                                'd_number': d_number,
                                'documents': data
                            }
                        else:
                            records[hd] = {
                                'hd': hd,
                                'd_number': d_number,
                                'documents': [data]
                            }
            except (json.JSONDecodeError, IOError):
                continue

        # 레거시 형식 지원: day_XX.json
        if not records:
            for json_file in self.output_dir.glob("day_*.json"):
                try:
                    day_match = re.search(r'day_(\d+)', json_file.name)
                    if day_match:
                        day = int(day_match.group(1))
                        hd = day + 1  # day 0 = HD 1
                        with open(json_file, 'r', encoding='utf-8') as f:
                            data = json.load(f)
                            if isinstance(data, list):
                                records[hd] = {
                                    'hd': hd,
                                    'd_number': day,
                                    'documents': data
                                }
                            elif isinstance(data, dict) and 'documents' in data:
                                records[hd] = {
                                    'hd': hd,
                                    'd_number': day,
                                    'documents': data['documents']
                                }
                            else:
                                records[hd] = {
                                    'hd': hd,
                                    'd_number': day,
                                    'documents': [data]
                                }
                except (json.JSONDecodeError, IOError):
                    continue

        return records

    def validate_all(self) -> ValidationReport:
        """모든 rule-based 검증 수행"""
        report = ValidationReport(patient_id=self.patient_id)

        # 1. 필수 HD 존재 검증
        self._validate_required_hds(report)

        # 2. 문서 타입 검증
        self._validate_document_types(report)

        # 3. O2 trajectory 검증
        self._validate_o2_trajectory(report)

        # 4. 항생제 trajectory 검증
        self._validate_antibiotic_trajectory(report)

        # 5. Lab 값 trajectory 검증
        self._validate_lab_trajectory(report)

        # 6. Vital signs 현실성 검증
        self._validate_vital_signs(report)

        # 7. 문서 간 일관성 검증
        self._validate_cross_document_consistency(report)

        # 8. 배양 검사 타이밍 검증
        self._validate_culture_timing(report)

        # 9. 간호기록 시프트 검증
        self._validate_nursing_shifts(report)

        # 10. 타임라인 데이터와 비교 (있는 경우)
        if self.has_timeline:
            self._validate_against_timeline(report)

        return report

    def _validate_required_hds(self, report: ValidationReport):
        """필수 HD 검증"""
        period = self.scenario_data.get('generation_period', {})
        start_hd = period.get('start_hd', 1)
        end_hd = period.get('end_hd', 10)

        # 생성 범위 내 모든 HD가 필요
        required_hds = set(range(start_hd, end_hd + 1))
        generated_hds = set(self.generated_records.keys())

        missing = required_hds - generated_hds
        if missing:
            report.add(ValidationResult(
                rule="required_hds",
                passed=False,
                message=f"필수 HD 누락: {sorted(missing)}",
                severity="ERROR",
                details={"missing": sorted(missing), "generated": sorted(generated_hds)}
            ))
        else:
            report.add(ValidationResult(
                rule="required_hds",
                passed=True,
                message=f"모든 필수 HD 존재: HD {start_hd} ~ HD {end_hd}"
            ))

    def _validate_document_types(self, report: ValidationReport):
        """각 HD별 필수 문서 타입 검증"""
        period = self.scenario_data.get('generation_period', {})
        d0_hd = period.get('d0_hd', 1)

        for hd, record_data in self.generated_records.items():
            docs = record_data.get('documents', [])
            doc_types = [d.get('document_type') for d in docs]

            # HD 1 (입원일) 체크
            if hd == 1:
                required = ['nursing_note', 'physician_note', 'lab_result']
                missing = set(required) - set(doc_types)
                if missing:
                    report.add(ValidationResult(
                        rule="document_types_hd1",
                        passed=False,
                        message=f"HD 1 (입원일) 필수 문서 누락: {missing}",
                        severity="WARNING",
                        details={"hd": hd, "missing": list(missing), "found": doc_types}
                    ))
                else:
                    report.add(ValidationResult(
                        rule="document_types_hd1",
                        passed=True,
                        message=f"HD 1 필수 문서 모두 존재"
                    ))

    def _validate_o2_trajectory(self, report: ValidationReport):
        """O2 trajectory 검증"""
        trajectory = self.scenario_data.get('trajectory', {})
        o2_info = trajectory.get('o2', [])

        if not o2_info:
            return

        # 예상 패턴 추출
        expected_pattern = {}
        for item in o2_info:
            hd = item.get('hd', item.get('day', 0) + 1)
            value = item.get('value', '')
            match = re.search(r'(\d+)', str(value))
            if match:
                expected_pattern[hd] = int(match.group(1))

        actual_o2 = {}
        for hd, record_data in self.generated_records.items():
            docs = record_data.get('documents', [])
            for doc in docs:
                if doc.get('document_type') == 'nursing_note':
                    o2_flow = doc.get('o2_flow', '')
                    if o2_flow:
                        match = re.search(r'(\d+)', str(o2_flow))
                        if match:
                            actual_o2[hd] = int(match.group(1))
                            break

        # 비교
        mismatches = []
        for hd, expected in expected_pattern.items():
            if hd in actual_o2:
                if abs(actual_o2[hd] - expected) > 1:  # 1L 허용 오차
                    mismatches.append({
                        "hd": hd,
                        "expected": expected,
                        "actual": actual_o2[hd]
                    })

        if mismatches:
            report.add(ValidationResult(
                rule="o2_trajectory",
                passed=False,
                message=f"O2 trajectory 불일치: {len(mismatches)}건",
                severity="WARNING",
                details={"mismatches": mismatches}
            ))
        else:
            report.add(ValidationResult(
                rule="o2_trajectory",
                passed=True,
                message="O2 trajectory 일치"
            ))

    def _validate_antibiotic_trajectory(self, report: ValidationReport):
        """항생제 trajectory 검증"""
        trajectory = self.scenario_data.get('trajectory', {})
        abx_info = trajectory.get('antibiotics', [])

        if not abx_info:
            return

        # 키워드 추출
        expected_abx = set()
        abx_keywords = ['levofloxacin', 'cefepime', 'linezolid', 'cefpodoxime',
                        'vancomycin', 'meropenem', 'piperacillin', 'azithromycin']

        for item in abx_info:
            drug = item.get('drug', '').lower()
            for abx in abx_keywords:
                if abx in drug:
                    expected_abx.add(abx)

        # 생성된 기록에서 항생제 추출
        found_abx = set()
        for hd, record_data in self.generated_records.items():
            docs = record_data.get('documents', [])
            for doc in docs:
                doc_str = json.dumps(doc, ensure_ascii=False).lower()
                for abx in abx_keywords:
                    if abx in doc_str:
                        found_abx.add(abx)

        missing = expected_abx - found_abx
        if missing:
            report.add(ValidationResult(
                rule="antibiotic_trajectory",
                passed=False,
                message=f"시나리오에 명시된 항생제 누락: {missing}",
                severity="WARNING",
                details={"expected": list(expected_abx), "found": list(found_abx)}
            ))
        else:
            report.add(ValidationResult(
                rule="antibiotic_trajectory",
                passed=True,
                message=f"항생제 trajectory 일치: {found_abx}"
            ))

    def _validate_lab_trajectory(self, report: ValidationReport):
        """Lab 값 trajectory 검증"""
        trajectory = self.scenario_data.get('trajectory', {})
        lab_info = trajectory.get('labs', {})

        if not lab_info:
            return

        # WBC trajectory 추출 및 검증
        wbc_values = []
        for hd in sorted(self.generated_records.keys()):
            record_data = self.generated_records[hd]
            docs = record_data.get('documents', [])
            for doc in docs:
                if doc.get('document_type') == 'lab_result':
                    wbc = doc.get('wbc')
                    if wbc is not None:
                        wbc_values.append({"hd": hd, "wbc": float(wbc)})

        # WBC 상승 후 하강 패턴 확인 (폐렴 케이스)
        if len(wbc_values) >= 3:
            # 피크 찾기
            peak_idx = max(range(len(wbc_values)), key=lambda i: wbc_values[i]['wbc'])

            if peak_idx > 0 and peak_idx < len(wbc_values) - 1:
                # 상승 → 하강 패턴 확인
                rising = wbc_values[peak_idx]['wbc'] > wbc_values[0]['wbc']
                falling = wbc_values[-1]['wbc'] < wbc_values[peak_idx]['wbc']

                if rising and falling:
                    report.add(ValidationResult(
                        rule="lab_wbc_trajectory",
                        passed=True,
                        message=f"WBC 상승→하강 패턴 확인 (peak HD{wbc_values[peak_idx]['hd']})"
                    ))
                else:
                    report.add(ValidationResult(
                        rule="lab_wbc_trajectory",
                        passed=False,
                        message="WBC trajectory 패턴 불일치",
                        severity="WARNING",
                        details={"values": wbc_values}
                    ))

    def _validate_vital_signs(self, report: ValidationReport):
        """Vital signs 현실성 검증 + null/빈 값 체크"""
        invalid_vitals = []
        missing_vitals = []

        # 정상 범위 정의
        ranges = {
            'temp': (35.0, 42.0),
            'hr': (40, 180),
            'rr': (8, 40),
            'bp_sys': (60, 220),
            'bp_dia': (30, 140),
            'spo2': (70, 100)
        }

        required_fields = ['temp', 'hr', 'rr', 'bp_sys', 'bp_dia', 'spo2']

        for hd, record_data in self.generated_records.items():
            docs = record_data.get('documents', [])
            for doc in docs:
                if doc.get('document_type') != 'nursing_note':
                    continue

                vs = doc.get('vital_signs', {})
                shift = doc.get('shift', '')

                if not vs:
                    missing_vitals.append({
                        "hd": hd,
                        "shift": shift,
                        "issue": "vital_signs 객체 없음"
                    })
                    continue

                # 필수 필드 null/빈 값 체크
                for field in required_fields:
                    val = vs.get(field)
                    if val is None or val == '' or val == '-':
                        missing_vitals.append({
                            "hd": hd,
                            "shift": shift,
                            "field": field,
                            "value": val
                        })

                # 범위 체크
                for key, (min_val, max_val) in ranges.items():
                    val = vs.get(key)
                    if val is not None and val != '' and val != '-':
                        try:
                            val = float(val)
                            if val < min_val or val > max_val:
                                invalid_vitals.append({
                                    "hd": hd,
                                    "shift": shift,
                                    "key": key,
                                    "value": val,
                                    "range": (min_val, max_val)
                                })
                        except (ValueError, TypeError):
                            pass

        # 결과 리포트
        if missing_vitals:
            report.add(ValidationResult(
                rule="vital_signs_missing",
                passed=False,
                message=f"Vital signs 누락/빈 값: {len(missing_vitals)}건",
                severity="ERROR",
                details={"missing": missing_vitals}
            ))
        else:
            report.add(ValidationResult(
                rule="vital_signs_missing",
                passed=True,
                message="모든 vital signs 필드 존재"
            ))

        if invalid_vitals:
            report.add(ValidationResult(
                rule="vital_signs_range",
                passed=False,
                message=f"비정상 범위 vital signs: {len(invalid_vitals)}건",
                severity="ERROR",
                details={"invalid": invalid_vitals}
            ))
        else:
            report.add(ValidationResult(
                rule="vital_signs_range",
                passed=True,
                message="모든 vital signs 정상 범위"
            ))

    def _validate_cross_document_consistency(self, report: ValidationReport):
        """같은 날 문서 간 일관성 검증"""
        inconsistencies = []

        for hd, record_data in self.generated_records.items():
            docs = record_data.get('documents', [])
            # 같은 날의 SpO2 값 비교
            spo2_values = []
            for doc in docs:
                doc_type = doc.get('document_type')

                if doc_type == 'nursing_note':
                    vs = doc.get('vital_signs', {})
                    spo2 = vs.get('spo2')
                    if spo2:
                        spo2_values.append(('nursing', float(spo2)))

                elif doc_type == 'physician_note':
                    obj = doc.get('objective', {})
                    if isinstance(obj, dict):
                        vs = obj.get('vital_signs', {})
                        spo2 = vs.get('spo2')
                        if spo2:
                            # 숫자만 추출
                            match = re.search(r'(\d+)', str(spo2))
                            if match:
                                spo2_values.append(('physician', float(match.group(1))))

            # SpO2 값 차이 확인
            if len(spo2_values) >= 2:
                vals = [v[1] for v in spo2_values]
                if max(vals) - min(vals) > 5:  # 5% 이상 차이
                    inconsistencies.append({
                        "hd": hd,
                        "type": "spo2",
                        "values": spo2_values
                    })

        if inconsistencies:
            report.add(ValidationResult(
                rule="cross_document_consistency",
                passed=False,
                message=f"문서 간 불일치: {len(inconsistencies)}건",
                severity="WARNING",
                details={"inconsistencies": inconsistencies}
            ))
        else:
            report.add(ValidationResult(
                rule="cross_document_consistency",
                passed=True,
                message="문서 간 일관성 확인됨"
            ))

    def _validate_culture_timing(self, report: ValidationReport):
        """배양 검사 타이밍 검증 (채취 후 2-3일 결과)"""
        cultures = []

        for hd, record_data in self.generated_records.items():
            docs = record_data.get('documents', [])
            for doc in docs:
                if doc.get('document_type') == 'microbiology':
                    cultures.append({
                        "hd": hd,
                        "status": doc.get('result_status', ''),
                        "collection": doc.get('collection_datetime', ''),
                        "result": doc.get('result_datetime', '')
                    })

        # FINAL 결과가 채취 후 적절한 시점에 나오는지 확인
        timing_issues = []
        for culture in cultures:
            if culture['status'] == 'FINAL':
                try:
                    coll_dt = datetime.strptime(culture['collection'].split('T')[0], "%Y-%m-%d")
                    result_dt = datetime.strptime(culture['result'].split('T')[0], "%Y-%m-%d")
                    days_diff = (result_dt - coll_dt).days

                    if days_diff < 2 or days_diff > 5:
                        timing_issues.append({
                            "culture": culture,
                            "days_diff": days_diff
                        })
                except (ValueError, TypeError, AttributeError):
                    pass

        if timing_issues:
            report.add(ValidationResult(
                rule="culture_timing",
                passed=False,
                message=f"배양 검사 타이밍 이상: {len(timing_issues)}건",
                severity="WARNING",
                details={"issues": timing_issues}
            ))
        elif cultures:
            report.add(ValidationResult(
                rule="culture_timing",
                passed=True,
                message="배양 검사 타이밍 적절"
            ))

    def _validate_nursing_shifts(self, report: ValidationReport):
        """간호기록 시프트 검증"""
        shift_counts = {}

        for hd, record_data in self.generated_records.items():
            docs = record_data.get('documents', [])
            nursing_docs = [d for d in docs if d.get('document_type') == 'nursing_note']
            shifts = [d.get('shift', '') for d in nursing_docs]
            shift_counts[hd] = {
                "count": len(nursing_docs),
                "shifts": shifts
            }

        # 하루 2-3개 시프트가 일반적
        issues = []
        for hd, info in shift_counts.items():
            if info['count'] > 0 and info['count'] < 2:
                issues.append({"hd": hd, "count": info['count']})

        if issues:
            report.add(ValidationResult(
                rule="nursing_shifts",
                passed=False,
                message=f"간호기록 시프트 부족: {len(issues)}일",
                severity="INFO",
                details={"issues": issues, "all": shift_counts}
            ))
        else:
            report.add(ValidationResult(
                rule="nursing_shifts",
                passed=True,
                message="간호기록 시프트 적절"
            ))

    def _validate_against_timeline(self, report: ValidationReport):
        """실제 환자 타임라인과 비교"""
        if not self.has_timeline:
            return

        # 입원일 일치 확인
        timeline_admit = self.timeline.admit_date

        # 생성된 기록의 날짜 추출
        generated_dates = set()
        for hd, record_data in self.generated_records.items():
            docs = record_data.get('documents', [])
            for doc in docs:
                for date_field in ['note_datetime', 'study_datetime', 'result_datetime']:
                    dt = doc.get(date_field, '')
                    if dt:
                        date_part = dt.split('T')[0]
                        generated_dates.add(date_part)
                        break

        # 입원일 기준 날짜 계산
        try:
            admit_dt = datetime.strptime(timeline_admit, "%Y-%m-%d")
            expected_dates = set()
            for hd in self.generated_records.keys():
                expected_dt = admit_dt + timedelta(days=hd - 1)  # HD는 1-based
                expected_dates.add(expected_dt.strftime("%Y-%m-%d"))

            if generated_dates and expected_dates:
                matching = generated_dates & expected_dates
                if len(matching) == len(expected_dates):
                    report.add(ValidationResult(
                        rule="timeline_dates",
                        passed=True,
                        message="타임라인 날짜 일치"
                    ))
                else:
                    report.add(ValidationResult(
                        rule="timeline_dates",
                        passed=False,
                        message=f"타임라인 날짜 불일치",
                        severity="WARNING",
                        details={
                            "expected": list(expected_dates),
                            "generated": list(generated_dates)
                        }
                    ))
        except ValueError:
            pass

        # 항생제 trajectory 비교
        timeline_abx = self.timeline.get_antibiotics_trajectory()
        if timeline_abx:
            report.add(ValidationResult(
                rule="timeline_antibiotics",
                passed=True,
                message=f"타임라인 항생제 이력 확인: {len(timeline_abx)}건",
                details={"antibiotics": timeline_abx}
            ))


class EMRValidatorV2:
    """EMR 검증 클래스 (Rule-based Only)"""

    def __init__(self, patient_id: str, output_dir: str = None, scenario_path: str = None):
        self.patient_id = patient_id

        # 출력 디렉토리
        if output_dir:
            self.output_dir = Path(output_dir)
        else:
            self.output_dir = config.OUTPUT_DIR / f"patient_{patient_id}"

        # 시나리오 로드
        if scenario_path:
            self.scenario_path = Path(scenario_path)
        else:
            self.scenario_path = Path(f"patient_scenario/patient_{patient_id}.md")

        self.scenario_data = self._load_scenario()

    def _load_scenario(self) -> Dict:
        """시나리오 파싱"""
        if not self.scenario_path.exists():
            return {}

        try:
            from generator import ScenarioParser
            parser = ScenarioParser(str(self.scenario_path))
            return parser.parse()
        except Exception as e:
            print(f"시나리오 파싱 실패: {e}")
            return {}

    def validate(self) -> ValidationReport:
        """Rule-based 검증만 수행"""
        print(f"\n{'='*60}")
        print(f"EMR Validation - Patient {self.patient_id}")
        print(f"{'='*60}")
        print(f"Output Dir: {self.output_dir}")
        print(f"Scenario: {self.scenario_path}")

        # 생성 기간 정보 출력
        period = self.scenario_data.get('generation_period', {})
        if period:
            print(f"Generation Period: HD {period.get('start_hd', 1)} ~ HD {period.get('end_hd', 10)}")
            print(f"D0 = HD {period.get('d0_hd', 1)}")

        # Rule-based 검증
        print(f"\n[1/1] Rule-based 검증 수행 중...")
        rule_validator = RuleBasedValidator(
            self.patient_id,
            self.output_dir,
            self.scenario_data
        )
        report = rule_validator.validate_all()

        # 결과 출력
        print(f"\n{'─'*40}")
        print("Rule-based 검증 결과:")
        print(f"{'─'*40}")

        for result in report.results:
            status = "✓" if result.passed else ("⚠" if result.severity == "WARNING" else "✗")
            print(f"  {status} [{result.rule}] {result.message}")

        print(f"\n{report.summary()}")

        return report

    def save_report(self, report: ValidationReport, output_path: str = None):
        """검증 리포트 저장 (Markdown)"""
        if output_path is None:
            output_path = self.output_dir / "rule_based_validation_report.md"

        self._save_markdown_report(report, Path(output_path))

    def _save_markdown_report(self, report: ValidationReport, path: Path):
        """Markdown 형식 리포트 생성"""
        period = self.scenario_data.get('generation_period', {})
        profile = self.scenario_data.get('profile', {})

        lines = [
            f"# EMR Rule-based Validation Report",
            f"",
            f"## Patient Information",
            f"| 항목 | 값 |",
            f"|:----:|:--:|",
            f"| Patient ID | {report.patient_id} |",
            f"| 진단명 | {profile.get('admission_reason', '-')} |",
            f"| 연령/성별 | {profile.get('age', '-')}세 {profile.get('gender', '-')} |",
            f"| 생성 기간 | HD {period.get('start_hd', 1)} ~ HD {period.get('end_hd', 10)} (D0 = HD {period.get('d0_hd', 1)}) |",
            f"| 검증일 | {datetime.now().strftime('%Y-%m-%d %H:%M')} |",
            f"",
            f"---",
            f"",
            f"## Validation Summary",
            f"",
            f"| Metric | Count |",
            f"|:------:|:-----:|",
            f"| Total Checks | {report.total_checks} |",
            f"| Passed | {report.passed} |",
            f"| Warnings | {report.warnings} |",
            f"| Errors | {report.errors} |",
            f"",
            f"**Pass Rate**: {report.passed}/{report.total_checks} ({100*report.passed/report.total_checks:.1f}%)" if report.total_checks > 0 else "",
            f"",
            f"---",
            f"",
            f"## Rule-based Validation Details",
            f""
        ]

        # 결과별 그룹화
        passed_results = [r for r in report.results if r.passed]
        warning_results = [r for r in report.results if not r.passed and r.severity == "WARNING"]
        error_results = [r for r in report.results if not r.passed and r.severity == "ERROR"]
        info_results = [r for r in report.results if not r.passed and r.severity == "INFO"]

        # Errors
        if error_results:
            lines.append("### ❌ Errors")
            lines.append("")
            for result in error_results:
                lines.append(f"#### `{result.rule}`")
                lines.append(f"")
                lines.append(f"{result.message}")
                if result.details:
                    lines.append(f"")
                    lines.append(f"<details>")
                    lines.append(f"<summary>Details</summary>")
                    lines.append(f"")
                    lines.append(f"```json")
                    lines.append(json.dumps(result.details, indent=2, ensure_ascii=False))
                    lines.append(f"```")
                    lines.append(f"</details>")
                lines.append(f"")

        # Warnings
        if warning_results:
            lines.append("### ⚠️ Warnings")
            lines.append("")
            for result in warning_results:
                lines.append(f"#### `{result.rule}`")
                lines.append(f"")
                lines.append(f"{result.message}")
                if result.details:
                    lines.append(f"")
                    lines.append(f"<details>")
                    lines.append(f"<summary>Details</summary>")
                    lines.append(f"")
                    lines.append(f"```json")
                    lines.append(json.dumps(result.details, indent=2, ensure_ascii=False))
                    lines.append(f"```")
                    lines.append(f"</details>")
                lines.append(f"")

        # Info (not passed but INFO severity)
        if info_results:
            lines.append("### ℹ️ Info")
            lines.append("")
            for result in info_results:
                lines.append(f"- `{result.rule}`: {result.message}")
            lines.append("")

        # Passed
        if passed_results:
            lines.append("### ✅ Passed")
            lines.append("")
            lines.append("| Rule | Message |")
            lines.append("|:-----|:--------|")
            for result in passed_results:
                lines.append(f"| `{result.rule}` | {result.message} |")
            lines.append("")

        lines.extend([
            f"---",
            f"",
            f"*Generated by EMR Validation v2 (Rule-based Only)*",
            f"*Date: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}*"
        ])

        with open(path, 'w', encoding='utf-8') as f:
            f.write('\n'.join(lines))

        print(f"Markdown 리포트 저장: {path}")


def main():
    """메인 실행"""
    parser = argparse.ArgumentParser(
        description='EMR Generator v2 - Rule-based Validation Only'
    )
    parser.add_argument(
        'patient_id',
        type=str,
        help='환자 ID (예: 17650289)'
    )
    parser.add_argument(
        '--output-dir',
        type=str,
        default=None,
        help='생성된 기록 디렉토리 (기본값: outputs/patient_{id})'
    )
    parser.add_argument(
        '--scenario',
        type=str,
        default=None,
        help='시나리오 파일 경로'
    )
    parser.add_argument(
        '--save',
        action='store_true',
        help='검증 리포트 저장'
    )

    args = parser.parse_args()

    validator = EMRValidatorV2(
        patient_id=args.patient_id,
        output_dir=args.output_dir,
        scenario_path=args.scenario
    )

    report = validator.validate()

    if args.save:
        validator.save_report(report)

    # 종료 코드 (에러가 있으면 1)
    return 1 if report.errors > 0 else 0


if __name__ == "__main__":
    import sys
    sys.exit(main())

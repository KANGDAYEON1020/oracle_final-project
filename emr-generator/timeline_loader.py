"""
EMR Generator v2 - Timeline Loader
타임라인 JSON 파싱 및 날짜별 데이터 추출 유틸리티
"""
import json
from pathlib import Path
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional
from collections import defaultdict

import config


class TimelineLoader:
    """환자 타임라인 JSON 로더"""

    def __init__(self, patient_id: str):
        self.patient_id = patient_id
        self.filepath = config.TIMELINE_DIR / f"patient_{patient_id}.json"
        self.data = self._load()
        self.admission = self._get_first_admission()

    def _load(self) -> Dict:
        """타임라인 JSON 로드"""
        if not self.filepath.exists():
            raise FileNotFoundError(f"타임라인 파일 없음: {self.filepath}")
        with open(self.filepath, 'r', encoding='utf-8') as f:
            return json.load(f)

    def _get_first_admission(self) -> Dict:
        """첫 번째 입원 정보 반환"""
        admissions = self.data.get('admissions', [])
        if not admissions:
            raise ValueError(f"입원 정보 없음: {self.patient_id}")
        return admissions[0]

    @property
    def patient_summary(self) -> Dict:
        """환자 기본 정보"""
        return self.data.get('patient_summary', {})

    @property
    def admit_date(self) -> str:
        """입원일"""
        return self.admission.get('admit_date', '')

    @property
    def discharge_date(self) -> str:
        """퇴원일"""
        return self.admission.get('discharge_date', '')

    @property
    def los_days(self) -> int:
        """재원 일수"""
        return int(self.admission.get('los_days', 10))

    @property
    def diagnoses(self) -> List[Dict]:
        """진단 목록"""
        return self.admission.get('diagnoses', [])

    @property
    def timeline(self) -> List[Dict]:
        """전체 타임라인 이벤트"""
        return self.admission.get('timeline', [])

    def get_events_for_hd(self, hd: int) -> Dict[str, List[Dict]]:
        """특정 Hospital Day의 이벤트를 타입별로 분류하여 반환

        Args:
            hd: Hospital Day (1-based, HD 1 = 입원일)

        Returns:
            {
                "medications": [...],
                "labs": [...],
                "cultures": [...],
                "vitals": [...]
            }
        """
        target_date = self._get_date_for_hd(hd)
        if not target_date:
            return {}

        events = defaultdict(list)

        for event in self.timeline:
            event_datetime = event.get('datetime', '')
            if not event_datetime:
                continue

            event_date = event_datetime.split(' ')[0]
            if event_date == target_date:
                event_type = event.get('type', 'other')

                # 이벤트 타입 분류
                if 'medication' in event_type:
                    events['medications'].append(event)
                elif 'lab' in event_type:
                    events['labs'].append(event)
                elif 'culture' in event_type or 'micro' in event_type:
                    events['cultures'].append(event)
                elif 'vital' in event_type:
                    events['vitals'].append(event)
                else:
                    events['other'].append(event)

        return dict(events)

    def get_active_medications(self, hd: int) -> List[Dict]:
        """특정 Hospital Day에 활성화된 약물 목록

        Args:
            hd: Hospital Day (1-based)

        Returns:
            현재 복용 중인 약물 리스트
        """
        target_date = self._get_date_for_hd(hd)
        if not target_date:
            return []

        target_dt = datetime.strptime(target_date, "%Y-%m-%d")
        active_meds = {}

        for event in self.timeline:
            event_type = event.get('type', '')
            if 'medication' not in event_type:
                continue

            event_datetime = event.get('datetime', '')
            if not event_datetime:
                continue

            event_dt = datetime.strptime(event_datetime.split(' ')[0], "%Y-%m-%d")

            # 해당 날짜 이전 또는 당일의 이벤트만
            if event_dt > target_dt:
                continue

            med_name = event.get('name', '')
            status = event.get('status', '')

            if 'start' in event_type.lower():
                active_meds[med_name] = event
            elif 'stop' in event_type.lower() or status == 'Discontinued':
                # 중단된 약물은 제거
                if med_name in active_meds:
                    del active_meds[med_name]

        return list(active_meds.values())

    def get_latest_labs(self, hd: int) -> Dict[str, Any]:
        """특정 Hospital Day까지의 최신 Lab 값

        Args:
            hd: Hospital Day (1-based)

        Returns:
            {lab_name: value, ...}
        """
        target_date = self._get_date_for_hd(hd)
        if not target_date:
            return {}

        target_dt = datetime.strptime(target_date, "%Y-%m-%d")
        latest_labs = {}

        for event in self.timeline:
            if event.get('type') != 'lab':
                continue

            event_datetime = event.get('datetime', '')
            if not event_datetime:
                continue

            event_dt = datetime.strptime(event_datetime.split(' ')[0], "%Y-%m-%d")

            if event_dt > target_dt:
                continue

            lab_name = event.get('name', '')
            lab_value = event.get('value')

            if lab_name and lab_value is not None:
                latest_labs[lab_name] = {
                    'value': lab_value,
                    'datetime': event_datetime,
                    'unit': event.get('unit', '')
                }

        return latest_labs

    def get_pending_cultures(self, hd: int) -> List[Dict]:
        """특정 Hospital Day에 결과 대기 중인 배양 검사

        채취 후 2-3일 이내면 pending, 이후면 결과 나옴

        Args:
            hd: Hospital Day (1-based)

        Returns:
            pending 상태인 배양 검사 리스트
        """
        pending = []
        target_date = self._get_date_for_hd(hd)
        if not target_date:
            return pending

        target_dt = datetime.strptime(target_date, "%Y-%m-%d")

        for event in self.timeline:
            if 'culture' not in (event.get('type') or '').lower():
                continue

            collection_datetime = event.get('datetime', '')
            if not collection_datetime:
                continue

            collection_dt = datetime.strptime(collection_datetime.split(' ')[0], "%Y-%m-%d")

            # 채취일 이후 ~ 채취일+3일 이내면 pending
            days_since_collection = (target_dt - collection_dt).days

            if 0 <= days_since_collection < 3:
                event_copy = event.copy()
                event_copy['days_pending'] = days_since_collection
                if days_since_collection == 0:
                    event_copy['status'] = 'COLLECTED'
                elif days_since_collection == 1:
                    event_copy['status'] = 'PRELIMINARY'
                else:
                    event_copy['status'] = 'PENDING'
                pending.append(event_copy)

        return pending

    def get_culture_results(self, hd: int) -> List[Dict]:
        """특정 Hospital Day에 결과가 나온 배양 검사

        Args:
            hd: Hospital Day (1-based)

        Returns:
            결과가 나온 배양 검사 리스트
        """
        results = []
        target_date = self._get_date_for_hd(hd)
        if not target_date:
            return results

        target_dt = datetime.strptime(target_date, "%Y-%m-%d")

        for event in self.timeline:
            if 'culture' not in (event.get('type') or '').lower():
                continue

            collection_datetime = event.get('datetime', '')
            if not collection_datetime:
                continue

            collection_dt = datetime.strptime(collection_datetime.split(' ')[0], "%Y-%m-%d")

            # 채취일+3일 = 결과 보고일
            result_date = collection_dt + timedelta(days=3)

            if result_date.date() == target_dt.date():
                event_copy = event.copy()
                event_copy['status'] = 'FINAL'
                event_copy['result_date'] = result_date.strftime("%Y-%m-%d")
                results.append(event_copy)

        return results

    def _get_date_for_hd(self, hd: int) -> Optional[str]:
        """입원일 기준 Hospital Day의 날짜 반환 (HD 1 = 입원일)"""
        if not self.admit_date:
            return None
        admit_dt = datetime.strptime(self.admit_date, "%Y-%m-%d")
        target_dt = admit_dt + timedelta(days=hd - 1)  # HD는 1-based
        return target_dt.strftime("%Y-%m-%d")

    def get_hd_summary(self, hd: int) -> Dict[str, Any]:
        """특정 Hospital Day의 전체 요약

        Args:
            hd: Hospital Day (1-based)

        Returns:
            해당 HD의 이벤트, 약물, Lab 등 전체 요약
        """
        return {
            'hd': hd,
            'date': self._get_date_for_hd(hd),
            'events': self.get_events_for_hd(hd),
            'active_medications': self.get_active_medications(hd),
            'latest_labs': self.get_latest_labs(hd),
            'pending_cultures': self.get_pending_cultures(hd),
            'culture_results': self.get_culture_results(hd)
        }

    def get_antibiotics_trajectory(self) -> List[Dict]:
        """항생제 변경 이력 추출

        Returns:
            [
                {"hd": 1, "action": "start", "drug": "Levofloxacin"},
                {"hd": 3, "action": "stop", "drug": "Levofloxacin"},
                {"hd": 3, "action": "start", "drug": "Cefepime"},
                ...
            ]
        """
        antibiotics = []

        # 일반적인 항생제 목록
        abx_keywords = [
            'levofloxacin', 'cefepime', 'linezolid', 'cefpodoxime',
            'vancomycin', 'meropenem', 'piperacillin', 'azithromycin',
            'ceftriaxone', 'ciprofloxacin', 'metronidazole', 'amoxicillin'
        ]

        admit_dt = datetime.strptime(self.admit_date, "%Y-%m-%d")

        for event in self.timeline:
            event_type = (event.get('type') or '').lower()
            if 'medication' not in event_type:
                continue

            med_name = (event.get('name') or '').lower()

            # 항생제인지 확인
            is_abx = any(abx in med_name for abx in abx_keywords)
            if not is_abx:
                continue

            event_datetime = event.get('datetime', '')
            if not event_datetime:
                continue

            event_dt = datetime.strptime(event_datetime.split(' ')[0], "%Y-%m-%d")
            hd = (event_dt - admit_dt).days + 1  # HD는 1-based

            action = 'start' if 'start' in event_type else 'stop'
            status = event.get('status', '')
            if status == 'Discontinued':
                action = 'stop'

            antibiotics.append({
                'hd': hd,
                'action': action,
                'drug': event.get('name', ''),
                'route': event.get('route', ''),
                'datetime': event_datetime
            })

        # HD순 정렬
        antibiotics.sort(key=lambda x: (x['hd'], x['datetime']))

        return antibiotics


def load_timeline(patient_id: str) -> TimelineLoader:
    """타임라인 로더 생성 헬퍼 함수"""
    return TimelineLoader(patient_id)


# =============================================================================
# 테스트
# =============================================================================
if __name__ == "__main__":
    print("=" * 60)
    print("Timeline Loader Test")
    print("=" * 60)

    try:
        loader = TimelineLoader("17650289")

        print(f"\n환자 ID: {loader.patient_id}")
        print(f"입원일: {loader.admit_date}")
        print(f"퇴원일: {loader.discharge_date}")
        print(f"재원 일수: {loader.los_days}")

        print(f"\n환자 요약: {loader.patient_summary}")

        print(f"\n진단 (상위 3개):")
        for dx in loader.diagnoses[:3]:
            print(f"  - {dx.get('description')}")

        print(f"\nHD 1 이벤트:")
        hd1_events = loader.get_events_for_hd(1)
        for event_type, events in hd1_events.items():
            print(f"  {event_type}: {len(events)}건")

        print(f"\nHD 3 활성 약물:")
        hd3_meds = loader.get_active_medications(3)
        for med in hd3_meds[:5]:
            print(f"  - {med.get('name')}")

        print(f"\n항생제 경과:")
        abx = loader.get_antibiotics_trajectory()
        for item in abx:
            print(f"  HD{item['hd']}: {item['action']} - {item['drug']}")

        print("\n✅ Timeline loader test completed!")

    except FileNotFoundError as e:
        print(f"❌ 파일 없음: {e}")
    except Exception as e:
        print(f"❌ 오류: {e}")

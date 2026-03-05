"""
EMR Generator v2 - 순차 생성기

설계:
1. 시나리오 마크다운을 파싱하여 구조화된 데이터로 변환
2. 타임라인 JSON을 로드하여 실제 데이터 참조
3. D0부터 LOS 끝까지 순차적으로 생성
4. 이전 생성 결과를 대화 맥락에 포함하여 일관성 유지
5. OpenAI GPT API를 통해 LLM 호출
6. 날짜별 요약 md 자동 생성
"""
import re
import json
from pathlib import Path
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any

from prompt import SYSTEM_PROMPT, build_full_prompt
from timeline_loader import TimelineLoader
import config

# Lazy import for openai
openai_client = None

# Timeline Lab 이름 -> Schema 필드 매핑
LAB_NAME_MAPPING = {
    'White Blood Cells': 'wbc',
    'Creatinine': 'cr',
    'Hemoglobin': 'hgb',
    'Platelet Count': 'plt',
    'Urea Nitrogen': 'bun',
    'Sodium': 'na',
    'Potassium': 'k',
    'Glucose': 'glucose',
    'Lactate': 'lactate',
    'C-Reactive Protein': 'crp',
    'CRP': 'crp',
    'Procalcitonin': 'procalcitonin',
}


class ScenarioParser:
    """환자 시나리오 마크다운 파서"""

    def __init__(self, filepath: str):
        self.filepath = Path(filepath)
        self.content = self._load()

    def _load(self) -> str:
        with open(self.filepath, 'r', encoding='utf-8') as f:
            return f.read()

    def parse(self) -> Dict[str, Any]:
        """마크다운을 구조화된 데이터로 파싱"""
        return {
            'profile': self._parse_profile(),
            'generation_period': self._parse_generation_period(),
            'narrative': self._parse_narrative(),
            'trajectory': self._parse_trajectory(),
            'events_by_hd': self._parse_events_by_hd(),
            'key_events': self._get_key_events(),
            'rules': self._parse_rules()
        }

    def _parse_profile(self) -> Dict[str, Any]:
        """환자 프로필 파싱"""
        profile = {}

        # Subject ID
        match = re.search(r'Subject id\s*:\s*(\d+)', self.content)
        profile['subject_id'] = match.group(1) if match else 'unknown'

        # 나이/성별
        match = re.search(r'\*\*(\d+)세\s+(여성|남성)\*\*', self.content)
        if match:
            profile['age'] = int(match.group(1))
            profile['gender'] = match.group(2)

        # 입원 사유
        match = re.search(r'\*\*Admission\s+([^*]+)\*\*', self.content)
        if match:
            profile['admission_reason'] = match.group(1).strip()

        # LOS
        match = re.search(r'LOS\s+약\s+(\d+)일', self.content)
        profile['los_days'] = int(match.group(1)) if match else 10

        # 기저질환
        match = re.search(r'기저질환[^:]*:\s*\*\*([^*]+)\*\*', self.content)
        if match:
            comorbids = re.split(r'[,、]', match.group(1))
            profile['comorbidities'] = [c.strip() for c in comorbids if c.strip()]

        # 신기능
        match = re.search(r'신기능:\s*[^*]*\*\*([^*]+)\*\*', self.content)
        if match:
            profile['renal_note'] = match.group(1).strip()

        return profile

    def _parse_generation_period(self) -> Dict[str, Any]:
        """합성데이터 생성 기간 + D0 기준점 파싱"""
        period = {}
        
        # "**합성데이터 생성 기간**: HD 1 ~ HD 8 (총 8일)" 또는
        # "합성데이터 생성 기간: HD 14 ~ HD 29"
        match = re.search(
            r'\*{0,2}합성데이터 생성 기간\*{0,2}[:\s]*HD\s*(\d+)\s*~\s*HD\s*(\d+)',
            self.content
        )
        if match:
            period['start_hd'] = int(match.group(1))
            period['end_hd'] = int(match.group(2))
        else:
            # 파싱 실패 시 기본값 (LOS 기반)
            los = self._parse_profile().get('los_days', 10)
            period['start_hd'] = 1
            period['end_hd'] = los
            print(f"  ⚠️ 생성 기간 파싱 실패, LOS 기반 기본값 사용: HD 1 ~ HD {los}")
        
        # "D0로 기준 잡음. (Hospital Day 16)" 또는 "(HD 1)"
        match = re.search(
            r'D0[로를]?\s*기준[^(]*\((?:Hospital Day|HD)\s*(\d+)\)',
            self.content
        )
        if match:
            period['d0_hd'] = int(match.group(1))
        else:
            # 기본값: start_hd가 D0
            period['d0_hd'] = period.get('start_hd', 1)
        
        period['total_days'] = period['end_hd'] - period['start_hd'] + 1
        
        return period
    
    def _parse_events_by_hd(self) -> Dict[int, Dict[str, Any]]:
        """HD별 이벤트 파싱"""
        events = {}
        
        # "### HD 16 (HAP Onset / D0) — 10월 3일" 패턴
        hd_section_pattern = r'###\s*HD\s*(\d+)\s*\(([^)]+)\)(?:[^—\n]*—\s*(\d+월\s*\d+일))?'
        
        # 각 HD 섹션 찾기
        for match in re.finditer(hd_section_pattern, self.content):
            hd = int(match.group(1))
            event_label = match.group(2).strip()
            date_str = match.group(3).strip() if match.group(3) else ''
            
            # 해당 HD 섹션의 전체 내용 추출
            section_start = match.end()
            next_section = re.search(r'\n###\s*HD\s*\d+|\n##\s+', self.content[section_start:])
            section_end = section_start + next_section.start() if next_section else len(self.content)
            section_content = self.content[section_start:section_end]
            
            # 필수 이벤트 추출
            required_events = []
            req_match = re.search(
                r'\*\*필수 이벤트\*\*(.*?)(?=\*\*문서별|$)',
                section_content,
                re.DOTALL
            )
            if req_match:
                for line in req_match.group(1).strip().split('\n'):
                    line = line.strip()
                    if line.startswith('-'):
                        required_events.append(line[1:].strip())
            
            # 문서별 가이드 추출
            doc_guides = {}
            guide_match = re.search(
                r'\*\*문서별 가이드\*\*(.*?)(?=\n---|\n###|$)',
                section_content,
                re.DOTALL
            )
            if guide_match:
                guide_text = guide_match.group(1)
                for line in guide_text.strip().split('\n'):
                    line = line.strip()
                    if line.startswith('-'):
                        # "- 간호기록: `내용`" 형태 파싱
                        doc_match = re.match(r'-\s*(간호기록|의사\s*기록|CXR|Lab|Micro)[:\s]*`?([^`]*)`?', line)
                        if doc_match:
                            doc_type = doc_match.group(1).replace(' ', '')
                            doc_guides[doc_type] = doc_match.group(2).strip()
            
            events[hd] = {
                'label': event_label,
                'date': date_str,
                'required_events': required_events,
                'doc_guides': doc_guides
            }
        
        return events

    def _parse_narrative(self) -> str:
        """핵심 서사 파싱"""
        match = re.search(
            r'###\s*1\)\s*핵심 서사[^\n]*\n(.*?)(?=\n##|\n###\s*\d|$)',
            self.content,
            re.DOTALL
        )
        if match:
            return match.group(1).strip()
        return ""

    def _parse_trajectory(self) -> Dict[str, Any]:
        """Trajectory 데이터 파싱 (O2, 항생제, Lab, 배양)"""
        trajectory = {
            'o2': [],
            'antibiotics': [],
            'labs': {},
            'cultures': []
        }

        # O2 trajectory
        o2_match = re.search(r'`O2_trajectory`[:\s]*(.*?)(?=`[a-z_]+`|\n\d+\.|\n##|$)',
                            self.content, re.DOTALL)
        if o2_match:
            o2_text = o2_match.group(1)
            for m in re.finditer(r'D(\d+)\s+(\d+L[^→\n]*)', o2_text):
                trajectory['o2'].append({'day': int(m.group(1)), 'value': m.group(2).strip()})

        # Antibiotic trajectory
        abx_section = re.search(r'`antibiotic_trajectory`[:\s]*(.*?)(?=`[a-z_]+`|\n\d+\.|\n##|$)',
                               self.content, re.DOTALL)
        if abx_section:
            abx_text = abx_section.group(1)
            for line in abx_text.split('\n'):
                if 'start' in line.lower() or '시작' in line:
                    day_m = re.search(r'D(\d+)', line)
                    drug_m = re.search(r'(levofloxacin|cefepime|linezolid|cefpodoxime|vancomycin|meropenem)', line, re.I)
                    if day_m and drug_m:
                        trajectory['antibiotics'].append({
                            'day': int(day_m.group(1)),
                            'action': 'start',
                            'drug': drug_m.group(1)
                        })
                elif 'stop' in line.lower() or '중단' in line:
                    day_m = re.search(r'D(\d+)', line)
                    drug_m = re.search(r'(levo|cefepime|linezolid)', line, re.I)
                    if day_m and drug_m:
                        trajectory['antibiotics'].append({
                            'day': int(day_m.group(1)),
                            'action': 'stop',
                            'drug': drug_m.group(1)
                        })

        # Lab trajectory
        lab_section = re.search(r'`lab_trajectory`[:\s]*(.*?)(?=`[a-z_]+`|\n\d+\.|\n##|$)',
                               self.content, re.DOTALL)
        if lab_section:
            lab_text = lab_section.group(1)

            # WBC
            wbc_m = re.search(r'WBC:\s*([\d.]+)[^→]*→\s*([\d~]+)', lab_text)
            if wbc_m:
                trajectory['labs']['WBC'] = [
                    {'day': 0, 'value': wbc_m.group(1)},
                    {'day': 2, 'value': wbc_m.group(2)}
                ]

            # Cr
            cr_m = re.search(r'Cr:\s*([\d.]+)[^→]*→\s*([\d.~]+)', lab_text)
            if cr_m:
                trajectory['labs']['Cr'] = [
                    {'day': 0, 'value': cr_m.group(1)},
                    {'day': 2, 'value': cr_m.group(2)}
                ]

            # Lactate
            lac_m = re.search(r'Lactate:\s*([\d.]+)\s+at\s+D(\d+)', lab_text)
            if lac_m:
                trajectory['labs']['Lactate'] = [
                    {'day': int(lac_m.group(2)), 'value': lac_m.group(1)}
                ]

        # Culture trajectory
        culture_section = re.search(r'`culture_trajectory`[:\s]*(.*?)(?=\n\d+\.|\n##|$)',
                                   self.content, re.DOTALL)
        if culture_section:
            culture_text = culture_section.group(1)
            if 'blood' in culture_text.lower():
                trajectory['cultures'].append({
                    'type': 'blood',
                    'result': 'pending → negative'
                })
            if 'sputum' in culture_text.lower():
                trajectory['cultures'].append({
                    'type': 'sputum',
                    'result': 'yeast only (colonization)'
                })

        return trajectory

    def _parse_events(self) -> Dict[int, List[str]]:
        """날짜별 필수 이벤트 파싱"""
        events = {}

        # D0, D2, D4, D7, D9~D10 섹션 찾기
        day_patterns = [
            (0, r'###\s*D0[^#]+(.*?)(?=\n###|\n##|$)'),
            (2, r'###\s*D2[^#]+(.*?)(?=\n###|\n##|$)'),
            (4, r'###\s*D4[^#]+(.*?)(?=\n###|\n##|$)'),
            (7, r'###\s*D7[^#]+(.*?)(?=\n###|\n##|$)'),
            (9, r'###\s*D9~?D?10[^#]+(.*?)(?=\n###|\n##|$)')
        ]

        for day, pattern in day_patterns:
            match = re.search(pattern, self.content, re.DOTALL)
            if match:
                section = match.group(1)
                # 필수 이벤트 추출
                event_match = re.search(r'\*\*필수 이벤트\*\*(.*?)(?=\*\*문서별|\n###|\n##|$)',
                                       section, re.DOTALL)
                if event_match:
                    event_lines = []
                    for line in event_match.group(1).strip().split('\n'):
                        line = line.strip()
                        if line.startswith('-'):
                            event_lines.append(line[1:].strip())
                    events[day] = event_lines

        return events

    def _get_key_events(self) -> Dict[int, str]:
        """핵심 이벤트 날짜와 설명"""
        return {
            0: "입원/초기평가",
            2: "악화 + 항생제 escalation",
            4: "Sepsis precursor 경계 이벤트",
            7: "호전 전환점",
            9: "Step-down + 퇴원 준비",
            10: "퇴원"
        }

    def _parse_rules(self) -> List[str]:
        """생성 규칙 파싱"""
        rules = []
        rules_match = re.search(r'문서 생성 규칙[^\n]*\n(.*?)(?=\n##|$)',
                               self.content, re.DOTALL)
        if rules_match:
            for line in rules_match.group(1).strip().split('\n'):
                line = line.strip()
                if line.startswith('-'):
                    rules.append(line[1:].strip())

        if not rules:
            rules = [
                "진단 확정 표현 금지 (confirmed/확진 금지)",
                "각 문서에 근거 스팬 1줄 포함"
            ]

        return rules


class EMRGenerator:
    """EMR 순차 생성기"""

    def __init__(self, model_name: str = None, output_dir: str = None):
        self.model_name = model_name or config.MODEL_NAME
        self.output_dir = Path(output_dir) if output_dir else config.OUTPUT_DIR
        self.conversation_history = []

    def generate_for_patient(self, scenario_path: str) -> Dict[str, Any]:
        """환자 시나리오에 대한 전체 EMR 생성"""

        # 시나리오 파싱
        print(f"\n{'='*60}")
        print("1. 시나리오 파싱 중...")
        parser = ScenarioParser(scenario_path)
        scenario_data = parser.parse()

        profile = scenario_data['profile']
        subject_id = profile.get('subject_id', 'unknown')

        period = scenario_data['generation_period']
        start_hd = period['start_hd']
        end_hd = period['end_hd']
        d0_hd = period['d0_hd']
        total_days = period['total_days']

        print(f"   환자 ID: {subject_id}")
        print(f"   나이/성별: {profile.get('age')}세 {profile.get('gender')}")
        print(f"   생성 기간: HD {start_hd} ~ HD {end_hd} ({total_days}일)")
        print(f"   D0 기준: HD {d0_hd}")

        # 타임라인 로드 시도
        print("\n2. 타임라인 데이터 로드 중...")
        timeline_loader = None
        admit_date = None
        try:
            timeline_loader = TimelineLoader(subject_id)
            admit_date = timeline_loader.admit_date
            print(f"   입원일: {admit_date}")
            print(f"   타임라인 이벤트: {len(timeline_loader.timeline)}건")
        except FileNotFoundError:
            print("   ⚠️ 타임라인 파일 없음, 시나리오 데이터만 사용")
            admit_date = datetime.now().strftime("%Y-%m-%d")

        # 환자별 출력 디렉토리
        patient_dir = self.output_dir / f"patient_{subject_id}"
        patient_dir.mkdir(exist_ok=True, parents=True)

        # 대화 초기화 (System prompt)
        self._init_conversation()

        # 전체 결과 저장
        all_records = []

        print(f"\n3. EMR 순차 생성 시작 (HD {start_hd} ~ HD {end_hd})")
        print(f"{'='*60}")

        # HD 범위로 순차 생성
        for hd in range(start_hd, end_hd + 1):
            d_number = hd - d0_hd  # 음수 가능 (D-2, D-1, ...)
            d_display = f"D{d_number:+d}" if d_number != 0 else "D0"
            print(f"\n[HD{hd} / {d_display}] 생성 중...", end=" ")

            # 해당 HD의 타임라인 요약
            day_summary = None
            if timeline_loader:
                day_summary = timeline_loader.get_hd_summary(hd)

            # 프롬프트 생성
            daily_prompt = build_full_prompt(
                scenario_data=scenario_data,
                hd=hd,
                d_number=d_number,
                admit_date=admit_date,
                day_summary=day_summary,
                previous_records=all_records[-3:] if all_records else None
            )

            # LLM 호출
            response = self._call_llm(daily_prompt)

            # 결과 저장
            record = {
                'hd': hd,
                'd_number': d_number,
                'date': self._get_date_for_hd(admit_date, hd),
                'content': response,
                'day_summary': day_summary,
                'generated_at': datetime.now().isoformat()
            }
            all_records.append(record)

            # 파일로 저장 (timeline_loader 전달하여 Lab 패치)
            self._save_daily_record(record, patient_dir, timeline_loader)

            print("✓")

        # 전체 요약 md 생성
        self._save_summary_markdown(scenario_data, all_records, patient_dir, admit_date)

        # 전체 요약 JSON 저장
        self._save_summary_json(scenario_data, all_records, patient_dir)

        print(f"\n{'='*60}")
        print(f"4. 생성 완료!")
        print(f"   출력 위치: {patient_dir}")
        print(f"   총 {len(all_records)}일 기록 생성")
        print(f"   요약 파일: generation_summary.md")

        return {
            'patient_id': subject_id,
            'records': all_records,
            'output_dir': str(patient_dir)
        }

    def _init_conversation(self):
        """대화 초기화 - System prompt 설정"""
        self.conversation_history = [
            {'role': 'system', 'content': SYSTEM_PROMPT}
        ]

    def _call_llm(self, prompt: str) -> str:
        """OpenAI GPT API 호출"""
        global openai_client
        if openai_client is None:
            from openai import OpenAI
            openai_client = OpenAI(api_key=config.OPENAI_API_KEY)

        try:
            # 현재 요청 추가
            messages = self.conversation_history + [
                {'role': 'user', 'content': prompt}
            ]

            response = openai_client.chat.completions.create(
                model=self.model_name,
                messages=messages,
                temperature=0.7,
                max_tokens=4096
            )

            assistant_response = response.choices[0].message.content

            # 대화 히스토리에 추가 (최근 2턴만 유지하여 컨텍스트 관리)
            self.conversation_history.append({'role': 'user', 'content': prompt})
            self.conversation_history.append({'role': 'assistant', 'content': assistant_response})

            # 히스토리가 너무 길어지면 오래된 것 제거 (system prompt는 유지)
            if len(self.conversation_history) > 7:  # system + 3 turns
                self.conversation_history = [self.conversation_history[0]] + self.conversation_history[-4:]

            return assistant_response

        except Exception as e:
            error_msg = f"[ERROR] LLM 호출 실패: {str(e)}"
            print(error_msg)
            return error_msg

    # def _get_date_for_day(self, admit_date: str, day: int) -> str:
    #     """입원일 기준 특정 일차의 날짜 반환"""
    #     try:
    #         admit_dt = datetime.strptime(admit_date, "%Y-%m-%d")
    #         target_dt = admit_dt + timedelta(days=day)
    #         return target_dt.strftime("%Y-%m-%d")
    #     except:
    #         return f"D{day}"
        
    def _get_date_for_hd(self, admit_date: str, hd: int) -> str:
        """입원일 기준 Hospital Day의 실제 날짜 반환 (HD 1 = 입원일)"""
        try:
            admit_dt = datetime.strptime(admit_date, "%Y-%m-%d")
            target_dt = admit_dt + timedelta(days=hd - 1)  # HD는 1-based
            return target_dt.strftime("%Y-%m-%d")
        except:
            return f"HD{hd}"

    def _parse_json_response(self, content: str) -> List[Dict]:
        """LLM 응답에서 JSON 배열 파싱 + raw_text 자동 생성"""
        # 마크다운 코드블록 제거
        cleaned = content.strip()
        if cleaned.startswith("```json"):
            cleaned = cleaned[7:]
        if cleaned.startswith("```"):
            cleaned = cleaned[3:]
        if cleaned.endswith("```"):
            cleaned = cleaned[:-3]
        cleaned = cleaned.strip()

        try:
            parsed = json.loads(cleaned)
            if isinstance(parsed, list):
                documents = parsed
            else:
                documents = [parsed]
            
            # raw_text 자동 생성 (없거나 비어있으면)
            for doc in documents:
                if not doc.get('raw_text'):
                    doc['raw_text'] = self._generate_raw_text(doc)
            
            return documents
            
        except json.JSONDecodeError as e:
            print(f"  [WARN] JSON 파싱 실패: {e}")
            return [{"parse_error": str(e), "raw_content": content[:1000]}]

    def _patch_lab_values_from_timeline(
        self,
        documents: List[Dict],
        hd: int,
        timeline_loader
    ) -> List[Dict]:
        """시나리오에 명시되지 않은 Lab 값을 Timeline에서 패치

        Args:
            documents: LLM이 생성한 문서 리스트
            hd: Hospital Day
            timeline_loader: TimelineLoader 인스턴스

        Returns:
            패치된 문서 리스트
        """
        if not timeline_loader:
            return documents

        try:
            latest_labs = timeline_loader.get_latest_labs(hd)
        except Exception:
            return documents

        if not latest_labs:
            return documents

        for doc in documents:
            if doc.get('document_type') != 'lab_result':
                continue

            patched_count = 0

            # Timeline Lab -> Schema 필드 매핑하여 패치
            for timeline_name, schema_field in LAB_NAME_MAPPING.items():
                if timeline_name not in latest_labs:
                    continue

                # 현재 값이 None인 경우에만 패치
                if doc.get(schema_field) is not None:
                    continue

                lab_data = latest_labs[timeline_name]
                value = lab_data.get('value') if isinstance(lab_data, dict) else lab_data

                # 값이 없거나 무효한 경우 스킵
                if value is None or value == '' or value == '___':
                    continue

                # float 변환 시도
                try:
                    doc[schema_field] = float(value)
                    patched_count += 1
                except (ValueError, TypeError):
                    # 숫자 변환 실패시 문자열로 저장
                    doc[schema_field] = value
                    patched_count += 1

            if patched_count > 0:
                # raw_text 재생성 (패치된 값 반영)
                doc['raw_text'] = self._generate_raw_text(doc)

        return documents

    def _save_daily_record(self, record: Dict, output_dir: Path, timeline_loader=None):
        """일별 기록 JSON 파일로 저장"""
        hd = record['hd']
        d_number = record['d_number']
        content = record['content']

        # JSON 파싱 시도
        documents = self._parse_json_response(content)

        # Timeline에서 누락된 Lab 값 패치
        if timeline_loader:
            documents = self._patch_lab_values_from_timeline(documents, hd, timeline_loader)

        # JSON 파일로 저장
        output_data = {
            "hd": hd,
            "d_number": d_number,
            "date": record.get('date', ''),
            "generated_at": record['generated_at'],
            "documents": documents
        }

        # 파일명: hd_14_d-2.json, hd_16_d0.json, hd_18_d+2.json 형태
        if d_number == 0:
            d_str = "d0"
        elif d_number > 0:
            d_str = f"d+{d_number}"
        else:
            d_str = f"d{d_number}"  # 음수는 자동으로 d-2 형태
        
        filepath = output_dir / f"hd_{hd:02d}_{d_str}.json"
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(output_data, f, indent=2, ensure_ascii=False)

    def _save_summary_markdown(self, scenario_data: Dict, records: List[Dict], output_dir: Path, admit_date: str):
        """날짜별 요약 마크다운 생성"""
        profile = scenario_data['profile']
        period = scenario_data.get('generation_period', {})

        md_lines = [
            f"# Patient {profile.get('subject_id')} 생성 요약",
            "",
            "## 환자 정보",
            f"- **나이/성별**: {profile.get('age')}세 {profile.get('gender')}",
            f"- **입원 사유**: {profile.get('admission_reason', '')}",
            f"- **생성 기간**: HD {period.get('start_hd', 1)} ~ HD {period.get('end_hd', 10)}",
            f"- **D0 기준**: HD {period.get('d0_hd', 1)}",
            f"- **기저질환**: {', '.join(profile.get('comorbidities', []))}",
            "",
            "---",
            "",
            "## 날짜별 요약",
            ""
        ]

        for record in records:
            hd = record['hd']
            d_number = record['d_number']
            date = record.get('date', '')
            content = record['content']

            d_display = f"D{d_number:+d}" if d_number != 0 else "D0"
            md_lines.append(f"### HD {hd} / {d_display} ({date})")
            md_lines.append("")

            # JSON 파싱하여 문서별 요약
            try:
                documents = self._parse_json_response(content)
                doc_counts = {}

                for doc in documents:
                    doc_type = doc.get('document_type', 'unknown')
                    doc_counts[doc_type] = doc_counts.get(doc_type, 0) + 1

                    # 주요 정보 추출
                    if doc_type == 'nursing_note':
                        shift = doc.get('shift', '')
                        spo2 = doc.get('vital_signs', {}).get('spo2', '')
                        o2 = doc.get('o2_flow', '')
                        md_lines.append(f"- **간호기록 ({shift})**: SpO2 {spo2}%, O2 {o2}")

                    elif doc_type == 'physician_note':
                        note_type = doc.get('note_type', '')
                        assessment = doc.get('assessment', [])
                        if isinstance(assessment, list):
                            assessment_str = '; '.join(assessment)[:80]
                        else:
                            assessment_str = str(assessment)[:80]
                        md_lines.append(f"- **의사기록 ({note_type})**: {assessment_str}...")

                    elif doc_type == 'lab_result':
                        wbc = doc.get('wbc', '')
                        cr = doc.get('cr', '')
                        lactate = doc.get('lactate', '')
                        lab_str = f"WBC {wbc}, Cr {cr}"
                        if lactate:
                            lab_str += f", Lactate {lactate}"
                        md_lines.append(f"- **Lab**: {lab_str}")

                    elif doc_type == 'radiology':
                        impression = doc.get('impression', '')[:80]
                        md_lines.append(f"- **CXR**: {impression}...")

                    elif doc_type == 'microbiology':
                        specimen = doc.get('specimen_type', '')
                        status = doc.get('result_status', '')
                        organism = doc.get('organism', '')
                        md_lines.append(f"- **배양 ({specimen})**: {status} - {organism}")

                md_lines.append("")
                md_lines.append(f"  > 문서 수: {', '.join([f'{k}: {v}' for k, v in doc_counts.items()])}")

            except:
                md_lines.append(f"  > 파싱 실패")

            md_lines.append("")

        # 항생제 타임라인
        md_lines.extend([
            "---",
            "",
            "## 항생제 타임라인",
            ""
        ])

        trajectory = scenario_data.get('trajectory', {})
        abx = trajectory.get('antibiotics', [])
        if abx:
            for item in abx:
                hd = item.get('hd', item.get('day', 0) + 1)
                md_lines.append(f"- HD{hd}: {item['action']} - {item['drug']}")
        else:
            md_lines.append("- 시나리오 참조")

        md_lines.extend([
            "",
            "---",
            "",
            f"*생성 일시: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}*",
            f"*모델: {self.model_name}*"
        ])

        filepath = output_dir / "generation_summary.md"
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write('\n'.join(md_lines))

    def _save_summary_json(self, scenario_data: Dict, records: List[Dict], output_dir: Path):
        """생성 요약 JSON 저장"""
        profile = scenario_data['profile']

        summary = {
            'patient_id': profile.get('subject_id'),
            'age': profile.get('age'),
            'gender': profile.get('gender'),
            'admission_reason': profile.get('admission_reason'),
            'los_days': profile.get('los_days'),
            'total_records': len(records),
            'generated_at': datetime.now().isoformat(),
            'model': self.model_name,
            'trajectory': scenario_data.get('trajectory', {}),
            'key_events': scenario_data.get('key_events', {})
        }

        filepath = output_dir / "generation_summary.json"
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(summary, f, indent=2, ensure_ascii=False)

    def _generate_raw_text(self, doc: Dict) -> str:
        """문서 타입별 raw_text 자동 생성"""
        doc_type = doc.get('document_type', '')

        if doc_type == 'physician_note':
            return self._generate_physician_raw_text(doc)
        elif doc_type == 'nursing_note':
            return self._generate_nursing_raw_text(doc)
        elif doc_type == 'radiology':
            return self._generate_radiology_raw_text(doc)
        elif doc_type == 'lab_result':
            return self._generate_lab_raw_text(doc)
        elif doc_type == 'microbiology':
            return self._generate_microbiology_raw_text(doc)

        return ""

    def _generate_physician_raw_text(self, doc: Dict) -> str:
        """의사 경과기록 raw_text 생성 (note_type별 헤더 적용)"""
        lines = []

        # note_type별 헤더 적용
        note_type = doc.get('note_type', 'PROGRESS')
        if note_type == 'ADMISSION':
            lines.append("[Admission Note]")
        elif note_type == 'DISCHARGE':
            lines.append("[Discharge Summary]")
        else:  # PROGRESS
            lines.append("[Progress Note]")

        lines.append("")

        # 주관적 소견 (Subjective)
        lines.append("주관적 소견(Subjective)")

        # Problem list
        problem_list = doc.get('problem_list', [])
        for prob in problem_list:
            lines.append(prob)

        # Treatment history
        tx_history = doc.get('treatment_history', '')
        if tx_history:
            lines.append(tx_history)

        lines.append("")

        # S)
        subjective = doc.get('subjective', '')
        if subjective:
            lines.append(f"S) {subjective}")

        lines.append("")

        # 객관적 소견 (Objective)
        lines.append("객관적 소견(Objective)")

        objective = doc.get('objective', {})
        if isinstance(objective, dict):
            # Vital signs
            vs = objective.get('vital_signs', {})
            if vs:
                vs_str = f"V/S: {vs.get('bp', '')} - {vs.get('hr', '')} - {vs.get('rr', '')} - {vs.get('bt', '')} - {vs.get('spo2', '')}%"
                lines.append(vs_str)

            # Lab results
            labs = objective.get('lab_results', {})
            if labs:
                lab_items = [f"{k.upper()} {v}" for k, v in labs.items() if v is not None]
                lines.append(f"Lab: {', '.join(lab_items)}")

            # Imaging
            imaging = objective.get('imaging', '')
            if imaging:
                lines.append(imaging)
        elif isinstance(objective, str):
            lines.append(objective)

        lines.append("")

        # 평가 (Assessment)
        lines.append("평가(Assessment)")
        assessment = doc.get('assessment', [])
        if isinstance(assessment, list):
            for a in assessment:
                lines.append(a)
        else:
            lines.append(str(assessment))

        lines.append("")

        # 치료 계획 (Plan)
        lines.append("치료 계획(Plan)")
        plan = doc.get('plan', [])
        if isinstance(plan, list):
            for p in plan:
                lines.append(p)
        else:
            lines.append(str(plan))

        return '\n'.join(lines)

    def _generate_nursing_raw_text(self, doc: Dict) -> str:
        """간호기록 raw_text 생성 (v1 스타일 헤더 적용)"""
        lines = []

        # v1 스타일 헤더 적용
        note_type = doc.get('note_type', 'PROGRESS')
        shift = doc.get('shift', 'Day')
        note_datetime = doc.get('note_datetime', '')

        if note_type == 'ADMISSION':
            lines.append("[Admission Note]")
        elif note_type == 'CRITICAL':
            lines.append("< Emergency Report >")
        else:  # PROGRESS
            # shift에 따른 Duty Report 헤더
            shift_map = {
                'Day': 'Day',
                'Evening': 'Evening',
                'Night': 'Night'
            }
            shift_name = shift_map.get(shift, 'Day')
            lines.append(f"< {shift_name} Duty Report >")

        lines.append(f"기록일시: {note_datetime}")
        lines.append("")

        # Vital signs (v1 스타일: BP - HR - RR - Temp - SpO2 단일 라인)
        vs = doc.get('vital_signs', {})
        if vs:
            bp_sys = vs.get('bp_sys', '')
            bp_dia = vs.get('bp_dia', '')
            hr = vs.get('hr', '')
            rr = vs.get('rr', '')
            temp = vs.get('temp', '')
            spo2 = vs.get('spo2', '')

            vs_line = f"V/S) {bp_sys}/{bp_dia} - {hr} - {rr} - {temp} - {spo2}%"
            lines.append(vs_line)
            lines.append("")

        # S) - 직접 인용 스타일 지원
        subjective = doc.get('subjective', '')
        if subjective:
            lines.append(f"S) {subjective}")

        # O)
        objective = doc.get('objective', '')
        if objective:
            lines.append(f"O) {objective}")

        # A)
        assessment = doc.get('assessment', '')
        if assessment:
            lines.append(f"A) {assessment}")

        # P)
        plan_action = doc.get('plan_action', '')
        if plan_action:
            lines.append(f"P) {plan_action}")

        lines.append("")

        # O2
        o2_device = doc.get('o2_device', '')
        o2_flow = doc.get('o2_flow', '')
        if o2_device or o2_flow:
            o2_text = f"{o2_device}" if o2_device else ""
            if o2_flow:
                o2_text += f" {o2_flow}" if o2_text else o2_flow
            lines.append(f"O2: {o2_text}")

        # I/O
        intake = doc.get('intake', '')
        output = doc.get('output', '')
        if intake or output:
            lines.append(f"I/O: {intake} / {output} mL")

        # Notify MD
        notify_md = doc.get('notify_md', False)
        if notify_md:
            lines.append("")
            lines.append("** 담당의 notify함 **")

        return '\n'.join(lines)

    def _generate_radiology_raw_text(self, doc: Dict) -> str:
        """영상 판독문 raw_text 생성"""
        lines = ["[ Radiology Report ]", ""]

        study_type = doc.get('study_type', '')
        study_datetime = doc.get('study_datetime', '')
        lines.append(f"Study: {study_type}")
        lines.append(f"Date: {study_datetime}")
        lines.append("")

        technique = doc.get('technique', '')
        if technique:
            lines.append(f"Technique: {technique}")

        comparison = doc.get('comparison', '')
        if comparison:
            lines.append(f"Comparison: {comparison}")

        lines.append("")
        lines.append("Findings:")
        findings = doc.get('findings', '')
        lines.append(f"  {findings}")

        lines.append("")
        lines.append("Impression:")
        impression = doc.get('impression', '')
        lines.append(f"  {impression}")

        return '\n'.join(lines)

    def _generate_lab_raw_text(self, doc: Dict) -> str:
        """Lab 결과 raw_text 생성"""
        lines = ["[ Laboratory Report ]", ""]

        result_datetime = doc.get('result_datetime', '')
        lines.append(f"Result Date: {result_datetime}")
        lines.append("")

        # CBC
        lines.append("CBC:")
        lines.append(f"  WBC: {doc.get('wbc', '-')} K/uL")
        lines.append(f"  Hgb: {doc.get('hgb', '-')} g/dL")
        lines.append(f"  Plt: {doc.get('plt', '-')} K/uL")
        lines.append("")

        # Chemistry
        lines.append("Chemistry:")
        lines.append(f"  BUN: {doc.get('bun', '-')} mg/dL")
        lines.append(f"  Cr: {doc.get('cr', '-')} mg/dL")
        lines.append(f"  Na: {doc.get('na', '-')} mEq/L")
        lines.append(f"  K: {doc.get('k', '-')} mEq/L")
        lines.append(f"  Glucose: {doc.get('glucose', '-')} mg/dL")
        lines.append("")

        # Inflammatory markers
        lactate = doc.get('lactate')
        crp = doc.get('crp')
        pct = doc.get('procalcitonin')

        if lactate or crp or pct:
            lines.append("Inflammatory Markers:")
            if lactate:
                lines.append(f"  Lactate: {lactate} mmol/L")
            if crp:
                lines.append(f"  CRP: {crp} mg/L")
            if pct:
                lines.append(f"  Procalcitonin: {pct} ng/mL")

        return '\n'.join(lines)

    def _generate_microbiology_raw_text(self, doc: Dict) -> str:
        """배양 검사 raw_text 생성"""
        lines = ["[ Microbiology Report ]", ""]

        specimen_type = doc.get('specimen_type', '')
        collection_datetime = doc.get('collection_datetime', '')
        result_datetime = doc.get('result_datetime', '')
        result_status = doc.get('result_status', '')

        lines.append(f"Specimen: {specimen_type}")
        lines.append(f"Collected: {collection_datetime}")
        lines.append(f"Reported: {result_datetime}")
        lines.append(f"Status: {result_status}")
        lines.append("")

        gram_stain = doc.get('gram_stain', '')
        if gram_stain:
            lines.append(f"Gram Stain: {gram_stain}")

        lines.append("")

        organism = doc.get('organism', '')
        colony_count = doc.get('colony_count', '')
        lines.append(f"Organism: {organism}")
        if colony_count:
            lines.append(f"Colony Count: {colony_count}")

        # Susceptibility
        susceptibility = doc.get('susceptibility', [])
        if susceptibility:
            lines.append("")
            lines.append("Susceptibility:")
            for s in susceptibility:
                abx = s.get('antibiotic', '')
                interp = s.get('interpretation', '')
                lines.append(f"  {abx}: {interp}")

        # MDRO
        is_mdro = doc.get('is_mdro', False)
        mdro_type = doc.get('mdro_type', '')
        if is_mdro:
            lines.append("")
            lines.append(f"*** MDRO ALERT: {mdro_type} ***")

        comments = doc.get('comments', '')
        if comments:
            lines.append("")
            lines.append(f"Comments: {comments}")

        return '\n'.join(lines)


def main():
    """메인 실행"""
    import sys

    if len(sys.argv) < 2:
        print("Usage: python generator.py <scenario.md>")
        print("Example: python generator.py patient_scenario/patient_17650289.md")
        return

    generator = EMRGenerator()
    result = generator.generate_for_patient(sys.argv[1])
    print(f"\n결과: {result['output_dir']}")


if __name__ == "__main__":
    main()

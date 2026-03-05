"""
EMR Generator v2 설정
"""
import os
from pathlib import Path

# OpenAI API 설정
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")  # 환경변수에서 가져오거나 직접 입력
MODEL_NAME = "gpt-4o-mini"

# 경로
PROJECT_ROOT = Path(__file__).parent
DATA_ROOT = PROJECT_ROOT.parent / "data"
SCENARIO_DIR = PROJECT_ROOT / "patient_scenario"
TIMELINE_DIR = DATA_ROOT / "outputs" / "patient_timelines"
OUTPUT_DIR = PROJECT_ROOT / "outputs"
LOG_DIR = PROJECT_ROOT / "logs"

# 디렉토리 생성
OUTPUT_DIR.mkdir(exist_ok=True, parents=True)
LOG_DIR.mkdir(exist_ok=True, parents=True)


# =============================================================================
# 문서 타입별 생성 규칙 (현실 반영 - 전역 규칙)
# =============================================================================

# 간호기록 Shift 시간 (8시간 간격)
NURSING_SHIFTS = {
    "Day": {"hour": 9, "minute": 30},      # 09:30
    "Evening": {"hour": 17, "minute": 30}, # 17:30
    "Night": {"hour": 1, "minute": 30},    # 01:30 (다음날)
}

# 문서별 생성 주기 규칙
DOCUMENT_TIMING_RULES = {
    "nursing_note": {
        "frequency": "8시간마다 (Shift 교대)",
        "notes": "매일 Day/Evening/Night 3회 생성"
    },
    "radiology": {
        "frequency": "촬영 당일 또는 익일 결과",
        "trigger": "입원 시 baseline + 임상 상태 변화 시 추가 촬영"
    },
    "microbiology": {
        "frequency": "채취 후 2-3일 소요",
        "preliminary": "Gram stain: 채취 후 1일",
        "final": "배양 동정: 채취 후 2-3일"
    },
    "lab_result": {
        "frequency": "필요 시 당일 결과",
        "routine": "매일 아침 채혈 (06:00)",
        "stat": "응급 시 즉시"
    }
}

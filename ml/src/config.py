"""
config.py - 경로, 파라미터, Item ID 상수 모음

노트북에서 사용:
    import sys; sys.path.append('..')
    from src.config import *
"""

from pathlib import Path

# ============================================================
# 경로
# ============================================================
BASE_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = BASE_DIR / "data"
RAW_DIR = DATA_DIR / "raw"
PROCESSED_DIR = DATA_DIR / "processed"
BASELINE_PROCESSED_DIR = DATA_DIR / "baseline" / "processed"
DB_PATH = RAW_DIR / "mimic_total.duckdb"
MODEL_DIR = BASE_DIR / "models"
OUTPUT_DIR = BASE_DIR / "outputs"

# 디렉토리 자동 생성
for _dir in [RAW_DIR, PROCESSED_DIR, BASELINE_PROCESSED_DIR, MODEL_DIR, OUTPUT_DIR]:
    _dir.mkdir(parents=True, exist_ok=True)


# ============================================================
# 슬라이딩 윈도우 파라미터
# ============================================================
WINDOW_SIZE_H = 6    # 윈도우 크기 (시간)
STRIDE_H = 1         # 이동 간격 (시간)
MIN_HOUR = 6         # 시작 시점 (ICU 입실 후)
MAX_HOUR = 72        # 종료 시점


# ============================================================
# 코호트 기준
# ============================================================
MIN_AGE = 18         # 성인 기준
MIN_LOS_DAYS = 1.0   # 최소 ICU 체류일
SOFA_THRESHOLD = 2   # Sepsis-3 SOFA 기준
INFECTION_WINDOW_H = 24  # 항생제-배양 동시성 판정 윈도우 (시간)


# ============================================================
# MIMIC-IV Item IDs
# ============================================================

# --- Vital Signs (chartevents) ---
ITEM_HR = '220045'           # Heart Rate
ITEM_RR = ['220210', '224690']  # Respiratory Rate
ITEM_SPO2 = '220277'         # SpO2
ITEM_TEMP_F = '223761'       # Temperature (Fahrenheit)
ITEM_TEMP_C = '223762'       # Temperature (Celsius)
ITEM_NBP_SYS = '220179'     # Non-invasive BP Systolic
ITEM_NBP_DIA = '220180'     # Non-invasive BP Diastolic
ITEM_NBP_MEAN = '220181'    # Non-invasive BP Mean
ITEM_ABP_SYS = '220050'     # Arterial BP Systolic
ITEM_ABP_DIA = '220051'     # Arterial BP Diastolic
ITEM_ABP_MEAN = '220052'    # Arterial BP Mean
ITEM_FIO2 = '223835'        # FiO2 (%)
ITEM_WEIGHT = '226512'      # Admission Weight

# --- Lab (labevents) ---
ITEM_SAO2 = '50817'          # SaO2
ITEM_PH = '50820'            # pH
ITEM_PAO2 = '50821'          # PaO2
ITEM_LACTATE = '50813'       # Lactate
ITEM_CREATININE = '50912'    # Creatinine
ITEM_BILIRUBIN = '50885'     # Bilirubin
ITEM_WBC = '51301'           # WBC
ITEM_PLATELETS = '51265'     # Platelets
ITEM_POTASSIUM = '50971'     # Potassium
ITEM_SODIUM = '50983'        # Sodium

# --- GCS (chartevents) ---
ITEM_GCS_EYE = '220739'      # GCS - Eye Opening
ITEM_GCS_VERBAL = '223900'   # GCS - Verbal Response
ITEM_GCS_MOTOR = '223901'    # GCS - Motor Response

# --- Ventilation (procedureevents) ---
ITEM_VENT = '225792'          # Invasive Mechanical Ventilation

# --- Vasopressors (inputevents) ---
ITEM_NOREPINEPHRINE = '221906'
ITEM_EPINEPHRINE = '221289'
ITEM_VASOPRESSIN = '222315'
ITEM_DOPAMINE = '221662'

VASOPRESSOR_ITEMS = [
    ITEM_NOREPINEPHRINE,
    ITEM_EPINEPHRINE,
    ITEM_VASOPRESSIN,
    ITEM_DOPAMINE,
]

# --- Antibiotics (inputevents) ---
ANTIBIOTIC_ITEMS = [
    '225798',   # Vancomycin
    '225893',   # Piperacillin/Tazobactam (Zosyn)
    '225842',   # Ampicillin
    '225850',   # Cefazolin
    '225853',   # Ceftazidime
    '225899',   # Bactrim (SMX/TMP)
    '225851',   # Cefepime
    '225859',   # Ciprofloxacin
    '225883',   # Meropenem
    '225837',   # Acyclovir
    '225847',   # Aztreonam
]

# --- Urine (outputevents) ---
ITEM_URINE_FOLEY = '226559'  # Foley
ITEM_URINE_VOID = '226560'   # Void

URINE_ITEMS = [ITEM_URINE_FOLEY, ITEM_URINE_VOID]

# --- DNR (chartevents) ---
ITEM_DNR = '223758'           # Code Status


# ============================================================
# 임상 범위 (이상치 클리핑)
# ============================================================
CLINICAL_RANGES = {
    'hr':    (20, 300),
    'rr':    (4, 60),
    'spo2':  (50, 100),
    'temp':  (30, 45),       # Celsius
    'sbp':   (40, 300),
    'dbp':   (20, 200),
    'mbp':   (30, 250),
    'sao2':  (50, 100),
    'ph':    (6.8, 7.8),
    'lactate':    (0.1, 30),
    'creatinine': (0.1, 30),
    'bilirubin':  (0.1, 50),
    'wbc':        (0.1, 100),
    'platelets':  (5, 1000),
    'potassium':  (1.5, 10),
    'sodium':     (110, 170),
    'weight':     (1, 500),
}


# ============================================================
# 결측 처리 기본값 (임상적 정상값)
# ============================================================
NORMAL_DEFAULTS = {
    'temp': 36.8,
    'lactate': 1.2,
    'fio2': 0.21,       # Room air
}


# ============================================================
# 피처 그룹 정의
# ============================================================
VITAL_COLS = ['hr', 'rr', 'spo2', 'sbp', 'dbp', 'mbp', 'temp']
VITAL_STAT_COLS = ['hr_max', 'rr_max', 'spo2_min', 'sbp_min']
LAB_COLS = ['creatinine', 'wbc', 'platelets', 'potassium', 'sodium', 'lactate']
GCS_COLS = ['gcs_eye', 'gcs_verbal', 'gcs_motor', 'gcs_total']
URINE_COLS = ['urine_ml_6h', 'urine_ml_kg_hr_avg', 'oliguria_flag']
FLAG_COLS = ['lactate_missing', 'abga_checked']
DELTA_FEATURES = ['hr', 'sbp', 'spo2', 'lactate', 'gcs_total']
SLOPE_FEATURES = ['hr', 'sbp', 'spo2', 'lactate', 'gcs_total']

# 예측 레이블
LABEL_HORIZONS = [6, 12, 24]   # 시간 단위
LABEL_EVENTS = ['death', 'vent', 'pressor', 'septic_shock', 'composite']

"""
src/ - 프로젝트 유틸리티 모듈

주요 모듈:
    - db.py: DuckDB 연결 및 쿼리 헬퍼
    - utils.py: 데이터 로드/저장, 결측 처리, 클리핑 등

사용 예:
    from src.db import get_connection, run_query
    from src.utils import save_csv, load_cohort

설정 참조:
    - docs/MIMIC_ITEMIDS.md - MIMIC-IV Item ID 매핑
    - docs/CLINICAL_PARAMETERS.md - 임상 파라미터 및 범위
    - docs/AGGREGATION_RULES.md - 데이터 집계 규칙
    - docs/PIPELINE_CONFIG.md - 파이프라인 설정 및 경로
"""

__version__ = "1.0.0"
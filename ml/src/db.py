"""
db.py - DuckDB 연결 및 쿼리 헬퍼

노트북에서 사용:
    from src.db import get_connection, run_query, load_sql

    con = get_connection()
    df = run_query(con, "SELECT * FROM icustays LIMIT 5")
    con.close()

참고:
    - DB 경로 및 설정: docs/PIPELINE_CONFIG.md
"""

import duckdb
import pandas as pd
from pathlib import Path

from .config import DB_PATH


def get_connection(db_path: str = None, read_only: bool = False) -> duckdb.DuckDBPyConnection:
    """
    DuckDB 연결 반환
    
    Args:
        db_path: DB 파일 경로 (None이면 config.DB_PATH 사용)
        read_only: 읽기 전용 모드
    
    Returns:
        DuckDB connection
    """
    path = db_path or DB_PATH
    
    if not Path(path).exists():
        raise FileNotFoundError(f"DB 파일 없음: {path}")
    
    con = duckdb.connect(path, read_only=read_only)
    print(f"✓ DuckDB 연결: {Path(path).name}")
    return con


def run_query(con: duckdb.DuckDBPyConnection, query: str) -> pd.DataFrame:
    """
    SQL 실행 → DataFrame 반환
    
    Args:
        con: DuckDB connection
        query: SQL 문자열
    
    Returns:
        pandas DataFrame
    """
    return con.execute(query).df()


def load_sql(filename: str) -> str:
    """
    sql/ 폴더에서 .sql 파일 읽기
    
    Args:
        filename: SQL 파일명 (예: 'sofa_score.sql')
    
    Returns:
        SQL 문자열
    
    사용 예:
        query = load_sql('sofa_score.sql')
        df = run_query(con, query)
    """
    # notebooks/ 에서 실행될 때 기준
    sql_dir = Path(__file__).resolve().parents[1] / "sql"
    filepath = sql_dir / filename
    if not filepath.exists():
        raise FileNotFoundError(f"SQL 파일 없음: {filepath}")
    return filepath.read_text(encoding="utf-8")


def register_df(con: duckdb.DuckDBPyConnection, name: str, df: pd.DataFrame):
    """
    DataFrame을 DuckDB 임시 테이블로 등록

    Args:
        con: DuckDB connection
        name: 테이블 이름
        df: pandas DataFrame
    """
    # DuckDB가 인식하지 못하는 string dtype 방지
    df_safe = df.copy()

    def _coerce_string_object(series: pd.Series) -> pd.Series:
        # pandas NA를 None으로 바꿔 DuckDB 타입 인식을 안정화
        s_obj = series.astype("object")
        return s_obj.where(s_obj.notna(), None)

    for col, dtype in df_safe.dtypes.items():
        dtype_str = str(dtype)
        dtype_name = getattr(dtype, "name", "")
        dtype_kind = getattr(dtype, "kind", None)

        # pandas string dtype 또는 numpy unicode/bytes 타입을 object로 변환
        if (
            dtype_str.startswith("string")
            or dtype_str == "str"
            or dtype_name == "str"
            or dtype is str
            or dtype_kind in {"U", "S"}
        ):
            df_safe[col] = _coerce_string_object(df_safe[col])
            continue

        # object 컬럼 중 문자열 위주의 컬럼을 안전하게 변환
        if dtype == object:
            # object 컬럼의 pandas NA를 None으로 정리
            df_safe[col] = df_safe[col].where(df_safe[col].notna(), None)
            non_null = df_safe[col].dropna()
            if not non_null.empty:
                sample = non_null.iloc[:1000]
                if sample.map(lambda v: isinstance(v, (str, bytes))).all():
                    df_safe[col] = _coerce_string_object(df_safe[col])

    con.register(name, df_safe)
    print(f"  → '{name}' 등록 ({len(df_safe):,} rows)")


def list_tables(con: duckdb.DuckDBPyConnection) -> pd.DataFrame:
    """
    현재 DB의 테이블 목록 조회
    """
    return con.execute("SHOW TABLES").df()

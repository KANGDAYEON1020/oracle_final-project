-- ============================================================
-- 00_setup_supabase.sql
-- Supabase SQL Editor에서 실행하세요.
-- RAG 의료 가이드라인 청크를 위한 pgvector 테이블 & 검색 함수
-- ============================================================

-- 1) pgvector 확장 활성화
CREATE EXTENSION IF NOT EXISTS vector;

-- 2) rag_chunks 테이블
CREATE TABLE IF NOT EXISTS rag_chunks (
    id            TEXT PRIMARY KEY,          -- chunk_id (예: KOREA_HAI_GUIDELINE_2024:000001)
    doc_id        TEXT NOT NULL,
    page_no       TEXT,
    section_path  TEXT,
    chunk_type    TEXT,
    content       TEXT NOT NULL,             -- 검색용 텍스트 (section_path + text)
    embedding     VECTOR(384) NOT NULL,      -- paraphrase-multilingual-MiniLM-L12-v2
    publisher     TEXT,
    year          TEXT,
    allowed_use   TEXT,
    disease_tags  TEXT,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- 3) IVFFlat 인덱스 (코사인 유사도)
--    lists 값은 sqrt(행수) 근처가 적당: sqrt(5912) ≈ 77, 넉넉히 50 사용
CREATE INDEX IF NOT EXISTS idx_rag_chunks_embedding
    ON rag_chunks
    USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 50);

-- 4) 필터용 보조 인덱스
CREATE INDEX IF NOT EXISTS idx_rag_chunks_doc_id    ON rag_chunks (doc_id);
CREATE INDEX IF NOT EXISTS idx_rag_chunks_publisher ON rag_chunks (publisher);

-- 5) 벡터 유사도 검색 RPC 함수
--    cosine distance 기반 top-K 반환
CREATE OR REPLACE FUNCTION match_rag_chunks(
    query_embedding VECTOR(384),
    match_count     INT DEFAULT 100,
    filter_doc_id   TEXT DEFAULT NULL,
    filter_publisher TEXT DEFAULT NULL
)
RETURNS TABLE (
    id            TEXT,
    doc_id        TEXT,
    page_no       TEXT,
    section_path  TEXT,
    chunk_type    TEXT,
    content       TEXT,
    publisher     TEXT,
    year          TEXT,
    allowed_use   TEXT,
    disease_tags  TEXT,
    similarity    FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        rc.id,
        rc.doc_id,
        rc.page_no,
        rc.section_path,
        rc.chunk_type,
        rc.content,
        rc.publisher,
        rc.year,
        rc.allowed_use,
        rc.disease_tags,
        1 - (rc.embedding <=> query_embedding) AS similarity
    FROM rag_chunks rc
    WHERE
        (filter_doc_id IS NULL OR rc.doc_id = filter_doc_id)
        AND (filter_publisher IS NULL OR rc.publisher = filter_publisher)
    ORDER BY rc.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

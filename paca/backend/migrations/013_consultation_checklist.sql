-- 상담 진행 체크리스트 및 메모 컬럼 추가
-- 2025-12-06

ALTER TABLE consultations
ADD COLUMN checklist JSON DEFAULT '[]' COMMENT '상담 진행 체크리스트',
ADD COLUMN consultation_memo TEXT COMMENT '상담 메모 (진행 중 기록)';

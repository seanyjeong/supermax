-- 학원 테이블에 납부일 컬럼 추가
-- 2025-12-03
-- 알림톡에서 납부일 표시를 위해 필요

-- academies 테이블에 tuition_due_day 컬럼이 없으면 추가
ALTER TABLE academies ADD COLUMN tuition_due_day INT DEFAULT 5 COMMENT '월 납부 기한일 (기본값: 5일)';

-- 기존 학원들의 납부일을 5일로 설정 (이미 DEFAULT 5로 설정됨)

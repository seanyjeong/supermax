-- 자동 발송 다중 날짜 지원을 위한 컬럼 변경
-- 기존: auto_send_day INT (단일 날짜)
-- 변경: auto_send_days VARCHAR(100) (콤마로 구분된 여러 날짜, 예: "5,15,25")

-- 1. 새 컬럼 추가
ALTER TABLE notification_settings
ADD COLUMN auto_send_days VARCHAR(100) DEFAULT '' AFTER auto_send_day;

-- 2. 기존 데이터 마이그레이션 (auto_send_day 값이 있으면 auto_send_days로 복사)
UPDATE notification_settings
SET auto_send_days = CAST(auto_send_day AS CHAR)
WHERE auto_send_day > 0;

-- 3. 기존 컬럼은 유지 (호환성) - 나중에 제거 가능
-- ALTER TABLE notification_settings DROP COLUMN auto_send_day;

-- 솔라피 활성화 컬럼 추가
-- 2025-12-03
-- SENS와 솔라피 각각 독립적으로 활성화/비활성화 가능

-- notification_settings 테이블에 solapi_enabled 컬럼 추가
ALTER TABLE notification_settings ADD COLUMN solapi_enabled BOOLEAN DEFAULT FALSE AFTER is_enabled;

-- 기존 is_enabled를 sens_enabled로 명확하게 (선택사항 - 호환성 유지를 위해 is_enabled 그대로 사용)
-- is_enabled: SENS용 활성화
-- solapi_enabled: 솔라피용 활성화

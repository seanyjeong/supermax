-- SMS Service ID 컬럼 추가
-- 알림톡과 SMS는 서로 다른 Service ID 사용

ALTER TABLE notification_settings
ADD COLUMN sms_service_id VARCHAR(255) AFTER naver_service_id;

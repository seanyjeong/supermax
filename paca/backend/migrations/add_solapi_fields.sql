-- 솔라피(Solapi) 지원을 위한 필드 추가
-- 실행: mysql -u root -p paca < add_solapi_fields.sql
--
-- 이미 있는 컬럼은 건너뛰고 없는 컬럼만 추가하세요
-- 에러 발생 시 해당 컬럼이 이미 존재하는 것이므로 무시하면 됩니다

-- 1. 서비스 타입 (이미 있으면 건너뛰기)
-- ALTER TABLE notification_settings ADD COLUMN service_type ENUM('sens', 'solapi') DEFAULT 'sens' AFTER academy_id;

-- 2. 솔라피 API Key (이미 있으면 건너뛰기)
-- ALTER TABLE notification_settings ADD COLUMN solapi_api_key VARCHAR(255) AFTER sms_service_id;

-- 3. 솔라피 API Secret
-- ALTER TABLE notification_settings ADD COLUMN solapi_api_secret VARCHAR(500) AFTER solapi_api_key;

-- 4. 솔라피 카카오 채널 ID (pfId)
-- ALTER TABLE notification_settings ADD COLUMN solapi_pfid VARCHAR(255) AFTER solapi_api_secret;

-- 5. 솔라피 발신번호
-- ALTER TABLE notification_settings ADD COLUMN solapi_sender_phone VARCHAR(20) AFTER solapi_pfid;

-- 6. 솔라피 템플릿 ID
ALTER TABLE notification_settings ADD COLUMN solapi_template_id VARCHAR(100) AFTER solapi_sender_phone;

-- 7. 솔라피 템플릿 본문
ALTER TABLE notification_settings ADD COLUMN solapi_template_content TEXT AFTER solapi_template_id;

-- 인덱스 추가 (이미 있으면 에러 발생하므로 무시)
-- ALTER TABLE notification_settings ADD INDEX idx_service_type (service_type);

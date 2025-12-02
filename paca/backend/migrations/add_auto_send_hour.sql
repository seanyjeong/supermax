-- 알림톡 자동발송 시간 설정 컬럼 추가
ALTER TABLE notification_settings
ADD COLUMN auto_send_hour TINYINT DEFAULT 9 COMMENT '자동발송 시간 (0-23, 한국시간)';

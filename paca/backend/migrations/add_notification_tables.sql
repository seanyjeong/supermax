-- 알림톡 기능을 위한 테이블 생성
-- 실행: mysql -u root -p paca < add_notification_tables.sql

-- 1. 알림 설정 테이블
CREATE TABLE IF NOT EXISTS notification_settings (
    id INT PRIMARY KEY AUTO_INCREMENT,
    academy_id INT NOT NULL,

    -- Naver Cloud SENS API 설정
    naver_access_key VARCHAR(255),
    naver_secret_key VARCHAR(500),  -- 암호화 저장 (길이 여유)
    naver_service_id VARCHAR(255),
    kakao_channel_id VARCHAR(255),

    -- 템플릿 코드 (Naver에서 승인받은)
    template_code VARCHAR(50),
    template_content TEXT,  -- 템플릿 본문 내용

    -- 알림 설정
    is_enabled BOOLEAN DEFAULT FALSE,
    auto_send_day INT DEFAULT 0,  -- 0: 수동만, 1-28: 매월 해당일 자동발송

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    FOREIGN KEY (academy_id) REFERENCES academies(id),
    UNIQUE KEY unique_academy (academy_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. 알림 발송 로그 테이블
CREATE TABLE IF NOT EXISTS notification_logs (
    id INT PRIMARY KEY AUTO_INCREMENT,
    academy_id INT NOT NULL,
    student_id INT,
    payment_id INT,

    recipient_name VARCHAR(100),
    recipient_phone VARCHAR(20) NOT NULL,
    message_type ENUM('alimtalk', 'sms') NOT NULL DEFAULT 'alimtalk',
    template_code VARCHAR(50),
    message_content TEXT,

    status ENUM('pending', 'sent', 'delivered', 'failed') DEFAULT 'pending',
    error_message TEXT,
    request_id VARCHAR(100),  -- Naver API response ID
    sent_at TIMESTAMP NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (academy_id) REFERENCES academies(id),
    FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE SET NULL,
    FOREIGN KEY (payment_id) REFERENCES student_payments(id) ON DELETE SET NULL,

    INDEX idx_academy_created (academy_id, created_at),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

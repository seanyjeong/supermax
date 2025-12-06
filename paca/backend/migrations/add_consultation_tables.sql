-- 상담 예약 시스템 테이블 생성
-- 실행: mysql -u root -pQq141171616! paca < /root/supermax/paca/backend/migrations/add_consultation_tables.sql

-- 1. academies 테이블에 slug 컬럼 추가
ALTER TABLE academies
ADD COLUMN slug VARCHAR(50) UNIQUE COMMENT '상담 페이지용 고유 URL slug (예: papa-academy)';

CREATE INDEX idx_academies_slug ON academies(slug);

-- 2. 상담 설정 테이블
CREATE TABLE consultation_settings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    academy_id INT NOT NULL,

    -- 상담 페이지 설정
    is_enabled BOOLEAN DEFAULT TRUE COMMENT '상담 신청 활성화 여부',
    page_title VARCHAR(100) DEFAULT '상담 예약' COMMENT '페이지 제목',
    page_description TEXT COMMENT '페이지 상단 안내 문구',

    -- 상담 슬롯 설정
    slot_duration INT DEFAULT 30 COMMENT '상담 시간 (분 단위)',
    max_reservations_per_slot INT DEFAULT 1 COMMENT '슬롯당 최대 예약 수',
    advance_days INT DEFAULT 30 COMMENT '예약 가능 일수 (오늘부터 N일)',

    -- 알게 된 경로 옵션 (JSON 배열)
    referral_sources JSON DEFAULT ('["블로그/인터넷 검색", "지인 소개", "현수막/전단지", "SNS", "기타"]'),

    -- 알림톡 설정
    send_confirmation_alimtalk BOOLEAN DEFAULT TRUE COMMENT '신청 확인 알림톡 발송 여부',
    confirmation_template_code VARCHAR(50) COMMENT '알림톡 템플릿 코드',

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    FOREIGN KEY (academy_id) REFERENCES academies(id) ON DELETE CASCADE,
    UNIQUE KEY unique_academy (academy_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. 요일별 운영 시간 테이블 (00:00~24:00 범위 내 자유 설정)
CREATE TABLE consultation_weekly_hours (
    id INT AUTO_INCREMENT PRIMARY KEY,
    academy_id INT NOT NULL,
    day_of_week TINYINT NOT NULL COMMENT '요일 (0=일, 1=월, 2=화, 3=수, 4=목, 5=금, 6=토)',
    is_available BOOLEAN DEFAULT TRUE COMMENT '해당 요일 상담 가능 여부 (FALSE=휴무)',
    start_time TIME COMMENT '시작 시간 (00:00:00 ~ 23:30:00)',
    end_time TIME COMMENT '종료 시간 (00:30:00 ~ 24:00:00)',

    FOREIGN KEY (academy_id) REFERENCES academies(id) ON DELETE CASCADE,
    UNIQUE KEY unique_academy_day (academy_id, day_of_week)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. 특정 일자 차단 테이블 (휴일, 행사 등 특정 날짜/시간 차단)
CREATE TABLE consultation_blocked_slots (
    id INT AUTO_INCREMENT PRIMARY KEY,
    academy_id INT NOT NULL,
    blocked_date DATE NOT NULL COMMENT '차단 날짜',
    is_all_day BOOLEAN DEFAULT TRUE COMMENT 'TRUE=종일 차단, FALSE=특정 시간만 차단',
    start_time TIME COMMENT '시작 시간 (is_all_day=FALSE일 때)',
    end_time TIME COMMENT '종료 시간 (is_all_day=FALSE일 때)',
    reason VARCHAR(200) COMMENT '차단 사유 (예: 공휴일, 학원 행사)',
    created_by INT COMMENT '생성자 ID',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (academy_id) REFERENCES academies(id) ON DELETE CASCADE,
    INDEX idx_blocked_date (academy_id, blocked_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. 상담 신청 테이블 (핵심)
CREATE TABLE consultations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    academy_id INT NOT NULL,

    -- 상담 유형
    consultation_type ENUM('new_registration', 'learning') NOT NULL DEFAULT 'new_registration' COMMENT '신규등록상담, 학습상담',

    -- 학부모 정보
    parent_name VARCHAR(50) NOT NULL COMMENT '학부모 이름',
    parent_phone VARCHAR(20) NOT NULL COMMENT '학부모 전화번호',

    -- 학생 정보
    student_name VARCHAR(50) NOT NULL COMMENT '학생 이름',
    student_grade ENUM('초1','초2','초3','초4','초5','초6','중1','중2','중3','고1','고2','고3','N수','성인') NOT NULL COMMENT '학년',
    student_school VARCHAR(100) COMMENT '학교명',

    -- 성적 정보 (JSON)
    academic_scores JSON COMMENT '성적 정보 {school_grades, mock_exam_grades, percentiles}',

    -- 기타 정보
    target_school VARCHAR(100) COMMENT '목표 학교',
    referrer_student VARCHAR(50) COMMENT '추천 원생',
    referral_sources JSON COMMENT '학원을 알게 된 경로 (복수선택)',
    inquiry_content TEXT COMMENT '문의 내용',

    -- 일정
    preferred_date DATE NOT NULL COMMENT '희망 상담 날짜',
    preferred_time TIME NOT NULL COMMENT '희망 상담 시간',

    -- 기존 학생 연결 (전화번호 매칭)
    linked_student_id INT COMMENT '연결된 기존 학생 ID',

    -- 상태 관리
    status ENUM('pending', 'confirmed', 'completed', 'cancelled', 'no_show') DEFAULT 'pending' COMMENT '대기중, 확정, 완료, 취소, 노쇼',
    admin_notes TEXT COMMENT '관리자 메모',

    -- 알림톡 발송 기록
    alimtalk_sent_at TIMESTAMP NULL COMMENT '알림톡 발송 시간',
    alimtalk_status VARCHAR(20) COMMENT '알림톡 발송 상태',

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    FOREIGN KEY (academy_id) REFERENCES academies(id) ON DELETE CASCADE,
    FOREIGN KEY (linked_student_id) REFERENCES students(id) ON DELETE SET NULL,
    INDEX idx_academy_date (academy_id, preferred_date),
    INDEX idx_academy_status (academy_id, status),
    INDEX idx_parent_phone (parent_phone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- 초기 데이터: P-ACA (academy_id = 2)
-- ============================================

-- P-ACA slug 설정
UPDATE academies SET slug = 'papa-academy' WHERE id = 2;

-- P-ACA 상담 설정 생성
INSERT INTO consultation_settings (academy_id, page_title, page_description)
VALUES (2, 'P-ACA 상담 예약', '체대입시 전문 P-ACA 학원 상담 예약입니다. 아래 정보를 입력해주시면 빠른 시간 내에 연락드리겠습니다.');

-- P-ACA 요일별 운영 시간 (초기값: 전체 열어둠, 설정에서 수정 가능)
-- 월~토 09:00-21:00 오픈, 일요일 휴무
INSERT INTO consultation_weekly_hours (academy_id, day_of_week, is_available, start_time, end_time) VALUES
(2, 0, FALSE, '09:00:00', '18:00:00'),  -- 일요일 휴무
(2, 1, TRUE, '09:00:00', '21:00:00'),   -- 월
(2, 2, TRUE, '09:00:00', '21:00:00'),   -- 화
(2, 3, TRUE, '09:00:00', '21:00:00'),   -- 수
(2, 4, TRUE, '09:00:00', '21:00:00'),   -- 목
(2, 5, TRUE, '09:00:00', '21:00:00'),   -- 금
(2, 6, TRUE, '09:00:00', '18:00:00');   -- 토

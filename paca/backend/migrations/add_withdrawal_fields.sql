-- 퇴원 관련 필드 추가
ALTER TABLE students
ADD COLUMN withdrawal_date DATE DEFAULT NULL COMMENT '퇴원일',
ADD COLUMN withdrawal_reason VARCHAR(500) DEFAULT NULL COMMENT '퇴원 사유';

-- status ENUM에 withdrawn 추가 (이미 있으면 무시)
-- ALTER TABLE students MODIFY COLUMN status ENUM('active', 'paused', 'inactive', 'graduated', 'withdrawn') DEFAULT 'active';

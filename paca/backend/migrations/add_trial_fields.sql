-- 체험생(Trial Student) 필드 추가
-- 2025-12-03

ALTER TABLE students
ADD COLUMN is_trial BOOLEAN DEFAULT FALSE COMMENT '체험생 여부',
ADD COLUMN trial_remaining INT DEFAULT 2 COMMENT '남은 체험 수업 횟수',
ADD COLUMN trial_dates JSON NULL COMMENT '체험 일정 [{date, time_slot}]';

-- 인덱스 추가 (체험생 조회 성능)
CREATE INDEX idx_students_is_trial ON students(is_trial);

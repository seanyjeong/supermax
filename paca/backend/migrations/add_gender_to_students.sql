-- 학생 테이블에 성별 컬럼 추가
-- 실행: mysql -u root -p paca < migrations/add_gender_to_students.sql

ALTER TABLE students
ADD COLUMN gender ENUM('male', 'female') NULL AFTER name;

-- 확인
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = 'paca' AND TABLE_NAME = 'students' AND COLUMN_NAME = 'gender';

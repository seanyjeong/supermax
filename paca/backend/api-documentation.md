# P-ACA Backend API Documentation

## 목차
1. [수업 일정 관리 API](#수업-일정-관리-api)
2. [학원 설정 API](#학원-설정-api)
3. [테스트 가이드](#테스트-가이드)

---

## 수업 일정 관리 API

베이스 URL: `/paca/schedules`

### 1. 수업 일정 목록 조회 (캘린더용)

**GET** `/paca/schedules`

캘린더 UI를 위한 수업 일정 목록을 조회합니다.

**권한**: owner, admin, teacher

**쿼리 파라미터**:
- `start_date` (선택): 조회 시작일 (YYYY-MM-DD)
- `end_date` (선택): 조회 종료일 (YYYY-MM-DD)
- `instructor_id` (선택): 강사 필터
- `time_slot` (선택): 시간대 필터 (`morning`, `afternoon`, `evening`)

**응답 예시**:
```json
{
  "message": "Found 15 schedules",
  "schedules": [
    {
      "id": 1,
      "class_date": "2025-01-15",
      "time_slot": "morning",
      "instructor_id": 2,
      "instructor_name": "김코치",
      "title": "기초체력 훈련",
      "content": "100m 달리기, 팔굽혀펴기",
      "attendance_taken": true,
      "notes": null,
      "created_at": "2025-01-10T09:00:00.000Z"
    }
  ]
}
```

---

### 2. 강사별 일정 조회

**GET** `/paca/schedules/instructor/:instructor_id`

특정 강사의 수업 일정을 조회합니다.

**권한**: owner, admin, teacher

**경로 파라미터**:
- `instructor_id`: 강사 ID

**쿼리 파라미터**:
- `start_date` (선택): 조회 시작일
- `end_date` (선택): 조회 종료일

**응답 예시**:
```json
{
  "message": "Found 8 schedules for 김코치",
  "instructor": {
    "id": 2,
    "name": "김코치"
  },
  "schedules": [...]
}
```

---

### 3. 수업 일정 상세 조회

**GET** `/paca/schedules/:id`

특정 수업 일정의 상세 정보를 조회합니다.

**권한**: owner, admin, teacher

**응답 예시**:
```json
{
  "message": "Schedule found",
  "schedule": {
    "id": 1,
    "academy_id": 1,
    "class_date": "2025-01-15",
    "time_slot": "morning",
    "instructor_id": 2,
    "instructor_name": "김코치",
    "instructor_phone": "010-1234-5678",
    "title": "기초체력 훈련",
    "content": "100m 달리기, 팔굽혀펴기",
    "attendance_taken": true,
    "notes": null,
    "created_at": "2025-01-10T09:00:00.000Z"
  }
}
```

---

### 4. 수업 일정 생성

**POST** `/paca/schedules`

새로운 수업 일정을 등록합니다.

**권한**: owner, admin only

**요청 본문**:
```json
{
  "class_date": "2025-01-20",
  "time_slot": "afternoon",
  "instructor_id": 2,
  "title": "점프력 향상 훈련",
  "content": "박스 점프, 스쿼트 점프",
  "notes": "날씨 좋으면 야외 진행"
}
```

**필수 필드**:
- `class_date`: 수업 날짜 (YYYY-MM-DD)
- `time_slot`: 시간대 (`morning`, `afternoon`, `evening`)
- `instructor_id`: 담당 강사 ID

**유효성 검증**:
- 날짜 형식 체크 (YYYY-MM-DD)
- time_slot ENUM 값 검증
- 강사가 해당 학원 소속인지 확인
- 중복 일정 방지 (같은 날짜, 시간대, 강사)

**응답 예시** (201 Created):
```json
{
  "message": "Schedule created successfully",
  "schedule": {
    "id": 15,
    "academy_id": 1,
    "class_date": "2025-01-20",
    "time_slot": "afternoon",
    "instructor_id": 2,
    "instructor_name": "김코치",
    "title": "점프력 향상 훈련",
    "content": "박스 점프, 스쿼트 점프",
    "attendance_taken": false,
    "notes": "날씨 좋으면 야외 진행",
    "created_at": "2025-01-15T10:30:00.000Z"
  }
}
```

**에러 응답** (409 Conflict):
```json
{
  "error": "Conflict",
  "message": "A schedule already exists for this instructor at this date and time"
}
```

---

### 5. 수업 일정 수정

**PUT** `/paca/schedules/:id`

기존 수업 일정을 수정합니다.

**권한**: owner, admin only

**요청 본문** (수정할 필드만 포함):
```json
{
  "title": "점프력 및 근력 훈련",
  "content": "박스 점프, 스쿼트 점프, 데드리프트",
  "notes": "실내 진행으로 변경"
}
```

**응답 예시**:
```json
{
  "message": "Schedule updated successfully",
  "schedule": {...}
}
```

---

### 6. 수업 일정 삭제

**DELETE** `/paca/schedules/:id`

수업 일정을 삭제합니다. (CASCADE로 출석 기록도 함께 삭제됨)

**권한**: owner, admin only

**응답 예시**:
```json
{
  "message": "Schedule deleted successfully"
}
```

---

### 7. 출석 현황 조회

**GET** `/paca/schedules/:id/attendance`

특정 수업의 출석 현황을 조회합니다. 해당 요일에 수업이 있는 학생 목록과 출석 기록을 반환합니다.

**권한**: owner, admin, teacher

**응답 예시**:
```json
{
  "message": "Attendance records retrieved",
  "schedule": {
    "id": 1,
    "class_date": "2025-01-15",
    "time_slot": "morning",
    "instructor_name": "김코치",
    "title": "기초체력 훈련",
    "attendance_taken": true
  },
  "students": [
    {
      "student_id": 5,
      "student_name": "홍길동",
      "student_number": "2025001",
      "attendance_status": "present",
      "notes": "",
      "is_expected": true
    },
    {
      "student_id": 7,
      "student_name": "김영희",
      "student_number": "2025003",
      "attendance_status": "absent",
      "notes": "병결",
      "is_expected": true
    },
    {
      "student_id": 10,
      "student_name": "이철수",
      "student_number": "2025007",
      "attendance_status": null,
      "notes": "",
      "is_expected": true
    }
  ]
}
```

**로직**:
- 수업 날짜의 요일을 계산 (0=일, 1=월, ..., 6=토)
- 학생의 `class_days` JSON 배열에 해당 요일이 포함된 학생만 필터링
- `attendance_status`가 null이면 아직 출석 체크 안 됨

---

### 8. 출석 체크 (일괄 처리)

**POST** `/paca/schedules/:id/attendance`

수업의 출석을 일괄 처리합니다. **트랜잭션**을 사용하여 원자성을 보장합니다.

**권한**: owner, admin, teacher

**요청 본문**:
```json
{
  "attendance_records": [
    {
      "student_id": 5,
      "attendance_status": "present",
      "notes": ""
    },
    {
      "student_id": 7,
      "attendance_status": "absent",
      "notes": "병결"
    },
    {
      "student_id": 10,
      "attendance_status": "late",
      "notes": "10분 지각"
    }
  ]
}
```

**attendance_status 값**:
- `present`: 출석
- `absent`: 결석
- `late`: 지각
- `excused`: 조퇴

**처리 로직**:
1. 트랜잭션 시작
2. 각 학생별 유효성 검증
   - 학생이 존재하고 해당 학원 소속인지 확인
   - attendance_status가 유효한 값인지 확인
3. UPSERT 처리 (기존 기록 있으면 UPDATE, 없으면 INSERT)
4. 모든 출석 처리 완료 후 `class_schedules.attendance_taken = true` 업데이트
5. 트랜잭션 커밋

**응답 예시**:
```json
{
  "message": "Attendance recorded for 3 students",
  "schedule_id": 1,
  "class_date": "2025-01-15",
  "attendance_records": [
    {
      "student_id": 5,
      "student_name": "홍길동",
      "attendance_status": "present",
      "notes": ""
    },
    {
      "student_id": 7,
      "student_name": "김영희",
      "attendance_status": "absent",
      "notes": "병결"
    },
    {
      "student_id": 10,
      "student_name": "이철수",
      "attendance_status": "late",
      "notes": "10분 지각"
    }
  ]
}
```

**에러 처리**:
- 일부 학생 검증 실패 시 → 전체 롤백
- 네트워크 오류 등 중간에 실패 시 → 전체 롤백

---

## 학원 설정 API

베이스 URL: `/paca/settings`

### 1. 학원 설정 조회

**GET** `/paca/settings`

학원의 운영 설정을 조회합니다. 설정이 없으면 기본값을 반환합니다.

**권한**: owner, admin, teacher

**응답 예시**:
```json
{
  "message": "Settings retrieved successfully",
  "settings": {
    "id": 1,
    "academy_id": 1,
    "academy_name": "슈퍼맥스 체대입시",
    "academy_address": "서울시 강남구...",
    "academy_phone": "02-1234-5678",
    "academy_email": "info@example.com",
    "business_number": "123-45-67890",
    "operating_hours": {
      "weekday": "09:00-21:00",
      "weekend": "10:00-18:00"
    },
    "tuition_due_day": 5,
    "salary_payment_day": 10,
    "morning_class_time": "09:30-12:00",
    "afternoon_class_time": "14:00-18:00",
    "evening_class_time": "18:30-21:00",
    "weekly_tuition_rates": {
      "weekly_1": 200000,
      "weekly_2": 300000,
      "weekly_3": 400000,
      "weekly_4": 450000,
      "weekly_5": 500000,
      "weekly_6": 550000,
      "weekly_7": 600000
    },
    "settings": null,
    "created_at": "2025-01-01T00:00:00.000Z",
    "updated_at": "2025-01-15T10:00:00.000Z"
  }
}
```

---

### 2. 학원 설정 수정

**PUT** `/paca/settings`

학원의 운영 설정을 수정합니다. 설정이 없으면 자동으로 생성합니다.

**권한**: owner, admin only

**요청 본문** (수정할 필드만 포함):
```json
{
  "tuition_due_day": 10,
  "salary_payment_day": 15,
  "morning_class_time": "09:00-12:00",
  "afternoon_class_time": "14:00-17:00",
  "evening_class_time": "18:00-21:00",
  "weekly_tuition_rates": {
    "weekly_1": 250000,
    "weekly_2": 350000,
    "weekly_3": 450000,
    "weekly_4": 500000,
    "weekly_5": 550000,
    "weekly_6": 600000,
    "weekly_7": 650000
  }
}
```

**유효성 검증**:
- `tuition_due_day`: 1~31 사이
- `salary_payment_day`: 1~31 사이
- 시간 형식: `HH:MM-HH:MM` (예: `09:30-12:00`)

**응답 예시** (201 Created - 새로 생성된 경우):
```json
{
  "message": "Settings created successfully",
  "settings": {...}
}
```

**응답 예시** (200 OK - 수정된 경우):
```json
{
  "message": "Settings updated successfully",
  "settings": {...}
}
```

---

### 3. 학원 기본 정보 수정

**PUT** `/paca/settings/academy`

학원의 기본 정보(이름, 주소, 전화번호 등)를 수정합니다.

**권한**: owner only

**요청 본문**:
```json
{
  "name": "슈퍼맥스 체육학원",
  "business_number": "123-45-67890",
  "address": "서울시 강남구 역삼동 123-45",
  "phone": "02-1234-5678",
  "email": "info@supermax.com",
  "operating_hours": {
    "weekday": "09:00-22:00",
    "weekend": "10:00-18:00",
    "holiday": "closed"
  }
}
```

**응답 예시**:
```json
{
  "message": "Academy information updated successfully",
  "academy": {
    "id": 1,
    "owner_user_id": 1,
    "name": "슈퍼맥스 체육학원",
    "business_number": "123-45-67890",
    "address": "서울시 강남구 역삼동 123-45",
    "phone": "02-1234-5678",
    "email": "info@supermax.com",
    "operating_hours": {
      "weekday": "09:00-22:00",
      "weekend": "10:00-18:00",
      "holiday": "closed"
    },
    "created_at": "2025-01-01T00:00:00.000Z",
    "updated_at": "2025-01-15T11:30:00.000Z"
  }
}
```

---

### 4. 주간 수업료 조회

**GET** `/paca/settings/tuition-rates`

주 1~7회 수업료 설정을 조회합니다.

**권한**: owner, admin, teacher

**응답 예시**:
```json
{
  "message": "Tuition rates retrieved successfully",
  "tuition_rates": {
    "weekly_1": 200000,
    "weekly_2": 300000,
    "weekly_3": 400000,
    "weekly_4": 450000,
    "weekly_5": 500000,
    "weekly_6": 550000,
    "weekly_7": 600000
  }
}
```

---

### 5. 주간 수업료 수정

**PUT** `/paca/settings/tuition-rates`

주 1~7회 수업료를 수정합니다.

**권한**: owner, admin only

**요청 본문**:
```json
{
  "tuition_rates": {
    "weekly_1": 250000,
    "weekly_2": 350000,
    "weekly_3": 450000,
    "weekly_4": 500000,
    "weekly_5": 550000,
    "weekly_6": 600000,
    "weekly_7": 650000
  }
}
```

**응답 예시**:
```json
{
  "message": "Tuition rates updated successfully",
  "tuition_rates": {...}
}
```

---

## 테스트 가이드

### 1. Postman 컬렉션 테스트 시나리오

#### A. 회원가입 및 로그인
```bash
# 1. 회원가입
POST http://localhost:8320/paca/auth/register
Body: {
  "email": "test@example.com",
  "password": "password123!",
  "name": "테스트 원장",
  "phone": "010-1234-5678",
  "academyName": "테스트 학원"
}

# 2. MySQL에서 승인 처리
UPDATE users SET approval_status = 'approved' WHERE email = 'test@example.com';

# 3. 로그인
POST http://localhost:8320/paca/auth/login
Body: {
  "email": "test@example.com",
  "password": "password123!"
}

# 응답에서 토큰 복사
# {
#   "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
#   "user": {...}
# }

# 이후 모든 요청 헤더에 추가:
# Authorization: Bearer <토큰>
```

#### B. 수업 일정 API 테스트

```bash
# 1. 강사 생성 (먼저 필요)
POST http://localhost:8320/paca/instructors
Headers: Authorization: Bearer <토큰>
Body: {
  "name": "김코치",
  "phone": "010-9876-5432",
  "salary_type": "hourly",
  "hourly_rate": 50000
}

# 2. 수업 일정 생성
POST http://localhost:8320/paca/schedules
Headers: Authorization: Bearer <토큰>
Body: {
  "class_date": "2025-01-20",
  "time_slot": "morning",
  "instructor_id": 1,
  "title": "기초체력 훈련",
  "content": "100m 달리기, 팔굽혀펴기"
}

# 3. 일정 목록 조회
GET http://localhost:8320/paca/schedules?start_date=2025-01-01&end_date=2025-01-31
Headers: Authorization: Bearer <토큰>

# 4. 학생 생성 (출석 체크 테스트용)
POST http://localhost:8320/paca/students
Headers: Authorization: Bearer <토큰>
Body: {
  "name": "홍길동",
  "phone": "010-1111-2222",
  "parent_phone": "010-3333-4444",
  "school": "체육고등학교",
  "grade": 2,
  "grade_type": "2",
  "admission_type": "susi",
  "class_days": [1, 3, 5],
  "weekly_count": 3,
  "monthly_tuition": 400000,
  "enrollment_date": "2025-01-01"
}

# 5. 출석 현황 조회
GET http://localhost:8320/paca/schedules/1/attendance
Headers: Authorization: Bearer <토큰>

# 6. 출석 체크
POST http://localhost:8320/paca/schedules/1/attendance
Headers: Authorization: Bearer <토큰>
Body: {
  "attendance_records": [
    {
      "student_id": 1,
      "attendance_status": "present",
      "notes": ""
    }
  ]
}

# 7. 일정 수정
PUT http://localhost:8320/paca/schedules/1
Headers: Authorization: Bearer <토큰>
Body: {
  "title": "기초체력 및 근력 훈련",
  "content": "100m 달리기, 팔굽혀펴기, 스쿼트"
}

# 8. 일정 삭제
DELETE http://localhost:8320/paca/schedules/1
Headers: Authorization: Bearer <토큰>
```

#### C. 학원 설정 API 테스트

```bash
# 1. 설정 조회 (처음엔 기본값 반환)
GET http://localhost:8320/paca/settings
Headers: Authorization: Bearer <토큰>

# 2. 설정 생성/수정
PUT http://localhost:8320/paca/settings
Headers: Authorization: Bearer <토큰>
Body: {
  "tuition_due_day": 10,
  "salary_payment_day": 15,
  "morning_class_time": "09:00-12:00",
  "afternoon_class_time": "14:00-17:00",
  "evening_class_time": "18:00-21:00"
}

# 3. 수업료 조회
GET http://localhost:8320/paca/settings/tuition-rates
Headers: Authorization: Bearer <토큰>

# 4. 수업료 수정
PUT http://localhost:8320/paca/settings/tuition-rates
Headers: Authorization: Bearer <토큰>
Body: {
  "tuition_rates": {
    "weekly_1": 250000,
    "weekly_2": 350000,
    "weekly_3": 450000,
    "weekly_4": 500000,
    "weekly_5": 550000,
    "weekly_6": 600000,
    "weekly_7": 650000
  }
}

# 5. 학원 정보 수정 (owner only)
PUT http://localhost:8320/paca/settings/academy
Headers: Authorization: Bearer <토큰>
Body: {
  "name": "슈퍼맥스 체육학원",
  "address": "서울시 강남구 역삼동 123-45",
  "phone": "02-1234-5678",
  "email": "info@supermax.com"
}
```

---

### 2. 서버 복사 및 테스트 절차

#### 서버에 파일 복사
```bash
# 1. 로컬에서 생성된 파일들:
# - C:\projects\paca\backend\routes\schedules.js
# - C:\projects\paca\backend\routes\settings.js

# 2. 서버로 복사 (FTP, SCP 등 사용)
scp C:\projects\paca\backend\routes\schedules.js user@server:/path/to/backend/routes/
scp C:\projects\paca\backend\routes\settings.js user@server:/path/to/backend/routes/
```

#### 서버에서 테스트
```bash
# 1. 서버 SSH 접속
ssh user@211.37.174.218

# 2. 백엔드 디렉토리로 이동
cd /path/to/backend

# 3. Node.js 서버 재시작
pm2 restart paca
# 또는
npm run dev

# 4. 로그 확인
pm2 logs paca
# 또는
tail -f logs/app.log

# 5. API 테스트 (서버 내부에서)
curl -X GET http://localhost:8320/health
curl -X GET http://localhost:8320/paca
```

---

### 3. 에러 처리 체크리스트

✅ **필수 테스트 항목**:

1. **인증 관련**
   - [ ] 토큰 없이 요청 → 401 Unauthorized
   - [ ] 만료된 토큰 → 401 Unauthorized
   - [ ] 잘못된 토큰 → 401 Unauthorized

2. **권한 관련**
   - [ ] teacher가 일정 생성 시도 → 403 Forbidden
   - [ ] teacher가 설정 수정 시도 → 403 Forbidden
   - [ ] admin이 학원 정보 수정 시도 → 403 Forbidden

3. **유효성 검증**
   - [ ] 잘못된 날짜 형식 → 400 Validation Error
   - [ ] 잘못된 time_slot 값 → 400 Validation Error
   - [ ] 존재하지 않는 instructor_id → 404 Not Found
   - [ ] 중복 일정 생성 시도 → 409 Conflict

4. **출석 체크 트랜잭션**
   - [ ] 중간에 오류 발생 시 롤백 확인
   - [ ] UPSERT 동작 확인 (수정/생성)
   - [ ] attendance_taken 플래그 업데이트 확인

5. **데이터 무결성**
   - [ ] 다른 학원 데이터 접근 불가
   - [ ] Soft Delete된 데이터 조회 불가
   - [ ] CASCADE 삭제 동작 확인

---

## 주요 구현 특징

### 1. 출석 체크 시스템
- **요일 기반 자동 필터링**: 학생의 `class_days` JSON 배열과 수업 날짜의 요일을 비교하여 해당 학생만 표시
- **UPSERT 패턴**: 기존 출석 기록이 있으면 UPDATE, 없으면 INSERT
- **트랜잭션 보장**: 일부 학생 처리 실패 시 전체 롤백

### 2. 학원 설정 시스템
- **기본값 제공**: 설정이 없어도 기본값으로 동작 가능
- **자동 생성**: 첫 수정 시 자동으로 설정 레코드 생성
- **JSON 데이터 타입**: 유연한 설정 저장 (weekly_tuition_rates, operating_hours)

### 3. 보안 및 권한
- **JWT 인증**: 모든 API에 verifyToken 미들웨어 적용
- **역할 기반 접근 제어**: requireRole 미들웨어로 세밀한 권한 관리
- **academy_id 필터링**: 사용자가 속한 학원 데이터만 접근 가능

### 4. 에러 핸들링
- **일관된 에러 형식**: `{ error, message, details }` 구조
- **명확한 HTTP 상태 코드**: 400, 401, 403, 404, 409, 500 등 적절히 사용
- **개발 환경 디버깅**: 상세 에러 메시지 및 스택 트레이스 제공

---

## 다음 단계

1. **자동화 테스트 작성** (Jest + Supertest)
2. **Swagger API 문서 생성**
3. **프론트엔드 개발** (Next.js + React)
4. **배포 및 운영**

---

## 기술 스택

- **Backend**: Node.js + Express.js
- **Database**: MySQL 8.0
- **Authentication**: JWT (jsonwebtoken)
- **Security**: helmet, cors, express-rate-limit
- **Validation**: Manual validation with regex
- **Transaction**: MySQL connection pool

---

## 작성자

P-ACA Development Team
Last Updated: 2025-01-24

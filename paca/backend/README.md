# P-ACA Backend API

체대입시 학원관리시스템 백엔드 API 서버

## 📋 기술 스택

- **Node.js** + **Express**
- **MySQL** (mysql2)
- **JWT** 인증
- **bcryptjs** 비밀번호 암호화

## 🚀 시작하기

### 1. 의존성 설치

```bash
cd backend
npm install
```

### 2. 환경 변수 설정

`.env.example`을 복사하여 `.env` 파일 생성:

```bash
cp .env.example .env
```

`.env` 파일 수정:
```env
PORT=8320
DB_HOST=211.37.174.218
DB_PORT=3306
DB_USER=root
DB_PASSWORD=Qq141171616!
DB_NAME=paca
JWT_SECRET=your-super-secret-change-this
```

### 3. 데이터베이스 설정

MySQL Workbench에서 `../database/schema-fixed.sql` 파일 실행

### 4. 서버 실행

**개발 모드:**
```bash
npm run dev
```

**프로덕션 모드:**
```bash
npm start
```

서버 실행 후: `http://localhost:8320/api`

## 📚 API 엔드포인트

### 인증 (Authentication)
- `POST /api/auth/register` - 회원가입
- `POST /api/auth/login` - 로그인
- `GET /api/auth/me` - 현재 사용자 정보
- `POST /api/auth/change-password` - 비밀번호 변경

### 사용자 (Users)
- `GET /api/users` - 사용자 목록 (관리자만)
- `GET /api/users/:id` - 사용자 상세
- `PUT /api/users/:id` - 사용자 수정
- `DELETE /api/users/:id` - 사용자 삭제
- `POST /api/users/approve/:id` - 사용자 승인 (원장만)

### 학생 (Students)
- `GET /api/students` - 학생 목록
- `POST /api/students` - 학생 등록
- `GET /api/students/:id` - 학생 상세
- `PUT /api/students/:id` - 학생 수정
- `DELETE /api/students/:id` - 학생 삭제

### 강사 (Instructors)
- `GET /api/instructors` - 강사 목록
- `POST /api/instructors` - 강사 등록
- `GET /api/instructors/:id` - 강사 상세
- `PUT /api/instructors/:id` - 강사 수정
- `DELETE /api/instructors/:id` - 강사 삭제

### 수납 (Payments)
- `GET /api/payments` - 수납 내역 목록
- `POST /api/payments` - 수납 등록
- `GET /api/payments/overdue` - 미납 목록
- `PUT /api/payments/:id` - 수납 수정

### 급여 (Salaries)
- `GET /api/salaries` - 급여 목록
- `POST /api/salaries/generate/:month` - 월별 급여 생성
- `GET /api/salaries/:id` - 급여 상세
- `PUT /api/salaries/:id/pay` - 급여 지급 처리

### 시즌 (Seasons)
- `GET /api/seasons` - 시즌 목록
- `POST /api/seasons` - 시즌 등록
- `POST /api/seasons/:id/enroll` - 학생 시즌 등록
- `POST /api/seasons/:id/calculate` - 시즌 전환 일할 계산

### 수업 일정 (Schedules)
- `GET /api/schedules` - 수업 일정 목록
- `POST /api/schedules` - 수업 일정 등록
- `POST /api/schedules/:id/attendance` - 출석 체크

### 설정 (Settings)
- `GET /api/settings` - 학원 설정 조회
- `PUT /api/settings` - 학원 설정 수정

## 🔐 인증

모든 API (인증 관련 제외)는 JWT 토큰이 필요합니다.

**Header:**
```
Authorization: Bearer <your_jwt_token>
```

## 🎯 배포

### GitHub에 업로드

```bash
git init
git add .
git commit -m "Initial backend setup"
git remote add origin <your-repo-url>
git push -u origin main
```

### 서버에서 배포

```bash
cd /path/to/server
git clone <your-repo-url>
cd paca/backend
npm install
pm2 start server.js --name paca-backend
```

## 📝 개발 상태

- [x] 프로젝트 구조 설정
- [x] 데이터베이스 스키마
- [x] JWT 인증 미들웨어
- [x] 회원가입/로그인 API
- [ ] 학생 관리 API
- [ ] 강사 관리 API
- [ ] 수납 관리 API
- [ ] 급여 계산 로직 (4대보험)
- [ ] 시즌 전환 로직
- [ ] 출결 관리 API
- [ ] 통계/보고서 API

## 🐛 디버깅

로그 확인:
```bash
# 개발 환경
npm run dev

# 프로덕션 (PM2)
pm2 logs paca-backend
```

## 📄 라이선스

TBD

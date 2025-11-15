const express = require('express');
const cors = require('cors');
const mysql = require('mysql2');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const axios = require('axios');
const { calculateFinalScore } = require('./calculation-logic.js');



const app = express();
const port = 8080;
const JWT_SECRET = 'super-secret-key!!';

// 1. CORS 옵션 설정
const corsOptions = {
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders: 'Content-Type,Authorization'
};

// 2. 미들웨어 적용 (순서 중요)
app.use(cors(corsOptions));
app.use(express.json());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// =================================================================
// 🚦 [디버깅 로그 1] 모든 요청을 가장 먼저 확인하는 '문지기'
// =================================================================
app.use((req, res, next) => {
    console.log(`\n\n<<<<< [${new Date().toLocaleString('ko-KR')}] 새로운 요청 감지! >>>>>`);
    console.log(`[요청 메소드] ${req.method}`);
    console.log(`[요청 경로] ${req.path}`);
    console.log(`[요청 발신지(Origin)] ${req.headers.origin}`);
    console.log('----------------------------------------------------');
    next();
});

// =================================================================
// 👮 [디버깅 로그 2] JWT 인증 미들웨어 실행 확인
// =================================================================
function authJWT(req, res, next) {
    console.log(`[인증 검사 시작] ${req.path} 경로의 토큰을 확인합니다.`);
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
        console.log("    -> [인증 실패] ❌ 토큰이 없습니다.");
        return res.status(401).json({ success: false, message: 'No token' });
    }
    try {
        req.user = jwt.verify(token, JWT_SECRET);
        console.log("    -> [인증 성공] ✅ 토큰이 유효합니다. 다음으로 진행합니다.");
        next();
    } catch {
        console.log("    -> [인증 실패] ❌ 토큰이 유효하지 않습니다.");
        return res.status(401).json({ success: false, message: 'Invalid token' });
    }
}

const db = mysql.createPool({
  host: '211.37.174.218',
  user: 'maxilsan',
  password: 'q141171616!',
  database: '26susi',
  charset: 'utf8mb4',
  waitForConnections: true, // 연결이 없을 때 대기
  connectionLimit: 10,      // 최대 10개의 커넥션을 만듦
  queueLimit: 0             // 대기열 제한 없음
});
const dbJungsi = mysql.createPool({
    host: '211.37.174.218',
    user: 'maxilsan',
    password: 'q141171616!',
    database: 'jungsi', // 💡 여기 포인트
    charset: 'utf8mb4'
});
const dbStudent = mysql.createPool({
    host: '211.37.174.218',
    user: 'maxilsan',
    password: 'q141171616!',
    database: 'jungsimaxstudent',
    charset: 'utf8mb4'
});

// 관리자 권한 체크 함수
function isAdmin(user) {
    // admin(본부)는 전체 승인 가능, 원장(owner)은 자기 지점 승인 가능
    return user && (user.userid === 'admin' || user.role === 'owner');
}

function safe(v) {
  return v === undefined ? null : v;
}




const authStudentJWT = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) {
        return res.status(401).json({ success: false, message: '토큰 필요' });
    }
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.role !== 'student') {
            return res.status(403).json({ success:false, message:'학생 전용' });
        }
        req.user = decoded;
        next();
    } catch (err) {
        console.error('authStudentJWT 에러:', err);
        return res.status(403).json({ success:false, message:'토큰 유효하지 않음' });
    }
};

const authOwnerJWT = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) {
        return res.status(401).json({ success: false, message: '토큰 필요' });
    }
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        // owner 또는 admin만 허용
        if (!(decoded.role === 'owner' || decoded.role === 'admin')) {
            return res.status(403).json({ success:false, message:'원장/관리자 전용' });
        }
        req.user = decoded;
        next();
    } catch (err) {
        console.error('authOwnerJWT 에러:', err);
        return res.status(403).json({ success:false, message:'토큰 유효하지 않음' });
    }
};


app.post('/26susi/owner_login', async (req, res) => {
    try {
        const { userid, password } = req.body;
        if (!userid || !password) {
            return res.json({ success: false, message: "아이디/비번 입력" });
        }

        // 원장회원 테이블에서 계정 찾기
        const [rows] = await db.promise().query(
            "SELECT * FROM 원장회원 WHERE 아이디 = ?",
            [userid]
        );

        if (!rows.length) {
            return res.json({ success: false, message: "해당 아이디가 없습니다." });
        }

        const user = rows[0];

        // 비번 검사
        const isMatch = await bcrypt.compare(password, user.비밀번호);
        if (!isMatch) {
            return res.json({ success: false, message: "비밀번호가 올바르지 않습니다." });
        }

        // role 결정
        // - admin 계정이면 role:'admin'
        // - 아니면 role:'owner' (원장)
        const role = (user.아이디 === 'admin') ? 'admin' : 'owner';

        // 원장/관리자 토큰 발급
const token = jwt.sign({
    id: user.원장ID,
    userid: user.아이디,
    name: user.이름,
    branch: user.지점명,
    phone: user.전화번호,
    role: role, // 'owner' 또는 'admin'
    position: user.직급 // ⭐️ 이 부분이 추가되었는지 확인!
}, JWT_SECRET, { expiresIn: '7d' });

        return res.json({ success: true, token });

    } catch (err) {
        console.error("원장 로그인 오류:", err);
        return res.json({ success: false, message: "서버 오류" });
    }
});


// (GET) 원장회원 리스트 조회
app.get('/26susi_admin_members', authJWT, async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ success: false, message: "권한없음" });
  const [rows] = await db.promise().query("SELECT 원장ID, 아이디, 이름, 지점명, 전화번호, 승인여부 FROM 원장회원");
  res.json({ success: true, members: rows });
});

// (POST) 회원 승인
app.post('/26susi_admin_approve', authJWT, async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ success: false, message: "권한없음" });
  const { userid } = req.body;
  if (!userid) return res.json({ success: false, message: "아이디 필요" });
  await db.promise().query("UPDATE 원장회원 SET 승인여부='O' WHERE 아이디=?", [userid]);
  res.json({ success: true });
});

// (POST) 회원 삭제
app.post('/26susi_admin_delete', authJWT, async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ success: false, message: "권한없음" });
  const { userid } = req.body;
  if (!userid) return res.json({ success: false, message: "아이디 필요" });
  await db.promise().query("DELETE FROM 원장회원 WHERE 아이디=?", [userid]);
  res.json({ success: true });
});

// ✅ 원장회원 회원가입
// ✅ [수정] 회원가입 API (에러 로깅 강화)
// 26susi.js 파일의 /26susi/register API를 이걸로 교체

app.post('/26susi/register', async (req, res) => {
  try {
    // ⭐️ 1. req.body에서 position(직급) 값 받기
    const { userid, password, name, position, branch, phone } = req.body;

    // ⭐️ 2. 유효성 검사에 position 추가
    if (![userid, password, name, position, branch, phone].every(Boolean)) {
      // ⭐️ 직급 필드가 비어있으면 에러 메시지 수정
      return res.json({ success: false, message: "모든 값을 입력해주세요 (직급 포함)." });
    }
    // (선택) position 값이 '원장','부원장','강사','팀장' 등 유효한 값인지 추가 검사 가능
    if (!['원장', '팀장','부원장','강사'].includes(position)) { // '강사' 등 다른 직급 허용 시 배열 수정
         return res.json({ success: false, message: "유효하지 않은 직급입니다." });
    }


    // 아이디 중복 검사 (기존과 동일)
    const [dup] = await db.promise().query(
      "SELECT 원장ID FROM 원장회원 WHERE 아이디 = ?", [userid]
    );
    if (dup.length > 0) {
      return res.json({ success: false, message: "이미 사용중인 아이디입니다." });
    }

    const hash = await bcrypt.hash(password, 10);

    // ⭐️ 3. INSERT 쿼리에 '직급' 컬럼과 값 추가
    await db.promise().query(
      "INSERT INTO 원장회원 (아이디, 비밀번호, 이름, 직급, 지점명, 전화번호) VALUES (?, ?, ?, ?, ?, ?)",
      [userid, hash, name, position, branch, phone] // ⭐️ 순서 맞추기
    );

    res.json({ success: true, message: "가입 신청 완료! 승인 후 로그인 가능합니다." }); // ⭐️ 성공 메시지 추가

  } catch (err) {
    console.error("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
    console.error("!!! /26susi/register 경로에서 오류 발생 !!!");
    console.error("- 발생 시간:", new Date().toLocaleString('ko-KR'));
    console.error("- 에러 내용:", err);
    console.error("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
    res.status(500).json({ success: false, message: "서버 내부 오류가 발생했습니다." });
  }
});



// ✅ 원장회원 로그인 + JWT 발급
app.post('/26susi/login', async (req, res) => {
  try {
    const { userid, password } = req.body;
    if (!userid || !password)
      return res.json({ success: false, message: "아이디/비번 입력" });

    const [rows] = await db.promise().query(
      "SELECT * FROM 원장회원 WHERE 아이디 = ?",
      [userid]
    );
    if (!rows.length) return res.json({ success: false, message: "아이디 없음" });

    const user = rows[0];
    if (user.승인여부 !== 'O')
      return res.json({ success: false, message: "아직 승인 안 됨" });

    const isMatch = await bcrypt.compare(password, user.비밀번호);
    if (!isMatch) return res.json({ success: false, message: "비번 오류" });

    // JWT 발급
    const token = jwt.sign(
      { id: user.원장ID, userid: user.아이디, name: user.이름, branch: user.지점명, phone: user.전화번호 }, // ✅ phone: user.전화번호 추가
      JWT_SECRET,
      { expiresIn: '3d' }
    );
    res.json({ success: true, token });
  } catch (err) {
    console.error('로그인 오류:', err);
    res.json({ success: false, message: "서버 오류" });
  }
});

// ✅ JWT 인증 미들웨어 (이후 모든 API에 붙여서 인증체크)
function authJWT(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, message: 'No token' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }
}

// 예시: 인증필요한 API
app.get('/26susi/profile', authJWT, async (req, res) => {
  // req.user에 원장정보 들어있음!
  res.json({ success: true, user: req.user });
});

app.listen(port, () => {
  console.log('원장회원 가입/로그인 서버 실행!');
});


app.post('/26susi_student/check-userid', async (req, res) => {
    const { userid } = req.body;
    if (!userid) {
        return res.status(400).json({ success: false, message: "아이디를 입력하세요." });
    }

    try {
        // ⭐️ 수정: dbStudent (jungsimaxstudent DB)의 새 테이블을 보도록 변경
        const [dup1] = await dbStudent.promise().query(
            "SELECT account_id FROM student_account WHERE userid = ?",
            [userid]
        );

        // 원장회원 아이디랑 겹쳐도 안 되게 막아줌 (이건 db (26susi)가 맞음)
        const [dup2] = await db.promise().query(
            "SELECT 원장ID FROM 원장회원 WHERE 아이디 = ?",
            [userid]
        );

        if (dup1.length > 0 || dup2.length > 0) {
            // 둘 중 하나라도 있으면 중복
            return res.json({ success: true, available: false, message: "이미 사용중인 아이디입니다." });
        }

        // 둘 다 없어야 사용 가능
        return res.json({ success: true, available: true, message: "사용 가능한 아이디입니다." });
        
    } catch (err) {
        console.error("학생 아이디 중복 체크 오류:", err);
        res.status(500).json({ success: false, message: "서버 오류" });
    }
});

app.post('/26susi_student/register', async (req, res) => {
    try {
        // ⭐️ 1. school, grade 값 받기
        const { userid, password, name, school, grade, branch, phone, gender } = req.body;

        // ⭐️ 2. grade는 필수, school은 선택으로 유효성 검사
        if (![userid, password, name, branch, phone, grade, gender].every(Boolean)) {
            return res.json({ success: false, message: "빈칸 없이 입력해주세요. (학년/성별 필수)" });
        }

        // 아이디 중복 검사 (dbStudent - student_account)
        const [dup] = await dbStudent.promise().query(
            "SELECT account_id FROM student_account WHERE userid = ?",
            [userid]
        );
        if (dup.length > 0) {
            return res.json({ success: false, message: "이미 사용중인 아이디입니다." });
        }

        const hash = await bcrypt.hash(password, 10);

        // ⭐️ 3. INSERT 쿼리에 school, grade 추가
        await dbStudent.promise().query(
            `INSERT INTO student_account 
                (userid, pw_hash, name, school, grade, branch, phone, gender, status) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, '대기')`,
            [userid, hash, name, school || null, grade, branch, phone, gender || null] // school은 없으면 null
        );

        return res.json({ success: true, message: "가입 신청 완료! 승인 후 로그인 가능합니다." });

    } catch (err) {
        console.error('학생 회원가입 오류:', err);
        return res.status(500).json({ success: false, message: "서버 오류" });
    }
});


app.post('/26susi_student/login', async (req, res) => {
    try {
        const { userid, password } = req.body;
        if (!userid || !password) {
            return res.json({ success: false, message: "아이디/비번 입력" });
        }

        const [rows] = await dbStudent.promise().query(
            "SELECT * FROM student_account WHERE userid = ?",
            [userid]
        );
        if (!rows.length) {
            return res.json({ success: false, message: "아이디 없음" });
        }

        const user = rows[0];

        if (user.status !== '승인') {
            return res.json({ success: false, message: "아직 승인되지 않은 계정입니다." });
        }

        const ok = await bcrypt.compare(password, user.pw_hash);
        if (!ok) {
            return res.json({ success: false, message: "비밀번호가 올바르지 않습니다." });
        }

        // 학생용 토큰
        const token = jwt.sign({
            account_id: user.account_id,
            userid: user.userid,
            name: user.name,
            branch: user.branch,
            phone: user.phone,
            gender: user.gender,
            role: 'student',
            jungsi_student_id: user.jungsi_student_id || null
        }, JWT_SECRET, { expiresIn: '3d' });

        return res.json({ success: true, token });

    } catch (err) {
        console.error("학생 로그인 오류:", err);
        return res.json({ success: false, message: "서버 오류" });
    }
});

// ✅ 학생 비밀번호 재설정: 인증번호 발송 (아이디 + 가입폰번호 일치해야만)
app.post('/26susi_student/request-reset-sms', async (req, res) => {
    const { userid, phone } = req.body;

    if (!userid || !phone) {
        return res.status(400).json({
            success: false,
            message: "아이디와 전화번호를 모두 입력해주세요."
        });
    }

    try {
        // 1. 학생 DB에서 아이디 + 전화번호가 모두 일치하는지 확인
        const [rows] = await dbStudent.promise().query(
            "SELECT account_id FROM student_account WHERE userid = ? AND phone = ?",
            [userid, phone]
        );

        if (rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "일치하는 학생 정보가 없습니다."
            });
        }

        // 2. 일치하면 인증번호 생성 + SMS 발송
        const code = generateCode();
        const smsResult = await sendVerificationSMS(phone, code);

        if (!smsResult.success) {
            throw new Error(smsResult.message || "SMS 발송 실패");
        }

        // 3. 인증번호를 메모리에 저장 (3분 유효)
        verificationCodes[phone] = {
            code,
            expires: Date.now() + 3 * 60 * 1000
        };

        console.log(`[학생 비밀번호 재설정] 인증번호 발송 성공. ID: ${userid}, 번호: ${phone}`);
        res.json({
            success: true,
            message: "인증번호가 발송되었습니다."
        });
    } catch (err) {
        console.error("학생 비밀번호 재설정 요청 오류:", err);
        res.status(500).json({
            success: false,
            message: "서버 오류가 발생했습니다."
        });
    }
});

// ✅ 학생 비밀번호 재설정: 새 비밀번호 저장
app.post('/26susi_student/reset-password', async (req, res) => {
    const { userid, newPassword } = req.body;

    if (!userid || !newPassword) {
        return res.status(400).json({
            success: false,
            message: "아이디와 새 비밀번호를 모두 입력해주세요."
        });
    }

    try {
        // 1. 새 비밀번호 해시
        const hash = await bcrypt.hash(newPassword, 10);

        // 2. 학생 계정 비밀번호(pw_hash) 수정
        const [result] = await dbStudent.promise().query(
            "UPDATE student_account SET pw_hash = ? WHERE userid = ?",
            [hash, userid]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: "해당 아이디의 학생을 찾을 수 없습니다."
            });
        }

        console.log(`[학생 비밀번호 재설정] 성공. ID: ${userid}`);
        res.json({
            success: true,
            message: "비밀번호가 성공적으로 변경되었습니다."
        });
    } catch (err) {
        console.error("학생 비밀번호 업데이트 오류:", err);
        res.status(500).json({
            success: false,
            message: "서버 오류로 비밀번호 변경에 실패했습니다."
        });
    }
});


app.get('/26susi_student/pending-list', authOwnerJWT, async (req, res) => {
    const user = req.user; 
    
    try {
        // ⭐️ 1. SELECT에 school, grade 추가
        let sql = `
            SELECT account_id, userid, name, school, grade, branch, phone, gender, status, jungsi_student_id, created_at
            FROM student_account
        `;
        const params = [];

        if (user.role === 'owner' && user.userid !== 'admin') {
            sql += " WHERE branch = ? ";
            params.push(user.branch);
        }

        sql += " ORDER BY created_at DESC";

        const [rows] = await dbStudent.promise().query(sql, params);

        // ⭐️ 2. 프론트에 전달할 mapped 객체에 고교명, 학년 추가
        const mapped = rows.map(r => ({
            학생ID: r.account_id,
            아이디: r.userid,
            이름: r.name,
            고교명: r.school, // ⭐️ 추가
            학년: r.grade,   // ⭐️ 추가
            지점명: r.branch,
            전화번호: r.phone,
            성별: r.gender,
            승인여부: r.status,
            내부학생_ID: r.jungsi_student_id,
            생성일시: r.created_at
        }));

        return res.json({ success: true, students: mapped });

    } catch (err) {
        console.error("학생 대기목록 조회 오류:", err);
        return res.status(500).json({ success: false, message: "서버 오류" });
    }
});


app.post('/26susi_student/delete', authOwnerJWT, async (req, res) => {
    const user = req.user;
    const { student_id } = req.body; // account_id

    if (!student_id) {
        return res.json({ success:false, message:"student_id 필요" });
    }

    try {
        // 권한 체크하려면 우선 대상 학생 불러오기
        const [rows] = await dbStudent.promise().query(
            "SELECT branch FROM student_account WHERE account_id=?",
            [student_id]
        );
        if (!rows.length) {
            return res.json({ success:false, message:"이미 없음" });
        }

        const targetBranch = rows[0].branch;

        if (user.role === 'owner' && user.userid !== 'admin') {
            if (user.branch !== targetBranch) {
                return res.status(403).json({
                    success:false,
                    message:"다른 지점 학생은 삭제할 수 없습니다."
                });
            }
        }

        // 실제 삭제
        await dbStudent.promise().query(
            "DELETE FROM student_account WHERE account_id=?",
            [student_id]
        );

        return res.json({ success:true });
    } catch (err) {
        console.error("학생 삭제 오류:", err);
        return res.status(500).json({ success:false, message:"서버 오류" });
    }
});



app.post('/26susi_student/approve', authOwnerJWT, async (req, res) => {
    const user = req.user; // 승인 요청자 (원장/관리자) 정보
    const { student_id } = req.body; // 프론트에서 보내는 학생ID = account_id

    if (!student_id) {
        return res.json({ success: false, message: "student_id 필요" });
    }

    // ⭐️ 여러 DB 작업을 하므로 커넥션을 얻어 트랜잭션 사용 고려 (여기선 단순화)
    try {
        // 1) 학생 계정 정보 가져오기 (dbStudent) - school, phone 추가!
        const [rows] = await dbStudent.promise().query(
            "SELECT account_id, name, branch, gender, grade, school, phone FROM student_account WHERE account_id=?", // ⭐️ school, phone 추가
            [student_id]
        );

        if (!rows.length) {
            return res.json({ success: false, message: "승인할 학생 계정을 찾을 수 없습니다." });
        }
        const st = rows[0]; // 승인 대상 학생 정보 (이제 school, phone 포함됨)

        // 2) owner 권한이면 자기 지점 학생만 승인 가능 (기존과 동일)
        if (user.role === 'owner' && user.userid !== 'admin') {
            if (user.branch !== st.branch) {
                return res.status(403).json({
                    success: false,
                    message: "다른 지점 학생은 승인할 수 없습니다."
                });
            }
        }

        // 3) ⭐️⭐️⭐️ [핵심 수정] jungsi DB에서 학생 찾기 또는 생성 ⭐️⭐️⭐️
        let jungsiStudentId = null; // 최종적으로 사용할 jungsi DB의 student_id
        let jungsiMessage = ""; // 최종 응답 메시지에 추가할 내용

        // 3-A: 먼저 이름/지점/성별로 찾아보기 (dbJungsi 사용)
        const [matchRows] = await dbJungsi.promise().query(
            `SELECT student_id
             FROM 학생기본정보
             WHERE student_name = ? AND branch_name = ? AND gender = ?
             LIMIT 1`, // 중복 시 첫 번째 것 사용 (개선 필요 시 로직 추가)
            [st.name, st.branch, st.gender || '']
        );

        if (matchRows.length === 1) {
            // 3-B: 찾았으면 해당 ID 사용
            jungsiStudentId = matchRows[0].student_id;
            jungsiMessage = `정시엔진 학생 ID ${jungsiStudentId}(으)로 연결됨 (기존 정보 활용)`;
            console.log(`✅ [학생 승인] 자동 매칭 성공: ${st.name}/${st.branch}/${st.gender} -> jungsi.student_id=${jungsiStudentId}`);

        } else if (matchRows.length > 1) {
            // 3-C: 여러 명 찾아지면 경고만 하고 일단 연결 안 함 (수동 처리 필요)
            jungsiStudentId = null; // 연결 안 함
            jungsiMessage = "정시엔진 학생 자동 매칭 실패 (중복 의심, 수동 연결 필요)";
            console.warn(`⚠️ [학생 승인] 중복 매칭: ${st.name}/${st.branch}/${st.gender} 후보 ${matchRows.length}명. jungsi_student_id는 NULL로 저장됩니다.`);

        } else {
            // 3-D: 못 찾았으면 새로 INSERT (dbJungsi 사용)
            console.log(`🔍 [학생 승인] 매칭 실패: ${st.name}/${st.branch}/${st.gender}. 정시엔진에 새로 등록합니다.`);
            try {
                // 학년도 계산 (예: 3학년이면 내년도, 그 외 학년은?) - 일단 내년도로 가정
                const currentYear = new Date().getFullYear();
                const targetYear = currentYear + 1; // 내년도 입시 기준
                // (st.grade 값에 따라 더 정확한 학년도 계산 로직 추가 가능)

                const insertSql = `
                    INSERT INTO 학생기본정보
                        (학년도, branch_name, student_name, grade, gender, school_name, phone_number) -- school_name, phone_number 추가
                    VALUES (?, ?, ?, ?, ?, ?, ?) -- ? 2개 추가
                `;
                // ⭐️ 이제 st.school과 st.phone 값이 제대로 들어감
                const [insertResult] = await dbJungsi.promise().query(insertSql, [
                    targetYear,
                    st.branch,
                    st.name,
                    st.grade,
                    st.gender || null,
                    st.school || null, // ✅ st 객체에 school 값이 있음
                    st.phone || null   // ✅ st 객체에 phone 값이 있음
                ]);
                jungsiStudentId = insertResult.insertId; // 새로 생성된 ID 사용
                jungsiMessage = `정시엔진 학생 ID ${jungsiStudentId}(으)로 신규 등록 및 연결됨`;
                console.log(`✅ [학생 승인] 정시엔진 신규 등록 성공: ${st.name} -> jungsi.student_id=${jungsiStudentId}`);
            } catch (insertErr) {
                // INSERT 실패 시 (예: 필수 컬럼 누락 등 DB 제약 조건)
                jungsiStudentId = null; // 연결 안 함
                jungsiMessage = `정시엔진 학생 신규 등록 실패 (DB 오류: ${insertErr.code})`;
                console.error(`❌ [학생 승인] 정시엔진 신규 등록 실패: ${st.name}`, insertErr);
                // 여기서 에러를 던지거나, 승인 자체는 진행하고 메시지만 남길 수 있음
                // 여기서는 승인은 진행하고 메시지만 남기는 것으로 처리
            }
        }

        // 4) 최종 승인 처리: status='승인', jungsi_student_id 업데이트 (dbStudent 사용)
        await dbStudent.promise().query(
            "UPDATE student_account SET status='승인', jungsi_student_id=? WHERE account_id=?",
            [jungsiStudentId, student_id] // jungsiStudentId가 null일 수도 있음
        );

        // 5) 최종 응답
        return res.json({
            success: true,
            message: `승인 완료. ${jungsiMessage}` // 정시엔진 처리 결과 메시지 포함
        });

    } catch (err) {
        console.error("❌ 학생 승인 처리 중 전체 오류:", err);
        return res.status(500).json({ success: false, message: "서버 오류 발생" });
    }
});
//실기배점


app.get('/26susi_get_practical_colleges', async (req, res) => {
  const sql = `
    SELECT 대학ID, 실기ID, 대학명, 학과명, 전형명
    FROM 대학정보
    WHERE 실기ID IS NOT NULL
    ORDER BY 대학명
  `;
  try {
    const [rows] = await db.promise().query(sql);
    res.json(rows);
  } catch (err) {
    console.error('실기 대학 조회 실패:', err);
    res.status(500).json({ error: '실기 대학 조회 실패' });
  }
});

// ✅ (신규) 실기ID 기준 배점표 전체 수정/저장 API
app.post('/26susi_update_score_table', authJWT, async (req, res) => {
    // authJWT를 넣어서 로그인한 관리자만 이 기능을 사용하도록 제한해야 해.
    if (!isAdmin(req.user)) {
        return res.status(403).json({ success: false, message: "관리자 권한이 필요합니다." });
    }

    const { 실기ID, data } = req.body;

    if (!실기ID || !Array.isArray(data) || data.length === 0) {
        return res.status(400).json({ success: false, message: "실기ID와 배점표 데이터가 필요합니다." });
    }

    const connection = await db.promise().getConnection(); // 트랜잭션을 위해 커넥션 가져오기

    try {
        await connection.beginTransaction(); // 트랜잭션 시작

        // 1. 기존 데이터를 모두 삭제
        console.log(`[수정 시작] 실기ID(${실기ID})의 기존 배점표를 삭제합니다.`);
        await connection.query("DELETE FROM `26수시실기배점` WHERE 실기ID = ?", [실기ID]);

        // 2. 프론트에서 받은 새 데이터로 다시 INSERT
        console.log(`[수정 진행] 실기ID(${실기ID})의 새로운 배점표 ${data.length}개를 추가합니다.`);
        
        // 여러 데이터를 한번에 넣기 위해 배열 형태로 가공
        const values = data.map(item => [
            실기ID,
            item.종목명,
            item.성별,
            item.기록,
            item.배점
        ]);

        const sql = "INSERT INTO `26수시실기배점` (실기ID, 종목명, 성별, 기록, 배점) VALUES ?";
        await connection.query(sql, [values]); // Bulk Insert 실행

        await connection.commit(); // 모든 작업이 성공했으면 최종 반영 (커밋)
        
        console.log(`[수정 완료] 실기ID(${실기ID}) 배점표 업데이트 성공!`);
        res.json({ success: true, message: '배점표가 성공적으로 업데이트되었습니다.' });

    } catch (err) {
        await connection.rollback(); // 오류 발생 시 모든 작업을 취소 (롤백)
        console.error('❌ 배점표 업데이트 중 오류 발생:', err);
        res.status(500).json({ success: false, message: '서버 오류로 업데이트에 실패했습니다.' });
    } finally {
        connection.release(); // 커넥션 반환
    }
});

// =================================================================
// 🚀 [신규] admin 전용 - 특정 지점 수합 데이터 조회 API
// =================================================================
app.get('/26susi/admin/branch_summary', authJWT, async (req, res) => {
    // 1. admin이 아니면 접근 거부
    if (!isAdmin(req.user)) {
        return res.status(403).json({ success: false, message: "관리자 전용 API입니다." });
    }

    // 2. 프론트에서 보낸 지점명을 받음 (예: ?branch=일산)
    const { branch } = req.query;
    if (!branch) {
        return res.status(400).json({ success: false, message: "지점명(branch) 쿼리가 필요합니다." });
    }

    try {
        // 3. 기존 API와 동일한 쿼리를 실행하되, 로그인한 유저의 지점(req.user.branch) 대신
        //    쿼리로 받은 지점(branch)을 사용
        const sql = `
            SELECT
                d.대학ID, d.대학명, d.학과명, d.전형명, d.실기ID,
                s.학생ID, s.이름, s.학년, s.성별, s.학교명, s.지점명,  /* 학교명, 지점명 포함 */
                f.내신등급, f.내신점수, f.실기총점, f.합산점수,
                f.기록1, f.점수1, f.기록2, f.점수2, f.기록3, f.점수3, f.기록4, f.점수4,
                f.기록5, f.점수5, f.기록6, f.점수6, f.기록7, f.점수7,
                f.최초합여부, f.최종합여부, f.실기일정
            FROM 대학정보 d
            JOIN 확정대학정보 f ON d.대학ID = f.대학ID
            JOIN 학생기초정보 s ON f.학생ID = s.학생ID
            WHERE s.지점명 = ?  /* 👈 여기가 핵심! */
            ORDER BY d.대학명, d.학과명, d.전형명, f.합산점수 DESC;
        `;
        // 4. 쿼리 실행 (파라미터로 req.query.branch 사용)
        const [rows] = await db.promise().query(sql, [branch]);

        // 5. 기존 API와 동일한 로직으로 데이터를 재조립
        const universityMap = new Map();
        for (const row of rows) {
            const key = row.대학ID;
            if (!universityMap.has(key)) {
                universityMap.set(key, {
                    대학ID: row.대학ID,
                    대학명: row.대학명,
                    학과명: row.학과명,
                    전형명: row.전형명,
                    실기ID: row.실기ID,
                    학생들: []
                });
            }
            universityMap.get(key).학생들.push({
                학생ID: row.학생ID, 이름: row.이름, 학년: row.학년, 성별: row.성별,
                학교명: row.학교명, 지점명: row.지점명, // 👈 1단계에서 추가한 필드
                내신등급: row.내신등급, 내신점수: row.내신점수, 실기총점: row.실기총점, 합산점수: row.합산점수,
                기록1: row.기록1, 점수1: row.점수1, 기록2: row.기록2, 점수2: row.점수2, 기록3: row.기록3, 점수3: row.점수3,
                기록4: row.기록4, 점수4: row.점수4, 기록5: row.기록5, 점수5: row.점수5, 기록6: row.기록6, 점수6: row.점수6,
                기록7: row.기록7, 점수7: row.점수7,
                최초합여부: row.최초합여부, 최종합여부: row.최종합여부, 실기일정: row.실기일정
            });
        }

        const practicalIds = [...universityMap.values()].map(uni => uni.실기ID).filter(id => id);
        if (practicalIds.length > 0) {
            const [events] = await db.promise().query(
                "SELECT 실기ID, GROUP_CONCAT(DISTINCT 종목명 ORDER BY 종목명 SEPARATOR ',') as 종목들 FROM `26수시실기배점` WHERE 실기ID IN (?) GROUP BY 실기ID",
                [practicalIds]
            );
            const eventMap = new Map(events.map(e => [e.실기ID, e.종목들.split(',')]));
            universityMap.forEach(uni => {
                if (uni.실기ID && eventMap.has(uni.실기ID)) {
                    uni.실기종목 = eventMap.get(uni.실기ID);
                }
            });
        }
        
        const results = Array.from(universityMap.values());
        // 6. admin에게 특정 지점의 데이터만 응답
        res.json({ success: true, universities: results });

    } catch (err) {
        console.error("Admin 지점별 수합 조회 API 오류:", err);
        res.status(500).json({ success: false, message: "서버 오류 발생" });
    }
});

// =================================================================
// 🚀 [신규] admin 전용 - "전 지점" 수합 데이터 조회 API
// (대학명 내림차순 정렬 포함)
// =================================================================
app.get('/26susi/admin/all_branch_summary', authJWT, async (req, res) => {
    // 1. admin이 아니면 접근 거부
    if (!isAdmin(req.user)) {
        return res.status(403).json({ success: false, message: "관리자 전용 API입니다." });
    }

    try {
        // 2. [수정] WHERE 절을 빼서 전 지점을 조회하고, ORDER BY를 대학명 내림차순으로 변경
        const sql = `
            SELECT
                d.대학ID, d.대학명, d.학과명, d.전형명, d.실기ID,
                s.학생ID, s.이름, s.학년, s.성별, s.학교명, s.지점명,
                f.내신등급, f.내신점수, f.실기총점, f.합산점수,
                f.기록1, f.점수1, f.기록2, f.점수2, f.기록3, f.점수3, f.기록4, f.점수4,
                f.기록5, f.점수5, f.기록6, f.점수6, f.기록7, f.점수7,
                f.최초합여부, f.최종합여부, f.실기일정
            FROM 대학정보 d
            JOIN 확정대학정보 f ON d.대학ID = f.대학ID
            JOIN 학생기초정보 s ON f.학생ID = s.학생ID
            /* WHERE 절 없음 (전 지점) */
            ORDER BY d.대학명 DESC, d.학과명, d.전형명, f.합산점수 DESC;
        `;
        const [rows] = await db.promise().query(sql);

        // 3. 대학별로 데이터를 재조립
        const universityMap = new Map();
        for (const row of rows) {
            const key = row.대학ID;
            if (!universityMap.has(key)) {
                universityMap.set(key, {
                    대학ID: row.대학ID,
                    대학명: row.대학명,
                    학과명: row.학과명,
                    전형명: row.전형명,
                    실기ID: row.실기ID,
                    학생들: []
                });
            }
            // 4. 학생 정보 PUSH (학교명, 지점명 포함)
            universityMap.get(key).학생들.push({
                학생ID: row.학생ID, 이름: row.이름, 학년: row.학년, 성별: row.성별,
                학교명: row.학교명,
                지점명: row.지점명,
                내신등급: row.내신등급, 내신점수: row.내신점수, 실기총점: row.실기총점, 합산점수: row.합산점수,
                기록1: row.기록1, 점수1: row.점수1, 기록2: row.기록2, 점수2: row.점수2, 기록3: row.기록3, 점수3: row.점수3,
                기록4: row.기록4, 점수4: row.점수4, 기록5: row.기록5, 점수5: row.점수5, 기록6: row.기록6, 점수6: row.점수6,
                기록7: row.기록7, 점수7: row.점수7,
                최초합여부: row.최초합여부, 최종합여부: row.최종합여부, 실기일정: row.실기일정
            });
        }

        // 5. 실기 종목 정보 합치기
        const practicalIds = [...universityMap.values()]
            .map(uni => uni.실기ID)
            .filter(id => id); 

        if (practicalIds.length > 0) {
            const [events] = await db.promise().query(
                "SELECT 실기ID, GROUP_CONCAT(DISTINCT 종목명 ORDER BY 종목명 SEPARATOR ',') as 종목들 FROM `26수시실기배점` WHERE 실기ID IN (?) GROUP BY 실기ID",
                [practicalIds]
            );
            const eventMap = new Map(events.map(e => [e.실기ID, e.종목들.split(',')]));
            universityMap.forEach(uni => {
                if (uni.실기ID && eventMap.has(uni.실기ID)) {
                    uni.실기종목 = eventMap.get(uni.실기ID);
                }
            });
        }
        
        const results = Array.from(universityMap.values());
        res.json({ success: true, universities: results });

    } catch (err) {
        console.error("Admin '전 지점' 수합 조회 API 오류:", err);
        res.status(500).json({ success: false, message: "서버 오류 발생" });
    }
});

// ✅ (신규) 대학 상세정보 전체 조회 API
app.get('/26susi/university-details', authJWT, async (req, res) => {
    // 프론트에서 ?college_id=123 형식으로 대학ID를 받음
    const { college_id } = req.query;

    if (!college_id) {
        return res.status(400).json({ success: false, message: "대학ID가 필요합니다." });
    }

    try {
        // 대학정보 테이블에서 해당 ID의 모든 컬럼(*)을 조회
        const [rows] = await db.promise().query(
            "SELECT * FROM 대학정보 WHERE 대학ID = ?",
            [college_id]
        );

        if (rows.length > 0) {
            // 조회 성공 시, 첫 번째 결과(대학 정보 객체)를 'details'라는 키로 전송
            res.json({ success: true, details: rows[0] });
        } else {
            // 해당 ID의 대학이 없을 경우 404 에러 전송
            res.status(404).json({ success: false, message: "해당 대학 정보를 찾을 수 없습니다." });
        }
    } catch (err) {
        console.error("대학 상세정보 조회 API 오류:", err);
        res.status(500).json({ success: false, message: "서버 오류가 발생했습니다." });
    }
});
app.post('/26susi_save_practical_total_config', async (req, res) => {
  const {
    대학ID,
    실기반영총점,
    기준총점,
    환산방식,
    특수식설명
  } = req.body;

  if (!대학ID || !실기반영총점) {
    return res.status(400).json({ error: '필수값 누락' });
  }

  const sql = `
    INSERT INTO 26수시실기총점반영 
    (대학ID, 실기반영총점, 기준총점, 환산방식, 특수식설명)
    VALUES (?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE 
      실기반영총점 = VALUES(실기반영총점),
      기준총점 = VALUES(기준총점),
      환산방식 = VALUES(환산방식),
      특수식설명 = VALUES(특수식설명)
  `;
  try {
    await db.promise().query(sql, [
      대학ID,
      실기반영총점,
      기준총점 || 400,
      환산방식 || '비율환산',
      특수식설명 || ''
    ]);
    res.json({ success: true });
  } catch (err) {
    console.error('총점 설정 저장 실패:', err);
    res.status(500).json({ error: '총점 설정 저장 실패' });
  }
});

// ✅ (새로 추가할 API) 대학 목록 + 실기 만점 합계 조회
// ✅ (새로 추가할 API) 대학 목록 + 실기 만점 합계 조회 -> (수정) 저장된 설정값도 함께 조회
app.get('/26susi_get_practical_colleges_with_scores', async (req, res) => {
  // 기존 쿼리에 `26수시실기총점반영` 테이블을 LEFT JOIN 하여 저장된 값을 함께 가져오도록 수정
  const sql = `
    SELECT 
      d.대학ID, d.실기ID, d.대학명, d.학과명, d.전형명,
      COALESCE(s.total_max_score, 0) AS 기본만점총합,
      t.실기반영총점, t.기준총점, t.환산방식, t.특수식설명
    FROM 
      대학정보 d
    LEFT JOIN (
      SELECT 
        실기ID, SUM(max_score) as total_max_score
      FROM (
        SELECT 
          실기ID, 종목명, MAX(CAST(배점 AS SIGNED)) as max_score 
        FROM \`26수시실기배점\`
        WHERE 실기ID IS NOT NULL
        GROUP BY 실기ID, 종목명
      ) as subquery
      GROUP BY 실기ID
    ) s ON d.실기ID = s.실기ID
    LEFT JOIN \`26수시실기총점반영\` t ON d.대학ID = t.대학ID
    WHERE 
      d.실기ID IS NOT NULL
    ORDER BY 
      d.대학명;
  `;

  try {
    const [rows] = await db.promise().query(sql);
    res.json(rows);
  } catch (err) {
    console.error('실기 만점 합계 및 설정값 조회 실패:', err);
    res.status(500).json({ error: '데이터 조회 실패' });
  }
});
// ✅ 실기ID 기준 배점표 + 종목명 조회
// ✅ 실기ID 기준 전체 원시 배점표 반환 (렌더링은 프론트에서)
// ✅ (수정) 실기ID 기준 전체 배점표 반환 (종목별로 그룹화)
app.get('/26susi_get_score_table', async (req, res) => {
  const { 실기ID } = req.query;
  if (!실기ID) return res.status(400).json({ error: '실기ID가 누락되었습니다.' });

  try {
    // 실기ID에 해당하는 모든 종목 데이터를 배점 순으로 가져옵니다.
    const [rows] = await db.promise().query(
      `SELECT 종목명, 성별, 기록, 배점 FROM \`26수시실기배점\` WHERE 실기ID = ? ORDER BY 종목명, CAST(배점 AS SIGNED) DESC`,
      [실기ID]
    );

    if (!rows || rows.length === 0) {
      return res.status(404).json({ success: false, error: '해당 실기ID에 대한 배점표가 없습니다.' });
    }

    // 종목명(예: "높이뛰기")을 기준으로 데이터를 그룹화합니다.
    const events = rows.reduce((acc, row) => {
      const { 종목명, 성별, 기록, 배점 } = row;
      // acc 객체에 해당 종목명이 없으면, 새로운 객체를 생성합니다.
      if (!acc[종목명]) {
        acc[종목명] = { 남: [], 여: [] };
      }
      // 성별에 따라 배점과 기록을 추가합니다.
      const entry = { 배점, 기록 };
      if (성별 === '남') {
        acc[종목명].남.push(entry);
      } else if (성별 === '여') {
        acc[종목명].여.push(entry);
      }
      return acc;
    }, {});

    res.json({ success: true, events });
  } catch (err) {
    console.error('❌ 배점표 조회 중 오류:', err);
    res.status(500).json({ success: false, error: '서버 오류로 배점표 조회에 실패했습니다.' });
  }
});




// =================================================================
// 📱 Naver SENS 설정 및 SMS 인증 관련
// =================================================================
// =================================================================
// 📱 Naver SENS 설정 및 SMS 인증 관련 (검증 완료된 코드)
// =================================================================
const verificationCodes = {}; // 메모리에 인증번호 저장

// 네이버 클라우드 플랫폼 SENS 키
const NAVER_ACCESS_KEY = 'A8zINaiL6JjWUNbT1uDB';
const NAVER_SECRET_KEY = 'eA958IeOvpxWQI1vYYA9GcXSeVFQYMEv4gCtEorW';
const SERVICE_ID = 'ncp:sms:kr:284240549231:sean';
const FROM_PHONE = '01021446765';

// 4자리 랜덤 인증번호 생성 함수
function generateCode() {
    return Math.floor(1000 + Math.random() * 9000).toString();
}

// SENS API 시그니처 생성 함수
function makeSignature(method, url, timestamp, accessKey, secretKey) {
    // 이 함수는 이제 확실히 작동하는 것을 확인했어.
    const space = " ";
    const newLine = "\n";
    const message = [];
    message.push(method);
    message.push(space);
    message.push(url);
    message.push(newLine);
    message.push(timestamp);
    message.push(newLine);
    message.push(accessKey);

    const hmac = crypto.createHmac('sha256', secretKey); // 🚨 이전 코드에 오타가 있었을 수 있어 'sha256'으로 수정
    return hmac.update(message.join('')).digest('base64');
}

// ✅ (신규) 인증번호 SMS 발송 API
app.post('/26susi/send-verification-sms', async (req, res) => {
    const { phone } = req.body;
    if (!phone) {
        return res.status(400).json({ success: false, message: "전화번호를 입력해주세요." });
    }

    const code = generateCode();
    const timestamp = Date.now().toString();
    
    // 인증번호와 만료시간(3분) 저장
    verificationCodes[phone] = { code, expires: Date.now() + 3 * 60 * 1000 };

    const url = `/sms/v2/services/${SERVICE_ID}/messages`;
        console.log("--- API 호출 직전 NAVER_SECRET_KEY 타입:", typeof NAVER_SECRET_KEY);
    console.log("--- API 호출 직전 NAVER_SECRET_KEY 값:", NAVER_SECRET_KEY);
    console.log("------------------------------------------");
    const signature = makeSignature('POST', url, timestamp, NAVER_ACCESS_KEY, NAVER_SECRET_KEY);

    try {
        await axios({
            method: 'POST',
            url: `https://sens.apigw.ntruss.com${url}`,
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'x-ncp-apigw-timestamp': timestamp,
                'x-ncp-iam-access-key': NAVER_ACCESS_KEY,
                'x-ncp-apigw-signature-v2': signature,
            },
            data: {
                type: 'SMS',
                from: FROM_PHONE,
                content: `[맥스체대입시] 인증번호는 [${code}] 입니다.`,
                messages: [{ to: phone }],
            },
        });
        console.log(`[인증번호 발송] 번호: ${phone}, 코드: ${code}`);
        res.json({ success: true, message: "인증번호가 발송되었습니다." });
    } catch (error) {
        console.error("SENS 발송 오류:", error.response?.data || error.message);
        res.status(500).json({ success: false, message: "인증번호 발송에 실패했습니다." });
    }
});


// ✅ (신규) 인증번호 확인 API
app.post('/26susi/verify-code', async (req, res) => {
    const { phone, code } = req.body;
    if (!phone || !code) {
        return res.status(400).json({ success: false, message: "필수 정보가 누락되었습니다." });
    }

    const stored = verificationCodes[phone];

    if (!stored) {
        return res.status(400).json({ success: false, message: "인증번호 요청 기록이 없습니다." });
    }
    if (Date.now() > stored.expires) {
        delete verificationCodes[phone]; // 만료된 코드는 삭제
        return res.status(400).json({ success: false, message: "인증번호가 만료되었습니다." });
    }
    if (stored.code !== code) {
        return res.status(400).json({ success: false, message: "인증번호가 일치하지 않습니다." });
    }

    // 인증 성공 시, 저장된 코드 삭제
    delete verificationCodes[phone];
    console.log(`[인증 성공] 번호: ${phone}`);
    res.json({ success: true, message: "인증에 성공했습니다." });
});

// [기존 /26susi_counsel_by_college 함수를 이걸로 교체]

// ✅ (신규) 아이디 중복 체크 API
app.post('/26susi/check-userid', async (req, res) => {
    try {
        const { userid } = req.body;
        if (!userid) {
            return res.status(400).json({ available: false, message: "아이디를 입력해주세요." });
        }
        const [dup] = await db.promise().query(
            "SELECT 원장ID FROM 원장회원 WHERE 아이디 = ?", [userid]
        );
        if (dup.length > 0) {
            res.json({ available: false, message: "이미 사용중인 아이디입니다." });
        } else {
            res.json({ available: true, message: "사용 가능한 아이디입니다." });
        }
    } catch (err) {
        console.error("아이디 중복 체크 오류:", err);
        res.status(500).json({ available: false, message: "서버 오류가 발생했습니다." });
    }
});

async function sendVerificationSMS(phone, code) {
  try {
    const message = `[맥스체대입시] 인증번호는 [${code}] 입니다.`;
    const timestamp = Date.now().toString();
    const url = `/sms/v2/services/${SERVICE_ID}/messages`;
    const signature = makeSignature('POST', url, timestamp, NAVER_ACCESS_KEY, NAVER_SECRET_KEY);

    await axios({
      method: 'POST',
      url: `https://sens.apigw.ntruss.com${url}`,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'x-ncp-apigw-timestamp': timestamp,
        'x-ncp-iam-access-key': NAVER_ACCESS_KEY,
        'x-ncp-apigw-signature-v2': signature,
      },
      data: {
        type: 'SMS',
        from: FROM_PHONE,
        content: message,
        messages: [{ to: phone }],
      },
    });

    return { success: true };
  } catch (err) {
    console.error("SMS 발송 실패:", err.response?.data || err.message);
    return { success: false, message: err.message };
  }
}


// ✅ (신규) 비밀번호 재설정을 위한 사용자 확인 및 인증 SMS 발송 API
app.post('/26susi/request-reset-sms', async (req, res) => {
    const { userid, phone } = req.body;
    if (!userid || !phone) {
        return res.status(400).json({ success: false, message: "아이디와 전화번호를 모두 입력해주세요." });
    }

    try {
        // 1. 아이디와 전화번호가 일치하는 회원이 있는지 확인
        const [rows] = await db.promise().query(
            "SELECT 원장ID FROM 원장회원 WHERE 아이디 = ? AND 전화번호 = ?", [userid, phone]
        );

        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: "일치하는 회원 정보가 없습니다." });
        }

        // 2. 회원이 확인되면, 기존 SMS 발송 로직 재사용
        const code = generateCode();
        const smsResult = await sendVerificationSMS(phone, code); // 기존에 만든 sendSms 함수 재사용

        if (smsResult.success) {
            verificationCodes[phone] = { code, expires: Date.now() + 3 * 60 * 1000 };
            console.log(`[비밀번호 재설정] 인증번호 발송 요청 성공. ID: ${userid}, 번호: ${phone}`);
            res.json({ success: true, message: "인증번호가 발송되었습니다." });
        } else {
            throw new Error(smsResult.message || "SMS 발송 실패");
        }
    } catch (err) {
        console.error("비밀번호 재설정 요청 오류:", err);
        res.status(500).json({ success: false, message: "서버 오류가 발생했습니다." });
    }
});


// ✅ (신규) 새 비밀번호 업데이트 API
app.post('/26susi/reset-password', async (req, res) => {
    const { userid, newPassword } = req.body;
    if (!userid || !newPassword) {
        return res.status(400).json({ success: false, message: "필수 정보가 누락되었습니다." });
    }

    try {
        // 1. 새 비밀번호를 bcrypt로 해싱
        const hash = await bcrypt.hash(newPassword, 10);

        // 2. DB에 업데이트
        const [result] = await db.promise().query(
            "UPDATE 원장회원 SET 비밀번호 = ? WHERE 아이디 = ?", [hash, userid]
        );

        if (result.affectedRows > 0) {
            console.log(`[비밀번호 재설정] 성공. ID: ${userid}`);
            res.json({ success: true, message: "비밀번호가 성공적으로 변경되었습니다." });
        } else {
            throw new Error("일치하는 사용자가 없어 비밀번호 변경에 실패했습니다.");
        }
    } catch (err) {
        console.error("비밀번호 업데이트 오류:", err);
        res.status(500).json({ success: false, message: "서버 오류로 비밀번호 변경에 실패했습니다." });
    }
});


app.get('/26susi_counsel_by_college', authJWT, async (req, res) => {
    const { college_id } = req.query;
    const branch = req.user.branch;

    if (!college_id) {
        return res.status(400).json({ success: false, message: "대학ID가 필요합니다." });
    }

    try {
        const sql = `
            SELECT 
                s.이름, s.학년, s.성별, s.학생ID,
                c.내신등급, c.내신점수,
                c.기록1, c.점수1, c.기록2, c.점수2, c.기록3, c.점수3,
                c.기록4, c.점수4, c.기록5, c.점수5, c.기록6, c.점수6,
                c.기록7, c.점수7,
                c.실기총점, c.합산점수
            FROM 상담대학정보 c
            JOIN 학생기초정보 s ON c.학생ID = s.학생ID
            WHERE c.대학ID = ? AND s.지점명 = ?
            ORDER BY c.합산점수 DESC, s.이름 ASC
        `;
        
        // ✅ [핵심 수정] db.query 앞에 .promise() 를 추가
        const [rows] = await db.promise().query(sql, [college_id, branch]);
        
        res.json({ success: true, students: rows });

    } catch (err) {
        console.error("대학별 상담 학생 조회 오류:", err);
        res.status(500).json({ success: false, message: "DB 조회 중 오류 발생", error: err.message });
    }
});
// (신규) 그룹 상담 페이지 전체 저장 API
// [기존 /26susi_counsel_by_college_save 함수를 이걸로 교체]

app.post('/26susi_counsel_by_college_save', authJWT, async (req, res) => {
    const { college_id, studentData } = req.body;
    if (!college_id || !Array.isArray(studentData)) {
        return res.status(400).json({ success: false, message: "필수 데이터가 누락되었습니다." });
    }

    const connection = await db.promise().getConnection();
    await connection.beginTransaction();

    try {
        for (const student of studentData) {
            // 1. 상담 당시의 기록(스냅샷)을 '상담대학정보'에 저장 (기존 로직)
            const counselSql = `
                INSERT INTO 상담대학정보 (
                    학생ID, 대학ID, 실기ID, 내신등급, 내신점수, 기록1, 점수1, 기록2, 점수2, 기록3, 점수3,
                    기록4, 점수4, 기록5, 점수5, 기록6, 점수6, 기록7, 점수7, 실기총점, 합산점수
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                    실기ID=VALUES(실기ID), 내신등급=VALUES(내신등급), 내신점수=VALUES(내신점수), 기록1=VALUES(기록1),
                    점수1=VALUES(점수1), 기록2=VALUES(기록2), 점수2=VALUES(점수2), 기록3=VALUES(기록3),
                    점수3=VALUES(점수3), 기록4=VALUES(기록4), 점수4=VALUES(점수4), 기록5=VALUES(기록5),
                    점수5=VALUES(점수5), 기록6=VALUES(기록6), 점수6=VALUES(점수6), 기록7=VALUES(기록7),
                    점수7=VALUES(점수7), 실기총점=VALUES(실기총점), 합산점수=VALUES(합산점수)`;
            
            const counselParams = [
                safe(student.학생ID), safe(college_id), safe(student.실기ID), safe(student.내신등급), safe(student.내신점수),
                safe(student.기록1), safe(student.점수1), safe(student.기록2), safe(student.점수2), safe(student.기록3), safe(student.점수3),
                safe(student.기록4), safe(student.점수4), safe(student.기록5), safe(student.점수5), safe(student.기록6), safe(student.점수6),
                safe(student.기록7), safe(student.점수7), safe(student.실기총점), safe(student.합산점수)
            ];
            await connection.query(counselSql, counselParams);

            // ✅ 2. 학생의 '공식' 내신 정보를 '학생_내신정보' 테이블에도 업데이트 (새로 추가된 로직)
            const gradeSql = `
                INSERT INTO 학생_내신정보 (학생ID, 대학ID, 등급, 내신점수)
                VALUES (?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE 등급=VALUES(등급), 내신점수=VALUES(내신점수)`;
            const gradeParams = [
                safe(student.학생ID),
                safe(college_id),
                safe(student.내신등급),
                safe(student.내신점수)
            ];
            await connection.query(gradeSql, gradeParams);
        }
        
        await connection.commit();
        res.json({ success: true, message: "성공적으로 저장되었습니다." });

    } catch (err) {
        await connection.rollback();
        console.error("그룹 상담 저장 API 오류:", err);
        res.status(500).json({ success: false, message: '서버 DB 처리 중 오류가 발생했습니다.' });
    } finally {
        if (connection) connection.release();
    }
});

// (신규) 학생별 상담메모 불러오기
app.get('/26susi_counsel_memo_load', authJWT, async (req, res) => {
  const { student_id } = req.query;
  if (!student_id) return res.status(400).json({ success: false, message: "학생ID 누락" });
  try {
    const [rows] = await db.promise().query("SELECT 상담메모 FROM 상담_로그 WHERE 학생ID = ?", [student_id]);
    const memo = rows.length > 0 ? rows[0].상담메모 : '';
    res.json({ success: true, memo });
  } catch(err) {
    console.error('상담메모 로드 오류:', err);
    res.status(500).json({ success: false, message: 'DB 오류' });
  }
});

// (신규) 학생별 상담메모 저장/수정
app.post('/26susi_counsel_memo_save', authJWT, async (req, res) => {
  const { student_id, memo } = req.body;
  if (student_id === undefined || memo === undefined) 
    return res.status(400).json({ success: false, message: "필수값 누락" });

  try {
    await db.promise().query(`
      INSERT INTO 상담_로그 (학생ID, 상담메모) VALUES (?, ?)
      ON DUPLICATE KEY UPDATE 상담메모 = VALUES(상담메모)
    `, [student_id, memo]);
    res.json({ success: true });
  } catch(err) {
    console.error('상담메모 저장 오류:', err);
    res.status(500).json({ success: false, message: 'DB 오류' });
  }
});

// (신규) 학생별 상담메모 삭제 (필요 시 사용)
app.post('/26susi_counsel_memo_delete', authJWT, async (req, res) => {
    const { student_id } = req.body;
    if (!student_id) return res.status(400).json({ success: false, message: "학생ID 누락" });

    try {
        await db.promise().query("DELETE FROM 상담_로그 WHERE 학생ID = ?", [student_id]);
        res.json({ success: true });
    } catch(err) {
        console.error('상담메모 삭제 오류:', err);
        res.status(500).json({ success: false, message: 'DB 오류' });
    }
});


//학생관리(정보수정및등록)
// 1. 학생 명단 다중등록 (엑셀 복붙/파싱된 배열)
app.post('/26susi_student_bulk_insert', authJWT, async (req, res) => {
  try {
    const branch = req.body.branch;
    const students = req.body.students;
    if (!branch || !Array.isArray(students) || students.length === 0)
      return res.json({ success: false, message: "지점/명단 입력 필요" });

    // (원장별 branch 일치 여부 검증하고 싶으면 여기서 체크!)
    // if (req.user.branch !== branch) return res.json({success:false, message:"권한없음"});

    let inserted = 0;
    for (let s of students) {
      if (!s.name) continue; // 최소값
      await db.promise().query(
        `INSERT INTO 학생기초정보 (이름, 학교명, 학년, 성별, 전화번호, 지점명)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [s.name, s.school || '', s.grade || '', s.gender || '', s.phone || '', branch]
      );
      inserted++;
    }
    res.json({ success: true, inserted });
  } catch (e) {
    console.error(e);
    res.json({ success: false, message: "등록 오류" });
  }
});

// 2. 학생 리스트 조회 (지점별)
app.get('/26susi_student_list', authJWT, async (req, res) => {
  try {
    const branch = req.query.branch || req.user.branch;
    // (여기도 branch 권한 체크해주면 더 안전!)
    // if (req.user.branch !== branch) return res.json({success:false, message:"권한없음"});

    const [rows] = await db.promise().query(
      "SELECT * FROM 학생기초정보 WHERE 지점명 = ? ORDER BY 학생ID DESC",
      [branch]
    );
    res.json({ success: true, students: rows });
  } catch (e) {
    console.error(e);
    res.json({ success: false, message: "조회 오류" });
  }
});

// 3. 학생 삭제
app.post('/26susi_student_delete', authJWT, async (req, res) => {
  try {
    const student_id = req.body.student_id;
    if (!student_id) return res.json({ success: false, message: "student_id 필요" });
    await db.promise().query("DELETE FROM 학생기초정보 WHERE 학생ID = ?", [student_id]);
    res.json({ success: true });
  } catch (e) {
    res.json({ success: false, message: "삭제 오류" });
  }
});

// 4. 학생 수정
app.post('/26susi_student_update', authJWT, async (req, res) => {
  try {
    const { student_id, name, school, grade, gender, phone } = req.body;
    if (!student_id) return res.json({ success: false, message: "student_id 필요" });

    await db.promise().query(
      `UPDATE 학생기초정보 SET
        이름=?, 학교명=?, 학년=?, 성별=?, 전화번호=?
        WHERE 학생ID=?`,
      [name, school, grade, gender, phone, student_id]
    );
    res.json({ success: true });
  } catch (e) {
    res.json({ success: false, message: "수정 오류" });
  }
});
// 내신입력및조회
// 1. 대학리스트 (전형명 포함!)


// 2. 학생리스트 (지점별)
app.get('/26susi_student_list', authJWT, async (req, res) => {
  const branch = req.query.branch || req.user.branch;
  const [rows] = await db.promise().query(
    "SELECT 학생ID, 이름 FROM 학생기초정보 WHERE 지점명 = ? ORDER BY 학생ID",
    [branch]
  );
  res.json({ success: true, students: rows });
});
// $개별조회
// GET /26susi_student_grade?student_id=123
app.get('/26susi_student_grade', authJWT, async (req, res) => {
  const student_id = req.query.student_id;
  if (!student_id) return res.json({ success: false, message: "student_id 필요" });
  const [rows] = await db.promise().query(
    "SELECT 대학ID, 등급, 내신점수 FROM 학생_내신정보 WHERE 학생ID = ?",
    [student_id]
  );
  res.json({ success: true, grades: rows });
});

//  상담페이지 대학선택 등급내신
// { student_id, college_id, 등급, 내신점수 }
app.post('/26susi_student_grade_update', authJWT, async (req, res) => {
  const { student_id, college_id, 등급, 내신점수 } = req.body;
  if (!student_id || !college_id)
    return res.json({ success: false, message: "필수값 누락" });
  await db.promise().query(`
    INSERT INTO 학생_내신정보 (학생ID, 대학ID, 등급, 내신점수)
    VALUES (?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE 등급=VALUES(등급), 내신점수=VALUES(내신점수)
  `, [student_id, college_id, 등급, 내신점수]);
  res.json({ success: true });
});

// GET /26susi_college_list 대학리스트 (수정)
// [교체할 코드]

// ✅ 이 코드가 파일에 남아있는지 확인해 봐.

app.get('/26susi_college_list', authJWT, async (req, res) => {
  // 로그인한 사용자의 지점 정보를 가져옴
  const userBranch = req.user.branch;

  const sql = `
    SELECT 
      d.대학ID, d.대학명, d.학과명, d.전형명, d.실기ID,
      t.실기반영총점, t.기준총점, t.환산방식,
      d.26맥스예상컷,
      bc.지점예상컷  -- 지점별_예상컷 테이블에서 가져온 지점예상컷
    FROM 대학정보 d
    LEFT JOIN \`26수시실기총점반영\` t ON d.대학ID = t.대학ID
    -- 로그인한 사용자의 지점에 해당하는 지점컷만 JOIN
    LEFT JOIN \`지점별_예상컷\` bc ON d.대학ID = bc.대학ID AND bc.지점명 = ?
  `;
  const [rows] = await db.promise().query(sql, [userBranch]);
  res.json({ success: true, colleges: rows });
});
// [새로 추가할 코드]
// [새로 추가할 코드 1: 맥스컷 저장 API (관리자 전용)]

app.post('/26susi_update_max_cut', authJWT, async (req, res) => {
    if (!isAdmin(req.user)) {
        return res.status(403).json({ success: false, message: "관리자 권한이 필요합니다." });
    }
    const { 대학ID, 맥스예상컷 } = req.body;
    if (!대학ID) return res.status(400).json({ success: false, message: "대학ID 누락" });

    await db.promise().query("UPDATE 대학정보 SET `26맥스예상컷` = ? WHERE 대학ID = ?", [맥스예상컷, 대학ID]);
    res.json({ success: true });
});

// [새로 추가할 코드 2: 지점컷 저장 API (해당 지점 원장 전용)]

app.post('/26susi_update_branch_cut', authJWT, async (req, res) => {
    const { 대학ID, 지점예상컷 } = req.body;
    const 지점명 = req.user.branch; // JWT 토큰에서 로그인한 원장의 지점명 사용 (안전!)

    if (!대학ID) return res.status(400).json({ success: false, message: "대학ID 누락" });

    // UPSERT: 데이터가 없으면 새로 INSERT, 있으면 UPDATE
    const sql = `
        INSERT INTO 지점별_예상컷 (대학ID, 지점명, 지점예상컷)
        VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE 지점예상컷 = VALUES(지점예상컷)
    `;
    await db.promise().query(sql, [대학ID, 지점명, 지점예상컷]);
    res.json({ success: true });
});
// [새로 추가할 코드 3: 컷 관리 페이지용 데이터 로딩]

// [교체할 코드]

// (수정) 컷 관리 페이지용 데이터 로딩 API
app.get('/26susi_get_all_cuts', authJWT, async (req, res) => {
    const userBranch = req.user.branch;
    const sql = `
        SELECT 
            d.대학ID, d.대학명, d.학과명, d.전형명, d.26맥스예상컷,
            d.실기ID, -- 이 부분을 추가해야 프론트에서 필터링 가능!
            bc.지점예상컷
        FROM 대학정보 d
        LEFT JOIN 지점별_예상컷 bc ON d.대학ID = bc.대학ID AND bc.지점명 = ?
        ORDER BY d.대학명, d.학과명, d.전형명
    `;
    const [rows] = await db.promise().query(sql, [userBranch]);
    res.json({ success: true, cuts: rows, user: req.user });
});



// ✅ [수정] 삭제 로직이 포함된 최종 코드로 교체하세요.
app.post('/26susi_counsel_college_save_multi', authJWT, async (req, res) => {
  const { student_id, colleges } = req.body;
  if (student_id === undefined || !Array.isArray(colleges)) {
    return res.status(400).json({ success: false, message: "필수값 누락" });
  }

  // 데이터베이스 작업을 묶어서 처리하는 '트랜잭션' 시작
  const connection = await db.promise().getConnection();
  await connection.beginTransaction();

  try {
    // 1단계: 해당 학생의 기존 상담 대학 정보를 전부 삭제합니다.
    await connection.query("DELETE FROM 상담대학정보 WHERE 학생ID = ?", [student_id]);

    // 2단계: 화면에 남아있던 새로운 대학 정보 목록을 다시 INSERT 합니다.
    // (만약 colleges 배열이 비어있다면, 아무것도 추가하지 않고 '전체 삭제'만 된 효과)
    for (const col of colleges) {
      await connection.query(
        `INSERT INTO 상담대학정보 (
          학생ID, 대학ID, 실기ID, 내신등급, 내신점수,
          기록1, 점수1, 기록2, 점수2, 기록3, 점수3, 기록4, 점수4,
          기록5, 점수5, 기록6, 점수6, 기록7, 점수7,
          실기총점, 합산점수
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          student_id, safe(col.대학ID), safe(col.실기ID), safe(col.내신등급),
          safe(col.내신점수), safe(col.기록1), safe(col.점수1), safe(col.기록2),
          safe(col.점수2), safe(col.기록3), safe(col.점수3), safe(col.기록4),
          safe(col.점수4), safe(col.기록5), safe(col.점수5), safe(col.기록6),
          safe(col.점수6), safe(col.기록7), safe(col.점수7), safe(col.실기총점),
          safe(col.합산점수)
        ]
      );
    }

    // 3단계: 모든 작업이 성공하면 최종적으로 서버에 반영합니다.
    await connection.commit();
    res.json({ success: true });

  } catch (err) {
    // 중간에 에러가 발생하면 모든 작업을 취소하고 원래대로 되돌립니다.
    await connection.rollback();
    console.error('상담 대학 정보 저장 트랜잭션 오류:', err);
    res.status(500).json({ success: false, message: 'DB 처리 중 오류 발생' });

  } finally {
    // 작업이 끝나면 연결을 반납합니다.
    connection.release();
  }
});

app.get('/26susi_events_by_practical_id', authJWT, async (req, res) => {
  const { practical_id, gender } = req.query;
  if (!practical_id || !gender)
    return res.json({ success: false, message: "practical_id, gender 필요" });

  const [rows] = await db.promise().query(
    "SELECT DISTINCT 종목명 FROM 26수시실기배점 WHERE 실기ID = ? AND 성별 = ? ORDER BY 종목명",
    [practical_id, gender]
  );
  res.json({ success: true, events: rows });
});

app.get('/26susi_counsel_college_load', async (req, res) => {
  const student_id = req.query.student_id;
  if (!student_id) return res.json({ success: false, message: '학생ID 누락' });

  try {
    const [rows] = await db.promise().query(`
      SELECT 대학ID,
             기록1, 점수1, 기록2, 점수2, 기록3, 점수3,
             기록4, 점수4, 기록5, 점수5, 기록6, 점수6, 기록7, 점수7,
             합산점수, 상담메모
      FROM 상담대학정보
      WHERE 학생ID = ?
    `, [student_id]);

    res.json({ success: true, colleges: rows });
  } catch (err) {
    console.error('❌ 상담대학정보 불러오기 오류:', err);
    res.json({ success: false, message: 'DB 오류' });
  }
});



app.get('/26susi_counsel_college_list', authJWT, async (req, res) => {
  const student_id = req.query.student_id;
  if (!student_id)
    return res.json({ success: false, message: "학생ID 필요" });

  const [rows] = await db.promise().query(
    "SELECT * FROM 상담대학정보 WHERE 학생ID = ? ORDER BY 기록ID DESC", [student_id]
  );
  res.json({ success: true, list: rows });
});


// POST /26susi_counsel_college_save
// { student_id, college_id, 실기_id, 상담메모 }
app.post('/26susi_counsel_college_save', authJWT, async (req, res) => {
  const { student_id, college_id, 실기_id, 상담메모 } = req.body;
  if (!student_id || !college_id)
    return res.json({ success: false, message: "필수값 누락" });

  await db.promise().query(`
    INSERT INTO 상담대학정보 (학생ID, 대학ID, 실기ID, 상담메모)
    VALUES (?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE 상담메모=VALUES(상담메모)
  `, [student_id, college_id, 실기_id || null, 상담메모 || null]);

  res.json({ success: true });
});





// 3. 학생-대학 내신입력 데이터 전체조회 (branch별) - 전형명 포함!
app.get('/26susi_student_grade_map', authJWT, async (req, res) => {
  const branch = req.query.branch || req.user.branch;

  // 대학/학생/기존 입력값 모두 조회 (전형명 포함)
  const [colleges] = await db.promise().query("SELECT 대학ID, 대학명, 학과명, 전형명 FROM 대학정보");
const [students] = await db.promise().query(
  "SELECT 학생ID, 이름 FROM 학생기초정보 WHERE 지점명 = ? ORDER BY 학생ID", [branch]
);
const studentIds = students.map(s => s.학생ID);
let grades = [];
if (studentIds.length > 0) {
  [grades] = await db.promise().query(
    "SELECT 학생ID, 대학ID, 등급, 내신점수 FROM 학생_내신정보 WHERE 학생ID IN (?)",
    [studentIds]
  );
}
const grade_map = {};
(grades || []).forEach(g => {
  grade_map[`${g.학생ID}-${g.대학ID}`] = { 등급: g.등급, 내신점수: g.내신점수 };
});
res.json({ success: true, colleges, students, grade_map });
});

// 4. 학생-대학 등급/내신 입력/수정 (Upsert)
app.post('/26susi_student_grade_update', authJWT, async (req, res) => {
  const { student_id, college_id, 등급, 내신점수 } = req.body;
  if (!student_id || !college_id)
    return res.json({ success: false, message: "필수값 누락" });
  // Upsert (없으면 insert, 있으면 update)
  await db.promise().query(`
    INSERT INTO 학생_내신정보 (학생ID, 대학ID, 등급, 내신점수)
    VALUES (?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE 등급=VALUES(등급), 내신점수=VALUES(내신점수)
  `, [student_id, college_id, 등급, 내신점수]);
  res.json({ success: true });
});



// ✅ isReverse 판별 함수
const isReverseEvent = (eventName) => {
  const lower = eventName.toLowerCase();
  return ['10', '20', 'run', '100', 'z', '달리기','벽치기','런','에르고','앞뒤구르기'].some(keyword => lower.includes(keyword));
};

// ✅ 1. 대학/학과 선택용 실기ID 목록
app.get('/26susi/practical-ids', (req, res) => {
const sql = `
  SELECT 실기ID, 대학명, 학과명, 전형명, 성별
  FROM \`26수시실기배점\`
  WHERE 실기ID IS NOT NULL
  GROUP BY 실기ID, 대학명, 학과명, 전형명, 성별
  ORDER BY 대학명
`;


  db.query(sql, (err, results) => {
    if (err) {
      console.error('❌ [실기ID 목록 조회 오류]', err);
      return res.status(500).json({ message: 'DB 오류' });
    }

    console.log('\n📌 [실기ID 목록 응답]');
    results.forEach(r => {
      console.log(`▶ 실기ID: ${r.실기ID} | ${r.대학명} / ${r.학과명} / ${r.전형명} / ${r.성별}`);
    });

    res.json(results);
  });
});



// ✅ 2. 종목명 + 성별 리스트
app.get('/26susi/events/:id', (req, res) => {
  const 실기ID = req.params.id;

  const sql = `
    SELECT DISTINCT 종목명, 성별
    FROM \`26수시실기배점\`
    WHERE 실기ID = ?
  `;
  db.query(sql, [실기ID], (err, results) => {
    if (err) {
      console.error('❌ [종목 조회 오류]', err);
      return res.status(500).json({ message: 'DB 오류' });
    }

    console.log(`\n📌 [실기ID ${실기ID} 종목 조회 결과]`);
    if (results.length === 0) {
      console.warn('⚠️ 종목 없음');
    } else {
      results.forEach(r => {
        console.log(`▶ 종목: ${r.종목명}, 성별: ${r.성별}`);
      });
    }

    res.json(results);
  });
});


// ✅ 3. 배점 계산 API
// [기존 calculate-score 함수를 이걸로 통째로 교체하세요]

// [기존 calculate-score 함수를 이걸로 통째로 교체하세요]
// [교체할 코드] 이 API를 아래 내용으로 완전히 바꿔줘
// [교체할 코드] /26susi/calculate-final-score API
// [26susi.js] 파일의 /calculate-final-score API를 이걸로 교체

// [26susi.js] 파일의 /calculate-final-score API를 이걸로 교체

app.post('/26susi/calculate-final-score', authJWT, async (req, res) => {
    const { 대학ID, gender, inputs, 내신점수 } = req.body;
    if (!대학ID || !gender || !Array.isArray(inputs)) {
        return res.status(400).json({ success: false, message: "필수 정보 누락" });
    }

    try {
        const [collegeInfoRows] = await db.promise().query("SELECT 실기ID FROM 대학정보 WHERE 대학ID = ?", [대학ID]);
        if (collegeInfoRows.length === 0) {
            return res.status(404).json({ success: false, message: "대학 정보를 찾을 수 없습니다." });
        }
        const 실기ID = collegeInfoRows[0].실기ID;

        const [configRows] = await db.promise().query("SELECT 실기반영총점, 기준총점, 환산방식 FROM `26수시실기총점반영` WHERE 대학ID = ?", [대학ID]);
        const config = configRows[0] || {};

        // --- 1단계: 기록을 개별 점수로 변환 ---
        const scoreCalculationTasks = inputs.map(async (input) => {
if (input.기록 === null || input.기록 === '') {
    // 진짜로 기록 자체가 없는 상태만 "0점 (미시도)" 취급
    return { 종목명: input.종목명, 배점: 0 };
}


            const studentRecord = parseFloat(input.기록);
            const reverse = ['10m', '20m', 'run', '100', 'z', '달리기','벽치기','런','에르고','앞뒤구르기'].some(k => input.종목명.toLowerCase().includes(k));

            // ✅✅✅ 대학ID 155번(동국대) 특수 계산식 ✅✅✅
            if (Number(대학ID) === 155) {
                // ... (기존 동국대 로직은 그대로 유지)
                const [[formula_data]] = await db.promise().query(
                    "SELECT 최저기준, 최고기준, 기본점수, 최고점수 FROM `26수시실기배점` WHERE 실기ID = ? AND 종목명 = ? AND 성별 = ? LIMIT 1",
                    [실기ID, input.종목명, gender]
                );

                if (formula_data) {
                    const { 최저기준, 최고기준, 기본점수, 최고점수 } = formula_data;
                    
                    if (reverse && studentRecord < 최고기준) return { 종목명: input.종목명, 배점: 최고점수 };
                    if (reverse && studentRecord > 최저기준) return { 종목명: input.종목명, 배점: 기본점수 };
                    if (!reverse && studentRecord > 최고기준) return { 종목명: input.종목명, 배점: 최고점수 };
                    if (!reverse && studentRecord < 최저기준) return { 종목명: input.종목명, 배점: 기본점수 };
                    
                    let score = (studentRecord - 최저기준) * (최고점수 - 기본점수) / (최고기준 - 최저기준) + 기본점수;
                    score = parseFloat(score.toFixed(2));
                    return { 종목명: input.종목명, 배점: score };
                }
            }

            // ✅✅✅ P/F 판정 로직 시작 (실기ID 99번) ✅✅✅
            if (실기ID === 99) {
                // ... (기존 P/F 로직은 그대로 유지)
                const [[pf_row]] = await db.promise().query(
                    "SELECT 기록 FROM `26수시실기배점` WHERE 실기ID = ? AND 종목명 = ? AND 성별 = ? AND 배점 = 'P' LIMIT 1",
                    [실기ID, input.종목명, gender]
                );

                if (!pf_row) return { 종목명: input.종목명, 배점: 'F' };

                const benchmarkRecord = parseFloat(pf_row.기록);
                const studentRecord = parseFloat(input.기록);
                const reverse = ['10m', '20m', 'run', '100', 'z', '달리기','벽치기','런','에르고','앞뒤구르기'].some(k => input.종목명.toLowerCase().includes(k));

                if (reverse) {
                    return { 종목명: input.종목명, 배점: studentRecord <= benchmarkRecord ? 'P' : 'F' };
                } else {
                    return { 종목명: input.종목명, 배점: studentRecord >= benchmarkRecord ? 'P' : 'F' };
                }
            }

            // --- P/F 대학이 아닐 경우, 기존 숫자 점수 계산 로직 실행 ---
            let sql;
            if (reverse) {
                sql = `
                    SELECT 배점 FROM \`26수시실기배점\`
                    WHERE 실기ID = ? AND 종목명 = ? AND 성별 = ? AND CAST(기록 AS DECIMAL(10,2)) <= ?
                    ORDER BY CAST(기록 AS DECIMAL(10,2)) DESC LIMIT 1`;
            } else {
                sql = `
                    SELECT 배점 FROM \`26수시실기배점\`
                    WHERE 실기ID = ? AND 종목명 = ? AND 성별 = ? AND ? >= CAST(기록 AS DECIMAL(10,2))
                    ORDER BY CAST(배점 AS SIGNED) DESC LIMIT 1`;
            }
            
            const [[row]] = await db.promise().query(sql, [실기ID, input.종목명, gender, input.기록]);
            
            let scoreValue = 0;
            if (row) {
                scoreValue = row.배점;
            } else {
                const [[maxScoreRow]] = await db.promise().query(
                    `SELECT 기록, 배점 FROM \`26수시실기배점\` 
                     WHERE 실기ID = ? AND 종목명 = ? AND 성별 = ? 
                     ORDER BY CAST(배점 AS SIGNED) DESC LIMIT 1`,
                    [실기ID, input.종목명, gender]
                );

                if (maxScoreRow) {
                    const bestBenchmark = parseFloat(maxScoreRow.기록);
                    const studentRecord = parseFloat(input.기록);

                    if (reverse && studentRecord < bestBenchmark) {
                        scoreValue = maxScoreRow.배점;
                    } else if (!reverse && studentRecord > bestBenchmark) {
                        scoreValue = maxScoreRow.배점;
                    }
                }
            }
            
            const isNumeric = !isNaN(parseFloat(scoreValue)) && isFinite(scoreValue);
            const finalScore = isNumeric ? Number(scoreValue) : scoreValue;
            
            return { 종목명: input.종목명, 배점: finalScore };
        });
        
        const individualScores = await Promise.all(scoreCalculationTasks);
        
        const 종목별점수 = {};
        individualScores.forEach(item => {
            종목별점수[item.종목명] = item.배점;
        });
        
        // --- 2단계: 종목별 감수 계산 (이 부분은 모든 대학에 공통으로 필요) ---
        // ... (감수 계산 로직은 그대로 유지)
        const gamCalculationTasks = Object.keys(종목별점수).map(async (eventName) => {
            const studentScore = 종목별점수[eventName];
            if (studentScore === 0 || isNaN(Number(studentScore))) return { 종목명: eventName, 감수: 0 };

            const [scoreList] = await db.promise().query(
                "SELECT 배점 FROM `26수시실기배점` WHERE 실기ID = ? AND 종목명 = ? AND 성별 = ? ORDER BY CAST(배점 AS SIGNED) DESC",
                [실기ID, eventName, gender]
            );
            const scores = scoreList.map(item => parseFloat(item.배점));
            if (scores.length === 0 || studentScore >= scores[0]) {
                return { 종목명: eventName, 감수: 0 };
            }
            const scoreIndex = scores.indexOf(studentScore);
            return { 종목명: eventName, 감수: scoreIndex === -1 ? 0 : scoreIndex };
        });
        const individualGams = await Promise.all(gamCalculationTasks);

        const 종목별감수 = {};
        individualGams.forEach(item => {
            종목별감수[item.종목명] = item.감수;
        });

        // ▼▼▼▼▼ 397번 대학 특수 로직 추가 ▼▼▼▼▼
          if (Number(대학ID) === 397) {
            const sumOfScores = individualScores.reduce((acc, scoreObj) => acc + Number(scoreObj.배점 || 0), 0);
            
            // let으로 변경해서 재할당 가능하게 수정
            let 실기총점 = (sumOfScores / 3 * 4) + 400;
            let 합산점수 = 실기총점 + Number(내신점수 || 0);

            // 소수점 처리
            실기총점 = parseFloat(실기총점.toFixed(2));
            합산점수 = parseFloat(합산점수.toFixed(2));

            return res.json({
                success: true,
                종목별점수,
                종목별감수,
                총감수: 0,
                실기총점: 실기총점,
                합산점수: 합산점수
            });
        }
        // ▲▲▲▲▲ 397번 대학 특수 로직 끝 ▲▲▲▲▲
        // ▲▲▲▲▲ 397번 대학 특수 로직 끝 ▲▲▲▲▲

        // --- 3단계: 최종 점수 계산 (외부 모듈 호출 - 397번이 아닐 경우에만 실행) ---
        const finalScores = calculateFinalScore(대학ID, 종목별점수, 내신점수, config, 종목별감수, inputs);

        // --- 4단계: 모든 결과 한번에 전송 ---
        res.json({
            success: true,
            종목별점수,
            종목별감수,
            총감수: finalScores.총감수,
            실기총점: finalScores.실기총점,
            합산점수: finalScores.합산점수
        });

    } catch (err) {
        console.error("만능 점수 계산 API 오류:", err);
        res.status(500).json({ success: false, message: "서버 오류 발생" });
    }
});
// (수정) 저장된 설정값도 함께 조회
app.get('/26susi_get_practical_colleges_with_scores', async (req, res) => {
  const sql = `
    SELECT 
      d.대학ID, d.실기ID, d.대학명, d.학과명, d.전형명,
      COALESCE(s.total_max_score, 0) AS 기본만점총합,
      t.실기반영총점, t.기준총점, t.환산방식, t.특수식설명
    FROM 
      대학정보 d
    LEFT JOIN (
      SELECT 
        실기ID, SUM(max_score) as total_max_score
      FROM (
        SELECT 
          실기ID, 종목명, MAX(CAST(배점 AS SIGNED)) as max_score 
        FROM \`26수시실기배점\`
        WHERE 실기ID IS NOT NULL
        GROUP BY 실기ID, 종목명
      ) as subquery
      GROUP BY 실기ID
    ) s ON d.실기ID = s.실기ID
    LEFT JOIN \`26수시실기총점반영\` t ON d.대학ID = t.대학ID
    WHERE 
      d.실기ID IS NOT NULL
    ORDER BY 
      d.대학명;
  `;
  try {
    const [rows] = await db.promise().query(sql);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: '데이터 조회 실패' });
  }
});

// ✅ (신규) 대시보드용 발표일정 조회 API
app.get('/26susi/announcement-dates', authJWT, async (req, res) => {
    try {
        // 1단계 발표일과 최종 발표일을 합쳐서 하나의 목록으로 만듦
        // STR_TO_DATE 함수로 문자열을 날짜로 변환하여 오늘(CURDATE())과 비교
        const sql = `
            SELECT * FROM (
                (SELECT 대학명, 학과명, 전형명, \`1단계발표일\` AS 발표일, '1차 발표' AS 내용 FROM 대학정보 WHERE \`1단계발표일\` IS NOT NULL AND \`1단계발표일\` != '')
                UNION ALL
                (SELECT 대학명, 학과명, 전형명, \`합격자발표일\` AS 발표일, '최종 발표' AS 내용 FROM 대학정보 WHERE \`합격자발표일\` IS NOT NULL AND \`합격자발표일\` != '')
            ) AS announcements
            WHERE STR_TO_DATE(발표일, '%Y.%m.%d') >= CURDATE()
            ORDER BY STR_TO_DATE(발표일, '%Y.%m.%d') ASC
            LIMIT 10;
        `;
        const [dates] = await db.promise().query(sql);
        res.json({ success: true, dates });
    } catch(err) {
        console.error("발표일정 조회 API 오류:", err);
        res.status(500).json({ success: false, message: "서버 오류 발생" });
    }
});


// ✅ (신규) 확정 대학 정보 조회 API
// =================================================================
// 📋 최종 수합 페이지 관련 API
// =================================================================

// (신규) 최종 수합 페이지 데이터 조회
// ✅ (수정) 최종 수합 페이지 데이터 조회 (지점 필터링 추가)
// ✅ (수정) 최종 수합 페이지 데이터 조회 ( .promise() 추가)
app.get('/26susi_final_list', authJWT, async (req, res) => {
    const { college_id } = req.query;
    const branch = req.user.branch;

    if (!college_id) {
        return res.status(400).json({ success: false, message: "대학ID가 필요합니다." });
    }

    try {
        const sql = `
            SELECT 
                s.이름, s.학년, s.성별,
                f.* FROM 확정대학정보 f
            JOIN 학생기초정보 s ON f.학생ID = s.학생ID
            WHERE f.대학ID = ? AND s.지점명 = ? 
            ORDER BY f.합산점수 DESC, s.이름 ASC
        `;
        
        // ▼▼▼▼▼ 여기가 수정된 부분! .promise() 추가 ▼▼▼▼▼
        const [rows] = await db.promise().query(sql, [college_id, branch]);
        // ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲

        res.json({ success: true, students: rows });

    } catch (err) {
        console.error("최종 수합 데이터 조회 오류:", err);
        res.status(500).json({ success: false, message: "DB 조회 중 오류 발생" });
    }
});

// (신규) 최종 수합 페이지로 불러올 상담 학생 후보 조회
app.get('/26susi_counsel_candidates', authJWT, async (req, res) => {
    const { college_id } = req.query;
    const branch = req.user.branch;
    if (!college_id) {
        return res.status(400).json({ success: false, message: "대학ID가 필요합니다." });
    }

    try {
        // 특정 대학에 대해 상담 이력이 있고, 해당 지점 소속이며, 아직 확정 명단에는 없는 학생들을 조회
        const sql = `
            SELECT 
                s.학생ID, s.이름, s.학년, s.성별,
                g.등급 as 내신등급, g.내신점수
            FROM 학생기초정보 s
            JOIN (SELECT DISTINCT 학생ID FROM 상담대학정보 WHERE 대학ID = ?) c ON s.학생ID = c.학생ID
            LEFT JOIN 학생_내신정보 g ON s.학생ID = g.학생ID AND g.대학ID = ?
            WHERE 
                s.지점명 = ? 
                AND s.학생ID NOT IN (SELECT 학생ID FROM 확정대학정보 WHERE 대학ID = ?)
            ORDER BY s.이름
        `;
        const [rows] = await db.promise().query(sql, [college_id, college_id, branch, college_id]);
        res.json({ success: true, candidates: rows });

    } catch (err) {
        console.error("상담 학생 후보 조회 오류:", err);
        res.status(500).json({ success: false, message: "DB 조회 중 오류 발생" });
    }
});

// (신규) 최종 수합 페이지 전체 저장
// 26susi.js의 /26susi_final_save API를 이 코드로 통째로 교체해줘

app.post('/26susi_final_save', authJWT, async (req, res) => {
    const { college_id, studentData } = req.body;
    const branch = req.user.branch; // ★ 1. 현재 로그인한 원장의 지점 정보를 가져옴

    if (!college_id || !Array.isArray(studentData)) {
        return res.status(400).json({ success: false, message: "필수 데이터가 누락되었습니다." });
    }

    const connection = await db.promise().getConnection();
    await connection.beginTransaction();

    try {
        const frontendStudentIds = studentData.map(s => s.학생ID);

        // ★ 2. DB에서 학생 목록을 가져올 때 '현재 지점' 학생들만 가져오도록 쿼리 수정 (가장 중요한 변경점)
        const [existingDbRows] = await connection.query(
            `SELECT f.학생ID FROM 확정대학정보 f
             JOIN 학생기초정보 s ON f.학생ID = s.학생ID
             WHERE f.대학ID = ? AND s.지점명 = ?`,
            [college_id, branch] // ★ 3. 쿼리에 branch 변수 추가
        );
        const existingDbStudentIds = existingDbRows.map(row => row.학생ID);

        const idsToDelete = existingDbStudentIds.filter(id => !frontendStudentIds.includes(id));
        
        // 이 부분부터는 이전과 동일하지만, 이제 idsToDelete 목록 자체가 안전해졌기 때문에
        // 다른 지점 데이터를 실수로 지울 가능성이 원천 차단됨.
        if (idsToDelete.length > 0) {
            await connection.query(
                "DELETE FROM 확정대학정보 WHERE 대학ID = ? AND 학생ID IN (?)",
                [college_id, idsToDelete]
            );
        }

        for (const student of studentData) {
            const finalSql = `
                INSERT INTO 확정대학정보 (
                    학생ID, 대학ID, 실기ID, 내신등급, 내신점수, 실기일정,
                    최초합여부, 최종합여부, 합산점수, 실기총점, 
                    기록1, 점수1, 기록2, 점수2, 기록3, 점수3, 기록4, 점수4,
                    기록5, 점수5, 기록6, 점수6, 기록7, 점수7
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                    실기ID=VALUES(실기ID), 내신등급=VALUES(내신등급), 내신점수=VALUES(내신점수), 실기일정=VALUES(실기일정),
                    최초합여부=VALUES(최초합여부), 최종합여부=VALUES(최종합여부), 합산점수=VALUES(합산점수), 실기총점=VALUES(실기총점),
                    기록1=VALUES(기록1), 점수1=VALUES(점수1), 기록2=VALUES(기록2), 점수2=VALUES(점수2), 기록3=VALUES(기록3), 점수3=VALUES(점수3),
                    기록4=VALUES(기록4), 점수4=VALUES(점수4), 기록5=VALUES(기록5), 점수5=VALUES(점수5), 기록6=VALUES(기록6), 점수6=VALUES(점수6),
                    기록7=VALUES(기록7), 점수7=VALUES(점수7)
            `;
            const finalParams = [
                student.학생ID, college_id, student.실기ID, student.내신등급, student.내신점수, student.실기일정,
                student.최초합여부, student.최종합여부, student.합산점수, student.실기총점,
                student.기록1, student.점수1, student.기록2, student.점수2, student.기록3, student.점수3, student.기록4, student.점수4,
                student.기록5, student.점수5, student.기록6, student.점수6, student.기록7, student.점수7
            ].map(v => v === undefined ? null : v);
            
            await connection.query(finalSql, finalParams);
        }
        
        await connection.commit();
        res.json({ success: true, message: "성공적으로 저장되었습니다." });

    } catch (err) {
        await connection.rollback();
        console.error("최종 수합 저장 API 오류:", err);
        res.status(500).json({ success: false, message: '서버 DB 처리 중 오류가 발생했습니다.' });
    } finally {
        if (connection) connection.release();
    }
});

// ✅ (수정) 대시보드용 지점별 실기일정 조회 API (개인별 실기일정 반영)
app.get('/26susi/branch-schedule', authJWT, async (req, res) => {
    const branch = req.user.branch;

    try {
        // [수정] d.실기일 대신 f.실기일정 을 기준으로 조회
        const sql = `
            SELECT
                f.실기일정 AS 실기일,
                d.대학명,
                d.학과명,
                s.이름 AS 학생이름
            FROM 확정대학정보 f
            JOIN 학생기초정보 s ON f.학생ID = s.학생ID
            JOIN 대학정보 d ON f.대학ID = d.대학ID
            WHERE
                s.지점명 = ?
                AND f.실기일정 IS NOT NULL
                AND f.실기일정 != ''
                AND STR_TO_DATE(f.실기일정, '%Y-%m-%d') >= CURDATE()
            ORDER BY
                STR_TO_DATE(f.실기일정, '%Y-%m-%d') ASC, d.대학명 ASC;
        `;
        const [rows] = await db.promise().query(sql, [branch]);

        if (rows.length === 0) {
            return res.json({ success: true, schedule: [] });
        }

        const scheduleMap = new Map();
        rows.forEach(row => {
            const key = `${row.실기일}|${row.대학명}|${row.학과명}`;
            if (!scheduleMap.has(key)) {
                scheduleMap.set(key, {
                    date: row.실기일,
                    university: row.대학명,
                    department: row.학과명,
                    students: []
                });
            }
            scheduleMap.get(key).students.push(row.학생이름);
        });

        const groupedSchedule = Array.from(scheduleMap.values());
        
        res.json({ success: true, schedule: groupedSchedule });

    } catch (err) {
        console.error("지점별 실기일정 조회 API 오류:", err);
        res.status(500).json({ success: false, message: "서버 오류 발생" });
    }
});

// ✅ (신규) 모집요강 탐색 페이지용 대학 필터링 API
// ✅ (수정) 새로운 필터(교직이수, 수능최저)를 처리하도록 기능 추가
// ✅ (수정) '1단계 전형 없음' 필터 조건을 처리하도록 기능 추가
// ✅ (수정) 수능최저 '없음' 필터 로직을 개선한 최종 버전
app.get('/26susi/explore-universities', authJWT, async (req, res) => {
    try {
        let baseQuery = `
            SELECT d.*, s.실기종목들
            FROM 대학정보 d
            LEFT JOIN (
                SELECT 실기ID, GROUP_CONCAT(DISTINCT 종목명 SEPARATOR ',') as 실기종목들
                FROM \`26수시실기배점\`
                GROUP BY 실기ID
            ) AS s ON d.실기ID = s.실기ID
        `;

        const whereClauses = [];
        const params = [];

        // 필터 조건들을 동적으로 추가
        if (req.query.type) { whereClauses.push('d.구분 = ?'); params.push(req.query.type); }
       if (req.query.region) {
            // region 파라미터가 '서울,경기' 처럼 콤마로 구분된 문자열로 올 수 있음
            const regions = req.query.region.split(',');
            whereClauses.push('d.광역 IN (?)'); // IN 절을 사용하여 여러 지역을 한 번에 검색
            params.push(regions);
        }
        
        if (req.query.teaching && req.query.teaching !== '전체') { 
            whereClauses.push("d.교직이수 = ?");
            params.push(req.query.teaching);
        }
        if (req.query.firstStage === 'O') { 
            whereClauses.push("d.1단계배수 IS NOT NULL AND d.1단계배수 != ''");
        } else if (req.query.firstStage === 'X') {
            whereClauses.push("(d.1단계배수 IS NULL OR d.1단계배수 = '')");
        }
        
        // ▼▼▼▼▼▼ 여기가 핵심 수정! ▼▼▼▼▼▼
        if (req.query.minSat && req.query.minSat !== '전체') {
            if (req.query.minSat === 'O') {
                // '있음'을 선택한 경우
                whereClauses.push("d.수능최저 = ?");
                params.push('O');
            } else if (req.query.minSat === 'X') {
                // '없음'을 선택한 경우 ('X', 비어있음, NULL 모두 포함)
                whereClauses.push("(d.수능최저 = 'X' OR d.수능최저 IS NULL OR d.수능최저 = '')");
            }
        }
        // ▲▲▲▲▲▲ 여기가 핵심 수정! ▲▲▲▲▲▲

        const eligibility = ['일반고', '특성화고', '체육고', '검정고시'].filter(key => req.query[key] === 'O');
        if (eligibility.length > 0) {
            whereClauses.push(`(${eligibility.map(e => `d.${e} = 'O'`).join(' AND ')})`);
        }
        const grades = ['내신일반', '내신진로'].filter(key => req.query[key] === 'O');
        if (grades.length > 0) {
            whereClauses.push(`(${grades.map(g => `d.${g} = 'O'`).join(' OR ')})`);
        }
        if (req.query.excludeEvents) {
            const eventsToExclude = req.query.excludeEvents.split(',');
            eventsToExclude.forEach(event => {
                whereClauses.push("(s.실기종목들 IS NULL OR NOT FIND_IN_SET(?, s.실기종목들))");
                params.push(event);
            });
        }
        if (req.query.isPractical === 'O') {
            whereClauses.push("d.실기ID IS NOT NULL");
        }

        if (whereClauses.length > 0) {
            baseQuery += ' WHERE ' + whereClauses.join(' AND ');
        }
        
        baseQuery += ' ORDER BY d.대학명, d.학과명;';

        const [rows] = await db.promise().query(baseQuery, params);
        res.json({ success: true, universities: rows });

    } catch (err) {
        console.error("대학 탐색 API 오류:", err);
        res.status(500).json({ success: false, message: "서버 오류 발생" });
    }
});
// ✅ (신규) 여러 학생에게 상담 대학 일괄 추가 API
// ✅ (수정) 디버깅 로그를 추가한 버전
// ✅ (수정) 디버깅 로그를 추가한 버전
app.post('/26susi/add-counseling-bulk', authJWT, async (req, res) => {
    const { college_id, student_ids } = req.body;

    // ▼▼▼▼▼▼ 디버깅 로그 ▼▼▼▼▼▼
    console.log('\n--- 상담 대학 일괄 추가 API 호출됨 ---');
    console.log('서버가 받은 데이터:', req.body);
    // ▲▲▲▲▲▲ 디버깅 로그 ▲▲▲▲▲▲

    if (!college_id || !Array.isArray(student_ids) || student_ids.length === 0) {
        return res.status(400).json({ success: false, message: "필수 정보가 누락되었습니다." });
    }

    try {
        const college = (await db.promise().query("SELECT 실기ID FROM 대학정보 WHERE 대학ID = ?", [college_id]))[0][0];
        if (!college) {
            return res.status(404).json({ success: false, message: "대학 정보를 찾을 수 없습니다." });
        }

        let addedCount = 0;
        console.log(`[시작] ${student_ids.length}명의 학생에 대한 작업을 시작합니다.`); // 디버깅 로그

        for (const student_id of student_ids) {
            
            console.log(`  [처리중] 학생 ID: ${student_id}`); // 디버깅 로그

            const [existing] = await db.promise().query(
                "SELECT 기록ID FROM 상담대학정보 WHERE 학생ID = ? AND 대학ID = ?",
                [student_id, college_id]
            );

            if (existing.length === 0) {
                console.log(`    -> [추가] 해당 학생은 목록에 없으므로 새로 추가합니다.`); // 디버깅 로그
                await db.promise().query(
                    "INSERT INTO 상담대학정보 (학생ID, 대학ID, 실기ID) VALUES (?, ?, ?)",
                    [student_id, college_id, college.실기ID]
                );
                addedCount++;
            } else {
                console.log(`    -> [건너뛰기] 해당 학생은 이미 상담 목록에 있습니다.`); // 디버깅 로그
            }
        }
        
        console.log(`[완료] 총 ${addedCount}명의 학생을 추가했습니다.`); // 디버깅 로그
        console.log('-------------------------------------\n');
        
        res.json({ success: true, message: `${addedCount}명의 학생에게 상담 대학이 추가되었습니다.` });

    } catch (err) {
        console.error("상담 대학 일괄 추가 API 오류:", err);
        res.status(500).json({ success: false, message: "서버 오류 발생" });
    }
});

// ✅ (신규) 특정 대학에 대해 이미 상담 목록에 있는 학생 ID 목록 조회 API
app.get('/26susi/counseled-students-for-college', authJWT, async (req, res) => {
    const { college_id } = req.query;
    if (!college_id) {
        return res.status(400).json({ success: false, message: "대학ID가 필요합니다." });
    }
    
    // 로그인한 원장 지점의 학생들만 대상으로 함
    const branch = req.user.branch;

    try {
        const sql = `
            SELECT c.학생ID 
            FROM 상담대학정보 c
            JOIN 학생기초정보 s ON c.학생ID = s.학생ID
            WHERE c.대학ID = ? AND s.지점명 = ?
        `;
        const [rows] = await db.promise().query(sql, [college_id, branch]);
        const studentIds = rows.map(r => r.학생ID);
        res.json({ success: true, student_ids: studentIds });
    } catch(err) {
        console.error("기존 상담 학생 ID 조회 API 오류:", err);
        res.status(500).json({ success: false, message: "서버 오류 발생" });
    }
});


// ✅ (신규) 필터링을 위한 모든 지역 목록 API
app.get('/26susi/filter-options/regions', authJWT, async (req, res) => {
    const [rows] = await db.promise().query("SELECT DISTINCT 광역 FROM 대학정보 WHERE 광역 IS NOT NULL AND 광역 != '' ORDER BY 광역");
    res.json({ success: true, regions: rows.map(r => r.광역) });
});

// ✅ (신규) 필터링을 위한 모든 실기 종목 목록 API
app.get('/26susi/filter-options/events', authJWT, async (req, res) => {
    const [rows] = await db.promise().query("SELECT DISTINCT 종목명 FROM `26수시실기배점` ORDER BY 종목명");
    res.json({ success: true, events: rows.map(r => r.종목명) });
});

// ✅ (신규) 공지사항 관련 API 3개

// 1. 공지사항 목록 조회 API (모든 사용자가 호출)
app.get('/26susi/announcements', authJWT, async (req, res) => {
    try {
        const sql = "SELECT * FROM 공지사항 ORDER BY 중요 DESC, 작성일시 DESC LIMIT 5";
        const [announcements] = await db.promise().query(sql);
        res.json({ success: true, announcements });
    } catch(err) {
        console.error("공지사항 조회 API 오류:", err);
        res.status(500).json({ success: false, message: "서버 오류" });
    }
});

// 2. 새 공지사항 작성 API (관리자 전용)
app.post('/26susi/announcements/create', authJWT, async (req, res) => {
    if (!isAdmin(req.user)) {
        return res.status(403).json({ success: false, message: "관리자 권한이 필요합니다." });
    }
    const { title, content, is_important } = req.body;
    try {
        const sql = "INSERT INTO 공지사항 (제목, 내용, 중요) VALUES (?, ?, ?)";
        await db.promise().query(sql, [title, content, is_important ? 'O' : 'X']);
        res.json({ success: true, message: "공지사항이 등록되었습니다." });
    } catch(err) {
        console.error("공지사항 작성 API 오류:", err);
        res.status(500).json({ success: false, message: "서버 오류" });
    }
});

// 3. 공지사항 삭제 API (관리자 전용)
app.post('/26susi/announcements/delete', authJWT, async (req, res) => {
    if (!isAdmin(req.user)) {
        return res.status(403).json({ success: false, message: "관리자 권한이 필요합니다." });
    }
    const { notice_id } = req.body;
    try {
        await db.promise().query("DELETE FROM 공지사항 WHERE 공지ID = ?", [notice_id]);
        res.json({ success: true, message: "공지사항이 삭제되었습니다." });
    } catch(err) {
        console.error("공지사항 삭제 API 오류:", err);
        res.status(500).json({ success: false, message: "서버 오류" });
    }
});

// --- 점수 계산 헬퍼 함수 (콜백 방식) ---
// --- 점수 계산 헬퍼 함수 (만점/최하점 처리 기능 추가) ---
// ⭐️ DB 기반 점수 계산 함수 (테이블명: scoring_criteria)
// [이 함수를 통째로 이걸로 교체해!]
async function calculateScoreFromDBAsync(event, gender, recordValue) {
    const isReverse = (event === '10m'); // 10m만 기록 낮을수록 좋음
    const order = isReverse ? 'ASC' : 'DESC';
    const comparison = isReverse ? '>=' : '<=';

    // 1. 점수표에서 기록에 맞는 점수를 바로 찾음
    const sql = `
        SELECT score
        FROM scoring_criteria
        WHERE event = ? AND gender = ? AND record_threshold ${comparison} ?
        ORDER BY record_threshold ${order}
        LIMIT 1;
    `;

    try {
        // (1번 쿼리)
        const [rows] = await db.promise().query(sql, [event, gender, recordValue]);
        
        if (rows.length > 0) {
            // ⭐️ 점수표에 있으면 그 점수 바로 반환
            return rows[0].score;
        } else {
            // ⭐️ 점수표에 없으면 (만점이거나, 빵점이거나)
            //    최고/최저 기준점을 찾음 (2번 쿼리)
            const [boundaries] = await db.promise().query(
                `SELECT
                    MIN(CASE WHEN score = 100 THEN record_threshold END) as max_score_record,
                    MAX(CASE WHEN score = 52 THEN record_threshold END) as min_score_record
                 FROM scoring_criteria WHERE event = ? AND gender = ?`,
                [event, gender]
            );

            if (boundaries.length > 0) {
                const { max_score_record, min_score_record } = boundaries[0];
                
                // ⭐️ callback() 대신 return을 사용
                if (isReverse) { // 10m (낮을수록 좋음)
                    // 만점 기준보다 잘했으면 100점
                    if (max_score_record !== null && recordValue <= max_score_record) return 100;
                    // 빵점 기준보다 못했으면 52점
                    if (min_score_record !== null && recordValue > min_score_record) return 52;
                } else { // 제멀 등 (높을수록 좋음)
                    // 만점 기준보다 잘했으면 100점
                    if (max_score_record !== null && recordValue >= max_score_record) return 100;
                    // 빵점 기준보다 못했으면 52점
                    if (min_score_record !== null && recordValue < min_score_record) return 52;
                }
            }

            // ⭐️ 쿼리/기준에 다 없으면 기본 빵점(52점)
            return 52; 
        }
    } catch (err) {
        // ⭐️ 에러가 나면 API가 500 에러를 뿜도록 함
        console.error("점수 계산 DB 쿼리 오류 (Async):", err);
        throw err; 
    }
}

// ✅ (신규) 학생별 최종 지원 현황 조회 API
app.get('/26susi/student_application_status', authJWT, async (req, res) => {
    // 1. 로그인한 원장님의 지점 정보를 가져옴
    const branch = req.user.branch;

    try {
        // 2. 해당 지점의 모든 학생에 대해, 확정된 대학 정보를 모두 JOIN해서 가져옴
        const sql = `
            SELECT
                s.학생ID, s.이름, s.학년,
                d.대학명, d.학과명, d.전형명
            FROM 학생기초정보 s
            JOIN 확정대학정보 f ON s.학생ID = f.학생ID
            JOIN 대학정보 d ON f.대학ID = d.대학ID
            WHERE s.지점명 = ?
            ORDER BY s.이름, d.대학명;
        `;
        const [rows] = await db.promise().query(sql, [branch]);

        // 3. DB에서 가져온 데이터를 학생별로 그룹화해서 재정리
        const studentMap = new Map();
        rows.forEach(row => {
            // 맵에 해당 학생이 없으면, 기본 틀을 만들어줌
            if (!studentMap.has(row.학생ID)) {
                studentMap.set(row.학생ID, {
                    학생ID: row.학생ID,
                    이름: row.이름,
                    학년: row.학년,
                    지원대학: [] // 지원 대학 목록을 담을 빈 배열
                });
            }
            // 해당 학생의 지원대학 배열에 대학 정보를 추가
            studentMap.get(row.학생ID).지원대학.push({
                대학명: row.대학명,
                학과명: row.학과명,
                전형명: row.전형명
            });
        });

        // 4. 맵을 배열로 변환해서 최종 결과 전송
        const results = Array.from(studentMap.values());
        res.json({ success: true, students: results });

    } catch (err) {
        console.error("학생별 지원 현황 조회 API 오류:", err);
        res.status(500).json({ success: false, message: "서버 오류 발생" });
    }
});

// ✅ (신규) 지점별 최종 수합 현황 (대학별 그룹) API
app.get('/26susi/branch_summary_by_university', authJWT, async (req, res) => {
    const branch = req.user.branch; // 로그인한 원장 지점

    try {
        // 1. 해당 지점 학생이 확정 명단에 있는 모든 대학/학생 정보를 가져옴
        const sql = `
            SELECT
                d.대학ID, d.대학명, d.학과명, d.전형명, d.실기ID,
                s.학생ID, s.이름, s.학년, s.성별,s.학교명, s.지점명,
                f.내신등급, f.내신점수, f.실기총점, f.합산점수,
                f.기록1, f.점수1, f.기록2, f.점수2, f.기록3, f.점수3, f.기록4, f.점수4,
                f.기록5, f.점수5, f.기록6, f.점수6, f.기록7, f.점수7,
                f.최초합여부, f.최종합여부, f.실기일정
            FROM 대학정보 d
            JOIN 확정대학정보 f ON d.대학ID = f.대학ID
            JOIN 학생기초정보 s ON f.학생ID = s.학생ID
            WHERE s.지점명 = ?
            ORDER BY d.대학명, d.학과명, d.전형명, f.합산점수 DESC;
        `;
        const [rows] = await db.promise().query(sql, [branch]);

        // 2. 대학별로 데이터를 재조립 (가장 중요한 부분)
        const universityMap = new Map();
        for (const row of rows) {
            const key = row.대학ID;
            if (!universityMap.has(key)) {
                // 이 대학이 처음 나오면, 대학 정보와 빈 학생 배열로 초기화
                universityMap.set(key, {
                    대학ID: row.대학ID,
                    대학명: row.대학명,
                    학과명: row.학과명,
                    전형명: row.전형명,
                    실기ID: row.실기ID,
                    학생들: []
                });
            }
            // 해당 대학의 '학생들' 배열에 학생 정보를 추가
            universityMap.get(key).학생들.push({
                학생ID: row.학생ID, 이름: row.이름, 학년: row.학년, 성별: row.성별,
                내신등급: row.내신등급, 내신점수: row.내신점수, 실기총점: row.실기총점, 합산점수: row.합산점수,
                기록1: row.기록1, 점수1: row.점수1, 기록2: row.기록2, 점수2: row.점수2, 기록3: row.기록3, 점수3: row.점수3,
                기록4: row.기록4, 점수4: row.점수4, 기록5: row.기록5, 점수5: row.점수5, 기록6: row.기록6, 점수6: row.점수6,
                기록7: row.기록7, 점수7: row.점수7,
                최초합여부: row.최초합여부, 최종합여부: row.최종합여부, 실기일정: row.실기일정
            });
        }

        // 3. 실기ID가 있는 대학들의 실기 종목 정보도 가져와서 합쳐줌
        const practicalIds = [...universityMap.values()]
            .map(uni => uni.실기ID)
            .filter(id => id); // null이나 undefined가 아닌 실기ID만 필터링

        if (practicalIds.length > 0) {
            const [events] = await db.promise().query(
                "SELECT 실기ID, GROUP_CONCAT(DISTINCT 종목명 ORDER BY 종목명 SEPARATOR ',') as 종목들 FROM `26수시실기배점` WHERE 실기ID IN (?) GROUP BY 실기ID",
                [practicalIds]
            );
            const eventMap = new Map(events.map(e => [e.실기ID, e.종목들.split(',')]));
            universityMap.forEach(uni => {
                if (uni.실기ID && eventMap.has(uni.실기ID)) {
                    uni.실기종목 = eventMap.get(uni.실기ID);
                }
            });
        }
        
        const results = Array.from(universityMap.values());
        res.json({ success: true, universities: results });
    } catch (err) {
        console.error("대학별 최종 수합 조회 API 오류:", err);
        res.status(500).json({ success: false, message: "서버 오류 발생" });
    }
});

// ✅ (신규) 미수합 학생 목록 조회 API
app.get('/26susi/unassigned_students', authJWT, async (req, res) => {
    const branch = req.user.branch; // 로그인한 원장 지점

    try {
        // SQL 쿼리를 사용해, '학생기초정보'에는 있지만 '확정대학정보'에는
        // 한 번도 등장하지 않은 학생들을 찾는다.
        const sql = `
            SELECT s.이름, s.학년
            FROM 학생기초정보 s
            LEFT JOIN 확정대학정보 f ON s.학생ID = f.학생ID
            WHERE s.지점명 = ? AND f.학생ID IS NULL
            ORDER BY s.이름;
        `;
        const [rows] = await db.promise().query(sql, [branch]);
        
        res.json({ success: true, students: rows });

    } catch (err) {
        console.error("미수합 학생 조회 API 오류:", err);
        res.status(500).json({ success: false, message: "서버 오류 발생" });
    }
});

// ✅ [26susi.js 파일의 기존 API를 이걸로 통째로 교체해줘]

// ✅ [26susi.js 파일의 기존 API를 이걸로 통째로 교체해줘]

// ✅ [26susi.js 파일의 기존 API를 이걸로 교체하고 서버를 재시작해줘]

// ✅ [26susi.js 파일의 기존 API를 이걸로 통째로 교체하고 서버를 재시작해줘]

app.get('/26susi/realtime-rank-by-college', authJWT, async (req, res) => {
    const { college_id } = req.query;
    if (!college_id) {
        return res.status(400).json({ success: false, message: "대학ID가 필요합니다." });
    }

    try {
        const [collegeInfo] = await db.promise().query("SELECT 실기ID FROM 대학정보 WHERE 대학ID = ?", [college_id]);
        const practical_id = collegeInfo[0]?.실기ID;
        let events = [];

        if (practical_id) {
            const [eventRows] = await db.promise().query(
                "SELECT DISTINCT 종목명 FROM `26수시실기배점` WHERE 실기ID = ? ORDER BY 종목명",
                [practical_id]
            );
            events = eventRows.map(e => e.종목명);
        }

        // ▼▼▼▼▼ 여기가 수정된 핵심 부분 (합/불 정보 추가) ▼▼▼▼▼
        const sql = `
            SELECT
                RANK() OVER (ORDER BY COALESCE(f.합산점수, 0) DESC, COALESCE(f.내신점수, 0) DESC) as 순위,
                s.학생ID, s.이름, s.지점명, s.성별, s.학년,
                f.내신점수, f.실기총점, f.합산점수,
                f.기록1, f.점수1, f.기록2, f.점수2, f.기록3, f.점수3, f.기록4, f.점수4,
                f.기록5, f.점수5, f.기록6, f.점수6, f.기록7, f.점수7,
                f.최초합여부, f.최종합여부
            FROM 확정대학정보 f
            JOIN 학생기초정보 s ON f.학생ID = s.학생ID
            WHERE f.대학ID = ?
            ORDER BY 순위 ASC;
        `;
        // ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲

        const [rankingRows] = await db.promise().query(sql, [college_id]);
        res.json({ success: true, ranking: rankingRows, events: events });

    } catch (err) {
        console.error("실시간 순위 조회 API 오류:", err);
        res.status(500).json({ success: false, message: "서버 오류 발생" });
    }
});

// ✅ (신규) 모바일 실기 기록 페이지를 위한 API 2개 (경로 수정)

// API 1: 특정 학생의 특정 대학에 대한 기존 실기 기록 조회
// ✅ (수정) .promise()를 추가하여 에러 해결
// API 1: 특정 학생의 특정 대학에 대한 기존 실기 기록 조회
app.get('/26susi/mobile_records', authJWT, async (req, res) => {
    const { student_id, college_id } = req.query;
    if (!student_id || !college_id) {
        return res.status(400).json({ success: false, message: "필수 정보 누락" });
    }
    try {
        // ▼▼▼ 여기가 수정된 부분! .promise() 추가 ▼▼▼
        const [rows] = await db.promise().query(
            "SELECT 기록1, 기록2, 기록3, 기록4, 기록5, 기록6, 기록7 FROM 확정대학정보 WHERE 학생ID = ? AND 대학ID = ?",
            [student_id, college_id]
        );
        // ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲

        res.json({ success: true, records: rows[0] || {} });
    } catch (err) {
        console.error("모바일 기록 조회 API 오류:", err);
        res.status(500).json({ success: false, message: "서버 오류" });
    }
});

// API 2: 모바일에서 입력한 실기 기록 저장 및 점수 자동 재계산
// ✅ (수정) db.promise().query()를 사용하여 Promise 에러 해결
app.post('/26susi/save_single_student_record', authJWT, async (req, res) => {
    const { studentData } = req.body;
    if (!studentData || !studentData.학생ID || !studentData.대학ID) {
        return res.status(400).json({ success: false, message: "필수 정보 누락" });
    }

    try {
        const sql = `
            INSERT INTO 확정대학정보 (학생ID, 대학ID, 실기ID, 
                기록1, 점수1, 기록2, 점수2, 기록3, 점수3, 기록4, 점수4, 
                기록5, 점수5, 기록6, 점수6, 기록7, 점수7, 
                실기총점, 합산점수)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                기록1=VALUES(기록1), 점수1=VALUES(점수1), 기록2=VALUES(기록2), 점수2=VALUES(점수2),
                기록3=VALUES(기록3), 점수3=VALUES(점수3), 기록4=VALUES(기록4), 점수4=VALUES(점수4),
                기록5=VALUES(기록5), 점수5=VALUES(점수5), 기록6=VALUES(기록6), 점수6=VALUES(점수6),
                기록7=VALUES(기록7), 점수7=VALUES(점수7),
                실기총점=VALUES(실기총점), 합산점수=VALUES(합산점수)
        `;

        const params = [
            studentData.학생ID, studentData.대학ID, studentData.실기ID,
            studentData.기록1 || null, studentData.점수1 || null,
            studentData.기록2 || null, studentData.점수2 || null,
            studentData.기록3 || null, studentData.점수3 || null,
            studentData.기록4 || null, studentData.점수4 || null,
            studentData.기록5 || null, studentData.점수5 || null,
            studentData.기록6 || null, studentData.점수6 || null,
            studentData.기록7 || null, studentData.점수7 || null,
            studentData.실기총점, studentData.합산점수
        ];

        // ▼▼▼ 여기가 수정된 부분! .promise() 추가 ▼▼▼
        await db.promise().query(sql, params);
        // ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲

        res.json({ success: true, message: "저장되었습니다." });

    } catch (err) {
        console.error("단일 학생 기록 저장 API 오류:", err);
        res.status(500).json({ success: false, message: "서버 오류: " + err.message });
    }
});

// ✅ [26susi.js 파일에 이 API 코드를 추가해줘]

// ✅ [26susi.js 파일의 기존 API를 이걸로 통째로 교체해줘]

// ✅ [26susi.js 파일의 기존 API를 이걸로 다시 한번 확인하고 교체해줘]

app.get('/26susi/branch-data-status', authJWT, async (req, res) => {
    try {
        // 학생 수(DISTINCT)와 총 데이터 건수(COUNT)를 모두 계산하는 쿼리
        const sql = `
            SELECT
                w.지점명,
                COALESCE(d.학생_수, 0) as 학생_수,
                COALESCE(d.데이터_수, 0) as 데이터_수
            FROM
                (SELECT DISTINCT 지점명 FROM 원장회원 WHERE 승인여부 = 'O') AS w
            LEFT JOIN
                (
                    SELECT
                        s.지점명,
                        COUNT(DISTINCT f.학생ID) as 학생_수,
                        COUNT(f.학생ID) as 데이터_수
                    FROM 확정대학정보 f
                    JOIN 학생기초정보 s ON f.학생ID = s.학생ID
                    GROUP BY s.지점명
                ) AS d ON w.지점명 = d.지점명
            ORDER BY 학생_수 DESC, 데이터_수 DESC, w.지점명 ASC;
        `;
        
        const [rows] = await db.promise().query(sql);
        res.json({ success: true, status: rows });

    } catch (err) {
        console.error("지점별 데이터 현황 조회 API 오류:", err);
        res.status(500).json({ success: false, message: "서버 오류 발생" });
    }
});

// ✅ [26susi.js 파일에 이 API 코드를 추가해줘]

// [신규 API] 특정 지점이 수합한 대학 ID 목록 조회
app.get('/26susi/branch-assigned-colleges', authJWT, async (req, res) => {
    const branch = req.user.branch; // 로그인한 사용자의 지점명

    try {
        // '확정대학정보'에서 해당 지점 학생이 포함된 모든 대학의 ID를 중복 없이 조회
        const sql = `
            SELECT DISTINCT f.대학ID
            FROM 확정대학정보 f
            JOIN 학생기초정보 s ON f.학생ID = s.학생ID
            WHERE s.지점명 = ?;
        `;
        const [rows] = await db.promise().query(sql, [branch]);
        const collegeIds = rows.map(r => r.대학ID); // [123, 456, 789] 형태의 배열로 변환
        res.json({ success: true, college_ids: collegeIds });

    } catch (err) {
        console.error("지점별 수합 대학 ID 조회 API 오류:", err);
        res.status(500).json({ success: false, message: "서버 오류 발생" });
    }
});
// =================================================================
// 🚀 API 실기테스트 로직 여기서부터 시작.
// =================================================================

// ⭐️ DB 기반 점수 계산 함수 (테이블명: scoring_criteria)
async function calculateScoreFromDBAsync(event, gender, recordValue) {
    const isReverse = (event === '10m'); // 10m만 기록 낮을수록 좋음
    const order = isReverse ? 'ASC' : 'DESC';
    const comparison = isReverse ? '>=' : '<=';

    // ⚠️ 테이블 이름을 scoring_criteria 로 수정
    const sql = `
        SELECT score
        FROM scoring_criteria
        WHERE event = ? AND gender = ? AND record_threshold ${comparison} ?
        ORDER BY record_threshold ${order}
        LIMIT 1;
    `;

    try {
        const [rows] = await db.promise().query(sql, [event, gender, recordValue]);
        if (rows.length > 0) {
            return rows[0].score;
        } else {
            // 환산표 기준보다 못하면 52점 반환 (빵점 기준)
             const [boundaries] =await  db.promise().query(
                // ⚠️ 테이블 이름을 scoring_criteria 로 수정
                `SELECT
                    MIN(CASE WHEN score = 100 THEN record_threshold END) as max_score_record,
                    MAX(CASE WHEN score = 52 THEN record_threshold END) as min_score_record
                 FROM scoring_criteria WHERE event = ? AND gender = ?`,
                [event, gender]
            );

            if (boundaries.length > 0) {
                const { max_score_record, min_score_record } = boundaries[0];
                // 만점 기준보다 잘했을 경우 100점 반환
                if (max_score_record !== null && isReverse && recordValue <= max_score_record) return 100;
                if (max_score_record !== null && !isReverse && recordValue >= max_score_record) return 100;
            }

            return 52; // 기본 빵점
        }
    } catch (err) {
        console.error("점수 계산 DB 쿼리 오류:", err);
        throw err;
    }
}

// 점수 계산 콜백 버전 (기존 API 호환용)
function calculateScoreFromDB(event, gender, recordValue, callback) {
    calculateScoreFromDBAsync(event, gender, recordValue)
        .then(score => callback(null, score))
        .catch(err => callback(err));
}


// --- API: 학생 일괄 등록 (실기 테스트용 DB) ---
app.post('/26susi/students', async (req, res) => {
    const { branchName, students } = req.body;
    if (!branchName || !students || !Array.isArray(students)) {
        return res.status(400).json({ message: '지점명과 학생 배열은 필수입니다.' });
    }
    const validStudents = students.filter(s => s.name && s.name.trim() !== '' && s.gender && ['남', '여'].includes(s.gender) && s.grade); // 학년 필수
    if (validStudents.length === 0) {
        return res.status(400).json({ message: '등록할 유효한 학생 데이터(이름,성별,학년 필수)가 없습니다.' });
    }

    let connection;
    try {
        const connection = await db.promise().getConnection() // Use promise pool connection
        await connection.beginTransaction();

        let [branchRows] = await connection.query('SELECT id FROM branches WHERE branch_name = ?', [branchName]);
        let branchId;
        if (branchRows.length > 0) {
            branchId = branchRows[0].id;
        } else {
            const [insertResult] = await connection.query('INSERT INTO branches (branch_name) VALUES (?)', [branchName]);
            branchId = insertResult.insertId;
        }

        const studentValues = validStudents.map(s => [s.name, s.gender, branchId, s.school || null, s.grade]); // school은 nullable
        await connection.query('INSERT INTO students (student_name, gender, branch_id, school, grade) VALUES ?', [studentValues]);

        await connection.commit();
        let successMessage = `${branchName} 지점 ${validStudents.length}명 등록 완료.`;
        if (validStudents.length < students.length) {
            successMessage += `\n(주의: ${students.length - validStudents.length}명은 이름/성별/학년 누락으로 제외됨)`;
        }
        res.status(201).json({ success: true, message: successMessage });

    } catch (err) {
        if (connection) await connection.rollback();
        console.error("학생 등록 API 오류:", err);
        res.status(500).json({ success: false, message: 'DB 저장 중 오류가 발생했습니다.' });
    } finally {
        if (connection) connection.release();
    }
});


// --- API: 조 배정 및 재배치 (핵심 로직) ---
async function executeFullAssignmentAsync() {
    const TOTAL_GROUPS = 6; // ⭐️ 6개 조로 수정 (A, B, C, D, E, F)
    const sql = `SELECT s.id FROM students s WHERE s.exam_group IS NULL`; // 조 배정 안 된 학생 조회

    const connection = await db.promise().getConnection();
    try {
        const [students] = await connection.query(sql);
        if (students.length === 0) return 0; // 배정할 학생 없음

        // 학생 순서 섞기
        for (let i = students.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [students[i], students[j]] = [students[j], students[i]];
        }

        const groupCounters = {}; // {'A': 0, 'B': 0, ...}
        const updatePromises = students.map((student, index) => {
            let groupNum = (index % TOTAL_GROUPS) + 1; // 1 ~ 6
            const groupLetter = String.fromCharCode(64 + groupNum); // 1->A, ..., 6->F

            groupCounters[groupLetter] = (groupCounters[groupLetter] || 0) + 1;
            const sequenceNum = groupCounters[groupLetter];
            const examNumber = `${groupLetter}-${sequenceNum}`;

            return connection.query('UPDATE students SET exam_group = ?, exam_number = ? WHERE id = ?', [groupLetter, examNumber, student.id]);
        });

        await Promise.all(updatePromises); // 모든 업데이트 비동기 병렬 처리
        return students.length; // 배정된 학생 수 반환

    } catch (err) {
        console.error("조 배정 로직 오류:", err);
        throw err; // 에러를 상위로 던짐
    } finally {
        if (connection) connection.release();
    }
}

// --- API: [조 배정 실행] ---
app.post('/26susi/assign-all-groups', async (req, res) => {
    try {
        const totalCount = await executeFullAssignmentAsync();
        if (totalCount === 0) {
            return res.status(400).json({ success: false, message: '새로 조를 배정할 학생이 없습니다.' });
        }
        res.status(200).json({ success: true, message: `총 ${totalCount}명의 학생 조 배정을 완료했습니다.` });
    } catch (err) {
        res.status(500).json({ message: '조 배정 중 오류 발생' });
    }
});

// --- API: [전체 재배치 실행] ---
app.post('/26susi/reassign-all-groups', async (req, res) => {
    let connection;
    try {
         const connection = await db.promise().getConnection()
        await connection.beginTransaction();
        // 1. 모든 학생 조, 수험번호 초기화
        await connection.query('UPDATE students SET exam_group = NULL, exam_number = NULL');
        // 2. 초기화 후 조 배정 실행 (connection 넘겨주지 않음, 내부에서 새로 생성)
        const totalCount = await executeFullAssignmentAsync();
        await connection.commit(); // 초기화 성공 후 커밋
        res.status(200).json({ success: true, message: `전체 재배치를 완료했습니다. 총 ${totalCount}명 배정.` });
    } catch (err) {
        if (connection) await connection.rollback(); // 롤백
        console.error("재배치 오류:", err);
        res.status(500).json({ message: '전체 재배치 중 오류 발생' });
    } finally {
        if (connection) connection.release();
    }
});

// --- API: 학생 정보 조회 (운영자/지점 페이지용) ---
app.get('/26susi/students', async (req, res) => {
    const { view, branchName } = req.query;
    let sql;
    const params = [];

    const orderByClause = `ORDER BY exam_number IS NULL, SUBSTRING_INDEX(exam_number, '-', 1), CAST(SUBSTRING_INDEX(exam_number, '-', -1) AS UNSIGNED)`;

    try {
        if (view === 'all') { // 운영자용
            sql = `SELECT s.id, s.student_name, s.gender, s.school, s.grade, b.branch_name, s.exam_group, s.exam_number, s.attendance, s.status FROM students s LEFT JOIN branches b ON s.branch_id = b.id ${orderByClause}`;
        } else if (branchName) { // 지점용
            sql = `SELECT s.id, s.student_name, s.gender, s.school, s.grade, b.branch_name, s.exam_group, s.exam_number, s.attendance, s.status FROM students s LEFT JOIN branches b ON s.branch_id = b.id WHERE b.branch_name = ? ORDER BY s.student_name ASC`;
            params.push(branchName);
        } else {
            return res.status(200).json({ success: true, data: [] });
        }
    const [students] = await db.promise().query(sql, params); // .promise() 추가!
        res.status(200).json({ success: true, data: students });
    } catch (err) {
        console.error("학생 조회 오류:", err);
        res.status(500).json({ success: false, message: '학생 데이터 조회 중 서버 오류 발생.' });
    }
});


// --- API: [참석/결석 처리] ---
app.patch('/26susi/attendance/:status/:studentId', async (req, res) => {
    const { status, studentId } = req.params;
    const validStatus = ['present', 'absent'];
    const attendanceValue = (status === 'present') ? '참석' : '결석';

    if (!validStatus.includes(status)) {
        return res.status(400).json({ success: false, message: '유효하지 않은 상태값입니다.' });
    }

   try {
        await db.promise().query(`UPDATE students SET attendance = ? WHERE id = ?`, [attendanceValue, studentId]); // ✅ await 추가!
        res.status(200).json({ success: true, message: `${attendanceValue} 처리 완료` });
    } catch (err) {
        console.error(`${attendanceValue} 처리 오류:`, err);
        res.status(500).json({ success: false, message: '서버 오류' });
    }
});

// --- API: [대시보드] 기록 오류 조회 (좌전굴 포함) ---
app.get('/26susi/dashboard/errors', async (req, res) => {
    // 좌전굴 포함 5종목 범위 체크
    const sql = `
        SELECT s.student_name, s.exam_number, b.branch_name, r.event, r.record_value, r.created_at
        FROM records r JOIN students s ON r.student_id = s.id JOIN branches b ON s.branch_id = b.id
        WHERE r.record_value != 0 AND (
            (r.event = '10m' AND (r.record_value < 1 OR r.record_value > 20)) OR
            (r.event = '제멀' AND (r.record_value < 100 OR r.record_value > 350)) OR
            (r.event = '배근력' AND (r.record_value < 10 OR r.record_value > 300)) OR
            (r.event = '메디신볼' AND (r.record_value < 1 OR r.record_value > 20)) OR
            (r.event = '좌전굴' AND (r.record_value < 0 OR r.record_value > 50))
        ) ORDER BY r.created_at DESC;
    `;
    try {
        const [results] = await db.promise().query(sql);
        res.status(200).json({ success: true, data: results });
    } catch (err) {
        console.error("기록 오류 조회 오류:", err);
        res.status(500).json({ message: 'DB 오류' });
    }
});

// --- API: 실기 기록 입력 ---
app.post('/26susi/records', async (req, res) => {
    const { examNumber, event, recordValue } = req.body;
    const VALID_EVENTS = ['제멀', '메디신볼', '10m', '배근력', '좌전굴'];
    if (!VALID_EVENTS.includes(event)) {
        return res.status(400).json({ success: false, message: `유효하지 않은 종목: ${event}` });
    }

    try {
        const [students] = await db.promise().query('SELECT id, gender FROM students WHERE exam_number = ?', [examNumber]);
        if (students.length === 0) return res.status(404).json({ message: `수험번호 '${examNumber}' 학생 없음.` });
        const student = students[0];

        let recordToSave;
        let score;

        if (recordValue.toString().toUpperCase() === 'F') {
            recordToSave = 0; // 파울 기록은 0
            score = 52;       // 파울 점수 52점
        } else {
            const numericRecord = parseFloat(recordValue);
            if (isNaN(numericRecord)) {
                return res.status(400).json({ success: false, message: '기록은 숫자 또는 F여야 합니다.' });
            }
            recordToSave = numericRecord;
            score = await calculateScoreFromDBAsync(event, student.gender, recordToSave); // DB 기반 점수 계산
        }

        const sql = `INSERT INTO records (student_id, event, record_value, score) VALUES (?, ?, ?, ?)
                     ON DUPLICATE KEY UPDATE record_value = VALUES(record_value), score = VALUES(score)`;
       await db.promise().query(sql, [student.id, event, recordToSave, score]);

        const message = (recordValue.toString().toUpperCase() === 'F') ? '파울(F) 기록 저장 완료' : '기록 저장 완료';
        res.status(201).json({ success: true, message: message, score: score });

    } catch (err) {
        console.error("기록 저장 API 오류:", err);
        res.status(500).json({ message: '기록 저장 중 서버 오류 발생' });
    }
});


// // --- API: [마스터] 학생 일괄 등록 ---
// API: [마스터] 학생 일괄 등록 (v8 - Connection Null 체크 및 에러 핸들링 강화)
// =============================================
// API: [마스터] 학생 일괄 등록 (v12 - Pool 직접 사용, 트랜잭션 없음)
// =============================================
// =================================================================
// =================================================================
// 🚀 [API] 마스터 - 학생 일괄 등록 (POST /26susi/students/master-bulk)
// (지점 이름 -> 지점 ID 자동 변환 및 생성 기능 포함)
// =================================================================
app.post('/26susi/students/master-bulk', async (req, res) => {
    
    // 1. 클라이언트가 보낸 데이터 받기
    const { students } = req.body; // { students: [ { branch: '일산', ... }, ... ] }

    // 2. 서버에서 데이터 유효성 검사
    if (!students || !Array.isArray(students) || students.length === 0) {
        console.log('[일괄 등록 실패] ❌ 학생 데이터가 비어있습니다.');
        return res.status(400).json({ 
            success: false, 
            message: '등록할 학생 데이터가 없습니다.' 
        });
    }

    console.log(`[일괄 등록 시작] 총 ${students.length}건의 데이터 처리 시도...`);

    // 여러 쿼리를 순서대로 실행해야 하므로 pool에서 '커넥션'을 하나 빌림
    const connection = await db.promise().getConnection();

    try {
        // ----- [ 1단계 ] 지점(Branch) ID 처리 -----

        // 1-A. 학생 데이터에서 고유한 '교육원 이름' 목록 추출
        // new Set()을 사용해 중복 이름(예: '일산'이 여러 개)을 제거
        const branchNameSet = new Set(students.map(s => s.branch));
        const uniqueBranchNames = [...branchNameSet]; // ['일산', '파주', '김포']

        // 1-B. 'branches' 테이블에 새로운 지점 이름 INSERT IGNORE
        // (branches 테이블의 branch_name 컬럼에 UNIQUE 키가 걸려있어서 가능)
        if (uniqueBranchNames.length > 0) {
            // [ ['일산'], ['파주'], ['김포'] ] 형태로 변환
            const branchValues = uniqueBranchNames.map(name => [name]);
            const insertBranchesSql = "INSERT IGNORE INTO branches (branch_name) VALUES ?";
            await connection.query(insertBranchesSql, [branchValues]);
            console.log(`[일괄 등록 1/3] ${uniqueBranchNames.length}개 고유 지점 ID 확인/생성 완료.`);
        }

        // 1-C. 'branches' 테이블에서 *모든* 지점 이름과 ID를 가져와 맵(Map)으로 만듦
        // (방금 추가한 지점 포함)
        const [allBranches] = await connection.query("SELECT id, branch_name FROM branches");
        
        // { "일산" => 1, "파주" => 2, "김포" => 3 }
        // JavaScript의 Map 객체를 사용하면 조회 속도가 매우 빠름
        const branchIdMap = new Map(allBranches.map(b => [b.branch_name, b.id]));
        console.log(`[일괄 등록 2/3] 지점 ID 맵 생성 완료. (총 ${branchIdMap.size}개)`);

        // ----- [ 2단계 ] 학생 데이터 INSERT 준비 -----

        // 2-A. 학생 데이터를 'students' 테이블에 맞게 2차원 배열로 변환
        // (이름 -> ID로 변환)
        const studentValues = students.map(s => {
            const branchId = branchIdMap.get(s.branch); // 맵(Map)에서 '일산'으로 '1'을 찾음
            
            // s.branch (e.g., '일산') -> branchId (e.g., 1)
            return [
                branchId, // ⭐️ 'branch' 대신 'branch_id' 컬럼에 ID 삽입
                s.name,
                s.gender,
                s.school,
                s.grade
            ];
        });

        // 2-B. SQL 쿼리 준비 (students 테이블)
        // ⭐️ 'branch' 컬럼이 아니라 'branch_id' 컬럼이라고 가정
       const insertStudentsSql = "INSERT IGNORE INTO students (branch_id, student_name, gender, school, grade) VALUES ?";

        // ----- [ 3단계 ] 학생 데이터 일괄 INSERT 실행 -----
        const [result] = await connection.query(insertStudentsSql, [studentValues]);

        console.log(`[일괄 등록 3/3] ✅ 총 ${students.length}건 요청 중 ${result.affectedRows}건 신규 등록 완료.`);

        // 4. 성공 응답 전송
        res.status(201).json({
            success: true,
            message: `총 ${students.length}건의 데이터 중 ${result.affectedRows}건이 신규 등록되었습니다. (중복 등 제외)`,
            insertedCount: result.affectedRows
        });

    } catch (error) {
        // 5. 오류 처리
        console.error('[일괄 등록 실패] ❌ DB 오류 발생:', error);
        res.status(500).json({
            success: false,
            message: '데이터베이스 등록 중 서버 오류가 발생했습니다.',
            error: error.message
        });
    } finally {
        // 6. 사용한 커넥션 반납 (필수!)
        // try/catch/finally 중 어디서 끝나든 항상 실행됨
        if (connection) connection.release();
    }
});
// --- API: [대체 학생 등록] ---
app.post('/26susi/students/substitute', async (req, res) => {
    // ... (기존과 거의 동일하나 async/await 사용) ...
     const { oldStudentId, newStudent } = req.body;
     const { name, gender, school, grade } = newStudent;
     if (!name || !gender || !school || !grade) return res.status(400).json({ success: false, message: '대체 학생 정보 모두 입력 필요.' });

     let connection;
     try {
          const connection = await db.promise().getConnection()
         await connection.beginTransaction();

         const [studentRows] = await connection.query('SELECT exam_number FROM students WHERE id = ?', [oldStudentId]);
         if (studentRows.length === 0) { await connection.rollback(); return res.status(404).json({ success: false, message: '대체할 학생 없음.' }); }
         const examNumber = studentRows[0].exam_number;

         const updateSql = `UPDATE students SET student_name = ?, gender = ?, school = ?, grade = ?, status = '대체', attendance = '참석' WHERE id = ?`;
         await connection.query(updateSql, [name, gender, school, grade, oldStudentId]);

         await connection.query(`INSERT INTO tshirt_management (student_id, type) VALUES (?, '교환')`, [oldStudentId]);

         await connection.commit();
         res.status(200).json({ success: true, message: `대체 완료! 수험번호 [${examNumber}]` });

     } catch (err) {
         if (connection) await connection.rollback();
         console.error("대체 학생 처리 오류:", err);
         res.status(500).json({ success: false, message: 'DB 오류' });
     } finally {
         if (connection) connection.release();
     }
});

// --- API: [현장 신규 학생 추가] ---
app.post('/26susi/students/add-new', async (req, res) => {
    // ⭐️ 오전/오후 제거, 6개조 로직으로 수정됨
    const { newStudent } = req.body;
    const { name, gender, school, grade, branchName } = newStudent;
     if (!name || !gender || !grade || !branchName) return res.status(400).json({ success: false, message: '이름, 성별, 학년, 지점명 필수.' });

    let connection;
    try {
         const connection = await db.promise().getConnection()
        await connection.beginTransaction();

        // 6개 조(A~F) 중 가장 인원 적은 조 찾기
        const groupCountSql = `SELECT exam_group, COUNT(*) as count FROM students WHERE exam_group IN ('A', 'B', 'C', 'D', 'E', 'F') GROUP BY exam_group ORDER BY count ASC LIMIT 1`;
        const [groupRows] = await connection.query(groupCountSql);
        let targetGroup = (groupRows.length > 0) ? groupRows[0].exam_group : 'A'; // 없으면 A조

        // 해당 조 다음 번호
        const [sequenceRows] = await connection.query(`SELECT COUNT(*) as count FROM students WHERE exam_group = ?`, [targetGroup]);
        const examNumber = `${targetGroup}-${sequenceRows[0].count + 1}`;

        // 지점 ID 확인/생성
        let [branchRows] = await connection.query('SELECT id FROM branches WHERE branch_name = ?', [branchName]);
        let branchId;
        if (branchRows.length > 0) branchId = branchRows[0].id;
        else { const [r] = await connection.query('INSERT INTO branches (branch_name) VALUES (?)', [branchName]); branchId = r.insertId; }

        // 학생 등록
        const insertSql = `INSERT INTO students (student_name, gender, school, grade, branch_id, exam_number, exam_group, status, attendance) VALUES (?, ?, ?, ?, ?, ?, ?, '추가', '참석')`;
        const [result] = await connection.query(insertSql, [name, gender, school || null, grade, branchId, examNumber, targetGroup]);
        const newStudentId = result.insertId;

        // 티셔츠 기록
        await connection.query(`INSERT INTO tshirt_management (student_id, type) VALUES (?, '신규')`, [newStudentId]);

        await connection.commit();
        res.status(201).json({ success: true, message: `신규 등록 완료! ${targetGroup}조 배정.\n수험번호: [${examNumber}]` });

    } catch (err) {
        if (connection) await connection.rollback();
        console.error("현장 신규 등록 오류:", err);
        res.status(500).json({ success: false, message: '서버 오류' });
    } finally {
        if (connection) connection.release();
    }
});

// --- API: [기록 페이지] 조 목록 조회 (A~F) ---
app.get('/26susi/records/groups', async (req, res) => {
    try {
        const sql = `SELECT DISTINCT exam_group FROM students WHERE exam_group IS NOT NULL ORDER BY exam_group ASC`;
        const [rows] = await db.promise().query(sql); // .promise() 추가!
        res.status(200).json({ success: true, data: rows.map(r => r.exam_group) });
    } catch (err) {
        console.error("조 목록 조회 오류:", err);
        res.status(500).json({ message: 'DB 오류' });
    }
});

// --- API: [기록 페이지] 특정 조 학생 목록 조회 ---
app.get('/26susi/records/students', async (req, res) => {
    const { group, event } = req.query;
    if (!group || !event) return res.status(400).json({ message: '조, 종목 필수.' });
    try {
        const sql = `
            SELECT s.id, s.student_name, s.exam_number, s.attendance, s.gender, r.record_value, r.score
            FROM students s LEFT JOIN records r ON s.id = r.student_id AND r.event = ? WHERE s.exam_group = ?
            ORDER BY SUBSTRING_INDEX(s.exam_number, '-', 1), CAST(SUBSTRING_INDEX(s.exam_number, '-', -1) AS UNSIGNED)`;
        const [students] = await db.promise().query(sql, [event, group]);
        res.status(200).json({ success: true, data: students });
    } catch (err) {
        console.error("조별 학생 목록 조회 오류:", err);
        res.status(500).json({ message: 'DB 오류' });
    }
});

// --- API: [기록 페이지] 실시간 점수 계산 ---
app.get('/26susi/records/calculate-score', async (req, res) => {
    const { event, gender, recordValue } = req.query;
    if (!event || !gender || !recordValue) return res.status(400).json({ message: '종목, 성별, 기록 필수.' });
    try {
        const score = await calculateScoreFromDBAsync(event, gender, parseFloat(recordValue));
        res.status(200).json({ success: true, score: score });
    } catch (err) {
        res.status(500).json({ success: false, message: '점수 계산 오류' });
    }
});

// --- API: [순위 시스템] 실시간 순위 조회 (좌전굴 포함) ---
// --- API: [순위 시스템] 실시간 순위 조회 (좌전굴 포함) ---
// --- API: [순위 시스템] 실시간 순위 조회 (⭐️ '전체' 성별 조회 기능 추가, LIMIT 확장) ---
app.get('/26susi/rankings', async (req, res) => {
    const { classType, gender, event } = req.query;

    // --- 1. classType 조건 (이전과 동일) ---
    let gradeCondition = ''; 
    if (classType === '선행반') gradeCondition = `s.grade IN ('1', '2')`;
    else if (classType === '입시반') gradeCondition = `s.grade = '3'`;
    else if (classType === 'N수반') gradeCondition = `s.grade = 'N'`;
    else if (classType === '전체') gradeCondition = `1=1`; 
    else return res.status(400).json({ message: '올바른 반 유형 아님.' });

    // --- 2. gender 조건 (⭐️ 핵심 수정 ⭐️) ---
    let genderCondition = '';
    const params = []; // params를 비워둠
    
    if (gender === '남' || gender === '여') {
        genderCondition = `AND s.gender = ?`;
        params.push(gender); // '남' 또는 '여'를 params에 추가
    } else if (gender === '전체') {
        genderCondition = ''; // '전체'일 경우, 성별 조건을 아예 추가하지 않음
    } else {
        // '남', '여', '전체'가 아니면 에러
        return res.status(400).json({ message: '올바른 성별이 아닙니다 (남, 여, 전체 중 하나).' });
    }

    let sql;
    try {
        if (event === '종합') {
            sql = `SELECT s.student_name, s.exam_number, b.branch_name, s.gender, SUM(r.score) as score,
                        RANK() OVER (ORDER BY SUM(r.score) DESC, MAX(CASE s.grade WHEN '1' THEN 1 WHEN '2' THEN 2 WHEN '3' THEN 3 WHEN 'N' THEN 4 ELSE 5 END) ASC,
                        MAX(CASE WHEN r.event = '제멀' THEN r.record_value ELSE 0 END) DESC, MAX(CASE WHEN r.event = '메디신볼' THEN r.record_value ELSE 0 END) DESC,
                        MIN(CASE WHEN r.event = '10m' THEN r.record_value ELSE 999 END) ASC, MAX(CASE WHEN r.event = '배근력' THEN r.record_value ELSE 0 END) DESC,
                        MAX(CASE WHEN r.event = '좌전굴' THEN r.record_value ELSE 0 END) DESC ) as ranking
                    FROM students s JOIN records r ON s.id = r.student_id JOIN branches b ON s.branch_id = b.id
                    WHERE ${gradeCondition} ${genderCondition}
                    GROUP BY s.id, s.student_name, s.exam_number, b.branch_name, s.gender 
                    ORDER BY ranking ASC LIMIT 2000`; // ⭐️ LIMIT 500으로 수정
        } else {
            sql = `SELECT s.student_name, s.exam_number, b.branch_name, s.gender, r.score, r.record_value,
                        RANK() OVER (ORDER BY r.score DESC, r.record_value ${(event === '10m') ? 'ASC' : 'DESC'}) as ranking
                    FROM students s JOIN records r ON s.id = r.student_id JOIN branches b ON s.branch_id = b.id
                    WHERE ${gradeCondition} ${genderCondition} AND r.event = ?
                    ORDER BY ranking ASC LIMIT 2000`; // ⭐️ LIMIT 500으로 수정
            params.push(event); // event는 params에 추가 (성별 뒤에)
        }
        
        const [results] = await db.promise().query(sql, params);
        res.status(200).json({ success: true, data: results });

    } catch (err) {
        console.error("랭킹 조회 오류:", err);
        res.status(500).json({ success: false, message: '서버 오류' });
    }
});

// --- API: [메인 대시보드] (통합, 5종목) ---
// --- API: [메인 대시보드] (통합, 5종목) ---
app.get('/26susi/dashboard/all', async (req, res) => {
    try {
        const studentCountSql = `
            SELECT 
                COUNT(s.id) as total, 
                COUNT(CASE WHEN s.attendance = '참석' THEN 1 END) as attended 
            FROM students s
        `;
        const recordCountSql = `
            SELECT r.event, COUNT(r.id) as completed 
            FROM records r 
            JOIN students s ON r.student_id = s.id 
            WHERE s.attendance = '참석' 
            GROUP BY r.event
        `;
        const errorSql = `
            SELECT s.student_name, s.exam_number, b.branch_name, r.event, r.record_value, r.created_at 
            FROM records r 
            JOIN students s ON r.student_id = s.id 
            JOIN branches b ON s.branch_id = b.id 
            WHERE r.record_value != 0 
              AND ( 
                    (r.event = '10m' AND (r.record_value < 1 OR r.record_value > 20)) 
                 OR (r.event = '제멀' AND (r.record_value < 100 OR r.record_value > 350)) 
                 OR (r.event = '배근력' AND (r.record_value < 10 OR r.record_value > 300)) 
                 OR (r.event = '메디신볼' AND (r.record_value < 1 OR r.record_value > 20)) 
                 OR (r.event = '좌전굴' AND (r.record_value < 0 OR r.record_value > 50)) 
                  ) 
            ORDER BY r.created_at DESC
        `;

        // ✅ rows 배열과 fields를 분리해서 받기
        const [[studentCountRows], [recordCounts], [errorList]] = await Promise.all([
            db.promise().query(studentCountSql),
            db.promise().query(recordCountSql),
            db.promise().query(errorSql)
        ]);

        // ✅ 첫 번째 행만 꺼내서 사용
        const studentCounts = studentCountRows[0] || { total: 0, attended: 0 };

        const dashboardData = {
            overall: {
                total: studentCounts.total || 0,
                attended: studentCounts.attended || 0,
                events: { '제멀': 0, '메디신볼': 0, '10m': 0, '배근력': 0, '좌전굴': 0 }
            }
        };

        recordCounts.forEach(row => {
            if (dashboardData.overall.events.hasOwnProperty(row.event)) {
                dashboardData.overall.events[row.event] = row.completed;
            }
        });

        res.status(200).json({ success: true, data: dashboardData, errors: errorList });
    } catch (err) {
        console.error("메인 대시보드 오류:", err);
        res.status(500).json({ message: '데이터 집계 오류' });
    }
});

// --- API: [사전 대시보드] ---
app.get('/26susi/dashboard/pre-event', async (req, res) => {
    // ... (기존과 동일하나 async/await 사용) ...
    const sql = `SELECT b.branch_name, COUNT(CASE WHEN s.attendance = '미정' OR s.attendance IS NULL THEN 1 END) as pending, COUNT(CASE WHEN s.attendance = '참석' THEN 1 END) as present, COUNT(CASE WHEN s.attendance = '결석' THEN 1 END) as absent, COUNT(CASE WHEN s.status = '대체' THEN 1 END) as substitute, COUNT(CASE WHEN s.status = '추가' THEN 1 END) as new_count FROM branches b LEFT JOIN students s ON b.id = s.branch_id GROUP BY b.branch_name ORDER BY b.branch_name`;
    try {
        const [results] = await db.promise().query(sql);
        res.status(200).json({ success: true, data: results });
    } catch (err) { console.error("사전 현황판 오류:", err); res.status(500).json({ message: 'DB 오류' }); }
});

// --- API: [티셔츠 관리] ---
app.get('/26susi/tshirts', async (req, res) => {
    // ... (기존과 동일하나 async/await 사용) ...
     const sql = `SELECT t.id, t.student_id, s.student_name, s.exam_number, b.branch_name, t.type, t.original_size, t.new_size, t.status FROM tshirt_management t JOIN students s ON t.student_id = s.id JOIN branches b ON s.branch_id = b.id ORDER BY b.branch_name, s.student_name`;
     try { const [results] = db.promise().query(sql); res.status(200).json({ success: true, data: results }); }
     catch (err) { console.error("티셔츠 목록 조회 오류:", err); res.status(500).json({ message: 'DB 오류' }); }
});

app.patch('/26susi/tshirts/:id', async (req, res) => {
    // ... (기존과 동일하나 async/await 사용) ...
     const { id } = req.params; const { original_size, new_size, status } = req.body;
     const sql = `UPDATE tshirt_management SET original_size = ?, new_size = ?, status = ? WHERE id = ?`;
     try { db.promise().query(sql, [original_size, new_size, status, id]); res.status(200).json({ success: true, message: '업데이트 완료' }); }
     catch (err) { console.error("티셔츠 업데이트 오류:", err); res.status(500).json({ message: 'DB 업데이트 오류' }); }
});

// --- API: [사전 현황판] 미확인 인원 명단 ---
app.get('/26susi/students/pending', async (req, res) => {
    // ... (기존과 동일하나 async/await 사용) ...
     const { branchName } = req.query; if (!branchName) return res.status(400).json({ message: '지점 이름 필수.' });
     const sql = `SELECT s.student_name, s.exam_number FROM students s JOIN branches b ON s.branch_id = b.id WHERE b.branch_name = ? AND (s.attendance = '미정' OR s.attendance IS NULL) ORDER BY s.student_name`;
     try { const [results] = await db.promise().query(sql, [branchName]); res.status(200).json({ success: true, data: results }); }
     catch (err) { console.error("미확인 인원 조회 오류:", err); res.status(500).json({ message: 'DB 오류' }); }
});

// --- API: [조별 진행 현황] (5종목) ---
app.get('/26susi/dashboard/group-progress', async (req, res) => {
    try {
        const attendanceSql = `SELECT exam_group, COUNT(id) as attended_count FROM students WHERE attendance = '참석' AND exam_group IS NOT NULL GROUP BY exam_group`;
        const recordsSql = `SELECT s.exam_group, r.event, COUNT(DISTINCT s.id) as completed_count FROM records r JOIN students s ON r.student_id = s.id WHERE s.attendance = '참석' AND s.exam_group IS NOT NULL GROUP BY s.exam_group, r.event`;
        const allCompletedSql = `SELECT exam_group, COUNT(student_id) as all_completed_count FROM (SELECT s.id as student_id, s.exam_group FROM records r JOIN students s ON r.student_id = s.id WHERE s.attendance = '참석' AND s.exam_group IS NOT NULL GROUP BY s.id, s.exam_group HAVING COUNT(DISTINCT r.event) = 5) as completed GROUP BY exam_group`;

        // ❌ 여기가 문제였음: db.query
        // const [[attendanceResults], [recordsResults], [allCompletedResults]] = await Promise.all([
        //     db.query(attendanceSql), db.query(recordsSql), db.query(allCompletedSql)
        // ]);
        
        // ✅ 이렇게 수정: db.promise().query
        const [[attendanceResults], [recordsResults], [allCompletedResults]] = await Promise.all([
            db.promise().query(attendanceSql), 
            db.promise().query(recordsSql), 
            db.promise().query(allCompletedSql)
        ]);

        const progressData = {};
        attendanceResults.forEach(row => {
            progressData[row.exam_group] = { attended: row.attended_count, allCompleted: 0, events: { '제멀': 0, '메디신볼': 0, '10m': 0, '배근력': 0, '좌전굴': 0 } };
        });
        recordsResults.forEach(row => { if (progressData[row.exam_group]?.events.hasOwnProperty(row.event)) progressData[row.exam_group].events[row.event] = row.completed_count; });
        allCompletedResults.forEach(row => { if (progressData[row.exam_group]) progressData[row.exam_group].allCompleted = row.all_completed_count; });

        res.status(200).json({ success: true, data: progressData });
    } catch (err) {
        console.error("조별 진행 현황 오류:", err);
        res.status(500).json({ message: 'DB 오류' });
    }
});

// --- API: [지점 리포트] (5종목) ---
app.get('/26susi/branch-report', async (req, res) => {
     const { branchName } = req.query; if (!branchName) return res.status(400).json({ message: '지점 이름 필수.' });
     const sql = `SELECT s.id, s.student_name, s.gender, r.event, r.record_value, r.score FROM students s LEFT JOIN records r ON s.id = r.student_id JOIN branches b ON s.branch_id = b.id WHERE b.branch_name = ?`;
     try {
         // 
         // ⭐️⭐️⭐️ 여기!!! await 추가 ⭐️⭐️⭐️
         const [results] = await db.promise().query(sql, [branchName]);
         // 
         // 

         const studentsMap = new Map(); // ... 학생 데이터 가공 ...
         results.forEach(row => { if (!studentsMap.has(row.id)) studentsMap.set(row.id, { id: row.id, name: row.student_name, gender: row.gender, totalScore: 0, records: {} }); const student = studentsMap.get(row.id); if (row.event) { student.records[row.event] = { record: row.record_value, score: row.score }; student.totalScore += row.score; } });
         let studentsData = Array.from(studentsMap.values());
         const EVENTS = ['제멀', '메디신볼', '10m', '배근력', '좌전굴'];
         ['남', '여'].forEach(gender => { /* ... 성별 순위 계산 ... */
             let genderGroup = studentsData.filter(s => s.gender === gender);
             genderGroup.sort((a, b) => b.totalScore - a.totalScore); genderGroup.forEach((s, i) => s.branchOverallRank = i + 1);
             EVENTS.forEach(event => { genderGroup.sort((a, b) => { const sA = a.records[event]?.score ?? -1, sB = b.records[event]?.score ?? -1; if (sB !== sA) return sB - sA; const rA = a.records[event]?.record ?? (event === '10m' ? 999 : -1), rB = b.records[event]?.record ?? (event === '10m' ? 999 : -1); return (event === '10m') ? rA - rB : rB - rA; }); genderGroup.forEach((s, i) => { if (s.records[event]) s.records[event].branchRank = i + 1; }); });
         });
         res.status(200).json({ success: true, data: studentsData });
     } catch (err) { console.error("지점 리포트 오류:", err); res.status(500).json({ message: 'DB 오류' }); }
});
// --- API: [전체 순위 조회] 리포트용 (5종목) ---
app.get('/26susi/all-ranks', async (req, res) => {
    // ... (기존과 거의 동일하나 async/await 사용) ...
     const sql = `WITH TotalScores AS (...), OverallRanks AS (...), EventRanks AS (SELECT s.id, r.event, RANK() OVER (PARTITION BY s.gender, r.event ORDER BY r.score DESC, (CASE WHEN r.event = '10m' THEN r.record_value END) ASC, (CASE WHEN r.event != '10m' THEN r.record_value END) DESC) as event_rank FROM students s JOIN records r ON s.id = r.student_id) SELECT s.id, ovr.overall_rank, evr_jemul.event_rank as jemul_rank, evr_medball.event_rank as medball_rank, evr_10m.event_rank as ten_m_rank, evr_baegun.event_rank as baegun_rank, evr_jwajeon.event_rank as jwajeon_rank FROM students s LEFT JOIN OverallRanks ovr ON s.id = ovr.id LEFT JOIN EventRanks evr_jemul ON s.id = evr_jemul.id AND evr_jemul.event = '제멀' LEFT JOIN EventRanks evr_medball ON s.id = evr_medball.id AND evr_medball.event = '메디신볼' LEFT JOIN EventRanks evr_10m ON s.id = evr_10m.id AND evr_10m.event = '10m' LEFT JOIN EventRanks evr_baegun ON s.id = evr_baegun.id AND evr_baegun.event = '배근력' LEFT JOIN EventRanks evr_jwajeon ON s.id = evr_jwajeon.id AND evr_jwajeon.event = '좌전굴'`; // CTE 정의는 생략
     try {
         const [results] = await db.promise().query(sql);
         const rankMap = {}; results.forEach(row => { rankMap[row.id] = { overallRank: row.overall_rank, '제멀': { rank: row.jemul_rank }, '메디신볼': { rank: row.medball_rank }, '10m': { rank: row.ten_m_rank }, '배근력': { rank: row.baegun_rank }, '좌전굴': { rank: row.jwajeon_rank } }; });
         res.status(200).json({ success: true, data: rankMap });
     } catch (err) { console.error("전체 순위 API 오류:", err); res.status(500).json({ message: 'DB 오류' }); }
});

// =================================================================
// 🚀 API 실기테스트 로직 여기서까지 끝
// =================================================================

// ✅ 서버 실행
app.listen(port, () => {
  console.log(`🔥 26수시 실기배점 서버 실행 중: http://localhost:${port}`);
});

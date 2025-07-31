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

// 관리자 권한 체크 함수
function isAdmin(user) {
  return user && user.userid === 'admin';
}
function safe(v) {
  return v === undefined ? null : v;
}


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
app.post('/26susi/register', async (req, res) => {
  try {
    const { userid, password, name, branch, phone } = req.body;
    if (![userid, password, name, branch, phone].every(Boolean)) {
      return res.json({ success: false, message: "모든 값을 입력해주세요." });
    }

    const [dup] = await db.promise().query(
      "SELECT 원장ID FROM 원장회원 WHERE 아이디 = ?", [userid]
    );
    if (dup.length > 0) {
      return res.json({ success: false, message: "이미 사용중인 아이디입니다." });
    }

    const hash = await bcrypt.hash(password, 10);
    await db.promise().query(
      "INSERT INTO 원장회원 (아이디, 비밀번호, 이름, 지점명, 전화번호) VALUES (?, ?, ?, ?, ?)",
      [userid, hash, name, branch, phone]
    );

    res.json({ success: true });

  } catch (err) {
    // 에러를 더 명확하게 터미널에 출력
    console.error("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
    console.error("!!! /26susi/register 경로에서 오류 발생 !!!");
    console.error("- 발생 시간:", new Date().toLocaleString('ko-KR'));
    console.error("- 에러 내용:", err); // 에러 객체 전체를 출력
    console.error("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");

    // 500 상태 코드와 함께 명확한 에러 메시지를 응답
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
  return ['10', '20', 'run', '100', 'z', '달리기','벽치기'].some(keyword => lower.includes(keyword));
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
                return { 종목명: input.종목명, 배점: 0 };
            }

            const studentRecord = parseFloat(input.기록);
            const reverse = ['10m', '20m', 'run', '100', 'z', '달리기','벽치기'].some(k => input.종목명.toLowerCase().includes(k));

            // ✅✅✅ 대학ID 155번(동국대) 특수 계산식 ✅✅✅
            if (Number(대학ID) === 155) {
                const [[formula_data]] = await db.promise().query(
                    "SELECT 최저기준, 최고기준, 기본점수, 최고점수 FROM `26수시실기배점` WHERE 실기ID = ? AND 종목명 = ? AND 성별 = ? LIMIT 1",
                    [실기ID, input.종목명, gender]
                );

                if (formula_data) {
                    const { 최저기준, 최고기준, 기본점수, 최고점수 } = formula_data;
                    
                    // 기록이 기준치를 벗어나는 경우 처리
                    if (reverse && studentRecord < 최고기준) return { 종목명: input.종목명, 배점: 최고점수 };
                    if (reverse && studentRecord > 최저기준) return { 종목명: input.종목명, 배점: 기본점수 };
                    if (!reverse && studentRecord > 최고기준) return { 종목명: input.종목명, 배점: 최고점수 };
                    if (!reverse && studentRecord < 최저기준) return { 종목명: input.종목명, 배점: 기본점수 };
                    
                    // 점수 산출 공식 적용
// 점수 산출 공식 적용
                    let score = (studentRecord - 최저기준) * (최고점수 - 기본점수) / (최고기준 - 최저기준) + 기본점수;
                    // ✅ 소수점 둘째 자리까지 반올림
                    score = parseFloat(score.toFixed(2));
                    return { 종목명: input.종목명, 배점: score };
                }
            }

            // ✅✅✅ P/F 판정 로직 시작 ✅✅✅
            // 실기ID 99번(청주대)일 경우, P/F 로직을 우선 적용
            if (실기ID === 99) {
                const [[pf_row]] = await db.promise().query(
                    "SELECT 기록 FROM `26수시실기배점` WHERE 실기ID = ? AND 종목명 = ? AND 성별 = ? AND 배점 = 'P' LIMIT 1",
                    [실기ID, input.종목명, gender]
                );

                if (!pf_row) return { 종목명: input.종목명, 배점: 'F' }; // 기준 기록이 없으면 Fail

                const benchmarkRecord = parseFloat(pf_row.기록);
                const studentRecord = parseFloat(input.기록);
                const reverse = ['10m', '20m', 'run', '100', 'z', '달리기','벽치기','런','에르고'].some(k => input.종목명.toLowerCase().includes(k));

                if (reverse) { // 기록이 낮을수록 좋은 종목
                    return { 종목명: input.종목명, 배점: studentRecord <= benchmarkRecord ? 'P' : 'F' };
                } else { // 기록이 높을수록 좋은 종목
                    return { 종목명: input.종목명, 배점: studentRecord >= benchmarkRecord ? 'P' : 'F' };
                }
            }
            // ✅✅✅ P/F 판정 로직 끝 ✅✅✅

            // --- P/F 대학이 아닐 경우, 기존 숫자 점수 계산 로직 실행 ---
 
// --- P/F 대학이 아닐 경우, 기존 숫자 점수 계산 로직 실행 ---

            let sql;
            if (reverse) {
                // 달리기처럼 기록이 낮을수록 좋은 종목의 경우 (구간 점수 방식)
                sql = `
                    SELECT 배점 FROM \`26수시실기배점\`
                    WHERE 실기ID = ? AND 종목명 = ? AND 성별 = ? AND CAST(기록 AS DECIMAL(10,2)) <= ?
                    ORDER BY CAST(기록 AS DECIMAL(10,2)) DESC LIMIT 1`;
            } else {
                // 멀리뛰기처럼 기록이 높을수록 좋은 종목의 경우 (기존 등급 달성 방식)
                sql = `
                    SELECT 배점 FROM \`26수시실기배점\`
                    WHERE 실기ID = ? AND 종목명 = ? AND 성별 = ? AND ? >= CAST(기록 AS DECIMAL(10,2))
                    ORDER BY CAST(배점 AS SIGNED) DESC LIMIT 1`;
            }
            
            const [[row]] = await db.promise().query(sql, [실기ID, input.종목명, gender, input.기록]);
            
            let scoreValue = 0;
            if (row) {
                // 배점표에서 점수를 찾았을 경우
                scoreValue = row.배점;
            } else {
                // 점수를 못 찾았을 때 -> 만점보다 잘한 경우인지 확인
                const [[maxScoreRow]] = await db.promise().query(
                    `SELECT 기록, 배점 FROM \`26수시실기배점\` 
                     WHERE 실기ID = ? AND 종목명 = ? AND 성별 = ? 
                     ORDER BY CAST(배점 AS SIGNED) DESC LIMIT 1`,
                    [실기ID, input.종목명, gender]
                );

                if (maxScoreRow) {
                    const bestBenchmark = parseFloat(maxScoreRow.기록);
                    const studentRecord = parseFloat(input.기록);

                    if (reverse && studentRecord < bestBenchmark) { // 달리기: 학생 기록이 만점 기준보다 빠를 때
                        scoreValue = maxScoreRow.배점; // 만점 부여
                    } else if (!reverse && studentRecord > bestBenchmark) { // 던지기: 학생 기록이 만점 기준보다 멀리 갔을 때
                        scoreValue = maxScoreRow.배점; // 만점 부여
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

        // --- 2단계: 종목별 감수 계산 ---
        const gamCalculationTasks = Object.keys(종목별점수).map(async (eventName) => {
            const studentScore = 종목별점수[eventName];
            if (studentScore === 0 || isNaN(Number(studentScore))) return { 종목명: eventName, 감수: 0 }; // P/F 같은 문자 점수는 감수 0

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

        // --- 3단계: 최종 점수 계산 (모듈 호출) ---
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
app.get('/26susi_final_list', authJWT, async (req, res) => {
    const { college_id } = req.query;
    if (!college_id) {
        return res.status(400).json({ success: false, message: "대학ID가 필요합니다." });
    }

    try {
        const sql = `
            SELECT 
                s.이름, s.학년, s.성별,
                f.* -- 확정대학정보 테이블의 모든 컬럼
            FROM 확정대학정보 f
            JOIN 학생기초정보 s ON f.학생ID = s.학생ID
            WHERE f.대학ID = ?
            ORDER BY f.합산점수 DESC, s.이름 ASC
        `;
        const [rows] = await db.promise().query(sql, [college_id]);
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
// ✅ (수정) 최종 수합 페이지 전체 저장 (개인별 실기일정 포함)
app.post('/26susi_final_save', authJWT, async (req, res) => {
    const { college_id, studentData } = req.body;
    if (!college_id || !Array.isArray(studentData)) {
        return res.status(400).json({ success: false, message: "필수 데이터가 누락되었습니다." });
    }

    const connection = await db.promise().getConnection();
    await connection.beginTransaction();

    try {
        await connection.query("DELETE FROM 확정대학정보 WHERE 대학ID = ?", [college_id]);

        for (const student of studentData) {
            // [수정] INSERT 문에 '실기일정' 추가
            const finalSql = `
                INSERT INTO 확정대학정보 (
                    학생ID, 대학ID, 실기ID, 내신등급, 내신점수, 
                    기록1, 점수1, 기록2, 점수2, 기록3, 점수3, 기록4, 점수4,
                    기록5, 점수5, 기록6, 점수6, 기록7, 점수7,
                    실기총점, 합산점수, 최초합여부, 최종합여부, 실기일정
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
            
            // [수정] 파라미터에 student.실기일정 추가
            const finalParams = [
                student.학생ID, college_id, student.실기ID, student.내신등급, student.내신점수,
                student.기록1, student.점수1, student.기록2, student.점수2, student.기록3, student.점수3, student.기록4, student.점수4,
                student.기록5, student.점수5, student.기록6, student.점수6, student.기록7, student.점수7,
                student.실기총점, student.합산점수, student.최초합여부, student.최종합여부, student.실기일정
            ].map(v => v === undefined ? null : v);
            await connection.query(finalSql, finalParams);

            if (student.내신등급 !== undefined || student.내신점수 !== undefined) {
                const gradeSql = `
                    INSERT INTO 학생_내신정보 (학생ID, 대학ID, 등급, 내신점수)
                    VALUES (?, ?, ?, ?)
                    ON DUPLICATE KEY UPDATE 등급=VALUES(등급), 내신점수=VALUES(내신점수)`;
                const gradeParams = [student.학생ID, college_id, student.내신등급, student.내신점수];
                await connection.query(gradeSql, gradeParams);
            }
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
        if (req.query.region) { whereClauses.push('d.광역 = ?'); params.push(req.query.region); }
        
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
            whereClauses.push(`(${eligibility.map(e => `d.${e} = 'O'`).join(' OR ')})`);
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
app.post('/26susi/add-counseling-bulk', authJWT, async (req, res) => {
    const { college_id, student_ids } = req.body;
    if (!college_id || !Array.isArray(student_ids) || student_ids.length === 0) {
        return res.status(400).json({ success: false, message: "필수 정보가 누락되었습니다." });
    }

    try {
        const college = (await db.promise().query("SELECT 실기ID FROM 대학정보 WHERE 대학ID = ?", [college_id]))[0][0];
        if (!college) {
            return res.status(404).json({ success: false, message: "대학 정보를 찾을 수 없습니다." });
        }

        let addedCount = 0;
        for (const student_id of student_ids) {
            // 이미 상담 목록에 있는지 확인
            const [existing] = await db.promise().query(
                "SELECT 기록ID FROM 상담대학정보 WHERE 학생ID = ? AND 대학ID = ?",
                [student_id, college_id]
            );

            // 없는 경우에만 새로 추가
            if (existing.length === 0) {
                await db.promise().query(
                    "INSERT INTO 상담대학정보 (학생ID, 대학ID, 실기ID) VALUES (?, ?, ?)",
                    [student_id, college_id, college.실기ID]
                );
                addedCount++;
            }
        }
        res.json({ success: true, message: `${addedCount}명의 학생에게 상담 대학이 추가되었습니다.` });

    } catch (err) {
        console.error("상담 대학 일괄 추가 API 오류:", err);
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




// ✅ 서버 실행
app.listen(port, () => {
  console.log(`🔥 26수시 실기배점 서버 실행 중: http://localhost:${port}`);
});

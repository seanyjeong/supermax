const express = require('express');
const mysql = require('mysql');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const multer = require('multer');
const admin = require('firebase-admin');
const crypto = require('crypto');
const bodyParser = require('body-parser');
const axios = require('axios');
const serviceAccount = require('/root/supermax/firebase-key.json');



const app = express();
// 이 코드 위치: const app = express(); 선언 바로 아래에 추가
app.use(express.json({ limit: '100mb' }));    // JSON 요청 용량 확대
app.use(express.urlencoded({ limit: '100mb', extended: true }));  // URL 인코딩 요청 용량 확대

const PORT = 5000;
const JWT_SECRET = "your_secret_key";

app.use(express.json());
// // ✅ 정확하고 명확한 CORS 설정 (프론트엔드 도메인 허용)
// const corsOptions = {
//   origin: ['https://score.ilsanmax.com', 'https://seanyjeong.github.io'],
//   methods: ['GET', 'POST', 'OPTIONS'],
//   allowedHeaders: ['Content-Type', 'Authorization'],
//   credentials: true  // ✅ 중요! credentials 사용 가능하도록 설정
// };

// app.use(cors(corsOptions));

// 개발 중에는 CORS origin을 '*'로 열어줍니다.
app.use(cors()); // 또는 아래처럼

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(bodyParser.json());

const verificationCodes = {}; // 🔥 인증번호 저장 객체

const NAVER_ACCESS_KEY = 'A8zINaiL6JjWUNbT1uDB';
const NAVER_SECRET_KEY = 'eA958IeOvpxWQI1vYYA9GcXSeVFQYMEv4gCtEorW';
const SERVICE_ID = 'ncp:sms:kr:284240549231:sean';
const FROM_PHONE = '01021446765';
function generateCode() {
    return Math.floor(1000 + Math.random() * 9000).toString();
}

// ✅ 1. 랜덤 인증번호 생성 함수
function generateCode() {
    return Math.floor(1000 + Math.random() * 9000).toString();
}


// ✅ 인증번호 발송 API
app.post('/feed/auth/send-verification', async (req, res) => { // 🔥 변경
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: "전화번호가 필요합니다." });

    const code = generateCode();
    verificationCodes[phone] = code;

    const message = `[MaxLounge] 인증번호: ${code}`;

    try {
        await sendSMS(phone, message);
        res.json({ success: true });
    } catch (err) {
        console.error("🔥 SMS 전송 실패:", err);
        res.status(500).json({ error: "SMS 전송 실패" });
    }
});


// ✅ 인증번호 검증 API
app.post('/feed/auth/verify-code', (req, res) => { // 🔥 변경
    const { phone, code } = req.body;
    if (!phone || !code) return res.status(400).json({ error: "전화번호와 인증번호가 필요합니다." });

    if (verificationCodes[phone] === code) {
        delete verificationCodes[phone]; // 인증 완료 후 삭제
        res.json({ success: true });
    } else {
        res.status(400).json({ error: "인증번호 불일치" });
    }
});


// ✅ 4. 네이버 클라우드 SMS 발송 함수
async function sendSMS(recipient, content) {
    const timestamp = Date.now().toString();
    const url = `/sms/v2/services/${SERVICE_ID}/messages`;

    const signature = crypto.createHmac('sha256', NAVER_SECRET_KEY)
        .update(`POST ${url}\n${timestamp}\n${NAVER_ACCESS_KEY}`)
        .digest('base64');

    await axios.post(`https://sens.apigw.ntruss.com${url}`, {
        type: "SMS",
        contentType: "COMM",
        countryCode: "82",
        from: FROM_PHONE,
        content,
        messages: [{ to: recipient }]
    }, {
        headers: {
            "x-ncp-apigw-timestamp": timestamp,
            "x-ncp-iam-access-key": NAVER_ACCESS_KEY,
            "x-ncp-apigw-signature-v2": signature,
            "Content-Type": "application/json"
        }
    });
}



// ✅ MySQL 데이터베이스 연결
const db = mysql.createConnection({
    host: "211.37.174.218",
    user: "maxilsan",
    password: "q141171616!",
    database: "max",
    charset: "utf8mb4"
});

db.connect(err => {
    if (err) {
        console.error("❌ MySQL 연결 실패:", err);
        // MySQL이 연결되지 않아도 서버 실행 가능하도록 변경
    } else {
        console.log("✅ MySQL Connected!");
    }
});

// ✅ Firebase Storage 설정
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
storageBucket: "ilsanmax.firebasestorage.app"

});
const bucket = admin.storage().bucket();

// ✅ 파일 업로드 설정 (Firebase Storage 사용)
const upload = multer({ storage: multer.memoryStorage() });

/* ======================================
   📌 1️⃣ 회원가입 & 로그인 & 로그아웃
====================================== */

// ✅ 회원가입 API
app.post('/feed/register', async (req, res) => {
    const { username, password, name, birth_date, phone, school, grade, gender, consent } = req.body;

    if (!consent) return res.status(400).json({ error: "개인정보 제공 동의가 필요합니다." });

    // 🔥 ✅ 중복 검사: 아이디(username), 전화번호(phone), 이름(name)
    const checkSql = "SELECT id FROM users WHERE username = ? OR (name = ? AND phone = ?)";
    db.query(checkSql, [username, name, phone], async (err, results) => {
        if (err) return res.status(500).json({ error: "DB 조회 오류" });

        if (results.length > 0) {
            return res.status(400).json({ error: "이미 존재하는 아이디 또는 전화번호입니다." });
        }

        // ✅ 중복이 없으면 회원가입 진행
        const hashedPassword = await bcrypt.hash(password, 10);
        const sql = "INSERT INTO users (username, password, name, birth_date, phone, school, grade, gender, consent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)";

        db.query(sql, [username, hashedPassword, name, birth_date, phone, school, grade, gender, consent], (err, result) => {
            if (err) return res.status(500).json({ error: err });
            res.json({ success: true, user_id: result.insertId });
        });
    });
});

// 임시 관리자 토큰 생성 API
app.post('/feed/adminresetgenerate-temp-token', (req, res) => {
  const { username, password } = req.body;

  // 관리자 비밀번호 확인
  if (username === 'admin' && password === 'admin1234') {
    const token = jwt.sign({ username: 'admin' }, JWT_SECRET, { expiresIn: '1h' });
    res.json({ success: true, token });
  } else {
    res.status(403).json({ error: "관리자 비밀번호가 틀립니다." });
  }
});


// 비밀번호 리셋 API
app.post('/feed/adminresetreset-password', (req, res) => {
  const { token, password } = req.body;

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    if (decoded.username === 'admin') {
      const hashedPassword = bcrypt.hashSync(password, 10);
      
      const sql = "UPDATE users SET password = ? WHERE username = 'admin'";
      db.query(sql, [hashedPassword], (err, result) => {
        if (err) {
          return res.status(500).json({ error: "비밀번호 변경 실패" });
        }
        res.json({ success: true, message: "비밀번호가 성공적으로 변경되었습니다." });
      });
    } else {
      res.status(403).json({ error: "관리자만 비밀번호를 리셋할 수 있습니다." });
    }
  } catch (err) {
    res.status(403).json({ error: "토큰이 만료되었거나 유효하지 않습니다." });
  }
});


// ✅ 유저강제 삭제
app.post('/feed/deleteuser', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: '토큰 없음' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!decoded.is_admin) return res.status(403).json({ error: '관리자 권한 없음' });

    const { user_id } = req.body;
    if (!user_id) return res.status(400).json({ error: 'user_id 누락' });

    // 🔥 여기서부터 삭제 로직
    // feeds, comments, likes, notifications, achievements 등 삭제
    // 마지막에 users 테이블에서 delete

    db.beginTransaction(err => {
      if (err) return res.status(500).json({ error: '트랜잭션 시작 실패' });

      const queries = [
        ["DELETE FROM comment_likes WHERE user_id = ?", [user_id]],
        ["DELETE FROM comments WHERE user_id = ?", [user_id]],
        ["DELETE FROM likes WHERE user_id = ?", [user_id]],
        ["DELETE FROM feeds WHERE user_id = ?", [user_id]],
        ["DELETE FROM notifications WHERE user_id = ?", [user_id]],
        ["DELETE FROM user_achievements WHERE user_id = ?", [user_id]],
        ["DELETE FROM user_goals WHERE user_id = ?", [user_id]],
        ["DELETE FROM users WHERE id = ?", [user_id]],
      ];

      let idx = 0;
      function next() {
        if (idx >= queries.length) {
          return db.commit(err => {
            if (err) return db.rollback(() => res.status(500).json({ error: '커밋 실패' }));
            res.json({ success: true });
          });
        }

        const [sql, params] = queries[idx++];
        db.query(sql, params, (err) => {
          if (err) return db.rollback(() => res.status(500).json({ error: '쿼리 실패', sql }));
          next();
        });
      }

      next();
    });

  } catch (err) {
    console.error("❌ 관리자 인증 실패:", err);
    res.status(403).json({ error: '토큰 오류 또는 관리자 아님' });
  }
});

//전체 초기화! 
// ✅ 전체 데이터 초기화 API (관리자 전용)
app.post('/feed/adminreset', (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "토큰 없음" });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.username !== 'admin') {
      return res.status(403).json({ error: "관리자만 접근 가능" });
    }

    const tables = [
      "feeds", "comments", "likes", "comment_likes", "notifications",
      "user_achievements", "user_goals"
    ];

    // 모든 테이블 삭제
    const deletePromises = tables.map(table => {
      return new Promise((resolve, reject) => {
        db.query(`DELETE FROM ${table}`, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    });

    Promise.all(deletePromises)
      .then(() => {
        res.json({ success: true, message: "모든 데이터 초기화 완료" });
      })
      .catch(err => {
        console.error("🔥 초기화 중 오류:", err);
        res.status(500).json({ error: "초기화 실패" });
      });

  } catch (e) {
    res.status(403).json({ error: "유효하지 않은 토큰" });
  }
});


// 🔔 알림 목록 API
// 🔔 알림 조회 API
app.post('/feed/my-notifications', (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "토큰 없음" });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user_id = decoded.user_id;

    const sql = `
      SELECT id, type, message, feed_id, created_at
      FROM notifications
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 10
    `;

    db.query(sql, [user_id], (err, rows) => {
      if (err) {
        console.error("❌ 알림 조회 실패:", err);
        return res.status(500).json({ error: "알림 조회 실패" });
      }

      res.json(rows); // 이제 feed_id도 포함됨
    });
  } catch (e) {
    console.error("❌ JWT 인증 실패:", e);
    res.status(403).json({ error: "토큰 유효하지 않음" });
  }
});


app.post('/feed/read-notification', (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "토큰 없음" });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user_id = decoded.user_id;
    const { id } = req.body;

    const sql = `DELETE FROM notifications WHERE id = ? AND user_id = ?`;

    db.query(sql, [id, user_id], (err) => {
      if (err) return res.status(500).json({ error: "삭제 실패" });
      res.json({ success: true });
    });
  } catch (err) {
    console.error("❌ JWT 오류:", err);
    res.status(403).json({ error: "토큰 유효하지 않음" });
  }
});

app.post('/feed/clear-notifications', (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "토큰 없음" });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user_id = decoded.user_id;

    const sql = `DELETE FROM notifications WHERE user_id = ?`;
    db.query(sql, [user_id], (err) => {
      if (err) {
        console.error("❌ 알림 삭제 실패:", err);
        return res.status(500).json({ error: "삭제 실패" });
      }

      res.json({ success: true });
    });
  } catch (err) {
    console.error("❌ JWT 오류:", err);
    res.status(403).json({ error: "토큰 유효하지 않음" });
  }
});







// ✅ 로그인 (JWT 발급)
// ✅ 로그인 (JWT 발급)
app.post('/feed/login', (req, res) => {
  const { username, password } = req.body;

  db.query("SELECT * FROM users WHERE username = ?", [username], async (err, results) => {
    if (err || results.length === 0) {
      console.error("❌ 로그인 실패: 아이디 또는 비밀번호가 틀림");
      return res.status(400).json({ error: "아이디 또는 비밀번호가 틀렸습니다." });
    }

    const user = results[0];

    // 비밀번호 해시 출력 (로그인 시 비교하는 해시 값)
    console.log("🔐 입력된 비밀번호:", password);
    console.log("🔐 DB에 저장된 해시된 비밀번호:", user.password);  // 이 값이 bcrypt 해시값입니다.

    // 입력된 비밀번호와 DB에 저장된 해시 비밀번호 비교
    const isMatch = await bcrypt.compare(password, user.password);
    
    if (!isMatch) {
      console.error("❌ 로그인 실패: 비밀번호 불일치");
      console.log("🔐 비밀번호 불일치: 입력된 비밀번호와 해시된 비밀번호가 다릅니다.");
      return res.status(400).json({ error: "아이디 또는 비밀번호가 틀렸습니다." });
    }

    // 관리자 여부 판단
    const isAdmin = user.username === 'admin'; // 'admin'인 경우에만 관리자 권한 부여

    // JWT 토큰 생성, 관리자 정보 포함
    const token = jwt.sign(
      { user_id: user.id, username: user.username, is_admin: isAdmin }, // 관리자 정보 포함
      JWT_SECRET,
      { expiresIn: "1d" }
    );

    console.log("✅ 로그인 성공:", {
      token,
      user_id: user.id,
      username: user.username,
      is_admin: isAdmin
    });

    res.json({
      success: true,
      token,
      user_id: user.id,
      username: user.username,
      is_admin: isAdmin // 프론트에 관리자 정보 전달
    });
  });
});


//목표기록
app.get('/feed/my-goals', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: '토큰 없음' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user_id = decoded.user_id;

    const sql = `SELECT event, goal_record FROM user_goals WHERE user_id = ?`;
    db.query(sql, [user_id], (err, rows) => {
      if (err) return res.status(500).json({ error: 'DB 오류' });
      res.json(rows);
    });

  } catch (err) {
    return res.status(403).json({ error: '토큰 유효하지 않음' });
  }
});
//목표기록수정
app.post('/feed/update-goals', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: '토큰 없음' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user_id = decoded.user_id;
    const goals = req.body.goals; // [{event, goal_record}, ...]

    const sql = `INSERT INTO user_goals (user_id, event, goal_record)
                 VALUES ? 
                 ON DUPLICATE KEY UPDATE goal_record = VALUES(goal_record)`;

    const values = goals.map(g => [user_id, g.event, g.goal_record]);

    db.query(sql, [values], (err) => {
      if (err) return res.status(500).json({ error: 'DB 저장 오류' });
      res.json({ success: true });
    });

  } catch (err) {
    return res.status(403).json({ error: '토큰 유효하지 않음' });
  }
});

app.get('/feed/user-goals/:userId', (req, res) => {
  const userId = req.params.userId;

  const sql = `SELECT event, goal_record FROM user_goals WHERE user_id = ?`;
  db.query(sql, [userId], (err, rows) => {
    if (err) return res.status(500).json({ error: 'DB 오류' });
    res.json(rows);
  });
});



// ✅ 현재 로그인한 사용자 정보 조회 (user_id 포함)
// ✅ 현재 로그인한 사용자 정보 조회 (user_id 포함, 전화번호, 생년월일 추가!)
// ✅ 특정 유저 정보 조회 (user_id 파라미터로 받음)
app.post('/feed/user-info', (req, res) => {
    const token = req.headers.authorization?.split(" ")[1];
    const { user_id } = req.body;

    if (!token || !user_id) return res.status(400).json({ error: "토큰 또는 user_id 누락" });

    try {
        jwt.verify(token, JWT_SECRET); // 유효성만 체크 (user_id는 직접 받음)

        db.query("SELECT name, profile_image, phone, birth_date, intro, gender FROM users WHERE id = ?", [user_id], (err, results) => {
            if (err) {
                console.error("🔥 MySQL 조회 오류:", err);
                return res.status(500).json({ error: "DB 조회 실패" });
            }
            if (results.length === 0) {
                return res.status(404).json({ error: "사용자를 찾을 수 없음" });
            }

            const { name, profile_image, phone, birth_date, intro, gender } = results[0];
            const profileImgUrl = profile_image || "https://placehold.co/100x100";

            res.json({ 
                success: true, 
                user_id,
                name, 
                profile_image: profileImgUrl,
                phone,
                birth_date,
                intro,
                gender
            });
        });
    } catch (error) {
        console.error("🔥 JWT 오류:", error);
        res.status(401).json({ error: "Invalid token", details: error.message });
    }
});

/* ======================================
   📌파이썬 연결AI (파일 업로드 포함)
====================================== */

app.post('/feed/ai-predict', async (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: '토큰 없음' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user_id = decoded.user_id;

    const sql = `
      SELECT event, record, created_at
      FROM feeds
      WHERE user_id = ? AND record IS NOT NULL
      ORDER BY created_at ASC
    `;

    db.query(sql, [user_id], async (err, results) => {
      if (err) {
        console.error('🔥 DB 오류:', err);
        return res.status(500).json({ error: '서버 오류' });
      }

      const grouped = {};
for (let r of results) {
  if (!grouped[r.event]) grouped[r.event] = [];
  grouped[r.event].push({
    record: parseFloat(r.record),
    created_at: r.created_at  // ✅ 예측 서버용 raw 날짜 전달
  });
}


      try {
        const aiRes = await axios.post('http://localhost:5050/predict', { grouped });
        res.json(aiRes.data);
      } catch (err) {
        console.error('❌ Python 예측 서버 응답 오류:', err.message);
        res.status(500).json({ error: 'AI 예측 실패' });
      }
    });
  } catch (err) {
    res.status(403).json({ error: '토큰 유효하지 않음' });
  }
});

// 맥스피드.js에서 Flask서버 연결
app.post('/feed/get-ai-recommended-goal', async (req, res) => {
  const { records } = req.body;

  try {
    const aiRes = await axios.post('http://localhost:5050/recommend-goal', { records });
    console.log("🚩 Flask 응답 성공:", aiRes.data); // ✅ 응답 성공 시 출력
    res.json(aiRes.data);
  } catch (e) {
    if (e.response) {
      console.error("🚨 Flask 응답 실패 (상세 메시지):", e.response.data); // ✅ Flask에서 보낸 오류 내용 출력
    } else {
      console.error("🔥 Flask API 호출 실패:", e.message);
    }
    res.status(500).json({ error: "AI 서버 연결 실패" });
  }
});




// 사용자의 종목별 기록 조회 (JWT decode로 user_id 가져오기)
app.get('/feed/user-records', async (req, res) => {
  const authHeader = req.headers['authorization'];
  
  if (!authHeader) {
    return res.status(401).json({ error: "토큰 없음" });
  }

  const token = authHeader.split(' ')[1];
  let user_id;

  try {
    const decoded = jwt.decode(token);
    user_id = decoded.user_id; // ✅ 토큰에서 user_id 추출
  } catch (err) {
    return res.status(403).json({ error: "잘못된 토큰" });
  }

  const { event } = req.query;

  if (!event) {
    return res.status(400).json({ error: "event가 필요합니다." });
  }

  try {
    const [records] = await db.query(`
      SELECT record, eventDate as date FROM feeds
      WHERE user_id = ? AND event = ? AND record IS NOT NULL
      ORDER BY eventDate ASC
    `, [user_id, event]);

    res.json(records);
  } catch (e) {
    console.error("🔥 기록 조회 실패:", e);
    res.status(500).json({ error: "기록 조회 실패" });
  }
});

//목표기록 저장 api들
app.post('/feed/save-achievement', (req, res) => {
  const { user_id, event, goal_value, goal_record, goal_date, medal } = req.body;

  // 목표 달성 기록 저장
  const sql = `INSERT INTO user_ievements (user_id, event, goal_value, goal_record, goal_date, medal)
               VALUES (?, ?, ?, ?, ?, ?)`;

  db.query(sql, [user_id, event, goal_value, goal_record, goal_date, medal], (err, result) => {
    if (err) {
      console.error("🔥 DB 오류:", err);
      return res.status(500).json({ error: 'DB 오류' });
    }

    res.json({ success: true });
  });
});

app.post('/feed/delete-achievements-over-record', (req, res) => {
  const { user_id, event, record } = req.body;
  if (!user_id || !event || !record) return res.status(400).json({ error: "user_id, event, record 필요" });

  const sql = `
    DELETE FROM user_achievements 
    WHERE user_id = ? AND event = ? AND goal_value > ?
  `;
  db.query(sql, [user_id, event, record], (err, result) => {
    if (err) {
      console.error("🔥 메달 조건 삭제 오류:", err);
      return res.status(500).json({ error: 'DB 오류' });
    }

    res.json({ deleted: result.affectedRows });
  });
});


app.get('/feed/my-achievements', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: '토큰 없음' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user_id = decoded.user_id;

    const sql = `SELECT * FROM user_achievements WHERE user_id = ? ORDER BY goal_date DESC`;
    db.query(sql, [user_id], (err, results) => {
      if (err) return res.status(500).json({ error: 'DB 오류' });
      res.json(results);
    });

  } catch (err) {
    return res.status(403).json({ error: '토큰 유효하지 않음' });
  }
});


app.get('/feed/user-achievements/:userId', (req, res) => {
  const userId = req.params.userId;

  const sql = `SELECT event, goal_value, goal_record, goal_date, medal 
               FROM user_achievements 
               WHERE user_id = ? 
               ORDER BY goal_date DESC`;

  db.query(sql, [userId], (err, results) => {
    if (err) {
      console.error("🔥 유저 메달 조회 오류:", err);
      return res.status(500).json({ error: 'DB 오류' });
    }

    res.json(results);
  });
});
app.post('/feed/save-achievement-if-new', (req, res) => {
  const { user_id, event, goal_value, goal_record, goal_date } = req.body;

  console.log("📌 [메달 요청 도착]", { user_id, event, goal_value, goal_record, goal_date });

  const sql = `
    SELECT * FROM user_achievements 
    WHERE user_id = ? AND event = ? 
    ORDER BY goal_value DESC LIMIT 1
  `;

  db.query(sql, [user_id, event], (err, rows) => {
    if (err) {
      console.error("❌ DB 조회 실패:", err);
      return res.status(500).json({ error: 'DB 조회 실패' });
    }

    const alreadySaved = rows[0];
    console.log("🔍 기존 메달:", alreadySaved);

    if (!alreadySaved || goal_value > alreadySaved.goal_value) {
      const insertSql = `
        INSERT INTO user_achievements 
        (user_id, event, goal_value, goal_record, goal_date)
        VALUES (?, ?, ?, ?, ?)
      `;
      db.query(insertSql, [user_id, event, goal_value, goal_record, goal_date], (err2) => {
        if (err2) {
          console.error("❌ DB 저장 실패:", err2);
          return res.status(500).json({ error: 'DB 저장 실패' });
        }

        console.log("🏅 [메달 저장 성공]");

        // 🔔 알림 추가
        const message = `${event} 종목에서 새로운 메달을 달성했습니다!`;
        const insertNoti = `
          INSERT INTO notifications (user_id, type, message)
          VALUES (?, 'medal', ?)
        `;
        db.query(insertNoti, [user_id, message], (err3) => {
          if (err3) console.warn("❌ 메달 알림 저장 실패:", err3);
          else console.log("✅ 메달 알림 저장 완료!");
        });

        return res.json({ saved: true });
      });
    } else {
      console.log("⚠️ 메달 저장 조건 불충족: 기존보다 낮거나 동일");
      return res.json({ saved: false });
    }
  });
});









/* ======================================
   📌 2️⃣ 피드 기능 (파일 업로드 포함)
====================================== */

// ✅ Firebase Storage에 파일 업로드 & URL 반환
async function uploadToFirebase(file, folder = "uploads") {
    try {
        console.log(`🚀 Firebase 업로드 시작: ${file.originalname}`);

        if (!file) throw new Error("파일이 없습니다!");

        // 🔥 `folder` 매개변수 추가 → 프로필 이미지는 "profiles/", 일반 파일은 "uploads/"
        const fileName = `${folder}/${Date.now()}_${file.originalname}`;
        const fileUpload = bucket.file(fileName);

        await fileUpload.save(file.buffer, {
            metadata: { contentType: file.mimetype }
        });

        console.log(`✅ 파일 업로드 성공: ${fileName}`);

        // 🔥 **파일을 공개로 설정 (`makePublic()`)**
        await fileUpload.makePublic();

        // ✅ **공개 URL 반환**
        const publicUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;
        console.log(`🌍 공개 URL: ${publicUrl}`);

        return publicUrl;
    } catch (error) {
        console.error("🔥 Firebase 업로드 오류:", error);
        throw new Error("파일 업로드 실패: " + error.message);
    }
}



app.post('/feed/add-feed', upload.array('files'), async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user_id = decoded.user_id;

    const { event, record, content } = req.body;
    let media_urls = [];

    if (req.files && req.files.length > 0) {
      for (let file of req.files) {
        const url = await uploadToFirebase(file, "feeds");
        media_urls.push(url);
      }
    }

    const sql = `
      INSERT INTO feeds (user_id, event, record, content, media_url, created_at)
      VALUES (?, ?, ?, ?, ?, NOW())
    `;
    const media = JSON.stringify(media_urls);

    // ✅ 콜백을 async로!
    db.query(sql, [user_id, event, record, content, media], async (err, result) => {
      if (err) {
        console.error("🔥 DB 저장 실패:", err);
        return res.status(500).json({ error: "DB 저장 실패" });
      }

      // ✅ 문자 전송
      try {
        await sendSMS("01021446765", `[MAX] 새 피드가 등록되었습니다.`);
        console.log("✅ 문자 전송 성공!");
      } catch (err) {
        console.warn("📡 문자 전송 실패:", err.message);
      }

      res.json({ success: true, feed_id: result.insertId });
    });

  } catch (e) {
    console.error("❌ 업로드 실패:", e);
    res.status(500).json({ error: "서버 오류" });
  }
});





// ✅ 피드 목록 (페이지네이션 추가!)
// 기존 /feed/feeds API 확장
app.get('/feed/feeds', (req, res) => {
  const tag = req.query.tag;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 5;
  const offset = (page - 1) * limit;

  let sql = `
    SELECT feeds.*, users.name,
           COALESCE(users.profile_image, 'https://placehold.co/40x40') AS profile_image
    FROM feeds
    JOIN users ON feeds.user_id = users.id
  `;
  const params = [];

  // ✅ tag가 있는 경우에만 필터링
if (tag) {
  sql += ` WHERE content LIKE ? OR event LIKE ? `;
  params.push(`%#${tag}%`, `%${tag}%`);
}


  sql += ` ORDER BY feeds.created_at DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  db.query(sql, params, (err, results) => {
    if (err) {
      console.error("🔥 피드 조회 오류:", err);
      return res.status(500).json({ error: "피드 조회 실패" });
    }
    res.json(results);
  });
});
//기록들 
app.get('/feed/my-records', (req, res) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: '토큰 없음' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user_id = decoded.user_id;

    const sql = `
      SELECT event, record, created_at
      FROM feeds
      WHERE user_id = ? AND record IS NOT NULL
      ORDER BY created_at ASC
    `;

    db.query(sql, [user_id], (err, results) => {
      if (err) {
        console.error('🔥 기록 불러오기 실패:', err);
        return res.status(500).json({ error: '서버 오류' });
      }
      res.json(results);
    });

  } catch (err) {
    return res.status(403).json({ error: '토큰 유효하지 않음' });
  }
});

// 내 피드만 조회 (로그인 사용자 전용)
app.get('/feed/my-feeds', (req, res) => {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ error: "Unauthorized: 토큰 없음" });

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const user_id = decoded.user_id;

        const sql = `
            SELECT feeds.*, users.username, users.profile_image
            FROM feeds
            JOIN users ON feeds.user_id = users.id
            WHERE feeds.user_id = ?
            ORDER BY feeds.created_at DESC
        `;
        db.query(sql, [user_id], (err, results) => {
            if (err) {
                console.error('❌ 내 피드 조회 오류:', err);
                return res.status(500).json({ error: '내 피드 조회 실패' });
            }
            res.json(results);
        });
    } catch (error) {
        console.error('❌ JWT 오류:', error);
        res.status(401).json({ error: "Invalid token", details: error.message });
    }
});


// ✅ Firebase 파일 삭제 함수
function deleteFromFirebaseByUrl(url) {
  try {
    const filePath = decodeURIComponent(url.split(`/${bucket.name}/`)[1]);
    return bucket.file(filePath).delete();
  } catch (err) {
    console.error("❌ Firebase 경로 추출 실패:", err);
    return Promise.resolve(); // 실패해도 서버 죽지 않게
  }
}

// ✅ 피드 삭제 API (Firebase 포함)
app.post('/feed/delete-feed', (req, res) => {
  const { feed_id } = req.body;
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    console.log("✅ [피드 삭제 요청] feed_id:", feed_id, "by user_id:", decoded.user_id);

    // ✅ 피드 정보 조회
    const checkSql = "SELECT * FROM feeds WHERE id = ? AND user_id = ?";
    db.query(checkSql, [feed_id, decoded.user_id], async (err, results) => {
      if (err || results.length === 0) {
        return res.status(403).json({ error: "삭제 권한 없음 또는 피드 없음" });
      }

      const feed = results[0];
      const mediaUrls = JSON.parse(feed.media_url || '[]');

      // ✅ Firebase 파일 삭제
      for (const url of mediaUrls) {
        try {
          await deleteFromFirebaseByUrl(url);
          console.log("🗑️ Firebase 파일 삭제 완료:", url);
        } catch (e) {
          console.warn("⚠️ Firebase 삭제 실패 (무시):", url);
        }
      }

      // ✅ DB에서 피드 삭제
      db.query("DELETE FROM feeds WHERE id = ?", [feed_id], (err) => {
        if (err) return res.status(500).json({ error: "피드 삭제 실패" });

        res.json({ success: true, message: "피드와 Firebase 파일이 삭제되었습니다." });
      });
    });

  } catch (error) {
    console.error("❌ JWT 오류:", error);
    res.status(401).json({ error: "Invalid token" });
  }
});

// ✅ 특정 사용자의 피드 조회
app.get('/feed/user-feeds/:userId', (req, res) => {
  const userId = req.params.userId;

  const sql = `
    SELECT feeds.*, users.name, 
           COALESCE(users.profile_image, 'https://placehold.co/40x40') AS profile_image
    FROM feeds
    JOIN users ON feeds.user_id = users.id 
    WHERE feeds.user_id = ?
    ORDER BY feeds.created_at DESC
  `;

  db.query(sql, [userId], (err, results) => {
    if (err) {
      console.error("🔥 [유저 피드] 조회 오류:", err);
      return res.status(500).json({ error: "유저 피드 조회 실패" });
    }

    res.json(results);
  });
});


// ✅ 내정보 수정관련 (이름 표시)
app.post('/feed/update-profile', upload.single('profile_image'), async (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const {
      current_password,
      new_password,
      confirm_password,
      phone,
      birth_date,
      intro  // ✅ 소개글 추가
    } = req.body;

    console.log("✅ [내정보 수정 요청] user_id:", decoded.user_id);

    // 비밀번호 변경 처리
    if (current_password) {
      db.query("SELECT password FROM users WHERE id = ?", [decoded.user_id], async (err, result) => {
        if (err) return res.status(500).json({ error: "DB 조회 실패" });
        if (result.length === 0) return res.status(400).json({ error: "유효하지 않은 사용자입니다." });

        const isMatch = await bcrypt.compare(current_password, result[0].password);
        if (!isMatch) return res.status(400).json({ error: "기존 비밀번호가 틀렸습니다." });

        if (new_password && new_password !== confirm_password) {
          return res.status(400).json({ error: "새 비밀번호가 일치하지 않습니다." });
        }

        const hashedPassword = new_password ? await bcrypt.hash(new_password, 10) : result[0].password;
        updateUserProfile(decoded.user_id, hashedPassword);
      });
    } else {
      updateUserProfile(decoded.user_id, null);
    }

    // ✅ 프로필 업데이트 함수
    async function updateUserProfile(user_id, newPassword) {
      let profile_url = null;

      if (req.file) {
        profile_url = await uploadToFirebase(req.file, "profiles");
      }

      const sql = `
        UPDATE users SET 
          password = COALESCE(?, password), 
          phone = COALESCE(?, phone),
          birth_date = COALESCE(?, birth_date),
          profile_image = COALESCE(?, profile_image),
          intro = COALESCE(?, intro)
        WHERE id = ?
      `;

      const values = [newPassword, phone, birth_date, profile_url, intro, user_id];

      db.query(sql, values, (err, result) => {
        if (err) return res.status(500).json({ error: "프로필 수정 실패" });

        console.log("✅ 프로필 수정 완료:", result);
        res.json({ success: true, profile_url });
      });
    }

  } catch (error) {
    console.error("🔥 서버 오류 발생:", error);
    res.status(500).json({ error: "Internal Server Error", details: error.message });
  }
});

app.patch('/feed/update-feed', upload.array('files'), async (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const { feed_id, content, event, record, existing_media } = req.body;

    // ✅ 유저가 본인 피드 수정하는지 확인
    db.query("SELECT * FROM feeds WHERE id = ? AND user_id = ?", [feed_id, decoded.user_id], async (err, results) => {
      if (err || results.length === 0) {
        return res.status(403).json({ error: "수정 권한 없음 또는 피드 없음" });
      }

      let mediaArray = [];
      try {
        mediaArray = JSON.parse(existing_media || '[]');
      } catch (e) {
        return res.status(400).json({ error: "기존 미디어 파싱 오류" });
      }

      // ✅ 새 파일 업로드 시 Firebase에 추가
      if (req.files && req.files.length > 0) {
        for (let file of req.files) {
          const url = await uploadToFirebase(file, "feeds");
          mediaArray.push(url);
        }
      }

      const sql = `
        UPDATE feeds SET content = ?, event = ?, record = ?, media_url = ?
        WHERE id = ? AND user_id = ?
      `;

      db.query(sql, [content, event, record, JSON.stringify(mediaArray), feed_id, decoded.user_id], (err) => {
        if (err) return res.status(500).json({ error: "피드 수정 실패" });
        res.json({ success: true, updated: true });
      });
    });
  } catch (error) {
    res.status(401).json({ error: "Invalid token" });
  }
});



// ✅ 단일 피드 조회 (JOIN 없이 바로 feeds 테이블에서만)
app.get('/feed/feeds/:id', (req, res) => {
  const feedId = parseInt(req.params.id, 10);
  if (isNaN(feedId)) return res.status(400).json({ error: '잘못된 피드 ID' });

  const sql = `
    SELECT 
      id,
      user_id,
      content,
      media_url,
      created_at,
      like_count,
      comment_count,
      event,
      record
    FROM feeds
    WHERE id = ?
  `;
  db.query(sql, [feedId], (err, result) => {
    if (err) {
      console.error('🔥 DB 오류:', err);
      return res.status(500).json({ error: "피드 조회 실패" });
    }
    if (result.length === 0) {
      return res.status(404).json({ error: "피드 없음" });
    }

    res.json(result[0]);
  });
});



// 댓글 좋아요 토글 API
app.post('/feed/like-comment', (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const userId = decoded.user_id;
    const { comment_id } = req.body;

    if (!comment_id) return res.status(400).json({ error: "댓글 ID 누락" });

    // 먼저 현재 좋아요 여부 확인
    const checkSql = 'SELECT * FROM comment_likes WHERE user_id = ? AND comment_id = ?';
    db.query(checkSql, [userId, comment_id], (err, rows) => {
      if (err) return res.status(500).json({ error: "DB 오류 (조회)" });

      if (rows.length > 0) {
        // 이미 좋아요 눌렀으면 → 삭제
        const delSql = 'DELETE FROM comment_likes WHERE user_id = ? AND comment_id = ?';
        db.query(delSql, [userId, comment_id], (err) => {
          if (err) return res.status(500).json({ error: "DB 오류 (삭제)" });

          // 개수 다시 계산
          const countSql = 'SELECT COUNT(*) AS count FROM comment_likes WHERE comment_id = ?';
          db.query(countSql, [comment_id], (err, countRes) => {
            if (err) return res.status(500).json({ error: "DB 오류 (카운트)" });
            res.json({ liked: false, like_count: countRes[0].count });
          });
        });
      } else {
        // 좋아요 등록
        const insSql = 'INSERT INTO comment_likes (user_id, comment_id) VALUES (?, ?)';
        db.query(insSql, [userId, comment_id], (err) => {
          if (err) return res.status(500).json({ error: "DB 오류 (삽입)" });

          const countSql = 'SELECT COUNT(*) AS count FROM comment_likes WHERE comment_id = ?';
          db.query(countSql, [comment_id], (err, countRes) => {
            if (err) return res.status(500).json({ error: "DB 오류 (카운트)" });
            res.json({ liked: true, like_count: countRes[0].count });
          });
        });
      }
    });

  } catch (e) {
    return res.status(401).json({ error: "토큰 인증 실패" });
  }
});

// ✅ 댓글 조회 API (GET /feed/comments/:feedId)
// ✅ /feed/comments/:feedId
app.get('/feed/comments/:feedId', (req, res) => {
  const feedId = req.params.feedId;
  const token = req.headers.authorization?.split(" ")[1];
  let user_id = null;

  try {
    if (token) {
      const decoded = jwt.verify(token, JWT_SECRET);
      user_id = decoded.user_id;
    }
  } catch (err) {
    console.log("❌ 토큰 오류 - 좋아요 상태 미적용");
  }

  const sql = `
    SELECT c.*, u.name,
      (SELECT COUNT(*) FROM comment_likes WHERE comment_id = c.id) AS like_count,
      (SELECT COUNT(*) FROM comment_likes WHERE comment_id = c.id AND user_id = ?) AS liked
    FROM comments c
    JOIN users u ON c.user_id = u.id
    WHERE c.feed_id = ?
    ORDER BY c.created_at ASC
  `;

  db.query(sql, [user_id, feedId], (err, results) => {
    if (err) {
      console.error("🔥 댓글 조회 오류:", err);
      return res.status(500).json({ error: "댓글 불러오기 실패" });
    }

    // liked는 0 또는 1 → true/false로 변환
    const mapped = results.map(r => ({
      ...r,
      liked: r.liked > 0,
      like_count: r.like_count || 0
    }));

    res.json(mapped);
  });
});





// ✅ 댓글 추가 API (문자 알림 기능 추가!)
app.post('/feed/add-comment', upload.single('media'), async (req, res) => {
    const { feed_id, content, parent_id } = req.body;
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ error: "Unauthorized" });

    try {
        const decoded = jwt.verify(token, JWT_SECRET);

        let media_url = null;
        if (req.file) {
            media_url = await uploadToFirebase(req.file, "comments");
        }

        const sql = `
            INSERT INTO comments (feed_id, user_id, content, parent_id, media_url)
            VALUES (?, ?, ?, ?, ?)
        `;
        db.query(sql, [feed_id, decoded.user_id, content, parent_id || null, media_url], (err, result) => {
          if (parent_id) {
            const replyTargetSql = `
              SELECT user_id FROM comments WHERE id = ?
            `;
            db.query(replyTargetSql, [parent_id], (err, replyTarget) => {
              const parentUserId = replyTarget?.[0]?.user_id;
              if (parentUserId && parentUserId !== decoded.user_id) {
                const nameSql = "SELECT name FROM users WHERE id = ?";
                db.query(nameSql, [decoded.user_id], (err, result) => {
                  const replyerName = result?.[0]?.name || '누군가';
                  const message = `${replyerName}님이 댓글에 답글을 남겼습니다.`;
        
                  const insertSql = `
                    INSERT INTO notifications (user_id, type, message, feed_id)
                    VALUES (?, 'reply', ?, ?)
                  `;
                  db.query(insertSql, [parentUserId, message, feed_id], (err) => {
                    if (err) console.warn("❌ 대댓글 알림 저장 실패:", err);
                    else console.log("✅ 대댓글 알림 저장 완료!");
                  });
                });
              }
            });
          }
        
            if (err) {
                console.error("🔥 댓글 추가 오류:", err);
                return res.status(500).json({ error: "댓글 추가 실패" });
            }

            // 댓글 카운트 업데이트
            db.query("UPDATE feeds SET comment_count = comment_count + 1 WHERE id = ?", [feed_id], () => {
                db.query("SELECT comment_count FROM feeds WHERE id = ?", [feed_id], async (err, countResult) => {
                    if (err) {
                        return res.status(500).json({ error: "댓글 카운트 업데이트 실패" });
                    }

                    // 🔥 댓글 작성자의 user_id와 피드 주인의 user_id 비교
                    const feedOwnerSql = `
                        SELECT feeds.user_id, users.phone
                        FROM feeds
                        JOIN users ON feeds.user_id = users.id
                        WHERE feeds.id = ?
                    `;

                    db.query(feedOwnerSql, [feed_id], async (err, feedOwnerResult) => {
                        if (err || feedOwnerResult.length === 0) {
                            console.error("🔥 피드 주인 조회 오류:", err);
                        } else {
                            const feedOwnerId = feedOwnerResult[0].user_id;
                            const feedOwnerPhone = feedOwnerResult[0].phone;

                            // 댓글 작성자가 피드 주인이 아니라면 문자 발송
                            if (decoded.user_id !== feedOwnerId) {
                                const smsMessage = `[일맥스타그램] 회원님의 피드에 댓글이 생성되었습니다.`;
                                try {
                                    await sendSMS(feedOwnerPhone, smsMessage);

                                    console.log(`✅ 댓글 알림 문자 발송 완료 → ${feedOwnerPhone}`);

                                    const commenterNameSql = "SELECT name FROM users WHERE id = ?";
                                    db.query(commenterNameSql, [decoded.user_id], (err, result) => {
                                      const commenterName = result?.[0]?.name || '누군가';
                                      const insertSql = `
                                        INSERT INTO notifications (user_id, type, message, feed_id)
                                        VALUES (?, 'comment', ?, ?)
                                      `;
                                      const message = `${commenterName}님이 댓글을 남겼습니다.`;
                                      db.query(insertSql, [feedOwnerId, message, feed_id], (err) => {
                                        if (err) console.warn("❌ 댓글 알림 저장 실패:", err);
                                        else console.log("✅ 댓글 알림 저장 완료!");
                                      });
                                    });
                              
                                } catch (smsErr) {
                                    console.error(`🔥 댓글 알림 문자 발송 실패 → ${feedOwnerPhone}`, smsErr);
                                }
                            } else {
                                console.log("🟡 본인의 댓글이라 문자 발송 없음");
                            }
                        }

                        // ✅ 최종 응답 반환
                        res.json({
                            success: true,
                            comment_id: result.insertId,
                            comment_count: countResult[0].comment_count
                        });
                    });
                });
            });
        });

    } catch (error) {
        console.error("🔥 JWT 오류:", error);
        res.status(401).json({ error: "Invalid token" });
    }
});



// ✅ 댓글 삭제 API (수정됨)
app.post('/feed/delete-comment', (req, res) => {
    const { comment_id } = req.body;
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ error: "Unauthorized" });

    try {
        const decoded = jwt.verify(token, JWT_SECRET);

        // 1. 댓글 정보 조회
        db.query(
            `SELECT feed_id, media_url FROM comments WHERE id = ? AND user_id = ?`,
            [comment_id, decoded.user_id],
            (err, results) => {
                if (err) {
                    console.error("🔥 댓글 조회 실패:", err);
                    return res.status(500).json({ error: "DB 조회 실패" });
                }

                if (results.length === 0) {
                    return res.status(404).json({ error: "댓글을 찾을 수 없음" });
                }

                const { feed_id, media_url } = results[0];

                // 2. 대댓글 존재 여부 확인
                db.query(
                    `SELECT COUNT(*) AS cnt FROM comments WHERE parent_id = ?`,
                    [comment_id],
                    (err, countResult) => {
                        if (err) {
                            console.error("🔥 대댓글 조회 오류:", err);
                            return res.status(500).json({ error: "대댓글 조회 실패" });
                        }

                        const hasReplies = countResult[0].cnt > 0;

                        if (hasReplies) {
                            // 🔁 대댓글이 있으면 → soft delete 처리
                            db.query(
                                `UPDATE comments SET content = '', deleted = 1 WHERE id = ?`,
                                [comment_id],
                                (err) => {
                                    if (err) return res.status(500).json({ error: "댓글 삭제 실패 (soft)" });

                                    res.json({ success: true, softDeleted: true });
                                }
                            );
                        } else {
                            // ❌ 대댓글이 없으면 → 실제 삭제
                            db.query(`DELETE FROM comments WHERE id = ?`, [comment_id], (err) => {
                                if (err) return res.status(500).json({ error: "댓글 삭제 실패" });

                                // 🔥 Firebase 스토리지 삭제
                                if (media_url) {
                                    try {
                                        let filePath;
                                        if (media_url.includes("firebasestorage.googleapis.com")) {
                                            filePath = decodeURIComponent(media_url.split("/o/")[1].split("?")[0]);
                                        } else {
                                            filePath = decodeURIComponent(media_url.replace(`https://storage.googleapis.com/${bucket.name}/`, ""));
                                        }

                                        bucket.file(filePath).delete().then(() => {
                                            console.log("✅ Firebase 댓글 파일 삭제 완료:", filePath);
                                        }).catch(err => {
                                            console.warn("⚠️ Firebase 댓글 파일 삭제 실패 (무시됨):", err.message);
                                        });
                                    } catch (e) {
                                        console.warn("⚠️ Firebase 경로 파싱 실패:", e.message);
                                    }
                                }

                                // 🔄 댓글 카운트 감소
                                db.query(`UPDATE feeds SET comment_count = comment_count - 1 WHERE id = ?`, [feed_id], (err) => {
                                    if (err) console.warn("⚠️ 댓글 카운트 업데이트 실패 (무시):", err);

                                    res.json({ success: true, deleted: true });
                                });
                            });
                        }
                    }
                );
            }
        );
    } catch (err) {
        console.error("🔥 댓글 삭제 오류:", err);
        res.status(500).json({ error: "댓글 삭제 실패" });
    }
});




// ✅ 좋아요 API
app.post('/feed/like', (req, res) => {
  const { feed_id } = req.body;
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    db.beginTransaction((err) => {
      if (err) return res.status(500).json({ error: "DB 트랜잭션 시작 실패" });

      // 1. 이미 좋아요 눌렀는지 확인
      const checkSql = "SELECT * FROM likes WHERE feed_id = ? AND user_id = ?";
      db.query(checkSql, [feed_id, decoded.user_id], (err, results) => {
        if (err) return db.rollback(() => res.status(500).json({ error: "좋아요 확인 실패" }));

        if (results.length > 0) {
          // ✅ 좋아요 취소
          const deleteSql = "DELETE FROM likes WHERE feed_id = ? AND user_id = ?";
          db.query(deleteSql, [feed_id, decoded.user_id], (err) => {
            if (err) return db.rollback(() => res.status(500).json({ error: "좋아요 취소 실패" }));

            updateLikeCount(false);
          });
        } else {
          // ✅ 좋아요 추가
          const insertSql = "INSERT INTO likes (feed_id, user_id) VALUES (?, ?)";
          db.query(insertSql, [feed_id, decoded.user_id], (err) => {
            if (err) return db.rollback(() => res.status(500).json({ error: "좋아요 추가 실패" }));

            updateLikeCount(true);
          });
        }

        // 🔄 좋아요 수 갱신 + 알림 처리 함수
        function updateLikeCount(isLiked) {
          db.query("SELECT COUNT(*) AS like_count FROM likes WHERE feed_id = ?", [feed_id], (err, countResult) => {
            if (err) return db.rollback(() => res.status(500).json({ error: "좋아요 수 조회 실패" }));

            const likeCount = countResult[0].like_count;
            db.query("UPDATE feeds SET like_count = ? WHERE id = ?", [likeCount, feed_id], (err) => {
              if (err) return db.rollback(() => res.status(500).json({ error: "like_count 업데이트 실패" }));

              if (isLiked) {
                // 🔔 좋아요한 유저 이름 불러와서 알림 추가
                const feedOwnerSql = `SELECT user_id FROM feeds WHERE id = ?`;
                db.query(feedOwnerSql, [feed_id], (err, feedRes) => {
                  const feedOwnerId = feedRes?.[0]?.user_id;
                  if (feedOwnerId && feedOwnerId !== decoded.user_id) {
                    const userSql = `SELECT name FROM users WHERE id = ?`;
                    db.query(userSql, [decoded.user_id], (err, nameResult) => {
                      const likerName = nameResult?.[0]?.name || '누군가';
                      const message = `${likerName}님이 피드에 좋아요를 눌렀습니다.`;

                      const notiSql = `
                        INSERT INTO notifications (user_id, type, message, feed_id)
                        VALUES (?, 'like', ?, ?)
                      `;
                      db.query(notiSql, [feedOwnerId, message, feed_id], (err) => {
                        if (err) console.warn("❌ 좋아요 알림 저장 실패:", err);
                        else console.log("✅ 좋아요 알림 저장 완료!");
                      });
                    });
                  }
                });
              }

              // 최종 응답
              db.commit(() => res.json({ liked: isLiked, like_count: likeCount }));
            });
          });
        }
      });
    });
  } catch (e) {
    console.error("❌ JWT 오류:", e);
    return res.status(403).json({ error: "Invalid token" });
  }
});









/* ======================================
   📌 서버 실행 (포트 충돌 방지 포함)
====================================== */

// ✅ 포트 충돌 방지 추가
const server = app.listen(PORT, () => {
    console.log(`🚀 server.js가 ${PORT} 포트에서 실행 중...`);
}).on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`❌ 오류: 포트 ${PORT}가 이미 사용 중입니다.`);
        process.exit(1); // 서버 종료
    } else {
        console.error(err);
    }
});

// ✅ 서버 종료 시 포트 정리
process.on('SIGINT', () => {
    console.log('❌ 서버 종료 중...');
    server.close(() => {
        console.log('✅ 서버가 정상적으로 종료되었습니다.');
        process.exit(0);
    });
});

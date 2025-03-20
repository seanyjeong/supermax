const express = require('express');
const mysql = require('mysql');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const multer = require('multer');
const admin = require('firebase-admin');
const serviceAccount = require('/root/supermax/firebase-key.json');

const app = express();
// 이 코드 위치: const app = express(); 선언 바로 아래에 추가
app.use(express.json({ limit: '100mb' }));    // JSON 요청 용량 확대
app.use(express.urlencoded({ limit: '100mb', extended: true }));  // URL 인코딩 요청 용량 확대

const PORT = 5000;
const JWT_SECRET = "your_secret_key";

app.use(express.json());
// ✅ 정확하고 명확한 CORS 설정 (프론트엔드 도메인 허용)
app.use(cors({
  origin: ['https://score.ilsanmax.com','https://seanyjeong.github.io'], // 네 프론트엔드 도메인
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));


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

// ✅ 회원가입
app.post('/feed/register', async (req, res) => {
    const { username, password, name, birth_date, phone, school, grade, gender, consent } = req.body;

    if (!consent) return res.status(400).json({ error: "개인정보 동의가 필요합니다." });

    const hashedPassword = await bcrypt.hash(password, 10);
    const sql = "INSERT INTO users (username, password, name, birth_date, phone, school, grade, gender, consent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)";

    db.query(sql, [username, hashedPassword, name, birth_date, phone, school, grade, gender, consent], (err, result) => {
        if (err) return res.status(500).json({ error: err });
        res.json({ success: true, user_id: result.insertId });
    });
});

// ✅ 로그인 (JWT 발급)
app.post('/feed/login', (req, res) => {
    const { username, password } = req.body;

    db.query("SELECT * FROM users WHERE username = ?", [username], async (err, results) => {
        if (err || results.length === 0) return res.status(400).json({ error: "아이디 또는 비밀번호가 틀렸습니다." });

        const user = results[0];
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ error: "아이디 또는 비밀번호가 틀렸습니다." });

        const token = jwt.sign({ user_id: user.id, username: user.username }, JWT_SECRET, { expiresIn: "1d" });
        res.json({ success: true, token, user });
    });
});
// ✅ 현재 로그인한 사용자 정보 조회
app.get('/feed/user-info', (req, res) => {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ error: "Unauthorized" });

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        res.json({ success: true, name: decoded.name });
    } catch {
        res.status(401).json({ error: "Invalid token" });
    }
});

// ✅ 로그아웃 (클라이언트에서 토큰 삭제)
app.post('/feed/logout', (req, res) => {
    res.json({ success: true, message: "로그아웃 성공" });
});

/* ======================================
   📌 2️⃣ 피드 기능 (파일 업로드 포함)
====================================== */

// ✅ Firebase Storage에 파일 업로드 & URL 반환
async function uploadToFirebase(file) {
    const fileName = `uploads/${Date.now()}_${file.originalname}`;
    const fileUpload = bucket.file(fileName);

    await fileUpload.save(file.buffer, {
        metadata: { contentType: file.mimetype }
    });

    // ✅ 이 부분 추가 → 파일 공개 설정
    await fileUpload.makePublic();

    // ✅ 공개 URL로 리턴
    return `https://storage.googleapis.com/${bucket.name}/${fileName}`;
}


// ✅ 피드 작성 (이름 포함)
app.post('/feed/add-feed', upload.single('file'), async (req, res) => {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ error: "Unauthorized" });

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const { content } = req.body;
        let media_url = null;

        if (req.file) {
            const fileName = `uploads/${Date.now()}_${req.file.originalname}`;
            const fileUpload = bucket.file(fileName);
            await fileUpload.save(req.file.buffer, { metadata: { contentType: req.file.mimetype } });
            await fileUpload.makePublic();
            media_url = `https://storage.googleapis.com/${bucket.name}/${fileName}`;
        }

        const sql = "INSERT INTO feeds (user_id, name, content, media_url) VALUES (?, ?, ?, ?)";
        db.query(sql, [decoded.user_id, decoded.name, content, media_url], (err, result) => {
            if (err) return res.status(500).json({ error: err });
            res.json({ success: true });
        });
    } catch {
        res.status(401).json({ error: "Invalid token" });
    }
});

// ✅ 피드 목록 (이름 표시)
app.get('/feed/feeds', (req, res) => {
    const sql = `SELECT feeds.*, users.name FROM feeds JOIN users ON feeds.user_id = users.id ORDER BY feeds.created_at DESC`;
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ error: '피드 조회 실패' });
        res.json(results);
    });
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

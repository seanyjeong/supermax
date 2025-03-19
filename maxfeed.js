const express = require('express');
const mysql = require('mysql');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');  // ✅ bcryptjs로 변경하여 실행 오류 해결
const cors = require('cors');
const multer = require('multer');
const admin = require('firebase-admin');
const serviceAccount = require('/root/supermax/firebase-key.json');  // ✅ Firebase 인증 키

const app = express();
const PORT = 5000;
const JWT_SECRET = "your_secret_key";  // ✅ JWT 비밀키

app.use(express.json());
app.use(cors());

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
        process.exit(1);
    }
    console.log("✅ MySQL Connected!");

    // ✅ MySQL 연결 후 서버 실행
    app.listen(PORT, () => {
        console.log(`🚀 maxfeed.js 피드 서버가 ${PORT} 포트에서 실행 중...`);
    });
});

// ✅ Firebase Storage 설정
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: "gs://ilsanmax.appspot.com"  // ✅ Firebase Storage 버킷 주소
});
const bucket = admin.storage().bucket();

// ✅ 파일 업로드 설정 (Firebase Storage 사용)
const upload = multer({ storage: multer.memoryStorage() });

/* ======================================
   📌 1️⃣ 회원가입 & 로그인 & 로그아웃
====================================== */

// ✅ 회원가입
app.post('/register', async (req, res) => {
    const { username, password, name, birth_date, phone, school, grade, gender, consent } = req.body;

    if (!consent) return res.status(400).json({ error: "개인정보 동의가 필요합니다." });

    const hashedPassword = await bcrypt.hash(password, 10);  // ✅ bcryptjs 사용
    const sql = "INSERT INTO users (username, password, name, birth_date, phone, school, grade, gender, consent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)";

    db.query(sql, [username, hashedPassword, name, birth_date, phone, school, grade, gender, consent], (err, result) => {
        if (err) return res.status(500).json({ error: err });
        res.json({ success: true, user_id: result.insertId });
    });
});

// ✅ 로그인 (JWT 발급)
app.post('/login', (req, res) => {
    const { username, password } = req.body;

    db.query("SELECT * FROM users WHERE username = ?", [username], async (err, results) => {
        if (err || results.length === 0) return res.status(400).json({ error: "아이디 또는 비밀번호가 틀렸습니다." });

        const user = results[0];
        const isMatch = await bcrypt.compare(password, user.password);  // ✅ bcryptjs 사용
        if (!isMatch) return res.status(400).json({ error: "아이디 또는 비밀번호가 틀렸습니다." });

        const token = jwt.sign({ user_id: user.id, username: user.username }, JWT_SECRET, { expiresIn: "1d" });
        res.json({ success: true, token, user });
    });
});

// ✅ 로그아웃 (클라이언트에서 토큰 삭제)
app.post('/logout', (req, res) => {
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

    return `https://storage.googleapis.com/${bucket.name}/${fileName}`;
}

// ✅ 피드 작성 (사진/동영상 업로드 포함)
app.post('/add-feed', upload.single('file'), async (req, res) => {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ error: "Unauthorized" });

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const { content } = req.body;
        const user_id = decoded.user_id;

        let media_url = null;
        if (req.file) {
            media_url = await uploadToFirebase(req.file);
        }

        const sql = "INSERT INTO feeds (user_id, content, media_url) VALUES (?, ?, ?)";
        db.query(sql, [user_id, content, media_url], (err, result) => {
            if (err) return res.status(500).json({ error: err });
            res.json({ success: true, feed_id: result.insertId });
        });
    } catch (error) {
        res.status(401).json({ error: "Invalid token" });
    }
});

// ✅ 전체 피드 조회
app.get('/feeds', (req, res) => {
    const sql = `
        SELECT feeds.*, users.username, users.profile_image 
        FROM feeds 
        JOIN users ON feeds.user_id = users.id 
        ORDER BY created_at DESC
    `;
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ error: err });
        res.json(results);
    });
});

// ✅ 내 피드만 조회
app.get('/my-feeds', (req, res) => {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ error: "Unauthorized" });

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const user_id = decoded.user_id;

        const sql = "SELECT * FROM feeds WHERE user_id = ? ORDER BY created_at DESC";
        db.query(sql, [user_id], (err, results) => {
            if (err) return res.status(500).json({ error: err });
            res.json(results);
        });
    } catch (error) {
        res.status(401).json({ error: "Invalid token" });
    }
});

/* ======================================
   📌 3️⃣ 좋아요 & 댓글 기능 (추가 가능)
====================================== */

// ✅ 좋아요 추가
app.post('/like', (req, res) => {
    const { feed_id, user_id } = req.body;
    const sql = "INSERT INTO likes (feed_id, user_id) VALUES (?, ?)";

    db.query(sql, [feed_id, user_id], (err, result) => {
        if (err) return res.status(500).json({ error: err });
        res.json({ success: true });
    });
});

// ✅ 댓글 추가
app.post('/comment', (req, res) => {
    const { feed_id, user_id, comment } = req.body;
    const sql = "INSERT INTO comments (feed_id, user_id, comment) VALUES (?, ?, ?)";

    db.query(sql, [feed_id, user_id, comment], (err, result) => {
        if (err) return res.status(500).json({ error: err });
        res.json({ success: true });
    });
});


/* ======================================
   📌 서버 실행 (5000번 포트)
====================================== */
app.listen(PORT, () => {
    console.log(`maxfeed.js 피드 서버가 ${PORT} 포트에서 실행 중...`);
});

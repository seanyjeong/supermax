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
// ✅ 정확하고 명확한 CORS 설정 (프론트엔드 도메인 허용)
const corsOptions = {
  origin: ['https://score.ilsanmax.com', 'https://seanyjeong.github.io'],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true  // ✅ 중요! credentials 사용 가능하도록 설정
};

app.use(cors(corsOptions));


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

    const message = `[MaxFeed] 인증번호: ${code}`;

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

        db.query("SELECT name, profile_image FROM users WHERE id = ?", [decoded.user_id], (err, results) => {
            if (err) {
                console.error("🔥 MySQL 조회 오류:", err);
                return res.status(500).json({ error: "DB 조회 실패" });
            }
            if (results.length === 0) {
                return res.status(400).json({ error: "유효하지 않은 사용자" });
            }

            // ✅ 기본 프로필 이미지 설정
            const { name, profile_image } = results[0];
            const profileImgUrl = profile_image || "https://placehold.co/40x40";

            res.json({ success: true, name, profile_image: profileImgUrl });
        });

    } catch (error) {
        console.error("🔥 JWT 오류:", error);
        res.status(401).json({ error: "Invalid token", details: error.message });
    }
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



// ✅ 피드 작성 (이름 포함)
app.post('/feed/add-feed', upload.single('file'), async (req, res) => {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ error: "Unauthorized" });

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        console.log("✅ [add-feed] 요청 수신:", req.body);
        console.log("📂 [파일 정보]:", req.file);

        const { content } = req.body;
        let media_url = null;

        if (!req.file) {
            console.error("❌ 파일 없음! 업로드 중단.");
            return res.status(400).json({ error: "파일이 없습니다!" });
        }

        console.log("🚀 Firebase 업로드 시작...");
        media_url = await uploadToFirebase(req.file);
        console.log("✅ Firebase 업로드 완료:", media_url);

        // 🔥 `user_id`로 `name` 조회 후 저장
        db.query("SELECT name FROM users WHERE id = ?", [decoded.user_id], (err, result) => {
            if (err) {
                console.error("❌ MySQL 조회 오류:", err);
                return res.status(500).json({ error: "DB 조회 실패" });
            }
            if (result.length === 0) {
                console.error("❌ 유저 없음: user_id =", decoded.user_id);
                return res.status(400).json({ error: "유효하지 않은 사용자입니다." });
            }

            const userName = result[0].name;  // ✅ 조회한 name 값 저장
            console.log("✅ DB에서 가져온 name:", userName);

            // 🔥 MySQL에 피드 저장
            const sql = "INSERT INTO feeds (user_id, name, content, media_url) VALUES (?, ?, ?, ?)";
            db.query(sql, [decoded.user_id, userName, content, media_url], (err, result) => {
                if (err) {
                    console.error("🔥 MySQL 삽입 오류:", err);
                    return res.status(500).json({ error: err });
                }
                console.log("✅ 피드 저장 완료!", result);
                res.json({ success: true });
            });
        });

    } catch (error) {
        console.error("🔥 서버 오류 발생:", error);
        res.status(500).json({ error: "Internal Server Error", details: error.message });
    }
});



// ✅ 피드 목록 (이름 표시)
app.get('/feed/feeds', (req, res) => {
    const sql = `
        SELECT feeds.*, users.name, 
               COALESCE(users.profile_image, 'https://placehold.co/40x40') AS profile_image
        FROM feeds 
        JOIN users ON feeds.user_id = users.id 
        ORDER BY feeds.created_at DESC
    `;

    db.query(sql, (err, results) => {
        if (err) {
            console.error("❌ 전체 피드 조회 오류:", err);
            return res.status(500).json({ error: "피드 조회 실패" });
        }
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
// ✅ 내정보 수정관련 (이름 표시)
app.post('/feed/update-profile', upload.single('profile_image'), async (req, res) => {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ error: "Unauthorized" });

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const { current_password, new_password, confirm_password, phone, birth_date } = req.body;

        console.log("✅ [내정보 수정 요청] user_id:", decoded.user_id);

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

        async function updateUserProfile(user_id, newPassword) {
            let profile_url = null;

            if (req.file) {
                profile_url = await uploadToFirebase(req.file, "profiles");  // 🔥 **공개 URL 적용**
            }

            const sql = `
                UPDATE users SET 
                password = COALESCE(?, password), 
                phone = COALESCE(?, phone),
                birth_date = COALESCE(?, birth_date),
                profile_image = COALESCE(?, profile_image)
                WHERE id = ?
            `;

            db.query(sql, [newPassword, phone, birth_date, profile_url, user_id], (err, result) => {
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
// ✅ 댓글 조회 API (GET /feed/comments/:feedId)
app.get('/feed/comments/:feedId', (req, res) => {
    const { feedId } = req.params;

    const sql = `
        SELECT comments.id, comments.feed_id, comments.user_id, comments.content, comments.parent_id, comments.created_at, 
               users.name
        FROM comments
        JOIN users ON comments.user_id = users.id
        WHERE comments.feed_id = ?
        ORDER BY COALESCE(comments.parent_id, comments.id), comments.created_at ASC
    `;

    db.query(sql, [feedId], (err, results) => {
        if (err) {
            console.error("🔥 [댓글] 불러오기 오류:", err);
            return res.status(500).json({ error: "댓글을 불러올 수 없습니다." });
        }

        res.json(results);
    });
});



// ✅ 댓글 추가 API (POST /feed/add-comment)
app.post('/feed/add-comment', (req, res) => {
    const { feed_id, content, parent_id } = req.body;
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ error: "Unauthorized" });

    try {
        const decoded = jwt.verify(token, JWT_SECRET);

        const sql = "INSERT INTO comments (feed_id, user_id, content, parent_id) VALUES (?, ?, ?, ?)";
        db.query(sql, [feed_id, decoded.user_id, content, parent_id], (err, result) => {
            if (err) {
                console.error("🔥 댓글 추가 오류:", err);
                return res.status(500).json({ error: "댓글 추가 실패" });
            }

            // ✅ 댓글 개수 증가 후 업데이트된 값 반환
            db.query("UPDATE feeds SET comment_count = comment_count + 1 WHERE id = ?", [feed_id], () => {
                db.query("SELECT comment_count FROM feeds WHERE id = ?", [feed_id], (err, countResult) => {
                    if (err) {
                        console.error("🔥 댓글 카운트 업데이트 오류:", err);
                        return res.status(500).json({ error: "댓글 카운트 업데이트 실패" });
                    }

                    res.json({ success: true, comment_id: result.insertId, comment_count: countResult[0].comment_count });
                });
            });
        });

    } catch (error) {
        console.error("🔥 JWT 오류:", error);
        res.status(401).json({ error: "Invalid token" });
    }
});

app.post('/feed/delete-comment', (req, res) => {
    const { comment_id } = req.body;
    const token = req.headers.authorization?.split(" ")[1];

    if (!token) return res.status(401).json({ error: "Unauthorized" });

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        console.log("✅ [댓글 삭제] 요청 수신:", { comment_id, user_id: decoded.user_id });

        // ✅ 내 댓글인지 확인
        db.query("SELECT * FROM comments WHERE id = ?", [comment_id], (err, results) => {
            if (err || results.length === 0) return res.status(400).json({ error: "댓글이 존재하지 않음" });

            const comment = results[0];
            if (comment.user_id !== decoded.user_id) {
                return res.status(403).json({ error: "삭제 권한 없음" });
            }

            // ✅ 댓글 삭제
            db.query("DELETE FROM comments WHERE id = ?", [comment_id], (err) => {
                if (err) return res.status(500).json({ error: "댓글 삭제 실패" });

                // ✅ 댓글 개수 업데이트
                db.query("UPDATE feeds SET comment_count = (SELECT COUNT(*) FROM comments WHERE feed_id = ?) WHERE id = ?", [comment.feed_id, comment.feed_id], () => {
                    res.json({ success: true });
                });
            });
        });

    } catch (error) {
        console.error("🔥 [댓글 삭제] JWT 인증 오류:", error);
        res.status(401).json({ error: "Invalid token" });
    }
});


// ✅ 좋아요 API
app.post('/feed/like', (req, res) => {
    console.log("🔥 [like] 요청 수신:", req.body);
    const { feed_id } = req.body;
    const token = req.headers.authorization?.split(" ")[1];

    if (!token) {
        console.error("❌ [like] 인증 실패: 토큰 없음");
        return res.status(401).json({ error: "Unauthorized" });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        console.log("✅ [like] JWT 해독 성공:", decoded);

        db.beginTransaction((err) => {
            if (err) {
                console.error("🔥 [like] 트랜잭션 시작 오류:", err);
                return res.status(500).json({ error: "DB 오류" });
            }

            db.query("SELECT * FROM likes WHERE feed_id = ? AND user_id = ?", [feed_id, decoded.user_id], (err, results) => {
                if (err) {
                    console.error("🔥 [like] MySQL 조회 오류:", err);
                    return db.rollback(() => res.status(500).json({ error: "좋아요 실패" }));
                }

                if (results.length > 0) {
                    // ✅ 좋아요 취소
                    db.query("DELETE FROM likes WHERE feed_id = ? AND user_id = ?", [feed_id, decoded.user_id], (err) => {
                        if (err) return db.rollback(() => res.status(500).json({ error: "좋아요 취소 실패" }));

                        // ✅ 최신 `COUNT(*)` 값 조회 후 `like_count` 업데이트
                        db.query("SELECT COUNT(*) AS like_count FROM likes WHERE feed_id = ?", [feed_id], (err, countResult) => {
                            if (err) return db.rollback(() => res.status(500).json({ error: "좋아요 조회 실패" }));

                            const likeCount = countResult[0].like_count;
                            db.query("UPDATE feeds SET like_count = ? WHERE id = ?", [likeCount, feed_id], (err) => {
                                if (err) return db.rollback(() => res.status(500).json({ error: "좋아요 카운트 업데이트 실패" }));

                                console.log("✅ [like] 좋아요 취소 완료:", likeCount);
                                db.commit(() => res.json({ liked: false, like_count: likeCount }));
                            });
                        });
                    });

                } else {
                    // ✅ 좋아요 추가
                    db.query("INSERT INTO likes (feed_id, user_id) VALUES (?, ?)", [feed_id, decoded.user_id], (err) => {
                        if (err) return db.rollback(() => res.status(500).json({ error: "좋아요 추가 실패" }));

                        // ✅ 최신 `COUNT(*)` 값 조회 후 `like_count` 업데이트
                        db.query("SELECT COUNT(*) AS like_count FROM likes WHERE feed_id = ?", [feed_id], (err, countResult) => {
                            if (err) return db.rollback(() => res.status(500).json({ error: "좋아요 조회 실패" }));

                            const likeCount = countResult[0].like_count;
                            db.query("UPDATE feeds SET like_count = ? WHERE id = ?", [likeCount, feed_id], (err) => {
                                if (err) return db.rollback(() => res.status(500).json({ error: "좋아요 카운트 업데이트 실패" }));

                                console.log("✅ [like] 좋아요 추가 완료:", likeCount);
                                db.commit(() => res.json({ liked: true, like_count: likeCount }));
                            });
                        });
                    });
                }
            });
        });

    } catch (error) {
        console.error("🔥 [like] JWT 인증 오류:", error);
        res.status(401).json({ error: "Invalid token" });
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

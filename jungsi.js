const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const jwt = require('jsonwebtoken');
const path = require('path'); // ⭐️ 1. 'path' 모듈 추가

const app = express();
const port = 9090;

const JWT_SECRET = 'super-secret-key!!';

app.use(cors());
app.use(express.json());

const authMiddleware = (req, res, next) => {
    // ... (이 부분은 수정할 필요 없이 완벽해) ...
    console.log(`[jungsi 서버] ${req.path} 경로에 대한 인증 검사를 시작합니다.`);
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) {
        console.log(" -> [인증 실패] ❌ 토큰이 없습니다.");
        return res.status(401).json({ success: false, message: '인증 토큰이 필요합니다.' });
    }
    try {
        const decodedUser = jwt.verify(token, JWT_SECRET);
        req.user = decodedUser;
        console.log(` -> [인증 성공] ✅ 사용자: ${req.user.userid}, 다음 단계로 진행합니다.`);
        next();
    } catch (err) {
        console.log(" -> [인증 실패] ❌ 토큰이 유효하지 않습니다.");
        return res.status(403).json({ success: false, message: '토큰이 유효하지 않습니다.' });
    }
};

const db = mysql.createPool({
    host: '211.37.174.218',
    user: 'maxilsan',
    password: 'q141171616!',
    database: 'jungsi',
    charset: 'utf8mb4',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});


// --- API 목록 ---

// [API #1] 전체 학교 목록 조회
// [API #1] 전체 학교 목록 조회 (⭐️ 업그레이드 버전)
app.get('/jungsi/schools', authMiddleware, async (req, res) => {
    try {
        const sql = `
            SELECT 
                b.U_ID, b.대학명, b.학과명, 
                r.selection_rules, r.english_scores, r.history_scores 
            FROM \`26정시기본\` AS b 
            LEFT JOIN \`26정시반영비율\` AS r ON b.U_ID = r.U_ID 
            ORDER BY b.U_ID ASC
        `;
        const [schools] = await db.query(sql);
        res.json({ success: true, schools });
    } catch (err) {
        console.error("❌ 학교 목록 조회 오류:", err);
        res.status(500).json({ success: false, message: "DB 오류" });
    }
});

// ⭐️ 2. [API #2] 특정 학과 상세 정보 조회 (다시 추가!)
// 프론트에서 학교를 클릭했을 때 규칙을 불러오려면 꼭 필요해.
app.post('/jungsi/school-details', authMiddleware, async (req, res) => {
    const { U_ID } = req.body;
    if (!U_ID) {
        return res.status(400).json({ success: false, message: "U_ID가 필요합니다." });
    }
    try {
        const sql = `
            SELECT b.*, r.* FROM \`26정시기본\` AS b
            JOIN \`26정시반영비율\` AS r ON b.U_ID = r.U_ID
            WHERE b.U_ID = ?
        `;
        const [results] = await db.query(sql, [U_ID]);
        if (results.length === 0) {
            return res.status(404).json({ success: false, message: "해당 학과 정보를 찾을 수 없습니다." });
        }
        res.json({ success: true, data: results[0] });
    } catch (err) {
        console.error("❌ 학과 상세 조회 오류:", err);
        res.status(500).json({ success: false, message: "DB 오류" });
    }
});


// [API #3] 선택 규칙 저장
app.post('/jungsi/rules/set', authMiddleware, async (req, res) => {
    const { U_ID, rules } = req.body;
    if (!U_ID) {
        return res.status(400).json({ success: false, message: "U_ID가 필요합니다." });
    }
    if (rules !== null && typeof rules !== 'object') {
        return res.status(400).json({ success: false, message: "규칙은 JSON 객체 또는 null이어야 합니다." });
    }
    try {
        const sql = "UPDATE `26정시반영비율` SET `selection_rules` = ? WHERE `U_ID` = ?";
        const [result] = await db.query(sql, [JSON.stringify(rules), U_ID]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: "해당 학과를 찾을 수 없습니다." });
        }
        res.json({ success: true, message: `U_ID ${U_ID} 학과의 규칙이 저장되었습니다.` });
    } catch (err) {
        console.error("❌ 규칙 저장 오류:", err);
        res.status(500).json({ success: false, message: "DB 오류" });
    }
});

// ⭐️⭐️⭐️ [초강력 신규 API] 대량의 등급 점수를 한 번에 저장하는 API ⭐️⭐️⭐️
app.post('/jungsi/scores/bulk-save', authMiddleware, async (req, res) => {
    const { scores_data } = req.body; // [{ U_ID, type, text }, { ... }] 형태의 배열

    if (!Array.isArray(scores_data)) {
        return res.status(400).json({ success: false, message: "잘못된 데이터 형식입니다." });
    }

    const textToJson = (text) => { /* 이전과 동일 */ if (!text || text.trim() === '') return null; const scores = text.trim().split(/[\s,]+/).filter(Boolean); const scoreJson = {}; scores.forEach((score, index) => { if (index < 9) { scoreJson[String(index + 1)] = isNaN(parseFloat(score)) ? score : parseFloat(score); }}); return JSON.stringify(scoreJson); };

    try {
        // Promise.all로 모든 DB 업데이트를 동시에 실행 (엄청 빠름)
        await Promise.all(scores_data.map(item => {
            const englishJson = textToJson(item.english_text);
            const historyJson = textToJson(item.history_text);
            const sql = "UPDATE `26정시반영비율` SET `english_scores` = ?, `history_scores` = ? WHERE `U_ID` = ?";
            return db.query(sql, [englishJson, historyJson, item.U_ID]);
        }));

        res.json({ success: true, message: `${scores_data.length}개 학과의 등급 점수가 모두 저장되었습니다!` });
    } catch (err) {
        console.error("❌ 등급 점수 대량 저장 오류:", err);
        res.status(500).json({ success: false, message: "DB 대량 저장 중 오류 발생" });
    }
});


// ⭐️ 3. [웹페이지 제공 라우트]
// '/setting' 주소로 접속하면 setting.html 파일을 보여줌
app.get('/setting', (req, res) => {
    res.sendFile(path.join(__dirname, 'setting.html'));
});


app.listen(port, () => {
    console.log(`정시 계산(jungsi) 서버가 ${port} 포트에서 실행되었습니다.`);
    console.log(`규칙 설정 페이지: http://localhost:${port}/setting`); // 주소 안내
});

const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const jwt = require('jsonwebtoken');

const app = express();
const port = 9090;

const JWT_SECRET = 'super-secret-key!!';

app.use(cors());
app.use(express.json());

const authMiddleware = (req, res, next) => {
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

// [신규 API] 정시 반영 선택 규칙을 설정(저장)하는 API
app.post('/jungsi/rules/set', authMiddleware, async (req, res) => {
    // 프론트에서 학과 U_ID와 설정할 규칙(JSON)을 받음
    const { U_ID, rules } = req.body;

    if (!U_ID) {
        return res.status(400).json({ success: false, message: "규칙을 설정할 학과의 U_ID가 필요합니다." });
    }

    // rules가 null이거나 객체/배열 형태인지 간단히 확인
    if (rules !== null && typeof rules !== 'object') {
        return res.status(400).json({ success: false, message: "규칙(rules)은 JSON 객체 또는 null이어야 합니다." });
    }

    console.log(`[규칙 설정] 학과 U_ID: ${U_ID}에 새로운 규칙을 저장합니다.`, rules);

    try {
        const sql = `
            UPDATE \`26정시반영비율\`
            SET \`selection_rules\` = ?
            WHERE \`U_ID\` = ?
        `;
        
        // rules 객체를 JSON 문자열로 변환해서 DB에 저장. null이면 null로 저장됨.
        const [result] = await db.query(sql, [JSON.stringify(rules), U_ID]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: "해당 U_ID를 가진 학과가 없어 규칙을 저장하지 못했습니다." });
        }

        res.json({
            success: true,
            message: `U_ID ${U_ID} 학과의 선택 반영 규칙이 성공적으로 저장되었습니다.`
        });

    } catch (err) {
        console.error("❌ 규칙 저장 중 DB 오류:", err);
        res.status(500).json({ success: false, message: "DB에 규칙을 저장하는 중 서버 오류가 발생했습니다." });
    }
});


app.listen(port, () => {
    console.log(`정시 계산(jungsi) 서버가 ${port} 포트에서 실행되었습니다.`);
});

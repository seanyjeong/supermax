const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise'); // promise()를 기본으로 사용하도록 변경
const jwt = require('jsonwebtoken'); // ⭐️ 1. jsonwebtoken 라이브러리 불러오기

const app = express();
const port = 9090;

// ⭐️ 2. 26susi 서버와 '반드시' 동일해야 하는 비밀키
const JWT_SECRET = 'super-secret-key!!'; 
// (주의: 실제 운영에서는こんな 간단한 키 대신 더 복잡한 키를 쓰고, .env 파일에 보관해야 안전해!)

app.use(cors());
app.use(express.json());

// ⭐️ 3. 26susi 서버의 authJWT 함수를 그대로 가져온 '인증 미들웨어'
// 이 함수가 jungsi 서버의 '문지기' 역할을 할 거야.
const authMiddleware = (req, res, next) => {
    console.log(`[jungsi 서버] ${req.path} 경로에 대한 인증 검사를 시작합니다.`);
    
    // 요청 헤더에서 토큰(신분증)을 꺼내 봄
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // "Bearer TOKEN" 형식에서 토큰 부분만 추출

    if (!token) {
        console.log(" -> [인증 실패] ❌ 토큰이 없습니다.");
        // 토큰이 없으면 문전박대
        return res.status(401).json({ success: false, message: '인증 토큰이 필요합니다.' });
    }

    // 토큰이 유효한지 비밀키로 검증
    try {
        // jwt.verify가 성공하면, 토큰에 담겨있던 사용자 정보가 해독되어 나옴
        const decodedUser = jwt.verify(token, JWT_SECRET);
        
        // 해독된 사용자 정보를 req 객체에 'user'라는 이름으로 저장
        // 이제 이 요청을 처리하는 모든 곳에서 req.user 로 사용자 정보 사용 가능
        req.user = decodedUser; 
        
        console.log(` -> [인증 성공] ✅ 사용자: ${req.user.userid}, 다음 단계로 진행합니다.`);
        next(); // 문 통과! 다음 로직 실행
    } catch (err) {
        console.log(" -> [인증 실패] ❌ 토큰이 유효하지 않습니다.");
        // 비밀키로 열어봤는데 안 열리면 가짜 신분증으로 판단하고 차단
        return res.status(403).json({ success: false, message: '토큰이 유효하지 않습니다.' });
    }
};


// --- DB 연결 설정 (기존과 동일) ---
const db = mysql.createPool({
    host: '211.37.174.218',
    user: 'maxilsan',
    password: 'q141171616!',
    database: 'jungsi', // jungsi 서버는 jungsi DB를 사용하도록 설정
    charset: 'utf8mb4',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// --- API 라우터 설정 ---

// 1. 인증이 필요 없는 테스트용 API (기존)
app.get('/jungsi/test', (req, res) => {
    res.json({ success: true, message: 'jungsi 서버는 정상 동작 중! (인증 불필요)' });
});

// ⭐️ 4. 인증이 '반드시' 필요한 정시 계산 API (예시)
// API 경로 중간에 authMiddleware 를 넣어주면, 이 API는 문지기의 검사를 통과해야만 실행됨!
app.post('/jungsi/calculate', authMiddleware, async (req, res) => {
    
    const loginUserId = req.user.userid;

    // 1. 프론트엔드에서 계산할 학과의 'U_ID'를 받는다고 가정
    const { U_ID } = req.body;

    if (!U_ID) {
        return res.status(400).json({ success: false, message: "계산할 학과의 U_ID가 필요합니다." });
    }

    console.log(`[계산 요청] 사용자: ${loginUserId}, 학과 U_ID: ${U_ID}`);

    try {
        // 2. DB에서 '학과 기본 정보'와 '계산 공식'을 한번에 조회 (JOIN 쿼리)
        const sql = `
            SELECT 
                b.university_name AS 대학명,
                b.department_name AS 학과명,
                r.* FROM \`26정시기본\` AS b
            JOIN \`26정시반영비율\` AS r ON b.U_ID = r.U_ID
            WHERE b.U_ID = ?
        `;
        
        const [results] = await db.query(sql, [U_ID]);

        // 3. 조회된 데이터가 있는지 확인
        if (results.length === 0) {
            return res.status(404).json({ success: false, message: "해당 학과의 정보를 찾을 수 없습니다." });
        }
        
        // 4. (오늘은 여기까지!) 조회한 데이터를 그대로 응답으로 보내주기
        const universityData = results[0];

        console.log(`[조회 성공]`, universityData);

        res.json({
            success: true,
            message: `U_ID ${U_ID} 학과 정보 조회 성공`,
            data: universityData 
        });

    } catch (err) {
        console.error("❌ 계산 정보 조회 중 DB 오류:", err);
        res.status(500).json({ success: false, message: "DB 조회 중 서버 오류가 발생했습니다." });
    }
});

app.listen(port, () => {
    console.log(`정시 계산(jungsi) 서버가 ${port} 포트에서 실행되었습니다.`);
});

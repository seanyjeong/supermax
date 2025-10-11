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
    database: 'jungsi_test', // jungsi 서버는 jungsi DB를 사용하도록 설정
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
    
    // 이 부분의 코드가 실행된다는 것은 이미 authMiddleware의 검증을 통과했다는 의미!
    // 그리고 req.user 에는 26susi 서버가 발급한 토큰의 정보가 그대로 들어있어.
    
    const loginUserId = req.user.userid; // 로그인한 사용자의 아이디
    const loginUserBranch = req.user.branch; // 로그인한 사용자의 지점

    console.log(`[계산 요청] ${loginUserBranch} 지점의 ${loginUserId} 님이 점수 계산을 요청했습니다.`);
    
    // 여기서부터 계산에 필요한 DB 조회 및 계산 로직을 구현하면 돼.
    // 예를 들어, loginUserId를 가지고 학생 성적을 DB에서 조회하는 등...
    
    const mockCalculatedScore = 987.65; // 계산 결과 예시

    res.json({
        success: true,
        message: `${loginUserId}님의 계산 결과입니다.`,
        score: mockCalculatedScore,
        requesting_user: req.user // 토큰에서 어떤 정보가 넘어왔는지 확인용
    });
});


app.listen(port, () => {
    console.log(`정시 계산(jungsi) 서버가 ${port} 포트에서 실행되었습니다.`);
});

const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const jwt = require('jsonwebtoken');
const path = require('path');
const fetch = require('node-fetch');
const multer = require('multer');
const fs = require('fs').promises;
const app = express();
const port = 9090;

const JWT_SECRET = 'super-secret-key!!';

app.use(cors());
app.use('/univlogos', express.static(path.join(__dirname, 'univlogos')));
app.use(express.json({ limit: '10mb' }));







// jungsi.js
const authMiddleware = (req, res, next) => {
    console.log(`[jungsi 서버] ${req.path} 경로에 대한 인증 검사를 시작합니다.`);
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) {
        console.log(` -> [인증 실패] ❌ 토큰 없음.`);
        return res.status(401).json({ success: false, message: '인증 토큰이 필요합니다.' });
    }

    try {
        req.user = jwt.verify(token, JWT_SECRET);
        const user = req.user;

        // ✅ 학생 계정 차단 (정시엔진 접근 불가)
        // if (user.role === 'student') {
        //     console.log(` -> [접근 차단] 🚫 학생 계정 (${user.userid}) 은 정시엔진 접근 불가`);
        //     return res.status(403).json({ success: false, message: '학생 계정은 정시엔진에 접근할 수 없습니다.' });
        // }

        // 🟢 인증 성공 로그
        console.log(` -> [인증 성공] ✅ 사용자: ${user.userid}, 지점: ${user.branch}, 역할: ${user.role} → 다음 단계로 진행`);
        next();

    } catch (err) {
        console.error(` -> [인증 실패] ❌ 토큰 검증 오류:`, err.name, err.message);
        return res.status(403).json({ success: false, message: '토큰이 유효하지 않습니다.' });
    }
};

const authStudentOnlyMiddleware = (req, res, next) => {
    console.log(`[jungsi 학생 인증] ${req.path} 경로 학생 인증 검사...`);
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) {
        return res.status(401).json({ success: false, message: '토큰 필요' });
    }
    try {
        const decoded = jwt.verify(token, JWT_SECRET); // 26susi.js와 SECRET이 같아야 함
        
        // 1. 학생이 아니면 차단
        if (decoded.role !== 'student') {
            return res.status(403).json({ success: false, message: '학생 전용 API입니다.' });
        }
        
        // 2. 정시 DB와 매핑 ID가 없으면 차단 (승인 안 된 학생)
        if (!decoded.jungsi_student_id) {
            return res.status(403).json({ success: false, message: '정시엔진에 매핑되지 않은 학생입니다. (승인 오류)' });
        }
        
        // ⭐️ 3. 성공: req 객체에 학생의 "정시 DB ID"를 주입
        req.student_id = decoded.jungsi_student_id; 
        req.user = decoded; // (기존 정보도 일단 유지)
        
        console.log(` -> [학생 인증 성공] ✅ 정시DB ID: ${req.student_id}`);
        next();
        
    } catch (err) {
        return res.status(403).json({ success: false, message: '토큰이 유효하지 않습니다.' });
    }
};

// =============================================
// ⭐️ [신규] 공유 링크 전용 인증 미들웨어
// =============================================
const authShareLinkMiddleware = (req, res, next) => {
    console.log(`[Share Link] ${req.path} 경로 공유 링크 인증 검사...`);
    
    // ⭐️ 중요: 프론트가 URL의 토큰을 헤더로 바꿔서 쏠 거임
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) {
        return res.status(401).json({ success: false, message: '인증 토큰이 필요합니다.' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        
        // 이 토큰이 'share_link' 용도인지, 필수 정보가 있는지 확인
        if (decoded.scope !== 'share_link' || !decoded.student_id || !decoded.year) {
            console.warn(` -> [인증 실패] ❌ 유효하지 않은 링크 타입/정보`);
            return res.status(403).json({ success: false, message: '유효하지 않은 링크입니다.' });
        }
        
        // ⭐️ req 객체에 공유 데이터를 주입
        req.share_data = {
            student_id: decoded.student_id,
            year: decoded.year,
            branch: decoded.branch
        };
        
        console.log(` -> [공유 링크 인증 성공] ✅ 학생ID: ${req.share_data.student_id}`);
        next();
        
    } catch (err) {
        console.error(` -> [인증 실패] ❌ 공유 토큰 검증 오류:`, err.name);
        // 토큰 만료, 서명 오류 등
        return res.status(403).json({ success: false, message: '링크가 만료되었거나 유효하지 않습니다.' });
    }
};


// =============================================
// ⭐️ [신규 API 1] 관리자용: 공유 링크(JWT) 생성 API
// (기존 /jungsi/counseling/wishlist/... API들 근처에 추가)
// =============================================
// POST /jungsi/counseling/generate-share-link
app.post('/jungsi/counseling/generate-share-link', authMiddleware, async (req, res) => {
    const { student_id, year } = req.body;
    const { branch } = req.user; // 관리자 지점

    console.log(`[API /generate-share-link] 학생(${student_id}, ${year}년도) 공유 링크 생성 요청 (요청자: ${branch})`);

    if (!student_id || !year) {
        return res.status(400).json({ success: false, message: '학생ID와 학년도가 필요합니다.' });
    }

    try {
        // (보안) 관리자가 자기 지점 학생이 맞는지 확인
        const [ownerCheck] = await db.query(
            'SELECT student_id FROM 학생기본정보 WHERE student_id = ? AND branch_name = ? AND 학년도 = ?',
            [student_id, branch, year]
        );
        if (ownerCheck.length === 0) {
            console.warn(` -> 권한 없음: 학생(${student_id})이 ${branch} 지점 소속(${year}학년도)이 아님.`);
            return res.status(403).json({ success: false, message: '해당 학생의 링크를 생성할 권한이 없습니다.' });
        }

        // 2. 공유용 JWT 생성 (학생ID, 학년도, 용도(scope) 포함)
        const shareToken = jwt.sign(
            {
                student_id: student_id,
                year: year,
                branch: branch,
                scope: 'share_link' // ⭐️ 중요: 이 토큰의 용도를 명시
            },
            JWT_SECRET,
            { expiresIn: '30d' } // ⭐️ 유효기간 30일 (원하는 대로 조절)
        );
            
        res.json({ success: true, token: shareToken });

    } catch (err) {
        console.error('❌ 공유 링크 생성 API 오류:', err);
        res.status(500).json({ success: false, message: '링크 생성 중 서버 오류 발생' });
    }
});


// =============================================
// ⭐️ [신규 API 2] 학생용: 공유된 상담 내역 조회 API
// (이건 /jungsi/public/... 경로에 두는 게 좋지만, 일단 여기에 둠)
// =============================================
// GET /jungsi/public/shared-wishlist
app.get('/jungsi/public/shared-wishlist', authShareLinkMiddleware, async (req, res) => {
    // ⭐️ 미들웨어가 검증하고 주입해준 정보 사용
    const { student_id, year } = req.share_data; 
    console.log(`[API /public/shared-wishlist] 학생(${student_id}, ${year}년도) 데이터 조회`);

    let connection;
    try {
        connection = await db.getConnection();

        // 1. 학생 기본 정보 조회 (이름 등 표시용)
        const [studentRows] = await connection.query(
            'SELECT student_name, school_name, gender FROM 학생기본정보 WHERE student_id = ? AND 학년도 = ?',
            [student_id, year]
        );
        if (studentRows.length === 0) {
            return res.status(404).json({ success: false, message: '학생 정보를 찾을 수 없습니다.' });
        }
        
        // 2. 상담 목록 조회 (기존 관리자 API의 SQL 재활용)
        const wishlistSql = `
            SELECT
                wl.모집군, wl.대학학과_ID,
                wl.상담_수능점수, wl.상담_내신점수, wl.상담_실기기록, wl.상담_실기반영점수,
                wl.상담_계산총점, wl.메모,
                jb.대학명, jb.학과명,
                jrb.수능, jrb.내신, jrb.실기 -- ⭐️ 비율 추가
            FROM jungsi.정시_상담목록 wl
            JOIN jungsi.정시기본 jb ON wl.대학학과_ID = jb.U_ID AND wl.학년도 = jb.학년도
            LEFT JOIN jungsi.정시반영비율 jrb ON wl.대학학과_ID = jrb.U_ID AND wl.학년도 = jrb.학년도 -- ⭐️ 비율 JOIN
            WHERE wl.학생_ID = ? AND wl.학년도 = ?
            ORDER BY FIELD(wl.모집군, '가', '나', '다'), wl.수정일시 DESC
        `;
        const [wishlistItems] = await connection.query(wishlistSql, [student_id, year]);

        console.log(` -> 학생 정보 및 상담 목록 ${wishlistItems.length}건 조회 완료`);

        // 3. 합쳐서 응답
        res.json({
            success: true,
            student: studentRows[0], // { student_name, ... }
            wishlist: wishlistItems  // [ { 모집군: '가', ... }, ... ]
        });

    } catch (err) {
        console.error(`❌ 공유 상담 내역 조회 API 오류 (학생ID: ${student_id}):`, err);
        res.status(500).json({ success: false, message: '데이터 조회 중 오류가 발생했습니다.' });
    } finally {
        if (connection) connection.release();
    }
});

// 1. 학생 공유 리포트 페이지 서빙
app.get('/student_report.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'student_report.html'));
});

// 2. 파비콘 502 에러 안 뜨게 무시 처리 (필수!)
app.get('/favicon.ico', (req, res) => res.status(204).end());
// ⭐️⭐️⭐️ [여기까지 추가] ⭐️⭐️⭐️

const dbSusi = mysql.createPool({
    host: '211.37.174.218',
    user: 'maxilsan',
    password: 'q141171616!',
    database: '26susi', // ⭐️ 26susi DB 연결
    charset: 'utf8mb4',
    waitForConnections: true,
    connectionLimit: 5, // (조회용이므로 5개 정도만)
    queueLimit: 0
});

const db = mysql.createPool({ host: '211.37.174.218', user: 'maxilsan', password: 'q141171616!', database: 'jungsi', charset: 'utf8mb4', waitForConnections: true, connectionLimit: 10, queueLimit: 0 });
const {
    calculateScoreWithConv, // 계산 함수
    safeParse,            // 유틸리티 함수
    loadYearHighestMap,     // 유틸리티 함수
    guessInquiryGroup       // 유틸리티 함수
    // 필요하다면 buildSpecialContext 등 다른 함수도 여기서 가져오기
} = require('./jungsical.js').helpers;

const dbStudent = mysql.createPool({
    host: '211.37.174.218',
    user: 'maxilsan',
    password: 'q141171616!',
    database: 'jungsimaxstudent',
    charset: 'utf8mb4'
});
// ⭐️ [핵심 1] jungsical.js 파일(계산기 부품)을 불러온다.
const jungsicalRouter = require('./jungsical.js')(db, authMiddleware);
// ⭐️ [신규] silgical.js 파일(실기 계산기 부품)을 불러온다.
const silgicalRouter = require('./silgical.js')(db, authMiddleware); //

// --- API 목록 ---
// ⭐️ [핵심 2] '/jungsi' 라는 주소로 들어오는 모든 요청은 jungsicalRouter(계산기 부품)에게 넘긴다.
app.use('/jungsi', jungsicalRouter);
app.use('/silgi', silgicalRouter);
const { buildPracticalScoreList } = require('./silgical.js');

// =============================================
// 레벨 시스템 유틸 함수
// =============================================

/**
 * 학생에게 경험치를 추가하고 레벨업 처리
 * @param {number} studentAccountId - 학생 계정 ID
 * @param {number} expToAdd - 추가할 경험치
 * @returns {Promise<{leveledUp: boolean, oldLevel: number, newLevel: number, currentExp: number, expForNextLevel: number}>}
 */
async function addExpAndCheckLevelUp(studentAccountId, expToAdd = 1) {
    try {
        // 1. 학생의 현재 레벨 정보 조회 (없으면 생성)
        let [studentLevel] = await dbStudent.query(
            `SELECT * FROM student_levels WHERE student_account_id = ?`,
            [studentAccountId]
        );

        // 학생 레벨 데이터가 없으면 초기화
        if (studentLevel.length === 0) {
            await dbStudent.query(
                `INSERT INTO student_levels (student_account_id, current_level, current_exp, total_exp_earned)
                 VALUES (?, 1, 0, 0)`,
                [studentAccountId]
            );
            [studentLevel] = await dbStudent.query(
                `SELECT * FROM student_levels WHERE student_account_id = ?`,
                [studentAccountId]
            );
        }

        const currentData = studentLevel[0];
        const oldLevel = currentData.current_level;
        let currentExp = currentData.current_exp + expToAdd;
        let currentLevel = currentData.current_level;
        const totalExpEarned = currentData.total_exp_earned + expToAdd;

        console.log(`[레벨시스템] 학생(${studentAccountId}) +${expToAdd} EXP | 현재: Lv.${currentLevel} (${currentExp} EXP)`);

        // 2. 레벨 요구사항 조회
        const [levelRequirements] = await dbStudent.query(
            `SELECT level, exp_required FROM level_requirements ORDER BY level ASC`
        );

        // 2-1. 레벨 다운 체크 (경험치가 음수인 경우)
        while (currentExp < 0 && currentLevel > 1) {
            currentLevel--;
            // 이전 레벨의 요구 경험치를 찾아서 더해줌
            const prevLevelReq = levelRequirements.find(req => req.level === currentLevel);
            if (prevLevelReq) {
                currentExp += prevLevelReq.exp_required;
                console.log(`📉 레벨다운! Lv.${currentLevel + 1} → Lv.${currentLevel} (${currentExp} EXP)`);
            }
        }

        // 레벨 1에서도 음수면 0으로 고정
        if (currentExp < 0) {
            currentExp = 0;
        }

        // 3. 레벨업 체크 및 처리
        let leveledUp = false;
        let newLevel = currentLevel;

        for (const req of levelRequirements) {
            if (req.level > currentLevel && currentExp >= req.exp_required) {
                // 레벨업!
                newLevel = req.level;
                currentLevel = req.level;
                leveledUp = true;

                // 레벨업 히스토리 기록
                await dbStudent.query(
                    `INSERT INTO student_level_history
                     (student_account_id, from_level, to_level, exp_at_levelup)
                     VALUES (?, ?, ?, ?)`,
                    [studentAccountId, oldLevel, newLevel, currentExp]
                );

                console.log(`🎉 레벨업! 학생(${studentAccountId}) Lv.${oldLevel} → Lv.${newLevel}`);
            }
        }

        // ⭐️ 최초 레벨 달성자 체크
        let isFirstAchiever = false;
        if (leveledUp) {
            try {
                // 해당 레벨을 최초로 달성했는지 확인
                const [existingAchiever] = await dbStudent.query(
                    `SELECT * FROM level_first_achievers WHERE level = ?`,
                    [newLevel]
                );

                if (existingAchiever.length === 0) {
                    // 최초 달성자!
                    const [studentInfo] = await dbStudent.query(
                        `SELECT name, branch FROM student_account WHERE account_id = ?`,
                        [studentAccountId]
                    );

                    if (studentInfo.length > 0) {
                        await dbStudent.query(
                            `INSERT INTO level_first_achievers (level, student_account_id, student_name, branch)
                             VALUES (?, ?, ?, ?)`,
                            [newLevel, studentAccountId, studentInfo[0].name, studentInfo[0].branch]
                        );
                        isFirstAchiever = true;
                        console.log(`🏆🏆🏆 최초 달성! 학생(${studentInfo[0].name}) Lv.${newLevel} 최초 달성자!`);
                    }
                }
            } catch (err) {
                console.error(`❌ 최초 달성자 체크 오류:`, err);
                // 에러가 나도 레벨업은 정상 진행
            }
        }

        // 4. 학생 레벨 정보 업데이트
        await dbStudent.query(
            `UPDATE student_levels
             SET current_level = ?, current_exp = ?, total_exp_earned = ?, updated_at = NOW()
             WHERE student_account_id = ?`,
            [currentLevel, currentExp, totalExpEarned, studentAccountId]
        );

        // 5. 다음 레벨까지 필요한 경험치 계산
        const nextLevelReq = levelRequirements.find(req => req.level > currentLevel);
        const expForNextLevel = nextLevelReq ? nextLevelReq.exp_required : null;

        return {
            leveledUp,
            isFirstAchiever,
            oldLevel,
            newLevel,
            currentLevel,
            currentExp,
            expForNextLevel,
            totalExpEarned,
            expAdded: expToAdd
        };

    } catch (err) {
        console.error(`❌ 레벨 시스템 처리 오류 (학생: ${studentAccountId}):`, err);
        throw err;
    }
}


// --- API 목록 ---
// [API #1] 특정 '학년도'의 전체 학교 목록 조회 (모든 규칙 포함 버전)
app.get('/jungsi/schools/:year', authMiddleware, async (req, res) => {
    const { year } = req.params;
    try {
        const sql = `
          SELECT
              b.U_ID,
              b.대학명,
              b.학과명,
              b.군,
              b.광역,
              b.시구,
              r.실기,
              r.selection_rules,
              r.bonus_rules,
              r.score_config,
              r.계산유형
          FROM \`정시기본\` AS b
          LEFT JOIN \`정시반영비율\` AS r
            ON b.U_ID = r.U_ID
           AND b.학년도 = r.학년도
          WHERE b.학년도 = ?
          ORDER BY b.U_ID ASC
        `;

        const [schools] = await db.query(sql, [year]);

        const list = schools.map(row => ({
            U_ID: row.U_ID,
            university: row.대학명,
            department: row.학과명,
            gun: row.군,
            광역: row.광역,
            시구: row.시구,
            실기: row.실기,
            selection_rules: row.selection_rules,
            bonus_rules: row.bonus_rules,
            score_config: row.score_config,
            계산유형: row.계산유형
        }));

        res.json({ success: true, list });
    } catch (err) {
        console.error("❌ 학교 목록 조회 오류:", err);
        res.status(500).json({ success: false, message: "DB 오류" });
    }
});

// jungsi.js 파일에서 이 부분을 찾아서 교체

app.post('/jungsi/school-details',  async (req, res) => { 
    const { U_ID, year } = req.body; 
    if (!U_ID || !year) { 
        return res.status(400).json({ success: false, message: "U_ID와 학년도(year)가 필요합니다." }); 
    } 
    
    try { 
        // 1. (기존) 기본 정보 + 반영 비율 조회
        const baseSql = `SELECT b.*, r.* FROM \`정시기본\` AS b JOIN \`정시반영비율\` AS r ON b.U_ID = r.U_ID AND b.학년도 = r.학년도 WHERE b.U_ID = ? AND b.학년도 = ?`;
        const [baseResults] = await db.query(baseSql, [U_ID, year]); 
        
        if (baseResults.length === 0) { 
            return res.status(404).json({ success: false, message: "해당 학과/학년도 정보를 찾을 수 없습니다." }); 
        } 
        
        // ⭐️ 기본 데이터를 변수에 저장
        const schoolData = baseResults[0];

        // 2. (신규) 실기 배점표 조회
        // (참고: 네 테이블 구조에 'index' 같은 정렬용 컬럼이 있다면 ORDER BY에 추가해)
        const scoreTableSql = "SELECT * FROM `정시실기배점` WHERE U_ID = ? AND 학년도 = ? ORDER BY 종목명, 성별, 기록"; // 👈 정시실기배점 테이블 조회
        const [scoreTableRows] = await db.query(scoreTableSql, [U_ID, year]);

        // 3. (신규) 1번 결과에 2번 배점표 배열을 '실기배점' 키로 합치기
        schoolData.실기배점 = scoreTableRows; // 👈 이게 핵심!

        // 4. 합쳐진 데이터를 전송
        res.json({ success: true, data: schoolData }); 

    } catch (err) { 
        console.error("❌ 학과 상세 조회(배점표 포함) 오류:", err);
        res.status(500).json({ success: false, message: "DB 오류" }); 
    } 
});
app.post('/jungsi/rules/set', authMiddleware, async (req, res) => { const { U_ID, year, rules } = req.body; if (!U_ID || !year) { return res.status(400).json({ success: false, message: "U_ID와 학년도(year)가 필요합니다." }); } if (rules !== null && typeof rules !== 'object') { return res.status(400).json({ success: false, message: "규칙은 JSON 객체 또는 null이어야 합니다." }); } try { const sql = "UPDATE `정시반영비율` SET `selection_rules` = ? WHERE `U_ID` = ? AND `학년도` = ?"; const [result] = await db.query(sql, [JSON.stringify(rules), U_ID, year]); if (result.affectedRows === 0) { return res.status(404).json({ success: false, message: "해당 학과/학년도를 찾을 수 없습니다." }); } res.json({ success: true, message: `[${year}학년도] 선택 규칙이 저장되었습니다.` }); } catch (err) { console.error("❌ 규칙 저장 오류:", err); res.status(500).json({ success: false, message: "DB 오류" }); } });
app.post('/jungsi/bonus-rules/set', authMiddleware, async (req, res) => { const { U_ID, year, rules } = req.body; if (!U_ID || !year) { return res.status(400).json({ success: false, message: "U_ID와 학년도(year)가 필요합니다." }); } if (rules !== null && typeof rules !== 'object') { return res.status(400).json({ success: false, message: "가산점 규칙은 JSON 객체 또는 null이어야 합니다." }); } try { const sql = "UPDATE `정시반영비율` SET `bonus_rules` = ? WHERE `U_ID` = ? AND `학년도` = ?"; const [result] = await db.query(sql, [JSON.stringify(rules), U_ID, year]); if (result.affectedRows === 0) { return res.status(404).json({ success: false, message: "해당 학과/학년도를 찾을 수 없습니다." }); } res.json({ success: true, message: `[${year}학년도] 가산점 규칙이 저장되었습니다.` }); } catch (err) { console.error("❌ 가산점 규칙 저장 오류:", err); res.status(500).json({ success: false, message: "DB 오류" }); } });
app.post('/jungsi/score-config/set', authMiddleware, async (req, res) => { const { U_ID, year, config } = req.body; if (!U_ID || !year) { return res.status(400).json({ success: false, message: "U_ID와 학년도(year)가 필요합니다." }); } if (typeof config !== 'object') { return res.status(400).json({ success: false, message: "점수 반영 방식(config)은 JSON 객체여야 합니다." }); } try { const sql = "UPDATE `정시반영비율` SET `score_config` = ? WHERE `U_ID` = ? AND `학년도` = ?"; const [result] = await db.query(sql, [JSON.stringify(config), U_ID, year]); if (result.affectedRows === 0) { return res.status(404).json({ success: false, message: "해당 학과/학년도를 찾을 수 없습니다." }); } res.json({ success: true, message: `[${year}학년도] 점수 반영 방식이 저장되었습니다.` }); } catch (err) { console.error("❌ 점수 반영 방식 저장 오류:", err); res.status(500).json({ success: false, message: "DB 오류" }); } });
app.post('/jungsi/special-formula/set', authMiddleware, async (req, res) => { const { U_ID, year, formula_type, formula_text } = req.body; if (!U_ID || !year) { return res.status(400).json({ success: false, message: "U_ID와 학년도(year)가 필요합니다." }); } try { const sql = "UPDATE `정시반영비율` SET `계산유형` = ?, `특수공식` = ? WHERE `U_ID` = ? AND `학년도` = ?"; const formulaToSave = (formula_type === '특수공식') ? formula_text : null; const [result] = await db.query(sql, [formula_type, formulaToSave, U_ID, year]); if (result.affectedRows === 0) { return res.status(404).json({ success: false, message: "해당 학과/학년도를 찾을 수 없습니다." }); } res.json({ success: true, message: `[${year}학년도] 계산 유형이 저장되었습니다.` }); } catch (err) { console.error("❌ 특수 공식 저장 오류:", err); res.status(500).json({ success: false, message: "DB 오류" }); } });

app.post('/jungsi/other-settings/set', authMiddleware, async (req, res) => {
    const { U_ID, year, settings } = req.body;
    if (!U_ID || !year) {
        return res.status(400).json({ success: false, message: "U_ID와 학년도(year)가 필요합니다." });
    }
    if (typeof settings !== 'object') {
        return res.status(400).json({ success: false, message: "설정(settings)은 JSON 객체여야 합니다." });
    }
    try {
        const sql = "UPDATE `정시반영비율` SET `기타설정` = ? WHERE `U_ID` = ? AND `학년도` = ?";
        const [result] = await db.query(sql, [JSON.stringify(settings), U_ID, year]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: "해당 학과/학년도를 찾을 수 없습니다." });
        }
        res.json({ success: true, message: `[${year}학년도] 기타 설정이 저장되었습니다.` });
    } catch (err) {
        console.error("❌ 기타 설정 저장 오류:", err);
        res.status(500).json({ success: false, message: "DB 오류" });
    }
});
// ⭐️⭐️⭐️ [신규 API] 계산 방식('환산'/'직접') 저장 API ⭐️⭐️⭐️
app.post('/jungsi/calc-method/set', authMiddleware, async (req, res) => {
    const { U_ID, year, method } = req.body;
    if (!U_ID || !year || !method) { return res.status(400).json({ success: false, message: "U_ID, 학년도(year), 계산방식(method)이 필요합니다." }); }
    try {
        const sql = "UPDATE `정시반영비율` SET `계산방식` = ? WHERE `U_ID` = ? AND `학년도` = ?";
        const [result] = await db.query(sql, [method, U_ID, year]);
        if (result.affectedRows === 0) { return res.status(404).json({ success: false, message: "해당 학과/학년도를 찾을 수 없습니다." }); }
        res.json({ success: true, message: `[${year}학년도] 계산 방식이 저장되었습니다.` });
    } catch (err) {
        console.error("❌ 계산 방식 저장 오류:", err);
        res.status(500).json({ success: false, message: "DB 오류" });
    }
    
});

// ⭐️ 디버그 메모 조회 (특정 학년도 전체)
app.get('/jungsi/debug-notes', authMiddleware, async (req, res) => {
  try {
    const year = parseInt(req.query.year, 10);
    if (!year) return res.status(400).json({ success: false, message: 'year가 필요합니다.' });

    const [rows] = await db.query(
      'SELECT U_ID, 학년도, is_correct, memo, updated_at FROM `정시디버그메모` WHERE 학년도 = ?',
      [year]
    );
    // 맵으로 주면 프론트에서 쓰기 편함
    const notesMap = {};
    rows.forEach(r => { notesMap[r.U_ID] = { is_correct: r.is_correct, memo: r.memo || '', updated_at: r.updated_at }; });
    res.json({ success: true, notes: notesMap });
  } catch (err) {
    console.error('❌ debug-notes 조회 오류:', err);
    res.status(500).json({ success: false, message: 'DB 오류' });
  }
});

// ⭐️ 디버그 메모 저장/업데이트
app.post('/jungsi/debug-notes/set', authMiddleware, async (req, res) => {
  try {
    const { U_ID, year, is_correct, memo } = req.body;
    if (!U_ID || !year) return res.status(400).json({ success: false, message: 'U_ID, year가 필요합니다.' });
    const status = (is_correct === 'Y' || is_correct === 'N' || is_correct === '?') ? is_correct : '?';
    const text = (typeof memo === 'string') ? memo : '';

    await db.query(
      `INSERT INTO \`정시디버그메모\` (U_ID, 학년도, is_correct, memo)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE is_correct = VALUES(is_correct), memo = VALUES(memo)`
      , [U_ID, year, status, text]
    );
    res.json({ success: true, message: '디버그 메모 저장 완료' });
  } catch (err) {
    console.error('❌ debug-notes 저장 오류:', err);
    res.status(500).json({ success: false, message: 'DB 오류' });
  }
});



// ⭐️ [신규 API] 미달 처리 규칙 ('0점'/'최하점') 저장 API
app.post('/jungsi/oor-rule/set', authMiddleware, async (req, res) => {
    const { U_ID, year, rule } = req.body;
    if (!U_ID || !year || !rule) { 
        return res.status(400).json({ success: false, message: "U_ID, 학년도(year), 규칙(rule)이 필요합니다." }); 
    }
    if (rule !== '0점' && rule !== '최하점') {
        return res.status(400).json({ success: false, message: "규칙은 '0점' 또는 '최하점' 이어야 합니다." });
    }
    try {
        const sql = "UPDATE `정시반영비율` SET `미달처리` = ? WHERE `U_ID` = ? AND `학년도` = ?";
        const [result] = await db.query(sql, [rule, U_ID, year]);
        if (result.affectedRows === 0) { 
            return res.status(404).json({ success: false, message: "해당 학과/학년도를 찾을 수 없습니다." }); 
        }
        res.json({ success: true, message: `[${year}학년도] 미달 처리 규칙이 저장되었습니다.` });
    } catch (err) {
        console.error("❌ 미달 처리 규칙 저장 오류:", err);
        res.status(500).json({ success: false, message: "DB 오류" });
    }
});

// GET /jungsi/inquiry-conv/:U_ID/:year?kind=사탐|과탐
app.get('/jungsi/inquiry-conv/:U_ID/:year', authMiddleware, async (req, res) => {
  const { U_ID, year } = req.params;
  const kind = req.query.kind; // optional
  try {
    let sql = `SELECT 계열, 백분위, 변환표준점수 FROM \`정시탐구변환표준\` WHERE U_ID=? AND 학년도=?`;
    const params = [U_ID, year];
    if (kind === '사탐' || kind === '과탐') { sql += ` AND 계열=?`; params.push(kind); }
    sql += ` ORDER BY 계열, 백분위 DESC`;
    const [rows] = await db.query(sql, params);

    // 응답을 { '사탐': { percentile: score, ... }, '과탐': {...} } 형태로
    const pack = {};
    for (const r of rows) {
      if (!pack[r.계열]) pack[r.계열] = {};
      pack[r.계열][String(r.백분위)] = Number(r.변환표준점수);
    }
    res.json({ success: true, mappings: pack });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success:false, message:'조회 오류' });
  }
});

// POST /jungsi/inquiry-conv/bulk-save
// body: { year, U_ID, rows_text }
// rows_text 예시(탭/개행 구분): 
// "사탐\t100\t70\n사탐\t99\t69.08\n...\n과탐\t100\t70\n..."
app.post('/jungsi/inquiry-conv/bulk-save', authMiddleware, async (req, res) => {
  const { year, U_ID, rows_text } = req.body;
  if (!year || !U_ID || !rows_text) {
    return res.status(400).json({ success:false, message:'year, U_ID, rows_text 필요' });
  }
  const lines = rows_text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  if (!lines.length) return res.json({ success:true, message:'저장할 데이터가 없습니다.' });

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const upSQL = `
      INSERT INTO \`정시탐구변환표준\` (U_ID, 학년도, 계열, 백분위, 변환표준점수)
      VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE 변환표준점수=VALUES(변환표준점수), updated_at=CURRENT_TIMESTAMP
    `;

    let count = 0;
    for (const line of lines) {
      const parts = line.split(/\t|,|\s+/).filter(Boolean); // 탭, 콤마, 공백 모두 허용
      if (parts.length < 3) continue;
      const kind = parts[0];
      if (kind !== '사탐' && kind !== '과탐') continue;
      const pct = parseInt(parts[1], 10);
      const conv = Number(parts[2]);
      if (Number.isNaN(pct) || Number.isNaN(conv)) continue;
      await conn.query(upSQL, [U_ID, year, kind, pct, conv]);
      count++;
    }

    await conn.commit();
    res.json({ success:true, message:`${count}건 저장 완료` });
  } catch (e) {
    await conn.rollback();
    console.error(e);
    res.status(500).json({ success:false, message:'저장 중 오류' });
  } finally {
    conn.release();
  }
});

// GET /jungsi/inquiry-conv/schools/:year
app.get('/jungsi/inquiry-conv/schools/:year', authMiddleware, async (req, res) => {
  const { year } = req.params;
  try {
    const sql = `
      SELECT U_ID, GROUP_CONCAT(DISTINCT 계열 ORDER BY 계열) AS 계열들, COUNT(*) AS cnt
      FROM \`정시탐구변환표준\`
      WHERE 학년도=?
      GROUP BY U_ID
      ORDER BY U_ID
    `;
    const [rows] = await db.query(sql, [year]);
    res.json({ success:true, items: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success:false, message:'목록 조회 오류' });
  }
});

// --- 최고표점 조회: 특정 학년도/모형(3월/6월/9월/수능) ---
app.get('/jungsi/topmax/:year/:exam', authMiddleware, async (req, res) => {
  const { year, exam } = req.params; // exam: '3월'|'6월'|'9월'|'수능'
  try {
    const [rows] = await db.query(
      'SELECT 과목명, 최고점 FROM `정시최고표점` WHERE 학년도=? AND 모형=? ORDER BY 과목명',
      [year, exam]
    );
    const map = {};
    rows.forEach(r => { map[r.과목명] = Number(r.최고점); });
    res.json({ success: true, year, exam, data: map });
  } catch (e) {
    console.error('❌ 최고표점 조회 오류:', e);
    res.status(500).json({ success: false, message: 'DB 오류' });
  }
});

// --- 최고표점 벌크 저장(업서트) ---
app.post('/jungsi/topmax/bulk-save', authMiddleware, async (req, res) => {
  const { year, exam, scores } = req.body;
  // scores: { "화법과작문": 132, "언어와매체": 134, ... } 형태
  if (!year || !exam || !scores || typeof scores !== 'object') {
    return res.status(400).json({ success:false, message:'year, exam, scores 필요' });
  }
  try {
    const entries = Object.entries(scores).filter(([k,v]) => k && v !== '' && v != null);
    if (!entries.length) return res.json({ success:true, message:'저장할 데이터가 없습니다.' });

    const sql = `
      INSERT INTO \`정시최고표점\` (학년도, 모형, 과목명, 최고점)
      VALUES ${entries.map(()=>'(?,?,?,?)').join(',')}
      ON DUPLICATE KEY UPDATE 최고점=VALUES(최고점), updated_at=NOW()
    `;
    const params = entries.flatMap(([sub, val]) => [year, exam, sub, Number(val)]);
    await db.query(sql, params);
    res.json({ success:true, message:`[${year}/${exam}] ${entries.length}개 저장 완료` });
  } catch (e) {
    console.error('❌ 최고표점 저장 오류:', e);
    res.status(500).json({ success:false, message:'DB 오류' });
  }
});

// --- (선택) 과목 목록 제공: 프론트가 헤더 생성 용
app.get('/jungsi/topmax/subjects', authMiddleware, (req, res) => {
  const subjects = [
    '화법과작문','언어와매체',
    '확률과통계','미적분','기하',
    '생활과윤리','윤리와사상','한국지리','세계지리','동아시아사','세계사','정치와법','경제','사회문화',
    '생명과학1','생명과학2','화학1','화학2','물리1','물리2','지구과학1','지구과학2'
  ];
  res.json({ success:true, subjects });
});

// ⭐ 총점(만점) 저장 - 기존 행 UPDATE + 디버깅 로그 빵빵하게
app.post('/jungsi/total/set', authMiddleware, async (req, res) => {
  const tag = '[TOTAL/SET]';
  try {
    const { U_ID, year, total } = req.body;
    const uid = Number(U_ID);
    const yr  = String(year);
    const t   = Number(total);

    console.log(`${tag} ▶ 요청 수신:`, { U_ID: uid, year: yr, total: t, rawBody: req.body });

    if (!uid || !yr || !Number.isFinite(t) || t <= 0) {
      console.log(`${tag} ✖ 유효성 실패`);
      return res.status(400).json({ success: false, message: 'U_ID, year, total(양수 숫자)가 필요합니다.' });
    }

    // 0) 현재 행 존재/값 확인
    const [beforeRows] = await db.query(
      'SELECT U_ID, 학년도, 총점 FROM `정시반영비율` WHERE U_ID=? AND 학년도=?',
      [uid, yr]
    );
    console.log(`${tag} ◀ BEFORE:`, beforeRows);

    if (!beforeRows.length) {
      console.log(`${tag} ✖ 대상 행 없음 (신규 생성 금지 모드)`);
      return res.status(404).json({ success: false, message: '대상 레코드가 없습니다. (신규 생성은 하지 않습니다)' });
    }

    // 1) UPDATE 실행
    const [upd] = await db.query(
      'UPDATE `정시반영비율` SET `총점`=? WHERE `U_ID`=? AND `학년도`=?',
      [t, uid, yr]
    );
    console.log(`${tag} ✅ UPDATE 결과:`, {
      affectedRows: upd.affectedRows,
      changedRows : upd.changedRows
    });

    // 1-1) 경고 메시지 확인
    try {
      const [warn] = await db.query('SHOW WARNINGS');
      if (warn && warn.length) {
        console.log(`${tag} ⚠ WARNINGS:`, warn);
      }
    } catch (_) {
      // 호환 안 될 수 있음 – 무시
    }

    // 2) AFTER 확인
    const [afterRows] = await db.query(
      'SELECT U_ID, 학년도, 총점 FROM `정시반영비율` WHERE U_ID=? AND 학년도=?',
      [uid, yr]
    );
    console.log(`${tag} ▶ AFTER:`, afterRows);

    // 응답에도 before/after 같이 주면 프론트에서도 바로 확인 가능
    return res.json({
      success: true,
      message: `[${yr}] U_ID ${uid} 총점=${t} 업데이트 완료`,
      before: beforeRows,
      after : afterRows
    });
  } catch (err) {
    console.error('❌ 총점 저장(UPDATE) 오류:', err);
    return res.status(500).json({ success: false, message: '총점 저장 중 서버 오류', error: String(err && err.message) });
  }
});

// ⭐️ [신규 API] 특정 조건의 등급컷 데이터 불러오기
app.get('/jungsi/grade-cuts/get', authMiddleware, async (req, res) => {
    const { year, exam_type, subject } = req.query;
    if (!year || !exam_type || !subject) {
        return res.status(400).json({ success: false, message: '학년도, 모형, 과목명 파라미터가 필요합니다.' });
    }

    try {
        const [rows] = await db.query(
            `SELECT 원점수, 표준점수, 백분위, 등급 
             FROM \`정시예상등급컷\` 
             WHERE 학년도 = ? AND 모형 = ? AND 선택과목명 = ? 
             ORDER BY 원점수 DESC`, // 원점수 높은 순으로 정렬
            [year, exam_type, subject]
        );
        res.json({ success: true, cuts: rows });
    } catch (err) {
        console.error('❌ 등급컷 불러오기 API 오류:', err);
        res.status(500).json({ success: false, message: 'DB 조회 중 오류 발생' });
    }
});

// ⭐️ [수정된 API] 등급컷 데이터 벌크 저장 (진짜 "덮어쓰기")
app.post('/jungsi/grade-cuts/set-bulk', authMiddleware, async (req, res, next) => {
    const { year, exam_type, subject, cuts } = req.body;

    // 1. 기본 검증
    if (!year || !exam_type || !subject) {
        return res.status(400).json({
            success: false,
            message: '학년도(year), 모형(exam_type), 과목명(subject)이 필요합니다.'
        });
    }
    if (!cuts || !Array.isArray(cuts) || cuts.length === 0) {
        return res.status(400).json({
            success: false,
            message: '저장할 등급컷 데이터(cuts)가 없습니다.'
        });
    }

    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        // 2. 기존 데이터 싹 삭제 (이게 핵심)
        await conn.query(
            'DELETE FROM `정시예상등급컷` WHERE 학년도 = ? AND 모형 = ? AND 선택과목명 = ?',
            [year, exam_type, subject]
        );

        // 3. 새로 들어온 cuts를 한 번에 INSERT
        const values = cuts.map(cut => [
            year,
            exam_type,
            subject,
            cut.원점수,
            cut.표준점수,
            cut.백분위,
            cut.등급
        ]);

        const sql = `
            INSERT INTO \`정시예상등급컷\`
                (학년도, 모형, 선택과목명, 원점수, 표준점수, 백분위, 등급)
            VALUES ?
        `;
        const [result] = await conn.query(sql, [values]);

        await conn.commit();

        return res.json({
            success: true,
            message: `[${year} ${exam_type} ${subject}] 등급컷 ${result.affectedRows}건 저장(덮어쓰기) 완료`
        });

    } catch (err) {
        await conn.rollback();
        console.error('[grade-cuts/set-bulk] DB 오류:', err);
        // 기존 코드 스타일 유지하려면 next(err)도 가능
        return res.status(500).json({
            success: false,
            message: '등급컷 저장 중 오류가 발생했습니다.'
        });
    } finally {
        conn.release();
    }
});

app.post('/jungsi/students/scores/recompute', authMiddleware, async (req, res) => {
  const { year, exam_type = '수능', scope = 'branch', student_ids } = req.body;
  if (!year) return res.status(400).json({ success:false, message:'year 필요' });

  const { branch } = req.user;
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // 1) 등급컷 로드
    const [allCuts] = await conn.query(
      'SELECT 선택과목명, 원점수, 표준점수, 백분위, 등급 FROM `정시예상등급컷` WHERE 학년도=? AND 모형=?',
      [year, exam_type]
    );
    const cutsMap = new Map();
    for (const c of allCuts) {
      if (!cutsMap.has(c.선택과목명)) cutsMap.set(c.선택과목명, []);
      cutsMap.get(c.선택과목명).push(c);
    }

    // 2) 대상 학생(원점수/선택과목은 기존 테이블에서)
    let where = 's.학년도=?';
    const params = [year];
    if (scope === 'branch') { where += ' AND b.branch_name=?'; params.push(branch); }
    if (Array.isArray(student_ids) && student_ids.length) {
      where += ` AND s.student_id IN (${student_ids.map(()=>'?').join(',')})`;
      params.push(...student_ids);
    }
    const [rows] = await conn.query(
      `SELECT s.student_id,
              s.국어_선택과목, s.국어_원점수,
              s.수학_선택과목, s.수학_원점수,
              s.영어_원점수, s.한국사_원점수,
              s.탐구1_선택과목, s.탐구1_원점수,
              s.탐구2_선택과목, s.탐구2_원점수
       FROM \`학생수능성적\` s
       JOIN \`학생기본정보\` b ON b.student_id=s.student_id
       WHERE ${where}`, params
    );

    const { interpolateScore, getEnglishGrade, getHistoryGrade } = require('./utils/scoreEstimator.js');

    // 3) 재계산 + 업데이트
    for (const r of rows) {
      const pack = (subj, raw) => (raw!=null && subj && cutsMap.has(subj))
        ? interpolateScore(raw, cutsMap.get(subj)) : null;

      await conn.query(
        `UPDATE \`학생수능성적\` SET
           국어_표준점수=?, 국어_백분위=?, 국어_등급=?,
           수학_표준점수=?, 수학_백분위=?, 수학_등급=?,
           영어_등급=?,
           한국사_등급=?,
           탐구1_표준점수=?, 탐구1_백분위=?, 탐구1_등급=?,
           탐구2_표준점수=?, 탐구2_백분위=?, 탐구2_등급=?
         WHERE student_id=? AND 학년도=?`,
        [
          pack(r.국어_선택과목, r.국어_원점수)?.std ?? null,
          pack(r.국어_선택과목, r.국어_원점수)?.pct ?? null,
          pack(r.국어_선택과목, r.국어_원점수)?.grade ?? null,

          pack(r.수학_선택과목, r.수학_원점수)?.std ?? null,
          pack(r.수학_선택과목, r.수학_원점수)?.pct ?? null,
          pack(r.수학_선택과목, r.수학_원점수)?.grade ?? null,

          (r.영어_원점수!=null)   ? getEnglishGrade(r.영어_원점수)   : null,
          (r.한국사_원점수!=null) ? getHistoryGrade(r.한국사_원점수) : null,

          pack(r.탐구1_선택과목, r.탐구1_원점수)?.std ?? null,
          pack(r.탐구1_선택과목, r.탐구1_원점수)?.pct ?? null,
          pack(r.탐구1_선택과목, r.탐구1_원점수)?.grade ?? null,

          pack(r.탐구2_선택과목, r.탐구2_원점수)?.std ?? null,
          pack(r.탐구2_선택과목, r.탐구2_원점수)?.pct ?? null,
          pack(r.탐구2_선택과목, r.탐구2_원점수)?.grade ?? null,

          r.student_id, year
        ]
      );
    }

    await conn.commit();
    res.json({ success:true, year, exam_type, updated: rows.length });
  } catch (e) {
    await conn.rollback();
    console.error('❌ 재계산 오류:', e);
    res.status(500).json({ success:false, message:'재계산 중 오류' });
  } finally {
    conn.release();
  }
});

app.post('/jungsi/calc-practical', authMiddleware, async (req, res) => {
  try {
    const { U_ID, year, practical } = req.body;
    if (!U_ID || !year) {
      return res.status(400).json({ success:false, message:'U_ID, year 필요' });
    }

    // 1) 이 대학의 정시반영비율(=실기모드, 실기비중 등) 가져오기
    const [rows] = await db.query(
      "SELECT * FROM `정시반영비율` WHERE U_ID=? AND 학년도=?",
      [U_ID, year]
    );
    if (!rows.length) {
      return res.status(404).json({ success:false, message:'대학 정보 없음' });
    }
    const F = rows[0];

    // 2) 이 대학의 실기 배점표
    const [scoreRows] = await db.query(
      "SELECT * FROM `정시실기배점` WHERE U_ID=? AND 학년도=? ORDER BY 종목명, 성별, 기록",
      [U_ID, year]
    );

    // 3) 학생 실기 기록을 → 점수 배열로 변환 (silgical.js 헬퍼 사용)
    const silgical = require('./silgical.js');
    const list = silgical.buildPracticalScoreList(practical || [], scoreRows);

    // 4) 모드에 따라 분기
    const mode = F.실기모드 || 'basic';
    let practicalScore = 0;

    if (mode === 'special') {
      practicalScore = calcPracticalSpecial(F, list);
    } else {
      practicalScore = calcPracticalBasic(F, list);
    }

    // 5) 프론트는 종목별 배점 그대로 쓰니까 우리는 총점만 뱉어줌
    return res.json({
      success: true,
      mode,
      practicalScore,
      detail: list   // 이건 프론트가 필요하면 쓰고, 아니면 무시
    });

  } catch (err) {
    console.error('❌ /jungsi/calc-practical 오류:', err);
    return res.status(500).json({ success:false, message:'서버 오류', error:String(err) });
  }
});








// --- 웹페이지 제공 라우트 ---
app.get('/setting', (req, res) => { res.sendFile(path.join(__dirname, 'setting.html')); });
app.get('/bulk-editor', (req, res) => { res.sendFile(path.join(__dirname, 'scores_bulk_editor.html')); });

// ⭐️ [신규] 로그인 페이지 서빙 라우트
app.get('/jungsilogin', (req, res) => {
    res.sendFile(path.join(__dirname, 'jungsilogin.html'));
});



// ⭐️ [신규] 1단계에서 만든 헬퍼 함수들 불러오기
const { 
  interpolateScore, 
  getEnglishGrade, 
  getHistoryGrade 
} = require('./utils/scoreEstimator.js');

// ... (기존의 다른 app.get, app.post 코드들) ...

// ✅ 등급별 영어/한국사 벌크 저장 (score_config는 안 건드림)
app.post('/jungsi/score-config/set-bulk', authMiddleware, async (req, res) => {
  const { year, items } = req.body;

  // 1. 기본 검증
  if (!year || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'year, items 필요'
    });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    for (const row of items) {
      const { U_ID, english, history } = row;
      if (!U_ID) continue;

      // 이 학년도 + U_ID가 있는지 먼저 확인
      const [rows] = await conn.query(
        'SELECT 1 FROM `정시반영비율` WHERE U_ID = ? AND 학년도 = ?',
        [U_ID, year]
      );
      if (!rows.length) {
        // 없으면 스킵 (여기서 INSERT 하고 싶으면 INSERT 문 추가)
        continue;
      }

      // ✅ 영어만 온 경우
      if (english && typeof english === 'object') {
        await conn.query(
          'UPDATE `정시반영비율` SET `english_scores` = ? WHERE U_ID = ? AND 학년도 = ?',
          [JSON.stringify(english), U_ID, year]
        );
      }

      // ✅ 한국사만 온 경우
      if (history && typeof history === 'object') {
        await conn.query(
          'UPDATE `정시반영비율` SET `history_scores` = ? WHERE U_ID = ? AND 학년도 = ?',
          [JSON.stringify(history), U_ID, year]
        );
      }

      // ✅ 둘 다 온 경우는 위에서 둘 다 실행됨
    }

    await conn.commit();
    return res.json({
      success: true,
      message: `${items.length}건 처리 (score_config는 안 건드림)`
    });
  } catch (e) {
    await conn.rollback();
    console.error('❌ score-config set-bulk 오류:', e);
    return res.status(500).json({
      success: false,
      message: '저장 중 오류'
    });
  } finally {
    conn.release();
  }
});



// ⭐️⭐️⭐️ [신규 API] 가채점 성적 저장 (Wide 포맷) ⭐️⭐️⭐️
app.post('/jungsi/student/score/set-wide', authMiddleware, async (req, res) => {
    // 1. 토큰에서 branch 이름(branch_name) 가져오기
    const { branch } = req.user; // 예: '일산'
    if (!branch) {
        // 인증 실패: 토큰에 지점 이름 정보가 없음
        return res.status(403).json({ success: false, message: '토큰에 지점 정보(branch name)가 없습니다.' });
    }

    // 2. 프론트에서 보낸 데이터 받기 (이전과 동일)
    const {
        student_id, 학년도, student_name, school_name, grade, gender, 입력유형, scores
    } = req.body;

    if (!학년도 || !student_name || !scores) {
         return res.status(400).json({ success: false, message: '학년도, 학생명, 성적 정보는 필수입니다.' });
    }

    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        let currentStudentId = student_id;

        // 3. [학생기본정보] 테이블 처리 (신규/수정)
        if (currentStudentId) {
            // (수정 시나리오)
            // (보안) branch_name 기준으로 소유권 확인
            const [ownerCheck] = await conn.query(
                'SELECT student_id FROM `학생기본정보` WHERE student_id = ? AND branch_name = ?', // 👈 branch_name 컬럼 사용
                [currentStudentId, branch] // 👈 branch 이름(문자열) 사용
            );
            if (ownerCheck.length === 0) {
                await conn.rollback();
                return res.status(403).json({ success: false, message: '수정 권한이 없는 학생입니다.' });
            }
            
            await conn.query(
                `UPDATE \`학생기본정보\` SET 
                    student_name = ?, school_name = ?, grade = ?, gender = ?
                 WHERE student_id = ?`,
                [student_name, school_name, grade, gender, currentStudentId]
            );
        } else {
            // (신규 생성 시나리오)
            // ⭐️ 수정: branch_name 컬럼에 branch(이름) 저장
            const [insertResult] = await conn.query(
                `INSERT INTO \`학생기본정보\` 
                    (학년도, branch_name, student_name, school_name, grade, gender) 
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [학년도, branch, student_name, school_name, grade, gender] // 👈 branch 이름(문자열) 저장
            );
            currentStudentId = insertResult.insertId;
        }

        // 4. [점수 처리] 및 5. [학생수능성적] 테이블 저장 (이 부분은 이전과 동일)
        const [allCuts] = await conn.query(
            'SELECT 선택과목명, 원점수, 표준점수, 백분위, 등급 FROM `정시예상등급컷` WHERE 학년도 = ? AND 모형 = ?',
            [학년도, '수능'] // (모형은 '수능'으로 가정)
        );
        const cutsMap = new Map();
        allCuts.forEach(cut => {
            const key = cut.선택과목명;
            if (!cutsMap.has(key)) cutsMap.set(key, []);
            cutsMap.get(key).push(cut);
        });

        // (savedData 객체 생성 및 채우기 - 이전과 동일)
        const savedData = { 
            student_id: currentStudentId, 학년도: 학년도, 입력유형: 입력유형,
            국어_선택과목: scores.국어_선택과목, 국어_원점수: scores.국어_원점수,
            수학_선택과목: scores.수학_선택과목, 수학_원점수: scores.수학_원점수,
            영어_원점수: scores.영어_원점수, 한국사_원점수: scores.한국사_원점수,
            탐구1_선택과목: scores.탐구1_선택과목, 탐구1_원점수: scores.탐구1_원점수,
            탐구2_선택과목: scores.탐구2_선택과목, 탐구2_원점수: scores.탐구2_원점수,
            국어_표준점수: null, 국어_백분위: null, 국어_등급: null,
            수학_표준점수: null, 수학_백분위: null, 수학_등급: null,
            영어_등급: null, 한국사_등급: null,
            탐구1_표준점수: null, 탐구1_백분위: null, 탐구1_등급: null,
            탐구2_표준점수: null, 탐구2_백분위: null, 탐구2_등급: null,
        };
        if (scores.영어_원점수 != null) savedData.영어_등급 = getEnglishGrade(scores.영어_원점수);
        if (scores.한국사_원점수 != null) savedData.한국사_등급 = getHistoryGrade(scores.한국사_원점수);
        const relativeSubjects = [
            { prefix: '국어', score: scores.국어_원점수, subject: scores.국어_선택과목 },
            { prefix: '수학', score: scores.수학_원점수, subject: scores.수학_선택과목 },
            { prefix: '탐구1', score: scores.탐구1_원점수, subject: scores.탐구1_선택과목 },
            { prefix: '탐구2', score: scores.탐구2_원점수, subject: scores.탐구2_선택과목 },
        ];
        for (const s of relativeSubjects) {
            if (s.score != null && s.subject && cutsMap.has(s.subject)) {
                const cuts = cutsMap.get(s.subject);
                const estimated = interpolateScore(s.score, cuts);
                savedData[`${s.prefix}_표준점수`] = estimated.std;
                savedData[`${s.prefix}_백분위`] = estimated.pct;
                savedData[`${s.prefix}_등급`] = estimated.grade;
            }
        }

     // 5. [학생수능성적] 테이블 저장 (UPSERT - 컬럼명/업데이트 구문 명시)
        const sql = `
            INSERT INTO \`학생수능성적\` (
                student_id, 학년도, 입력유형,
                국어_선택과목, 국어_원점수, 국어_표준점수, 국어_백분위, 국어_등급,
                수학_선택과목, 수학_원점수, 수학_표준점수, 수학_백분위, 수학_등급,
                영어_원점수, 영어_등급,
                한국사_원점수, 한국사_등급,
                탐구1_선택과목, 탐구1_원점수, 탐구1_표준점수, 탐구1_백분위, 탐구1_등급,
                탐구2_선택과목, 탐구2_원점수, 탐구2_표준점수, 탐구2_백분위, 탐구2_등급
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                입력유형=VALUES(입력유형),
                국어_선택과목=VALUES(국어_선택과목), 국어_원점수=VALUES(국어_원점수), 국어_표준점수=VALUES(국어_표준점수), 국어_백분위=VALUES(국어_백분위), 국어_등급=VALUES(국어_등급),
                수학_선택과목=VALUES(수학_선택과목), 수학_원점수=VALUES(수학_원점수), 수학_표준점수=VALUES(수학_표준점수), 수학_백분위=VALUES(수학_백분위), 수학_등급=VALUES(수학_등급),
                영어_원점수=VALUES(영어_원점수), 영어_등급=VALUES(영어_등급),
                한국사_원점수=VALUES(한국사_원점수), 한국사_등급=VALUES(한국사_등급),
                탐구1_선택과목=VALUES(탐구1_선택과목), 탐구1_원점수=VALUES(탐구1_원점수), 탐구1_표준점수=VALUES(탐구1_표준점수), 탐구1_백분위=VALUES(탐구1_백분위), 탐구1_등급=VALUES(탐구1_등급),
                탐구2_선택과목=VALUES(탐구2_선택과목), 탐구2_원점수=VALUES(탐구2_원점수), 탐구2_표준점수=VALUES(탐구2_표준점수), 탐구2_백분위=VALUES(탐구2_백분위), 탐구2_등급=VALUES(탐구2_등급);
        `; // ⭐️ 세미콜론 추가 (선택사항이지만 권장)

        const params = [
            savedData.student_id, savedData.학년도, savedData.입력유형,
            savedData.국어_선택과목, savedData.국어_원점수, savedData.국어_표준점수, savedData.국어_백분위, savedData.국어_등급,
            savedData.수학_선택과목, savedData.수학_원점수, savedData.수학_표준점수, savedData.수학_백분위, savedData.수학_등급,
            savedData.영어_원점수, savedData.영어_등급,
            savedData.한국사_원점수, savedData.한국사_등급,
            savedData.탐구1_선택과목, savedData.탐구1_원점수, savedData.탐구1_표준점수, savedData.탐구1_백분위, savedData.탐구1_등급,
            savedData.탐구2_선택과목, savedData.탐구2_원점수, savedData.탐구2_표준점수, savedData.탐구2_백분위, savedData.탐구2_등급
        ];

        // ⭐️ 디버깅 로그 추가: 실행될 SQL과 파라미터 확인
        console.log("--- [DEBUG] Executing SQL ---");
        console.log("SQL:", sql);
        console.log("Params:", params);
        console.log("----------------------------");

        await conn.query(sql, params);
        
        // 6. 모든 작업 성공!
        await conn.commit();
        
        res.json({ 
            success: true, 
            message: '가채점 저장 및 변환 완료', 
            student_id: currentStudentId, 
            savedData: savedData 
        });

    } catch (err) {
        await conn.rollback();
        console.error('❌ 가채점 저장 API 오류:', err); 
        res.status(500).json({ success: false, message: '서버 오류 발생', error: err.message }); 
    } finally {
        conn.release();
    }
});

// 지점 학생 목록 + 기존 성적 불러오기 (학년도 필터 추가)
app.get('/jungsi/students/list-by-branch', authMiddleware, async (req, res) => {
    const { branch } = req.user; // 토큰에서 지점 이름
    const { year } = req.query; // URL 쿼리에서 학년도 가져오기 (예: ?year=2027)

    if (!branch) {
        return res.status(403).json({ success: false, message: '토큰에 지점 정보가 없습니다.' });
    }
    if (!year) {
         return res.status(400).json({ success: false, message: '학년도(year) 파라미터가 필요합니다.' });
    }

    try {
        // ⭐️ 수정: SELECT 목록에 b.phone_number, b.phone_owner 추가
        const sql = `
            SELECT
                b.student_id, b.student_name, b.school_name, b.grade, b.gender,
                b.phone_number, b.phone_owner, -- ⭐️ 전화번호, 연락처 구분 추가
                s.입력유형,
                s.국어_선택과목, s.국어_원점수, s.국어_표준점수, s.국어_백분위, s.국어_등급,
                s.수학_선택과목, s.수학_원점수, s.수학_표준점수, s.수학_백분위, s.수학_등급,
                s.영어_원점수, s.영어_등급,
                s.한국사_원점수, s.한국사_등급,
                s.탐구1_선택과목, s.탐구1_원점수, s.탐구1_표준점수, s.탐구1_백분위, s.탐구1_등급,
                s.탐구2_선택과목, s.탐구2_원점수, s.탐구2_표준점수, s.탐구2_백분위, s.탐구2_등급
            FROM 학생기본정보 b
            LEFT JOIN 학생수능성적 s ON b.student_id = s.student_id AND b.학년도 = s.학년도 -- JOIN 조건에 학년도 추가
            WHERE b.branch_name = ?
              AND b.학년도 = ?  -- WHERE 절에도 학년도 조건 추가
            ORDER BY b.student_name ASC;
        `;
        const [students] = await db.query(sql, [branch, year]); // 파라미터로 year 전달

        // 프론트엔드가 쓰기 편하게 가공
        const formattedStudents = students.map(s => {
            // scores 객체 생성 로직 (null 처리 포함)
            const scoresData = s.입력유형 ? {
                    입력유형: s.입력유형,
                    // ... (기존 성적 필드들) ...
                    국어_선택과목: s.국어_선택과목, 국어_원점수: s.국어_원점수, 국어_표준점수: s.국어_표준점수, 국어_백분위: s.국어_백분위, 국어_등급: s.국어_등급,
                    수학_선택과목: s.수학_선택과목, 수학_원점수: s.수학_원점수, 수학_표준점수: s.수학_표준점수, 수학_백분위: s.수학_백분위, 수학_등급: s.수학_등급,
                    영어_원점수: s.영어_원점수, 영어_등급: s.영어_등급,
                    한국사_원점수: s.한국사_원점수, 한국사_등급: s.한국사_등급,
                    탐구1_선택과목: s.탐구1_선택과목, 탐구1_원점수: s.탐구1_원점수, 탐구1_표준점수: s.탐구1_표준점수, 탐구1_백분위: s.탐구1_백분위, 탐구1_등급: s.탐구1_등급,
                    탐구2_선택과목: s.탐구2_선택과목, 탐구2_원점수: s.탐구2_원점수, 탐구2_표준점수: s.탐구2_표준점수, 탐구2_백분위: s.탐구2_백분위, 탐구2_등급: s.탐구2_등급
                } : null;

            return {
                student_id: s.student_id,
                student_name: s.student_name,
                school_name: s.school_name,
                grade: s.grade,
                gender: s.gender,
                phone_number: s.phone_number, // ⭐️ 추가
                phone_owner: s.phone_owner,   // ⭐️ 추가
                scores: scoresData
            };
        });

        res.json({ success: true, students: formattedStudents });

    } catch (err) {
        console.error('❌ 지점 학생 목록 조회 API 오류:', err);
        res.status(500).json({ success: false, message: '서버 오류 발생' });
    }
});

// ⭐️ [신규 API 2] 여러 학생 성적 일괄 저장/변환 (Bulk)
// jungsi.js 파일의 이 API 부분을 아래 코드로 교체하세요.

app.post('/jungsi/students/scores/bulk-set-wide', authMiddleware, async (req, res) => {
    const { branch } = req.user; // 인증된 지점 이름
    const { 학년도, 입력유형, studentScores } = req.body; // 프론트에서 보낸 데이터

    if (!학년도 || !입력유형 || !Array.isArray(studentScores) || studentScores.length === 0) {
        return res.status(400).json({ success: false, message: '학년도, 입력유형, 학생 성적 배열(studentScores)은 필수입니다.' });
    }

    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        // 보안 강화: 요청한 student_id들이 진짜 해당 branch 소속인지 미리 확인
        const studentIds = studentScores.map(s => s.student_id);
        const [validStudents] = await conn.query(
            'SELECT student_id FROM 학생기본정보 WHERE branch_name = ? AND student_id IN (?)',
            [branch, studentIds]
        );
        const validStudentIdSet = new Set(validStudents.map(s => s.student_id));

        // 등급컷 데이터 한 번에 로드
        const [allCuts] = await conn.query(
            'SELECT 선택과목명, 원점수, 표준점수, 백분위, 등급 FROM `정시예상등급컷` WHERE 학년도 = ? AND 모형 = ?',
            [학년도, '수능'] // 모형은 '수능'으로 가정
        );
        const cutsMap = new Map();
        allCuts.forEach(cut => {
            const key = cut.선택과목명;
            if (!cutsMap.has(key)) cutsMap.set(key, []);
            cutsMap.get(key).push(cut);
        });

        // 업데이트된 결과를 담을 배열
        const updatedResults = [];
        let updatedCount = 0;

        // SQL 쿼리 (루프 밖에서 한 번만 정의)
        const sql = `
            INSERT INTO \`학생수능성적\` (
                student_id, 학년도, 입력유형,
                국어_선택과목, 국어_원점수, 국어_표준점수, 국어_백분위, 국어_등급,
                수학_선택과목, 수학_원점수, 수학_표준점수, 수학_백분위, 수학_등급,
                영어_원점수, 영어_등급,
                한국사_원점수, 한국사_등급,
                탐구1_선택과목, 탐구1_원점수, 탐구1_표준점수, 탐구1_백분위, 탐구1_등급,
                탐구2_선택과목, 탐구2_원점수, 탐구2_표준점수, 탐구2_백분위, 탐구2_등급
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                입력유형=VALUES(입력유형), 국어_선택과목=VALUES(국어_선택과목), 국어_원점수=VALUES(국어_원점수), 국어_표준점수=VALUES(국어_표준점수), 국어_백분위=VALUES(국어_백분위), 국어_등급=VALUES(국어_등급),
                수학_선택과목=VALUES(수학_선택과목), 수학_원점수=VALUES(수학_원점수), 수학_표준점수=VALUES(수학_표준점수), 수학_백분위=VALUES(수학_백분위), 수학_등급=VALUES(수학_등급),
                영어_원점수=VALUES(영어_원점수), 영어_등급=VALUES(영어_등급), 한국사_원점수=VALUES(한국사_원점수), 한국사_등급=VALUES(한국사_등급),
                탐구1_선택과목=VALUES(탐구1_선택과목), 탐구1_원점수=VALUES(탐구1_원점수), 탐구1_표준점수=VALUES(탐구1_표준점수), 탐구1_백분위=VALUES(탐구1_백분위), 탐구1_등급=VALUES(탐구1_등급),
                탐구2_선택과목=VALUES(탐구2_선택과목), 탐구2_원점수=VALUES(탐구2_원점수), 탐구2_표준점수=VALUES(탐구2_표준점수), 탐구2_백분위=VALUES(탐구2_백분위), 탐구2_등급=VALUES(탐구2_등급);
        `;

        // 각 학생 데이터 처리
        for (const studentData of studentScores) {
            const student_id = studentData.student_id;
            const scores = studentData.scores; // { 국어_선택과목: ..., 국어_원점수: ... }

            // 보안 체크: 해당 지점 학생이 아니면 건너뛰기
            if (!validStudentIdSet.has(student_id)) {
                console.warn(`[Bulk Save] student_id ${student_id}는 ${branch} 지점 소속이 아니므로 건너<0xEB><0><0x8E>니다.`);
                continue;
            }

            // savedData 객체 생성 및 점수 변환
            const savedData = {
                student_id: student_id, 학년도: 학년도, 입력유형: 입력유형,
                국어_선택과목: scores.국어_선택과목, 국어_원점수: scores.국어_원점수,
                수학_선택과목: scores.수학_선택과목, 수학_원점수: scores.수학_원점수,
                영어_원점수: scores.영어_원점수, 한국사_원점수: scores.한국사_원점수,
                탐구1_선택과목: scores.탐구1_선택과목, 탐구1_원점수: scores.탐구1_원점수,
                탐구2_선택과목: scores.탐구2_선택과목, 탐구2_원점수: scores.탐구2_원점수,
                 // (계산될 값 초기화)
                국어_표준점수: null, 국어_백분위: null, 국어_등급: null,
                수학_표준점수: null, 수학_백분위: null, 수학_등급: null,
                영어_등급: null, 한국사_등급: null,
                탐구1_표준점수: null, 탐구1_백분위: null, 탐구1_등급: null,
                탐구2_표준점수: null, 탐구2_백분위: null, 탐구2_등급: null,
            };

            // 가채점('raw')일 경우 변환 실행
            if (입력유형 === 'raw') {
                if (scores.영어_원점수 != null) savedData.영어_등급 = getEnglishGrade(scores.영어_원점수);
                if (scores.한국사_원점수 != null) savedData.한국사_등급 = getHistoryGrade(scores.한국사_원점수);
                const relativeSubjects = [
                    { prefix: '국어', score: scores.국어_원점수, subject: scores.국어_선택과목 },
                    { prefix: '수학', score: scores.수학_원점수, subject: scores.수학_선택과목 },
                    { prefix: '탐구1', score: scores.탐구1_원점수, subject: scores.탐구1_선택과목 },
                    { prefix: '탐구2', score: scores.탐구2_원점수, subject: scores.탐구2_선택과목 },
                ];
                for (const s of relativeSubjects) {
                    if (s.score != null && s.subject && cutsMap.has(s.subject)) {
                        const cuts = cutsMap.get(s.subject);
                        const estimated = interpolateScore(s.score, cuts);
                        savedData[`${s.prefix}_표준점수`] = estimated.std;
                        savedData[`${s.prefix}_백분위`] = estimated.pct;
                        savedData[`${s.prefix}_등급`] = estimated.grade;
                    }
                }
            } else { // 실채점('official') 로직 (필요시 상세 구현)
                savedData.국어_표준점수=scores.국어_표준점수||null; savedData.국어_백분위=scores.국어_백분위||null; savedData.국어_등급=scores.국어_등급||null;
                savedData.수학_표준점수=scores.수학_표준점수||null; savedData.수학_백분위=scores.수학_백분위||null; savedData.수학_등급=scores.수학_등급||null;
                savedData.영어_등급=scores.영어_등급||getEnglishGrade(scores.영어_원점수); savedData.한국사_등급=scores.한국사_등급||getHistoryGrade(scores.한국사_원점수);
                savedData.탐구1_표준점수=scores.탐구1_표준점수||null; savedData.탐구1_백분위=scores.탐구1_백분위||null; savedData.탐구1_등급=scores.탐구1_등급||null;
                savedData.탐구2_표준점수=scores.탐구2_표준점수||null; savedData.탐구2_백분위=scores.탐구2_백분위||null; savedData.탐구2_등급=scores.탐구2_등급||null;
            }

            // --- ⭐️⭐️⭐️ 수정: params 배열 생성 위치를 루프 안으로 이동 ⭐️⭐️⭐️ ---
            const params = [
                savedData.student_id, savedData.학년도, savedData.입력유형,
                savedData.국어_선택과목, savedData.국어_원점수, savedData.국어_표준점수, savedData.국어_백분위, savedData.국어_등급,
                savedData.수학_선택과목, savedData.수학_원점수, savedData.수학_표준점수, savedData.수학_백분위, savedData.수학_등급,
                savedData.영어_원점수, savedData.영어_등급,
                savedData.한국사_원점수, savedData.한국사_등급,
                savedData.탐구1_선택과목, savedData.탐구1_원점수, savedData.탐구1_표준점수, savedData.탐구1_백분위, savedData.탐구1_등급,
                savedData.탐구2_선택과목, savedData.탐구2_원점수, savedData.탐구2_표준점수, savedData.탐구2_백분위, savedData.탐구2_등급
            ];
            // --- ⭐️⭐️⭐️ 수정 끝 ⭐️⭐️⭐️ ---

            await conn.query(sql, params); // DB 실행

            updatedResults.push(savedData); // 결과 배열에 추가
            updatedCount++;
        } // for 루프 끝

        // 모든 학생 처리 완료 후 커밋
        await conn.commit();

        res.json({
            success: true,
            message: `총 ${updatedCount}명의 학생 성적을 저장/변환했습니다.`,
            updatedData: updatedResults // 업데이트된 데이터 반환
        });

    } catch (err) {
        await conn.rollback(); // 에러 발생 시 롤백
        console.error('❌ 학생 성적 벌크 저장 API 오류:', err);
        res.status(500).json({ success: false, message: '서버 오류 발생', error: err.message });
    } finally {
        conn.release(); // 커넥션 반환
    }
});
app.post('/jungsi/students/bulk-add', authMiddleware, async (req, res) => {
    const { branch } = req.user; // 토큰에서 지점 이름
    if (!branch) {
        return res.status(403).json({ success: false, message: '토큰에 지점 정보가 없습니다.' });
    }

    // ⭐️ 수정: students 배열 안에 phone_number, phone_owner 포함 예상
    const { 학년도, students } = req.body; // students는 [{ student_name, school_name, phone_number, phone_owner, grade, gender }, ...] 배열

    // 필수 값 및 형식 검사
    if (!학년도 || !Array.isArray(students) || students.length === 0) {
        return res.status(400).json({ success: false, message: '학년도와 학생 정보 배열(students)은 필수입니다.' });
    }

    const conn = await db.getConnection();
    try {
        await conn.beginTransaction(); // 트랜잭션 시작

        let insertedCount = 0;
        const insertErrors = []; // 오류 발생 학생 저장

        // ⭐️ 수정: INSERT 쿼리에 phone_number, phone_owner 추가
        const sql = `
            INSERT INTO \`학생기본정보\`
                (학년도, branch_name, student_name, school_name, phone_number, phone_owner, grade, gender)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `;

        // 학생 배열 반복 처리
        for (const student of students) {
            // 각 학생 정보 유효성 검사 (서버에서도 한 번 더)
            if (!student.student_name || !student.grade || !student.gender) { // 이름, 학년, 성별은 필수
                insertErrors.push({ name: student.student_name || '이름 없음', reason: '필수 정보 누락 (이름/학년/성별)' });
                continue; // 다음 학생으로 건너뛰기
            }

            try {
                // ⭐️ 수정: INSERT 실행 파라미터에 phone_number, phone_owner 추가
                const params = [
                    학년도,
                    branch, // 토큰에서 가져온 지점 이름 사용
                    student.student_name,
                    student.school_name || null, // 학교명 (없으면 NULL)
                    student.phone_number || null, // 전화번호 (없으면 NULL)
                    student.phone_owner || '학생', // 연락처 구분 (없으면 '학생' 기본값)
                    student.grade,
                    student.gender
                ];
                // 쿼리 실행
                const [result] = await conn.query(sql, params);
                if (result.affectedRows > 0) {
                    insertedCount++; // 성공 카운트 증가
                }
            } catch (err) {
                 // 중복 등의 DB 오류 발생 시 로깅하고 건너뛰기
                 console.error(`[Bulk Add Error] Student: ${student.student_name}, Error: ${err.message}`);
                 // ⭐️ 수정: phone_owner 값 유효성 오류(ENUM)도 잡을 수 있게 DB 오류 메시지 포함
                 insertErrors.push({ name: student.student_name, reason: err.code === 'ER_DUP_ENTRY' ? '중복 의심' : `DB 오류(${err.code})` });
            }
        }

        // 모든 학생 처리 후 커밋 (최종 반영)
        await conn.commit();

        // 결과 메시지 생성
        let message = `총 ${insertedCount}명의 학생을 추가했습니다.`;
        if (insertErrors.length > 0) {
            message += ` (${insertErrors.length}명 오류 발생)`;
        }

        // 성공 응답 전송 (201 Created)
        res.status(201).json({
            success: true,
            message: message,
            insertedCount: insertedCount,
            errors: insertErrors // 어떤 학생이 왜 실패했는지 정보 전달
        });

    } catch (err) {
        // 트랜잭션 자체의 오류 발생 시 롤백 (모든 작업 취소)
        await conn.rollback();
        console.error('❌ 학생 일괄 추가 API 트랜잭션 오류:', err);
        res.status(500).json({ success: false, message: '서버 오류 발생', error: err.message });
    } finally {
        // DB 커넥션 반환
        conn.release();
    }
});
// ⭐️ [신규 API] 학생 정보 수정
app.put('/jungsi/students/update/:student_id', authMiddleware, async (req, res) => {
    const { branch } = req.user; // 토큰에서 지점 이름
    const { student_id } = req.params; // URL 경로에서 학생 ID 가져오기

    // ⭐️ 수정: 프론트에서 보낼 정보에 phone_number, phone_owner 추가
    const { student_name, school_name, grade, gender, phone_number, phone_owner } = req.body;

    // 필수 값 검사 (이름, 학년, 성별)
    if (!student_name || !grade || !gender) {
        return res.status(400).json({ success: false, message: '이름, 학년, 성별은 필수 입력 항목입니다.' });
    }
    // ⭐️ 추가: 연락처 구분 값 유효성 검사 (ENUM 값 확인)
    if (phone_owner && phone_owner !== '학생' && phone_owner !== '학부모') {
        return res.status(400).json({ success: false, message: "연락처 구분은 '학생' 또는 '학부모'여야 합니다." });
    }


    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        // 1. (보안) 수정하려는 학생이 진짜 이 지점 소속인지 확인
        const [ownerCheck] = await conn.query(
            'SELECT student_id FROM `학생기본정보` WHERE student_id = ? AND branch_name = ?',
            [student_id, branch]
        );
        if (ownerCheck.length === 0) {
            await conn.rollback(); // 롤백하고
            return res.status(403).json({ success: false, message: '수정 권한이 없는 학생입니다.' }); // 거부
        }

        // 2. ⭐️ 수정: 학생 정보 업데이트 SQL에 phone_number, phone_owner 추가
        const sql = `
            UPDATE \`학생기본정보\` SET
                student_name = ?,
                school_name = ?,
                grade = ?,
                gender = ?,
                phone_number = ?,
                phone_owner = ?
            WHERE student_id = ?
        `;
        // ⭐️ 수정: 파라미터에 phone_number, phone_owner 추가 (없으면 NULL, phone_owner 기본값 '학생')
        const params = [
            student_name,
            school_name || null,
            grade,
            gender,
            phone_number || null,
            phone_owner || '학생', // 값이 없거나 유효하지 않으면 '학생'으로
            student_id
        ];
        const [result] = await conn.query(sql, params);

        // 3. 커밋 (최종 반영)
        await conn.commit();

        if (result.affectedRows > 0) {
            res.json({ success: true, message: '학생 정보가 수정되었습니다.' });
        } else {
            // 이 경우는 거의 없지만 (ownerCheck에서 걸러지므로)
            res.status(404).json({ success: false, message: '해당 학생을 찾을 수 없습니다.' });
        }

    } catch (err) {
        await conn.rollback(); // 에러 시 롤백
        console.error('❌ 학생 수정 API 오류:', err);
        res.status(500).json({ success: false, message: '서버 오류 발생', error: err.message });
    } finally {
        conn.release(); // 커넥션 반환
    }
});

// =============================================
// ⭐️ 학생 삭제 API
// =============================================
// DELETE /jungsi/students/delete/:student_id
app.delete('/jungsi/students/delete/:student_id', authMiddleware, async (req, res) => {
    const { branch } = req.user; // 토큰에서 지점 이름
    const { student_id } = req.params; // URL 경로에서 삭제할 학생 ID 가져오기

    console.log(`[API DELETE /students/delete] 학생 ID(${student_id}) 삭제 요청 (요청자 지점: ${branch})`);

    if (!student_id) {
        return res.status(400).json({ success: false, message: '삭제할 학생 ID가 필요합니다.' });
    }

    let connection;
    try {
        // ⭐️⭐️⭐️ 중요: 학생 기본 정보는 jungsi DB에 있음! db 사용! ⭐️⭐️⭐️
        connection = await db.getConnection(); 
        await connection.beginTransaction(); // 트랜잭션 시작

        // 1. (보안) 삭제하려는 학생이 진짜 이 지점 소속인지 확인
        const [ownerCheck] = await connection.query(
            'SELECT student_id FROM 학생기본정보 WHERE student_id = ? AND branch_name = ?',
            [student_id, branch]
        );
        if (ownerCheck.length === 0) {
            await connection.rollback(); // 롤백하고
            console.warn(` -> 삭제 권한 없음: 학생(${student_id})이 ${branch} 지점 소속이 아님.`);
            return res.status(403).json({ success: false, message: '삭제 권한이 없는 학생입니다.' }); // 거부
        }

        // --- ⭐️⭐️⭐️ 중요: 관련 데이터 삭제 (jungsimaxstudent DB) ⭐️⭐️⭐️ ---
        // 학생 기본 정보를 지우기 전에 학생 DB의 관련 데이터를 먼저 지워야 함!
        
        // 예시: 학생수능성적 삭제 (jungsi DB) - 만약 ON DELETE CASCADE 없다면
        // await connection.query('DELETE FROM 학생수능성적 WHERE student_id = ?', [student_id]); 

        // 예시: 상담목록 삭제 (jungsi DB) - 만약 ON DELETE CASCADE 없다면
        // await connection.query('DELETE FROM 정시_상담목록 WHERE 학생_ID = ?', [student_id]);

        // 예시: 최종지원 삭제 (jungsi DB) - 만약 ON DELETE CASCADE 없다면
        // await connection.query('DELETE FROM 정시_최종지원 WHERE 학생_ID = ?', [student_id]);
        
        // // 예시: 학생 실기 기록 삭제 (jungsimaxstudent DB) - 다른 DB 풀 사용!
        // await dbStudent.query('DELETE FROM student_practical_records WHERE account_id = (SELECT account_id FROM jungsi.학생기본정보 WHERE student_id = ?)', [student_id]);
        // // 예시: 학생 실기 목표 삭제 (jungsimaxstudent DB)
        // await dbStudent.query('DELETE FROM student_practical_goals WHERE account_id = (SELECT account_id FROM jungsi.학생기본정보 WHERE student_id = ?)', [student_id]);
        // // 예시: 학생 실기 설정 삭제 (jungsimaxstudent DB)
        // await dbStudent.query('DELETE FROM student_practical_settings WHERE account_id = (SELECT account_id FROM jungsi.학생기본정보 WHERE student_id = ?)', [student_id]);
        // // 예시: 학생 저장 대학 삭제 (jungsimaxstudent DB)
        // await dbStudent.query('DELETE FROM student_saved_universities WHERE account_id = (SELECT account_id FROM jungsi.학생기본정보 WHERE student_id = ?)', [student_id]);
        // // 예시: 학생 점수 기록 삭제 (jungsimaxstudent DB)
        // await dbStudent.query('DELETE FROM student_score_history WHERE account_id = (SELECT account_id FROM jungsi.학생기본정보 WHERE student_id = ?)', [student_id]);
        // // --- ⭐️⭐️⭐️ 관련 데이터 삭제 끝 ⭐️⭐️⭐️ ---

        // 3. 학생 기본 정보 삭제 (jungsi DB)
        const deleteSql = 'DELETE FROM 학생기본정보 WHERE student_id = ?';
        const [result] = await connection.query(deleteSql, [student_id]);

        // 4. 커밋 (최종 반영)
        await connection.commit();

        if (result.affectedRows > 0) {
            console.log(` -> 학생 ID(${student_id}) 삭제 성공`);
            res.status(204).send(); // 성공 시 No Content
        } else {
            console.warn(` -> 삭제할 학생 없음 (ID: ${student_id})`);
            res.status(404).json({ success: false, message: '삭제할 학생을 찾을 수 없습니다.' });
        }

    } catch (err) {
        if (connection) await connection.rollback(); // 에러 시 롤백
        console.error('❌ 학생 삭제 API 오류:', err);
        res.status(500).json({ success: false, message: '서버 오류 발생', error: err.message });
    } finally {
        if (connection) connection.release(); // 커넥션 반환
    }
});


// jungsi.js 파일의 /jungsi/overview-configs/:year API 부분을 이걸로 교체

app.get('/jungsi/overview-configs/:year',  async (req, res) => {
    const { year } = req.params;
    if (!year) {
        return res.status(400).json({ success: false, message: '학년도 파라미터가 필요합니다.' });
    }

    try {
        // --- ⭐️ 수정: SELECT 목록에 r.계산유형 추가 ---
        const sql = `
            SELECT
                b.U_ID, b.대학명, b.학과명,
                r.score_config,
                r.총점,
                r.계산유형 -- ⭐️ 계산 유형 컬럼 추가
            FROM \`정시기본\` AS b
            LEFT JOIN \`정시반영비율\` AS r ON b.U_ID = r.U_ID AND b.학년도 = r.학년도
            WHERE b.학년도 = ?
            ORDER BY b.U_ID ASC;
        `;
        // --- ⭐️ 수정 끝 ---
        const [configs] = await db.query(sql, [year]);

        const formattedConfigs = configs.map(item => {
            let parsedConfig = {};
            // ... (score_config 파싱 로직은 동일) ...
            if (item.score_config) {
                if (typeof item.score_config === 'object' && item.score_config !== null) { parsedConfig = item.score_config; }
                else if (typeof item.score_config === 'string') { try { parsedConfig = JSON.parse(item.score_config); if (typeof parsedConfig !== 'object' || parsedConfig === null) { parsedConfig = {}; } } catch (e) { console.warn(`[API /overview-configs] U_ID ${item.U_ID} score_config 파싱 실패:`, item.score_config); parsedConfig = {}; } }
                else { console.warn(`[API /overview-configs] U_ID ${item.U_ID} score_config 타입 이상함:`, typeof item.score_config); parsedConfig = {}; }
            }

            return {
                U_ID: item.U_ID,
                대학명: item.대학명,
                학과명: item.학과명,
                score_config: parsedConfig,
                총점: item.총점 ? Number(item.총점) : 1000,
                계산유형: item.계산유형 || '기본비율' // ⭐️ 계산유형 값 추가 (없으면 '기본비율'로 가정)
            };
        });

        res.json({ success: true, configs: formattedConfigs });

    } catch (err) {
        console.error('❌ 개요 설정 조회 API 오류:', err);
        res.status(500).json({ success: false, message: 'DB 조회 중 오류 발생' });
    }
});

app.get('/jungsi/public/schools/:year', async (req, res) => { // ⭐️ authMiddleware 제거 (학생도 접근 가능해야 함)
    const { year } = req.params;
    const { region, teaching, exclude_events, exclude_subjects, inquiry_count } = req.query; 

    console.log(`[API /public/schools] Year: ${year}, Filters:`, req.query); // 로그 추가

    try {

        // =============================================
        // ⭐️ [수정] SQL: r.수능, r.내신, b.단계별 추가
        // =============================================
        let sql = `
            SELECT
                b.U_ID, b.대학명 AS university, b.학과명 AS department, b.군 AS gun,
                b.광역 AS regionWide, b.시구 AS regionLocal, b.교직 AS teacher,
                b.모집정원 AS quota,
                b.단계별 AS stageMultiple, -- ⭐️ 1단계 배수 표시용 (숫자 컬럼)
                
                r.실기 AS practicalRatio,
                r.수능 AS suneungRatio,     -- ⭐️ 수능 비율
                r.내신 AS naeshinRatio,     -- ⭐️ 내신 비율
                
                jov.국어_raw, jov.수학_raw, jov.영어_raw, jov.탐구_raw, jov.탐구수_raw, jov.한국사_raw,
                
                GROUP_CONCAT(DISTINCT ev.종목명 ORDER BY ev.종목명 SEPARATOR ',') AS events
            FROM 정시기본 b
            LEFT JOIN 정시반영비율 r ON b.U_ID = r.U_ID AND b.학년도 = r.학년도
            LEFT JOIN 정시실기배점 ev ON b.U_ID = ev.U_ID AND b.학년도 = ev.학년도
            LEFT JOIN 정시_원본반영표 jov ON b.U_ID = jov.매칭_U_ID AND b.학년도 = jov.학년도
        `;
        // =============================================

        const whereClauses = ['b.학년도 = ?'];
        const params = [year];

        // 지역 필터
        if (region) {
            const regions = region.split(',').map(r => r.trim()).filter(Boolean);
            if (regions.length > 0) {
                whereClauses.push('b.광역 IN (?)');
                params.push(regions);
            }
        }

         // 실기 종목 제외 필터
        if (exclude_events) {
            const eventsToExclude = exclude_events.split(',').map(e => e.trim()).filter(Boolean);
            if (eventsToExclude.length > 0) {
                whereClauses.push(`
                    b.U_ID NOT IN (
                        SELECT DISTINCT U_ID
                        FROM 정시실기배점
                        WHERE 학년도 = ? AND 종목명 IN (?)
                    )
                `);
                params.push(year, eventsToExclude);
            }
        }

        // 반영 과목 제외 필터
        if (exclude_subjects) {
            const subjectsToExclude = exclude_subjects.split(',').map(s => s.trim()).filter(Boolean);
            if (subjectsToExclude.includes('국어')) {
                whereClauses.push("(jov.국어_raw IS NULL OR jov.국어_raw = '' OR jov.국어_raw LIKE '(%)')");
            }
            if (subjectsToExclude.includes('수학')) {
                whereClauses.push("(jov.수학_raw IS NULL OR jov.수학_raw = '' OR jov.수학_raw LIKE '(%)')");
            }
            if (subjectsToExclude.includes('영어')) {
                whereClauses.push("(jov.영어_raw IS NULL OR jov.영어_raw = '' OR jov.영어_raw LIKE '(%)')");
            }
            if (subjectsToExclude.includes('탐구')) {
                whereClauses.push("(jov.탐구_raw IS NULL OR jov.탐구_raw = '' OR jov.탐구_raw LIKE '(%)')");
            }
        }
        
        // 탐구 개수 필터
        if (inquiry_count === '1' || inquiry_count === '2') {
             whereClauses.push('jov.탐구수_raw = ?');
             params.push(inquiry_count);
        }

        sql += ` WHERE ${whereClauses.join(' AND ')}`;
        
        // =============================================
        // ⭐️ [수정] GROUP BY 절 수정 (수능, 내신, 단계별 추가)
        // =============================================
        sql += ` GROUP BY b.U_ID, b.대학명, b.학과명, b.군, b.광역, b.시구, b.교직, b.모집정원, b.단계별,
                         r.실기, r.수능, r.내신,
                         jov.국어_raw, jov.수학_raw, jov.영어_raw, jov.탐구_raw, jov.탐구수_raw, jov.한국사_raw `;
        // =============================================
        
        sql += ` ORDER BY b.대학명, b.학과명 ASC`;

        console.log("Executing SQL:", sql);
        console.log("With Params:", params);

        const [rows] = await db.query(sql, params);

        console.log(` -> Found ${rows.length} universities matching criteria.`);

        // =============================================
        // ⭐️ [수정] formattedRows에 새 데이터 추가
        // =============================================
        const formattedRows = rows.map(row => ({
            ...row, 
            practicalRatio: row.practicalRatio ? Number(row.practicalRatio) : 0,
            suneungRatio: row.suneungRatio ? Number(row.suneungRatio) : 0,     // ⭐️ 추가
            naeshinRatio: row.naeshinRatio ? Number(row.naeshinRatio) : 0,     // ⭐️ 추가
            stageMultiple: row.stageMultiple || null,                         // ⭐️ 추가 (단계별)
            events: row.events ? row.events.split(',') : []
        }));
        // =============================================

        res.json({ success: true, universities: formattedRows });

    } catch (err) {
        console.error("❌ 공개 학교 목록 조회 오류 (v2):", err);
        res.status(500).json({ success: false, message: "DB 오류", error: err.message });
    }
});

// =============================================
// ⭐️ [신규] 특정 학생/학년도의 상담 목록 조회 API
// =============================================
// GET /jungsi/counseling/wishlist/:student_id/:year
app.get('/jungsi/counseling/wishlist/:student_id/:year', authMiddleware, async (req, res) => {
    // URL 경로에서 학생 ID와 학년도 추출
    const { student_id, year } = req.params;
    // 인증된 사용자(강사/관리자)의 지점 정보 가져오기 (권한 확인용)
    const { branch } = req.user;

    console.log(`[API GET /wishlist] 학생(${student_id}), 학년도(${year}) 상담 목록 조회 요청 (요청자 지점: ${branch})`);

    // 필수 파라미터 확인
    if (!student_id || !year) {
        return res.status(400).json({ success: false, message: '학생 ID와 학년도 파라미터가 필요합니다.' });
    }

    try {
        // --- 보안 검사: 요청한 학생이 해당 지점 소속인지 확인 ---
        const [ownerCheck] = await db.query(
            'SELECT student_id FROM 학생기본정보 WHERE student_id = ? AND branch_name = ? AND 학년도 = ?',
            [student_id, branch, year]
        );
        // 학생 정보가 없거나, 다른 지점 학생이면 권한 없음(403 Forbidden) 응답
        if (ownerCheck.length === 0) {
            console.warn(` -> 조회 권한 없음: 학생(${student_id})이 ${branch} 지점 소속(${year}학년도)이 아님.`);
            return res.status(403).json({ success: false, message: '조회 권한이 없는 학생입니다.' });
        }
        console.log(` -> 권한 확인 완료`);

        // --- 학생의 상담 목록 조회 ---
        const sql = `
            SELECT
                wl.상담목록_ID, wl.학생_ID, wl.학년도, wl.모집군, wl.대학학과_ID,
                wl.상담_수능점수, wl.상담_내신점수, wl.상담_실기기록, wl.상담_실기반영점수,
                wl.상담_계산총점, wl.메모, wl.수정일시,
                jb.대학명, jb.학과명 -- 정시기본 테이블에서 대학/학과명 JOIN
            FROM jungsi.정시_상담목록 wl
            JOIN jungsi.정시기본 jb ON wl.대학학과_ID = jb.U_ID AND wl.학년도 = jb.학년도
            WHERE wl.학생_ID = ? AND wl.학년도 = ?
            ORDER BY FIELD(wl.모집군, '가', '나', '다'), wl.수정일시 DESC -- 군별 정렬, 최신순 정렬
        `;
        const [wishlistItems] = await db.query(sql, [student_id, year]);

        console.log(` -> 상담 목록 ${wishlistItems.length}건 조회 완료`);

        // --- 결과 응답 ---
        res.json({ success: true, wishlist: wishlistItems });

    } catch (err) {
        console.error(`❌ 학생 상담 목록 조회 API 오류 (학생ID: ${student_id}, 학년도: ${year}):`, err);
        res.status(500).json({ success: false, message: 'DB 조회 중 오류가 발생했습니다.' });
    }
});
// --- 상담 목록 일괄 저장 (덮어쓰기: Delete then Insert) ---
app.post('/jungsi/counseling/wishlist/bulk-save', authMiddleware, async (req, res) => {
  const { 학생_ID, 학년도, wishlistItems } = req.body;
  if (!학생_ID || !학년도 || !Array.isArray(wishlistItems))
    return res.status(400).json({ success:false, message:'학생_ID/학년도/wishlistItems 필요' });

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction(); // --- 1. 트랜잭션 시작 ---

    // ⭐️⭐️⭐️ 2. [수정] 이 학생의 해당 년도 모든 목록을 먼저 삭제 ⭐️⭐️⭐️
    const deleteSql = 'DELETE FROM jungsi.정시_상담목록 WHERE 학생_ID = ? AND 학년도 = ?';
    await conn.query(deleteSql, [학생_ID, 학년도]);
    console.log(`[bulk-save] Cleared old wishlist for student ${학생_ID}, year ${학년도}`);


    // 3. [수정] ON DUPLICATE KEY UPDATE 구문이 필요 없는 단순 INSERT 쿼리로 변경
    const insertSql = `
      INSERT INTO jungsi.정시_상담목록
        (학생_ID, 학년도, 모집군, 대학학과_ID,
         상담_수능점수, 상담_내신점수, 상담_실기기록, 상담_실기반영점수,
         상담_계산총점)
      VALUES (?,?,?,?, ?,?,?,?, ?)
    `; 

    // 4. 새 목록을 INSERT (wishlistItems가 0개면 이 루프는 그냥 건너뜀)
    if (wishlistItems.length > 0) {
        for (const it of wishlistItems) {
          const silgiJSON = it.상담_실기기록 && Object.keys(it.상담_실기기록).length
            ? JSON.stringify(it.상담_실기기록) : null;

          await conn.query(insertSql, [ // ⭐️ insertSql 사용
            학생_ID, 학년도, it.모집군, it.대학학과_ID,
            it.상담_수능점수 ?? null,
            it.상담_내신점수 ?? null,
            silgiJSON,
            it.상담_실기반영점수 ?? null,
            it.상담_계산총점 ?? null
          ]);
        }
    }

    await conn.commit(); // --- 5. 커밋 ---
    console.log(`[bulk-save] Saved ${wishlistItems.length} new items.`);
    res.json({ success:true, saved:wishlistItems.length });
  } catch (e) {
    await conn.rollback(); // --- 6. 롤백 ---
    console.error('wishlist bulk-save error:', e);
    res.status(500).json({ success:false, message:'DB 오류' });
  } finally {
    conn.release();
  }
});



// --- 상담 목록 개별 삭제 ---
// DELETE /jungsi/counseling/wishlist/:wishlist_id
app.delete('/jungsi/counseling/wishlist/:wishlist_id', authMiddleware, async (req, res) => {
    const { wishlist_id } = req.params;
    const { branch } = req.user;

    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        // 보안: 삭제하려는 항목 소유권 확인
        const [ownerCheck] = await conn.query(
            `SELECT wl.상담목록_ID FROM 정시_상담목록 wl JOIN 학생기본정보 si ON wl.학생_ID = si.student_id
             WHERE wl.상담목록_ID = ? AND si.branch_name = ?`, [wishlist_id, branch]
        );
        if (ownerCheck.length === 0) {
            await conn.rollback();
            return res.status(403).json({ success: false, message: '삭제 권한이 없습니다.' });
        }

        // 삭제 실행
        const [result] = await conn.query('DELETE FROM 정시_상담목록 WHERE 상담목록_ID = ?', [wishlist_id]);
        await conn.commit();

        if (result.affectedRows > 0) {
            res.json({ success: true, message: '상담 목록에서 삭제되었습니다.' });
        } else {
            res.status(404).json({ success: false, message: '삭제할 항목을 찾을 수 없습니다.' });
        }
    } catch (err) {
        await conn.rollback();
        console.error('❌ 상담 목록 삭제 오류:', err);
        res.status(500).json({ success: false, message: 'DB 삭제 중 오류가 발생했습니다.' });
    } finally {
        conn.release();
    }
});

// =============================================
// ⭐️ 정시_최종지원 API (final_apply.html 용) - 생략 없음!
// =============================================

// --- 최종 지원 내역 조회 (특정 학생, 특정 학년도) ---
// GET /jungsi/final-apply/:student_id/:year
app.get('/jungsi/final-apply/:student_id/:year', authMiddleware, async (req, res) => {
    const { student_id, year } = req.params;
    const { branch } = req.user;
    try {
        // 보안: 해당 학생 소유권 확인
        const [ownerCheck] = await db.query(
            'SELECT student_id FROM 학생기본정보 WHERE student_id = ? AND branch_name = ? AND 학년도 = ?',
            [student_id, branch, year]
        );
        if (ownerCheck.length === 0) {
            return res.status(403).json({ success: false, message: '조회 권한이 없는 학생입니다.' });
        }

        // 최종 지원 내역 조회 (대학 정보 포함 JOIN)
        const sql = `
            SELECT
                fa.*,
                jb.대학명, jb.학과명
            FROM 정시_최종지원 fa
            JOIN 정시기본 jb ON fa.대학학과_ID = jb.U_ID AND fa.학년도 = jb.학년도
            WHERE fa.학생_ID = ? AND fa.학년도 = ?
            ORDER BY FIELD(fa.모집군, '가', '나', '다')
        `;
        const [applications] = await db.query(sql, [student_id, year]);

        res.json({ success: true, applications: applications });
    } catch (err) {
        console.error('❌ 최종 지원 내역 조회 오류:', err);
        res.status(500).json({ success: false, message: 'DB 조회 중 오류가 발생했습니다.' });
    }
});

// --- 최종 지원 내역 추가/수정 (군별 Upsert) ---
// POST /jungsi/final-apply/set
app.post('/jungsi/final-apply/set', authMiddleware, async (req, res) => {
    const {
        학생_ID, 학년도, 모집군, 대학학과_ID,
        지원_수능점수, 지원_내신점수, 지원_실기기록, 지원_실기총점, 지원_실기상세, 지원_총점,
        결과_1단계, 결과_최초, 결과_최종, 최종등록_여부, 메모
    } = req.body;
    const { branch } = req.user;

    // 필수 값 검사
    if (!학생_ID || !학년도 || !모집군 || !대학학과_ID) {
        return res.status(400).json({ success: false, message: '학생ID, 학년도, 모집군, 대학학과ID는 필수 항목입니다.' });
    }

    try {
        // 보안: 해당 학생 소유권 확인
        const [ownerCheck] = await db.query(
            'SELECT student_id FROM 학생기본정보 WHERE student_id = ? AND branch_name = ?',
            [학생_ID, branch]
        );
        if (ownerCheck.length === 0) {
            return res.status(403).json({ success: false, message: '저장 권한이 없는 학생입니다.' });
        }

        // 프론트에서 보낸 값만 사용 (상담목록 fallback 제거)
        const finalSuneungScore = 지원_수능점수;
        const finalTotalScore = 지원_총점;

        // Upsert 실행
        const sql = `
            INSERT INTO 정시_최종지원
                (학생_ID, 학년도, 모집군, 대학학과_ID, 지원_수능점수, 지원_내신점수, 지원_실기기록, 지원_실기총점, 지원_실기상세, 지원_총점,
                 결과_1단계, 결과_최초, 결과_최종, 최종등록_여부, 메모)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                대학학과_ID = VALUES(대학학과_ID), 지원_수능점수 = VALUES(지원_수능점수), 지원_내신점수 = VALUES(지원_내신점수),
                지원_실기기록 = VALUES(지원_실기기록), 지원_실기총점 = VALUES(지원_실기총점), 지원_실기상세 = VALUES(지원_실기상세),
                지원_총점 = VALUES(지원_총점), 결과_1단계 = VALUES(결과_1단계), 결과_최초 = VALUES(결과_최초), 결과_최종 = VALUES(결과_최종),
                최종등록_여부 = VALUES(최종등록_여부), 메모 = VALUES(메모), 수정일시 = CURRENT_TIMESTAMP
        `;
        const params = [
            학생_ID, 학년도, 모집군, 대학학과_ID,
            finalSuneungScore === undefined || finalSuneungScore === null ? null : Number(finalSuneungScore),
            지원_내신점수 === undefined || 지원_내신점수 === null ? null : Number(지원_내신점수),
            지원_실기기록 === undefined || 지원_실기기록 === null || Object.keys(지원_실기기록).length === 0 ? null : JSON.stringify(지원_실기기록),
            지원_실기총점 === undefined || 지원_실기총점 === null ? null : Number(지원_실기총점),
            지원_실기상세 === undefined || 지원_실기상세 === null ? null : JSON.stringify(지원_실기상세),
            finalTotalScore === undefined || finalTotalScore === null ? null : Number(finalTotalScore),
            결과_1단계 === undefined || 결과_1단계 === null ? '해당없음' : String(결과_1단계),
            결과_최초 === undefined || 결과_최초 === null ? '미정' : String(결과_최초),
            결과_최종 === undefined || 결과_최종 === null ? '미정' : String(결과_최종),
            최종등록_여부 === undefined || 최종등록_여부 === null ? false : Boolean(최종등록_여부),
            메모 === undefined || 메모 === null ? null : String(메모)
        ];
        const [result] = await db.query(sql, params);

        res.json({ success: true, message: '최종 지원 내역이 저장/수정되었습니다.', affectedRows: result.affectedRows });

    } catch (err) {
        console.error('❌ 최종 지원 내역 저장/수정 오류:', err);
        res.status(500).json({ success: false, message: 'DB 저장/수정 중 오류가 발생했습니다.' });
    }
});

// --- 최종 지원 결과만 업데이트 ---
// PUT /jungsi/final-apply/status/:application_id
app.put('/jungsi/final-apply/status/:application_id', authMiddleware, async (req, res) => {
    const { application_id } = req.params;
    const { 결과_1단계, 결과_최초, 결과_최종, 최종등록_여부, 메모 } = req.body;
    const { branch } = req.user;

    const updates = {};
    if (결과_1단계 !== undefined) updates.결과_1단계 = 결과_1단계 === null ? '해당없음' : String(결과_1단계);
    if (결과_최초 !== undefined) updates.결과_최초 = 결과_최초 === null ? '미정' : String(결과_최초);
    if (결과_최종 !== undefined) updates.결과_최종 = 결과_최종 === null ? '미정' : String(결과_최종);
    if (최종등록_여부 !== undefined) updates.최종등록_여부 = 최종등록_여부 === null ? false : Boolean(최종등록_여부);
    if (메모 !== undefined) updates.메모 = 메모 === null ? null : String(메모);

    if (Object.keys(updates).length === 0) {
        return res.status(400).json({ success: false, message: '수정할 결과 정보가 없습니다.' });
    }

    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        const [ownerCheck] = await conn.query(
            `SELECT fa.최종지원_ID FROM 정시_최종지원 fa JOIN 학생기본정보 si ON fa.학생_ID = si.student_id
             WHERE fa.최종지원_ID = ? AND si.branch_name = ?`, [application_id, branch]
        );
        if (ownerCheck.length === 0) {
            await conn.rollback();
            return res.status(403).json({ success: false, message: '수정 권한이 없습니다.' });
        }

        const setClauses = Object.keys(updates).map(key => `\`${key}\` = ?`).join(', ');
        const sql = `UPDATE 정시_최종지원 SET ${setClauses}, 수정일시 = CURRENT_TIMESTAMP WHERE 최종지원_ID = ?`;
        const params = [...Object.values(updates), application_id];
        const [result] = await conn.query(sql, params);
        await conn.commit();

        if (result.affectedRows > 0) {
            res.json({ success: true, message: '지원 결과가 업데이트되었습니다.' });
        } else {
            res.status(404).json({ success: false, message: '해당 지원 내역을 찾을 수 없습니다.' });
        }
    } catch (err) {
        await conn.rollback();
        console.error('❌ 지원 결과 업데이트 오류:', err);
        res.status(500).json({ success: false, message: 'DB 업데이트 중 오류가 발생했습니다.' });
    } finally {
        conn.release();
    }
});

// --- 최종 지원 내역 삭제 (군 단위로 삭제) ---
// DELETE /jungsi/final-apply/:student_id/:year/:gun
app.delete('/jungsi/final-apply/:student_id/:year/:gun', authMiddleware, async (req, res) => {
    const { student_id, year, gun } = req.params;
    const { branch } = req.user;
    const 모집군 = gun;

    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        const [ownerCheck] = await conn.query(
            'SELECT student_id FROM 학생기본정보 WHERE student_id = ? AND branch_name = ? AND 학년도 = ?',
            [student_id, branch, year]
        );
        if (ownerCheck.length === 0) {
            await conn.rollback();
            return res.status(403).json({ success: false, message: '삭제 권한이 없는 학생입니다.' });
        }

        const [result] = await conn.query(
            'DELETE FROM 정시_최종지원 WHERE 학생_ID = ? AND 학년도 = ? AND 모집군 = ?',
            [student_id, year, 모집군]
        );
        await conn.commit();

        if (result.affectedRows > 0) {
            res.json({ success: true, message: `[${year} ${모집군}] 최종 지원 내역이 삭제되었습니다.` });
        } else {
            res.json({ success: true, message: '삭제할 최종 지원 내역이 없습니다.' });
        }
    } catch (err) {
        await conn.rollback();
        console.error('❌ 최종 지원 내역 삭제 오류:', err);
        res.status(500).json({ success: false, message: 'DB 삭제 중 오류가 발생했습니다.' });
    } finally {
        conn.release();
    }
});

// =====================[ 수능 성적표 단체 입력: API ]=====================

// (공통) 입력유형이 'official'이면 원점수는 무시(NULL 강제)
const nullifyRawForOfficial = (x) => {
  if (x.입력유형 !== 'official') return x;
  return {
    ...x,
    국어_원점수: null,
    수학_원점수: null,
    영어_원점수: null,
    한국사_원점수: null,
    탐구1_원점수: null,
    탐구2_원점수: null,
  };
};

// [A] 학생 성적표(공식/가채점 구분) 여러 명 조회
// body: { year: "2026", student_ids: [1,2,3] }
app.post('/jungsi/scores/list', authMiddleware, async (req, res) => {
  const { year, student_ids } = req.body;
  if (!year || !Array.isArray(student_ids) || student_ids.length === 0) {
    return res.status(400).json({ success:false, message:'year, student_ids[] 필요' });
  }
  try {
    const marks = new Array(student_ids.length).fill('?').join(',');
    const [rows] = await db.query(
      `SELECT *
         FROM jungsi.학생수능성적
        WHERE 학년도 = ?
          AND student_id IN (${marks})`,
      [year, ...student_ids]
    );
    // 응답을 student_id => [rows] 맵으로
    const map = {};
    for (const r of rows) {
      const sid = r.student_id;
      if (!map[sid]) map[sid] = [];
      map[sid].push(r);
    }
    res.json({ success:true, data: map });
  } catch (e) {
    console.error('❌ /jungsi/scores/list 오류:', e);
    res.status(500).json({ success:false, message:'DB 오류' });
  }
});

// [B] 공식 성적 일괄 업서트 + raw→official 승격
// body: {
//   year:"2026",
//   items:[{
//     student_id, 입력유형:"official",
//     국어_선택과목, 국어_표준점수, 국어_백분위, 국어_등급,
//     수학_선택과목, 수학_표준점수, 수학_백분위, 수학_등급,
//     영어_등급,
//     한국사_등급,
//     탐구1_선택과목, 탐구1_표준점수, 탐구1_백분위, 탐구1_등급,
//     탐구2_선택과목, 탐구2_표준점수, 탐구2_백분위, 탐구2_등급
//   }, ...]
// }
app.post('/jungsi/scores/officialize-bulk', authMiddleware, async (req, res) => {
  const { year, items } = req.body;
  if (!year || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ success:false, message:'year, items[] 필요' });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const sql = `
      INSERT INTO jungsi.학생수능성적 (
        student_id, 학년도, 입력유형,
        국어_선택과목, 국어_원점수, 국어_표준점수, 국어_백분위, 국어_등급,
        수학_선택과목, 수학_원점수, 수학_표준점수, 수학_백분위, 수학_등급,
        영어_원점수, 영어_등급,
        한국사_원점수, 한국사_등급,
        탐구1_선택과목, 탐구1_원점수, 탐구1_표준점수, 탐구1_백분위, 탐구1_등급,
        탐구2_선택과목, 탐구2_원점수, 탐구2_표준점수, 탐구2_백분위, 탐구2_등급
      ) VALUES (?,?,?,?, ?,?,?,?, ?,?,?,?, ?,?, ?,?, ?,?,?,?, ?,?, ?,?,?,?, ?)
      ON DUPLICATE KEY UPDATE
        입력유형='official',
        국어_선택과목=VALUES(국어_선택과목),
        국어_원점수=NULL,  국어_표준점수=VALUES(국어_표준점수), 국어_백분위=VALUES(국어_백분위), 국어_등급=VALUES(국어_등급),
        수학_선택과목=VALUES(수학_선택과목),
        수학_원점수=NULL,  수학_표준점수=VALUES(수학_표준점수), 수학_백분위=VALUES(수학_백분위), 수학_등급=VALUES(수학_등급),
        영어_원점수=NULL,  영어_등급=VALUES(영어_등급),
        한국사_원점수=NULL, 한국사_등급=VALUES(한국사_등급),
        탐구1_선택과목=VALUES(탐구1_선택과목),
        탐구1_원점수=NULL,  탐구1_표준점수=VALUES(탐구1_표준점수), 탐구1_백분위=VALUES(탐구1_백분위), 탐구1_등급=VALUES(탐구1_등급),
        탐구2_선택과목=VALUES(탐구2_선택과목),
        탐구2_원점수=NULL,  탐구2_표준점수=VALUES(탐구2_표준점수), 탐구2_백분위=VALUES(탐구2_백분위), 탐구2_등급=VALUES(탐구2_등급)
    `;

    for (const raw of items) {
      const x = nullifyRawForOfficial({
        ...raw,
        입력유형: 'official'
      });

      await conn.query(sql, [
        x.student_id, year, x.입력유형,
        x.국어_선택과목 ?? null, x.국어_원점수 ?? null, x.국어_표준점수 ?? null, x.국어_백분위 ?? null, x.국어_등급 ?? null,
        x.수학_선택과목 ?? null, x.수학_원점수 ?? null, x.수학_표준점수 ?? null, x.수학_백분위 ?? null, x.수학_등급 ?? null,
        x.영어_원점수 ?? null, x.영어_등급 ?? null,
        x.한국사_원점수 ?? null, x.한국사_등급 ?? null,
        x.탐구1_선택과목 ?? null, x.탐구1_원점수 ?? null, x.탐구1_표준점수 ?? null, x.탐구1_백분위 ?? null, x.탐구1_등급 ?? null,
        x.탐구2_선택과목 ?? null, x.탐구2_원점수 ?? null, x.탐구2_표준점수 ?? null, x.탐구2_백분위 ?? null, x.탐구2_등급 ?? null,
      ]);
    }

    await conn.commit();
    res.json({ success:true, message:`${items.length}명 공식 성적 업로드/승격 완료` });
  } catch (e) {
    await conn.rollback();
    console.error('❌ /jungsi/scores/officialize-bulk 오류:', e);
    res.status(500).json({ success:false, message:'DB 오류', error:e.message });
  } finally {
    conn.release();
  }
});

app.get('/jungsi/counseling/stats/:U_ID/:year', authMiddleware, async (req, res) => {
    const { U_ID, year } = req.params;
    const { branch } = req.user;

    console.log(`[API /counseling/stats v3] U_ID: ${U_ID}, Year: ${year} 요청 (요청자 지점: ${branch})`);

    if (!U_ID || !year) {
        return res.status(400).json({ success: false, message: 'U_ID와 year 파라미터가 필요합니다.' });
    }

    try {
        // ⭐️ DB에서 해당 학과/학년도의 저장된 '상담_수능점수'만 바로 조회!
        const sql = `
            SELECT 상담_수능점수
            FROM 정시_상담목록
            WHERE 대학학과_ID = ? AND 학년도 = ? AND 상담_수능점수 IS NOT NULL
        `;
        const [rows] = await db.query(sql, [U_ID, year]); // connection 대신 db 직접 사용 가능

        if (rows.length === 0) {
            console.log(` -> 저장된 수능 점수 데이터 없음`);
            return res.json({ success: true, top10Score: null, totalCount: 0 });
        }

        // 점수만 추출하여 내림차순 정렬
        const scores = rows.map(r => Number(r.상담_수능점수)).sort((a, b) => b - a);
        const totalCount = scores.length;

        // 상위 10% 인덱스 계산
        const top10Index = Math.floor(totalCount * 0.1);

        let top10Score = null;
        if (totalCount > 0) {
             if (totalCount < 10) {
                 top10Score = scores[0]; // 10명 미만이면 최고점
                 console.log(` -> ${totalCount}명 (<10), 수능 최고점 반환: ${top10Score}`);
             } else {
                 top10Score = scores[top10Index]; // 10명 이상이면 계산된 인덱스 점수
                 console.log(` -> ${totalCount}명 (>=10), 수능 상위 10% (${top10Index + 1}등) 점수 반환: ${top10Score}`);
             }
        } else {
             console.log(` -> 유효 점수 없음`);
        }

        res.json({ success: true, top10Score: top10Score, totalCount: totalCount });

    } catch (err) {
        console.error(`❌ /counseling/stats v3 API 오류 (U_ID: ${U_ID}, Year: ${year}):`, err);
        res.status(500).json({ success: false, message: 'DB 조회 중 오류가 발생했습니다.' });
    }
    // finally { connection?.release(); } // 커넥션 풀 사용 시 필요
});

// =============================================
// ⭐️ [신규] 타군 인기 지원 통계 API
// =============================================
// GET /jungsi/counseling/cross-gun-stats/:U_ID/:year
app.get('/jungsi/counseling/cross-gun-stats/:U_ID/:year', authMiddleware, async (req, res) => {
    const { U_ID, year } = req.params;
    const requested_U_ID = parseInt(U_ID, 10); // 기준이 되는 대학/학과 ID

    console.log(`[API /cross-gun-stats] U_ID: ${requested_U_ID}, Year: ${year} 요청`);

    if (!requested_U_ID || !year) {
        return res.status(400).json({ success: false, message: 'U_ID와 year 파라미터가 필요합니다.' });
    }

    let connection;
    try {
        connection = await db.getConnection();

        // 1. 기준 학과(requested_U_ID) 정보 가져오기 (군 확인용)
        const [baseDept] = await connection.query(
            'SELECT 군 FROM 정시기본 WHERE U_ID = ? AND 학년도 = ?',
            [requested_U_ID, year]
        );
        if (baseDept.length === 0) {
            return res.status(404).json({ success: false, message: '기준 학과 정보를 찾을 수 없습니다.' });
        }
        const baseGun = baseDept[0].군; // 예: '가'
        const otherGuns = ['가', '나', '다'].filter(g => g !== baseGun); // 예: ['나', '다']
        console.log(` -> 기준 군: ${baseGun}, 조회 대상 타군: ${otherGuns.join(', ')}`);


        // 2. 기준 학과를 추가한 학생들의 ID 목록 조회
        const studentIdSql = `
            SELECT DISTINCT 학생_ID
            FROM 정시_상담목록
            WHERE 대학학과_ID = ? AND 학년도 = ?
        `;
        const [studentIdRows] = await connection.query(studentIdSql, [requested_U_ID, year]);
        const targetStudentIds = studentIdRows.map(r => r.학생_ID);

        if (targetStudentIds.length === 0) {
            console.log(` -> 기준 학과(${requested_U_ID})를 추가한 학생 없음`);
            // 데이터가 없어도 성공 응답 (빈 결과 반환)
            const emptyResult = {};
            otherGuns.forEach(gun => emptyResult[`${gun}_gun_top3`] = []);
             return res.json({ success: true, ...emptyResult, studentCount: 0 });
        }
        console.log(` -> 기준 학과(${requested_U_ID}) 추가 학생 ${targetStudentIds.length}명 확인`);

        // 3. 해당 학생들이 타군에 지원한 내역 집계
        const statsSql = `
            SELECT wl.모집군, wl.대학학과_ID, jb.대학명, jb.학과명, COUNT(*) as count
            FROM 정시_상담목록 wl
            JOIN 정시기본 jb ON wl.대학학과_ID = jb.U_ID AND wl.학년도 = jb.학년도
            WHERE wl.학생_ID IN (?)
              AND wl.학년도 = ?
              AND wl.모집군 IN (?) -- 다른 군만 조회
            GROUP BY wl.모집군, wl.대학학과_ID, jb.대학명, jb.학과명
            ORDER BY wl.모집군, count DESC
        `;
        const [statsRows] = await connection.query(statsSql, [targetStudentIds, year, otherGuns]);
        console.log(` -> 타군 지원 내역 ${statsRows.length}건 조회 완료`);

        // 4. 군별 Top 3 추출
        const result = {};
        otherGuns.forEach(gun => {
            result[`${gun}_gun_top3`] = statsRows
                .filter(row => row.모집군 === gun)
                .slice(0, 3) // 상위 3개만 추출
                .map(row => ({ // 필요한 정보만 가공
                    U_ID: row.대학학과_ID,
                    university: row.대학명,
                    department: row.학과명,
                    count: row.count
                }));
             console.log(` -> ${gun}군 Top 3:`, result[`${gun}_gun_top3`]);
        });

        res.json({ success: true, ...result, studentCount: targetStudentIds.length });

    } catch (err) {
        console.error(`❌ /cross-gun-stats API 오류 (U_ID: ${requested_U_ID}, Year: ${year}):`, err);
        res.status(500).json({ success: false, message: 'DB 조회 또는 집계 중 오류가 발생했습니다.' });
    } finally {
        if (connection) connection.release();
    }
});

// jungsi.js 파일 하단 app.listen 전에 추가

// =============================================
// ⭐️ [신규] 상담 목록 개별 추가 API (+ 3개 제한 체크)
// =============================================
// POST /jungsi/counseling/wishlist/add
app.post('/jungsi/counseling/wishlist/add', authMiddleware, async (req, res) => {
    // 필요한 정보: 학생_ID, 학년도, 모집군, 대학학과_ID
    const { 학생_ID, 학년도, 모집군, 대학학과_ID } = req.body;
    const { branch } = req.user; // 권한 확인용

    console.log(`[API /wishlist/add] 요청:`, req.body); // 로그 추가

    // 필수 값 검증
    if (!학생_ID || !학년도 || !모집군 || !대학학과_ID) {
        return res.status(400).json({ success: false, message: '학생ID, 학년도, 모집군, 대학학과ID는 필수 항목입니다.' });
    }

    let connection;
    try {
        connection = await db.getConnection();
        await connection.beginTransaction();

        // 1. 보안: 해당 학생 소유권 확인
        const [ownerCheck] = await connection.query(
            'SELECT student_id FROM 학생기본정보 WHERE student_id = ? AND branch_name = ?',
            [학생_ID, branch]
        );
        if (ownerCheck.length === 0) {
            await connection.rollback();
            return res.status(403).json({ success: false, message: '추가 권한이 없는 학생입니다.' });
        }

        // 2. 해당 군에 이미 몇 개 있는지 확인
        const [countCheck] = await connection.query(
            'SELECT COUNT(*) as count FROM 정시_상담목록 WHERE 학생_ID = ? AND 학년도 = ? AND 모집군 = ?',
            [학생_ID, 학년도, 모집군]
        );
        const currentCount = countCheck[0].count;
        console.log(` -> 현재 ${모집군}군 개수: ${currentCount}`);

        if (currentCount >= 3) {
            await connection.rollback(); // 롤백하고 종료
            console.log(` -> ${모집군}군 3개 초과, 추가 불가`);
            return res.status(400).json({ success: false, message: `${모집군}군에는 최대 3개까지만 추가할 수 있습니다.` });
        }

        // 3. 이미 추가된 항목인지 확인 (중복 방지)
        const [duplicateCheck] = await connection.query(
             'SELECT 상담목록_ID FROM 정시_상담목록 WHERE 학생_ID = ? AND 학년도 = ? AND 대학학과_ID = ?',
             [학생_ID, 학년도, 대학학과_ID]
        );
        if (duplicateCheck.length > 0) {
            await connection.rollback();
            console.log(` -> 이미 추가된 학과 (대학학과_ID: ${대학학과_ID})`);
            // 이미 있으면 성공으로 간주하고 메시지만 다르게 줄 수도 있음
             return res.status(409).json({ success: false, message: '이미 상담 목록에 추가된 학과입니다.' }); // 409 Conflict
        }


        // 4. (필수 아님, 옵션) 추가하기 전에 수능/내신/실기 점수 미리 계산해서 저장하기
        //    (bulk-save API와 유사한 로직 추가 가능 - 여기선 일단 null로 저장)
        const calculatedSuneungScore = null; // 필요 시 계산 로직 추가
        const inputNaeshinScore = null;    // 프론트에서 안 받으므로 null
        const calculatedSilgiScore = null; // 필요 시 계산 로직 추가
        const calculatedTotalScore = null; // 필요 시 계산 로직 추가

        // 5. DB에 INSERT
        const insertSql = `
            INSERT INTO 정시_상담목록
                (학생_ID, 학년도, 모집군, 대학학과_ID,
                 상담_수능점수, 상담_내신점수, 상담_실기기록, 상담_실기반영점수, 상담_계산총점, 메모, 수정일시)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
        `;
        const [insertResult] = await connection.query(insertSql, [
            학생_ID, 학년도, 모집군, 대학학과_ID,
            calculatedSuneungScore, inputNaeshinScore, null, calculatedSilgiScore, calculatedTotalScore, null
        ]);

        await connection.commit(); // 성공 시 커밋
        console.log(` -> ${모집군}군에 추가 완료 (ID: ${insertResult.insertId})`);
        res.status(201).json({ success: true, message: '상담 목록에 추가되었습니다.', insertedId: insertResult.insertId }); // 201 Created

    } catch (err) {
        if (connection) await connection.rollback(); // 오류 시 롤백
        console.error('❌ 상담 목록 개별 추가 오류:', err);
        res.status(500).json({ success: false, message: 'DB 처리 중 오류가 발생했습니다.' });
    } finally {
        if (connection) connection.release(); // 커넥션 반환
    }
});

// jungsi.js 파일 하단 app.listen 전에 추가

// =============================================
// ⭐️ [신규] 상담 목록 개별 삭제 API (POST 방식)
// =============================================
// POST /jungsi/counseling/wishlist/remove
app.post('/jungsi/counseling/wishlist/remove', authMiddleware, async (req, res) => {
    // 필요한 정보: 학생_ID, 학년도, 대학학과_ID
    const { 학생_ID, 학년도, 대학학과_ID } = req.body;
    const { branch } = req.user; // 권한 확인용

    console.log(`[API /wishlist/remove] 요청:`, req.body);

    // 필수 값 검증
    if (!학생_ID || !학년도 || !대학학과_ID) {
        return res.status(400).json({ success: false, message: '학생ID, 학년도, 대학학과ID는 필수 항목입니다.' });
    }

    let connection;
    try {
        connection = await db.getConnection();
        await connection.beginTransaction();

        // 1. 보안: 해당 학생 소유권 확인 (삭제 권한 확인)
        //    정시_상담목록과 학생기본정보를 JOIN하여 branch_name 확인
        const [ownerCheck] = await connection.query(
            `SELECT wl.상담목록_ID
             FROM 정시_상담목록 wl
             JOIN 학생기본정보 si ON wl.학생_ID = si.student_id
             WHERE wl.학생_ID = ? AND wl.학년도 = ? AND wl.대학학과_ID = ? AND si.branch_name = ?`,
            [학생_ID, 학년도, 대학학과_ID, branch]
        );

        // 해당 항목이 없거나, 다른 지점 학생의 항목이면 삭제 불가
        if (ownerCheck.length === 0) {
            await connection.rollback();
            // 항목이 아예 없는 경우 404 Not Found, 권한 없는 경우 403 Forbidden 반환 가능
            // 여기서는 일단 403으로 통일 (프론트에서 구분 필요 시 수정)
            console.log(` -> 삭제 대상 없거나 권한 없음`);
            return res.status(403).json({ success: false, message: '삭제할 항목이 없거나 권한이 없습니다.' });
        }

        // 2. DB에서 DELETE 실행
        const deleteSql = `
            DELETE FROM 정시_상담목록
            WHERE 학생_ID = ? AND 학년도 = ? AND 대학학과_ID = ?
        `;
        const [deleteResult] = await connection.query(deleteSql, [학생_ID, 학년도, 대학학과_ID]);

        await connection.commit(); // 성공 시 커밋

        if (deleteResult.affectedRows > 0) {
            console.log(` -> 삭제 완료`);
            res.json({ success: true, message: '상담 목록에서 삭제되었습니다.' });
        } else {
            // 이 경우는 ownerCheck에서 걸러지므로 거의 발생하지 않음
            console.log(` -> 삭제된 행 없음 (ownerCheck 통과 후 삭제 실패?)`);
            // 이미 삭제되었거나 동시에 다른 요청으로 삭제된 경우일 수 있음
             // 실패보다는 성공으로 간주하고 메시지만 다르게 줄 수도 있음
             res.status(404).json({ success: false, message: '삭제할 항목을 찾을 수 없습니다.' });
        }

    } catch (err) {
        if (connection) await connection.rollback(); // 오류 시 롤백
        console.error('❌ 상담 목록 개별 삭제 오류:', err);
        res.status(500).json({ success: false, message: 'DB 처리 중 오류가 발생했습니다.' });
    } finally {
        if (connection) connection.release(); // 커넥션 반환
    }
});

// jungsi.js 파일 하단 app.listen(...) 바로 위에 추가


// jungsi.js 파일 상단 부근
const isAdmin = (user) => user && user.userid === 'admin'; 
// =============================================
// ⭐️ [신규] 컷 점수 조회 API (v3 - 비율, 군, 모집정원 정보 포함)
// =============================================
// GET /jungsi/cutoffs/:year
app.get('/jungsi/cutoffs/:year', authMiddleware, async (req, res) => {
    const { year } = req.params;
    const { branch, role } = req.user; // 로그인한 사용자 정보

    console.log(`[API /cutoffs GET v3] Year: ${year}, User: ${branch} (${role})`);

    if (!year) {
        return res.status(400).json({ success: false, message: '학년도 파라미터가 필요합니다.' });
    }

    let connection;
    try {
        connection = await db.getConnection();

        // 1. 해당 학년도 모든 대학/학과 정보 + 반영비율 + 모집정원 가져오기
        const baseSql = `
            SELECT
                b.U_ID, b.대학명, b.학과명, b.군,
                b.모집정원, -- ⭐️⭐️⭐️ 모집정원 컬럼 추가 (띄어쓰기 없는 이름 사용) ⭐️⭐️⭐️
                r.수능, r.내신, r.실기
            FROM 정시기본 AS b
            LEFT JOIN 정시반영비율 AS r ON b.U_ID = r.U_ID AND b.학년도 = r.학년도
            WHERE b.학년도 = ?
            ORDER BY b.대학명, b.학과명
        `;
        const [baseInfoRows] = await connection.query(baseSql, [year]);
        console.log(` -> Found ${baseInfoRows.length} base departments with ratios/count for year ${year}`);

        // 2. 컷 점수 가져오기 ('MAX' 컷 + '로그인한 지점' 컷)
        const cutoffSql = `
            SELECT U_ID, branch_name, 수능컷, 총점컷, \`25년총점컷\`
            FROM 정시_컷점수
            WHERE 학년도 = ? AND (branch_name = 'MAX' OR branch_name = ?)
        `;
        const [cutoffRows] = await connection.query(cutoffSql, [year, branch]);
        console.log(` -> Found ${cutoffRows.length} cutoff entries for year ${year} (MAX or ${branch})`);

        // 3. 데이터를 U_ID 기준으로 합치기
        const resultsMap = new Map();
        baseInfoRows.forEach(dept => {
            resultsMap.set(dept.U_ID, {
                U_ID: dept.U_ID,
                학년도: parseInt(year),
                대학명: dept.대학명,
                학과명: dept.학과명,
                군: dept.군,
                모집인원: dept.모집정원, // ⭐️ 필드 이름 '모집인원'으로 통일 (프론트와 일치)
                수능비율: dept.수능,
                내신비율: dept.내신,
                실기비율: dept.실기,
                지점_수능컷: null,
                지점_총점컷: null,
                맥스_수능컷: null,
                맥스_총점컷: null,
                '25년총점컷': null
            });
        });

        cutoffRows.forEach(cut => {
            const entry = resultsMap.get(cut.U_ID);
            if (entry) {
                if (cut.branch_name === 'MAX') {
                    entry.맥스_수능컷 = cut.수능컷;
                    entry.맥스_총점컷 = cut.총점컷;
                    entry['25년총점컷'] = cut['25년총점컷'];
                } else if (cut.branch_name === branch) {
                    entry.지점_수능컷 = cut.수능컷;
                    entry.지점_총점컷 = cut.총점컷;
                }
            }
        });

        const responseData = Array.from(resultsMap.values());
        console.log(` -> Prepared ${responseData.length} items for response`);
        res.json({ success: true, cutoffs: responseData });

    } catch (err) {
        console.error(`❌ /cutoffs GET v3 API 오류 (Year: ${year}):`, err);
        res.status(500).json({ success: false, message: 'DB 조회 중 오류가 발생했습니다.' });
    } finally {
        if (connection) connection.release();
    }
});

// =============================================
// ⭐️ [신규] 컷 점수 저장/수정 API
// =============================================
// POST /jungsi/cutoffs/set
app.post('/jungsi/cutoffs/set', authMiddleware, async (req, res) => {
    const { year, updates } = req.body;
    const { branch, role } = req.user;

    console.log(`[API /cutoffs SET] Year: ${year}, User: ${branch} (${role}), Updates count: ${updates?.length}`);

    if (!year || !Array.isArray(updates) || updates.length === 0) {
        return res.status(400).json({ success: false, message: '학년도와 업데이트할 컷 점수 배열이 필요합니다.' });
    }

    let connection;
    try {
        connection = await db.getConnection();
        await connection.beginTransaction();

        let updatedMaxCount = 0;
        let updatedBranchCount = 0;

        const upsertSql = `
            INSERT INTO 정시_컷점수 (학년도, U_ID, branch_name, 수능컷, 총점컷, \`25년총점컷\`)
            VALUES (?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                수능컷 = VALUES(수능컷),
                총점컷 = VALUES(총점컷),
                \`25년총점컷\` = VALUES(\`25년총점컷\`),
                updated_at = NOW()
        `;

        for (const item of updates) {
            const U_ID = item.U_ID;
            if (!U_ID) {
                console.warn(" -> Skipping update item without U_ID:", item);
                continue;
            }

            // Admin 역할 처리
            if (isAdmin(req.user) && (item.맥스_수능컷 !== undefined || item.맥스_총점컷 !== undefined || item['25년총점컷'] !== undefined)) {
                const maxSuneung = item.맥스_수능컷 === '' ? null : item.맥스_수능컷;
                const maxTotal = item.맥스_총점컷 === '' ? null : item.맥스_총점컷;
                const total25 = item['25년총점컷'] === '' ? null : item['25년총점컷'];

                 if ((maxSuneung === null || !isNaN(parseFloat(maxSuneung))) &&
                     (maxTotal === null || !isNaN(parseFloat(maxTotal))) &&
                     (total25 === null || !isNaN(parseFloat(total25))))
                 {
                    console.log(` -> Admin updating MAX for U_ID ${U_ID}: 수능=${maxSuneung}, 총점=${maxTotal}, 25총점=${total25}`);
                    await connection.query(upsertSql, [year, U_ID, 'MAX', maxSuneung, maxTotal, total25]);
                    updatedMaxCount++;
                 } else {
                     console.warn(` -> Admin skipped MAX invalid data for U_ID ${U_ID}:`, item);
                 }
            }

             // 지점 컷 처리 (Admin도 자기 지점 컷은 수정 가능하도록 함, 원치 않으면 if(isAdmin) 블록 밖으로)
             if (item.지점_수능컷 !== undefined || item.지점_총점컷 !== undefined) {
                 const branchSuneung = item.지점_수능컷 === '' ? null : item.지점_수능컷;
                 const branchTotal = item.지점_총점컷 === '' ? null : item.지점_총점컷;

                 if ((branchSuneung === null || !isNaN(parseFloat(branchSuneung))) &&
                     (branchTotal === null || !isNaN(parseFloat(branchTotal))))
                 {
                     console.log(` -> User ${branch} updating BRANCH for U_ID ${U_ID}: 수능=${branchSuneung}, 총점=${branchTotal}`);
                     await connection.query(upsertSql, [year, U_ID, branch, branchSuneung, branchTotal, null]); // 25년총점컷은 null
                     updatedBranchCount++;
                 } else {
                      console.warn(` -> User ${branch} skipped BRANCH invalid data for U_ID ${U_ID}:`, item);
                 }
            }
        } // end for loop

        await connection.commit();
        console.log(` -> Commit successful. MAX updates: ${updatedMaxCount}, Branch updates: ${updatedBranchCount}`);
        res.json({ success: true, message: `총 ${updatedMaxCount + updatedBranchCount}건의 컷 점수가 저장/수정되었습니다.` });

    } catch (err) {
        if (connection) await connection.rollback();
        console.error(`❌ /cutoffs SET API 오류 (Year: ${year}):`, err);
         // ⭐️ '정시_컷점수' 테이블이 없으면 'Table ... doesn't exist' 에러 발생 가능
        res.status(500).json({ success: false, message: 'DB 저장 중 오류가 발생했습니다. (테이블 확인 필요)' });
    } finally {
        if (connection) connection.release();
    }
});

// =============================================
// ⭐️ 지점별 최종 지원 목록 + 실기 일정 조회 API (이름 변경!)
// =============================================
// GET /jungsi/branch-final-applies/:year
app.get('/jungsi/branch-final-applies/:year', authMiddleware, async (req, res) => {
    const { year } = req.params;
    console.log('[API /branch-final-applies] req.user object received:', req.user);
    const { branch } = req.user || {};
    console.log(`[API /branch-final-applies] Year: ${year}, Branch extracted: ${branch}`);

    if (!year || !branch) {
        console.error(`[API /branch-final-applies] Missing year or branch! Year: ${year}, Branch: ${branch}`);
        return res.status(400).json({ success: false, message: '학년도 파라미터와 지점 정보가 필요합니다.' });
    }
    try {
        const sql = `
            SELECT fa.최종지원_ID, fa.학생_ID, si.student_name, jb.대학명, jb.학과명,
                   fa.모집군, fa.실기날짜, fa.실기시간
            FROM 정시_최종지원 AS fa
            JOIN 학생기본정보 AS si ON fa.학생_ID = si.student_id AND si.branch_name = ? AND si.학년도 = fa.학년도
            JOIN 정시기본 AS jb ON fa.대학학과_ID = jb.U_ID AND fa.학년도 = jb.학년도
            WHERE fa.학년도 = ?
            ORDER BY si.student_name, FIELD(fa.모집군, '가', '나', '다');
        `;
        const [rows] = await db.query(sql, [branch, year]);
        console.log(` -> Found ${rows.length} final applications for branch ${branch}, year ${year}`);
        res.json({ success: true, list: rows });
    } catch (err) {
        console.error(`❌ /branch-final-applies API 오류 (Year: ${year}, Branch: ${branch}):`, err);
        res.status(500).json({ success: false, message: 'DB 조회 중 오류가 발생했습니다.' });
    }
});

// =============================================
// ⭐️ 실기 날짜/시간 저장/수정 API (이름 변경!)
// =============================================
// POST /jungsi/update-apply-schedule
app.post('/jungsi/update-apply-schedule', authMiddleware, async (req, res) => {
    const { 최종지원_ID, 실기날짜, 실기시간 } = req.body;
    const { branch } = req.user;
    console.log(`[API /update-apply-schedule] Request Body:`, req.body);

    // ... (유효성 검사 등은 이전과 동일) ...
    if (!최종지원_ID) { return res.status(400).json({ success: false, message: '최종지원_ID는 필수 항목입니다.' }); }
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (실기날짜 && !dateRegex.test(실기날짜) && 실기날짜 !== '') { return res.status(400).json({ success: false, message: '실기 날짜 형식이 올바르지 않습니다 (YYYY-MM-DD).' }); }
    const timeRegex = /^\d{2}:\d{2}$/;
    if (실기시간 && !timeRegex.test(실기시간) && 실기시간 !== '') { return res.status(400).json({ success: false, message: '실기 시간 형식이 올바르지 않습니다 (HH:MM).' }); }


    let connection;
    try {
        connection = await db.getConnection();
        await connection.beginTransaction();
        const [ownerCheck] = await connection.query(
            `SELECT fa.최종지원_ID FROM 정시_최종지원 fa JOIN 학생기본정보 si ON fa.학생_ID = si.student_id
             WHERE fa.최종지원_ID = ? AND si.branch_name = ?`, [최종지원_ID, branch]
        );
        if (ownerCheck.length === 0) {
            await connection.rollback();
            console.log(` -> 수정 권한 없음 (ID: ${최종지원_ID}, Branch: ${branch})`);
            return res.status(403).json({ success: false, message: '수정 권한이 없는 항목입니다.' });
        }
        const updateSql = `UPDATE 정시_최종지원 SET 실기날짜 = ?, 실기시간 = ?, 수정일시 = NOW() WHERE 최종지원_ID = ?`;
        const dateToSave = 실기날짜 === '' ? null : 실기날짜;
        const timeToSave = 실기시간 === '' ? null : 실기시간;
        const [updateResult] = await connection.query(updateSql, [dateToSave, timeToSave, 최종지원_ID]);
        await connection.commit();
        if (updateResult.affectedRows > 0) {
            console.log(` -> 실기 일정 업데이트 완료 (ID: ${최종지원_ID})`);
            res.json({ success: true, message: '실기 일정이 저장되었습니다.' });
        } else {
            console.log(` -> 업데이트 대상 없음 (ID: ${최종지원_ID})`);
            res.status(404).json({ success: false, message: '업데이트할 항목을 찾을 수 없습니다.' });
        }
    } catch (err) {
        if (connection) await connection.rollback();
        console.error('❌ 실기 일정 저장/수정 오류:', err);
        res.status(500).json({ success: false, message: 'DB 처리 중 오류가 발생했습니다.' });
    } finally {
        if (connection) connection.release();
    }
});

// --- jungsi.js 에 추가될 API 코드 ---

// Helper function for admin check
const isAdminMiddleware = (req, res, next) => {
    // authMiddleware가 이미 req.user를 설정했다고 가정
    if (req.user && req.user.userid === 'admin') {
        console.log(` -> [권한 확인] ✅ Admin 사용자 (${req.user.userid}), 통과`);
        next(); // Admin이면 통과
    } else {
        console.warn(` -> [권한 확인] ❌ Admin 권한 필요 (요청자: ${req.user?.userid})`);
        res.status(403).json({ success: false, message: '관리자 권한이 필요합니다.' });
    }
};

// =============================================
// ⭐️ 공지사항 API
// =============================================

// GET /jungsi/announcements : 모든 공지사항 조회
app.get('/jungsi/announcements', authMiddleware, async (req, res) => {
    console.log('[API GET /jungsi/announcements] 공지사항 목록 조회 요청');
    try {
        const [announcements] = await db.query(
            'SELECT notice_id, title, content, created_by, created_at, updated_at FROM `공지사항` ORDER BY created_at DESC'
        );
        console.log(` -> 공지사항 ${announcements.length}건 조회 완료`);
        res.json({ success: true, announcements: announcements });
    } catch (err) {
        console.error('❌ 공지사항 조회 오류:', err);
        res.status(500).json({ success: false, message: 'DB 조회 중 오류 발생' });
    }
});

// POST /jungsi/announcements/add : 새 공지사항 추가 (Admin 전용)
app.post('/jungsi/announcements/add', authMiddleware, isAdminMiddleware, async (req, res) => {
    const { title, content } = req.body;
    const created_by = req.user.userid; // Admin ID
    console.log(`[API POST /jungsi/announcements/add] Admin (${created_by}) 공지사항 추가 요청:`, req.body);

    if (!title) {
        return res.status(400).json({ success: false, message: '제목은 필수 항목입니다.' });
    }

    try {
        const [result] = await db.query(
            'INSERT INTO `공지사항` (title, content, created_by) VALUES (?, ?, ?)',
            [title, content || null, created_by]
        );
        console.log(` -> 공지사항 추가 성공 (ID: ${result.insertId})`);
        res.status(201).json({ success: true, message: '공지사항이 추가되었습니다.', notice_id: result.insertId });
    } catch (err) {
        console.error('❌ 공지사항 추가 오류:', err);
        res.status(500).json({ success: false, message: 'DB 삽입 중 오류 발생' });
    }
});

// PUT /jungsi/announcements/update/:notice_id : 공지사항 수정 (Admin 전용)
app.put('/jungsi/announcements/update/:notice_id', authMiddleware, isAdminMiddleware, async (req, res) => {
    const { notice_id } = req.params;
    const { title, content } = req.body;
    const admin_id = req.user.userid;
    console.log(`[API PUT /jungsi/announcements/update/${notice_id}] Admin (${admin_id}) 공지사항 수정 요청:`, req.body);


    if (!title) {
        return res.status(400).json({ success: false, message: '제목은 필수 항목입니다.' });
    }

    try {
        const [result] = await db.query(
            'UPDATE `공지사항` SET title = ?, content = ? WHERE notice_id = ?',
            [title, content || null, notice_id]
        );

        if (result.affectedRows > 0) {
            console.log(` -> 공지사항 수정 성공 (ID: ${notice_id})`);
            res.json({ success: true, message: '공지사항이 수정되었습니다.' });
        } else {
            console.warn(` -> 수정할 공지사항 없음 (ID: ${notice_id})`);
            res.status(404).json({ success: false, message: '수정할 공지사항을 찾을 수 없습니다.' });
        }
    } catch (err) {
        console.error('❌ 공지사항 수정 오류:', err);
        res.status(500).json({ success: false, message: 'DB 수정 중 오류 발생' });
    }
});

// DELETE /jungsi/announcements/delete/:notice_id : 공지사항 삭제 (Admin 전용)
app.delete('/jungsi/announcements/delete/:notice_id', authMiddleware, isAdminMiddleware, async (req, res) => {
    const { notice_id } = req.params;
    const admin_id = req.user.userid;
    console.log(`[API DELETE /jungsi/announcements/delete/${notice_id}] Admin (${admin_id}) 공지사항 삭제 요청`);

    try {
        const [result] = await db.query(
            'DELETE FROM `공지사항` WHERE notice_id = ?',
            [notice_id]
        );

        if (result.affectedRows > 0) {
            console.log(` -> 공지사항 삭제 성공 (ID: ${notice_id})`);
            res.json({ success: true, message: '공지사항이 삭제되었습니다.' });
        } else {
            console.warn(` -> 삭제할 공지사항 없음 (ID: ${notice_id})`);
            res.status(404).json({ success: false, message: '삭제할 공지사항을 찾을 수 없습니다.' });
        }
    } catch (err) {
        console.error('❌ 공지사항 삭제 오류:', err);
        res.status(500).json({ success: false, message: 'DB 삭제 중 오류 발생' });
    }
});

// =============================================
// ⭐️ 상담일정 API
// =============================================

// GET /jungsi/counseling-schedules/:year/:month : 해당 월의 '로그인한 지점' 상담 일정 조회
app.get('/jungsi/counseling-schedules/:year/:month', authMiddleware, async (req, res) => {
    const { year, month } = req.params;
    const { branch } = req.user;
    console.log(`[API GET /jungsi/counseling-schedules] ${branch} 지점 ${year}-${month} 상담 일정 조회 요청`);

    // 월 형식 확인 (1~12)
    const monthNum = parseInt(month, 10);
    if (isNaN(monthNum) || monthNum < 1 || monthNum > 12) {
        return res.status(400).json({ success: false, message: '월(month) 파라미터는 1-12 사이의 숫자여야 합니다.' });
    }
    // DB에서 DATE 형식으로 비교하기 위해 시작일, 종료일 계산
    const startDate = `${year}-${String(monthNum).padStart(2, '0')}-01`;
    const endDate = new Date(year, monthNum, 0).toISOString().split('T')[0]; // 해당 월의 마지막 날짜

    try {
        const [schedules] = await db.query(
            `SELECT schedule_id, student_id, counseling_date, counseling_time, counseling_type
             FROM \`상담일정\`
             WHERE branch_name = ? AND counseling_date BETWEEN ? AND ?
             ORDER BY counseling_date, counseling_time`,
            [branch, startDate, endDate]
        );
        console.log(` -> ${schedules.length}건 조회 완료`);
        res.json({ success: true, schedules: schedules });
    } catch (err) {
        console.error('❌ 상담 일정 조회 오류:', err);
        res.status(500).json({ success: false, message: 'DB 조회 중 오류 발생' });
    }
});

// ⭐️ [신규] GET /jungsi/counsel-schedule : 특정 날짜의 상담 일정 조회 (index.html 알림용)
app.get('/jungsi/counsel-schedule', authMiddleware, async (req, res) => {
    const { date, branch } = req.query;
    console.log(`[API GET /jungsi/counsel-schedule] 날짜: ${date}, 지점: ${branch}`);

    if (!date || !branch) {
        return res.status(400).json({ success: false, message: '날짜(date)와 지점(branch)이 필요합니다.' });
    }

    try {
        const [schedules] = await db.query(
            `SELECT
                s.schedule_id AS id,
                s.student_id,
                st.student_name AS name,
                st.phone_number AS phone,
                s.counseling_time AS startTime,
                s.counseling_type
             FROM \`상담일정\` s
             LEFT JOIN \`학생기본정보\` st ON s.student_id = st.student_id
             WHERE s.branch_name = ? AND s.counseling_date = ?
             ORDER BY s.counseling_time`,
            [branch, date]
        );

        console.log(` -> ${schedules.length}건 조회 완료`);
        res.json({ success: true, list: schedules });
    } catch (err) {
        console.error('❌ 상담 일정 조회 오류:', err);
        res.status(500).json({ success: false, message: 'DB 조회 중 오류 발생' });
    }
});

// jungsi.js 파일에서 POST /jungsi/counseling-schedules/add API를 찾아 교체

// POST /jungsi/counseling-schedules/add : 새 상담 일정 추가 (로그인한 지점)
app.post('/jungsi/counseling-schedules/add', authMiddleware, async (req, res) => {
    const { student_id, counseling_date, counseling_time, counseling_type } = req.body;
    const { branch } = req.user;
    console.log(`[API POST /jungsi/counseling-schedules/add] ${branch} 지점 상담 추가 요청:`, req.body);

    // 유효성 검사
    if (!student_id || !counseling_date || !counseling_time) {
        return res.status(400).json({ success: false, message: '학생, 날짜, 시간은 필수 항목입니다.' });
    }
    const timeRegex = /^\d{2}:\d{2}$/;
    if (!timeRegex.test(counseling_time)) {
        return res.status(400).json({ success: false, message: '시간 형식이 올바르지 않습니다 (HH:MM).' });
    }
    // ⭐️ 30분 단위 검사 로직은 프론트엔드에서 5분 단위로 변경했으므로, 여기서는 5분 단위로 수정
    const minutes = parseInt(counseling_time.split(':')[1], 10);
    if (minutes % 5 !== 0) { // 30 -> 5
        return res.status(400).json({ success: false, message: '시간은 5분 단위여야 합니다.' }); // 30분 -> 5분
    }

    let connection;
    try {
        connection = await db.getConnection();
        await connection.beginTransaction();

        // ⭐️ 중복 시간 체크 (기존: 동일 시간 -> 변경: 30분 이내 겹침)
        const [conflictCheck] = await connection.query(
            `SELECT schedule_id FROM \`상담일정\`
             WHERE branch_name = ? 
               AND counseling_date = ? 
               AND ABS(TIME_TO_SEC(TIMEDIFF(counseling_time, ?))) < 1800`, // 1800초 = 30분
            [branch, counseling_date, counseling_time]
        );
        if (conflictCheck.length > 0) {
            await connection.rollback();
            console.warn(` -> 시간 중복 발생! (${counseling_date} ${counseling_time}) - 30분 이내 겹침`);
            return res.status(409).json({ success: false, message: '해당 시간 30분 이내에 이미 다른 상담 일정이 있습니다.' }); // 409 Conflict
        }

        // DB 삽입
        const [result] = await connection.query(
            `INSERT INTO \`상담일정\` (branch_name, student_id, counseling_date, counseling_time, counseling_type)
             VALUES (?, ?, ?, ?, ?)`,
            [branch, student_id, counseling_date, counseling_time, counseling_type || null]
        );
        await connection.commit();
        console.log(` -> 상담 일정 추가 성공 (ID: ${result.insertId})`);
        res.status(201).json({ success: true, message: '상담 일정이 추가되었습니다.', schedule_id: result.insertId });

    } catch (err) {
        if (connection) await connection.rollback();
        console.error('❌ 상담 일정 추가 오류:', err);
        // FK 제약조건 위반 등 다른 DB 에러 처리
        if (err.code === 'ER_NO_REFERENCED_ROW_2') {
             return res.status(400).json({ success: false, message: '선택한 학생 정보가 유효하지 않습니다.' });
        }
        res.status(500).json({ success: false, message: 'DB 삽입 중 오류 발생' });
    } finally {
        if (connection) connection.release();
    }
});

// jungsi.js 파일에서 PUT /jungsi/counseling-schedules/update/:schedule_id API를 찾아 교체

// PUT /jungsi/counseling-schedules/update/:schedule_id : 상담 일정 수정 (로그인한 지점)
app.put('/jungsi/counseling-schedules/update/:schedule_id', authMiddleware, async (req, res) => {
    const { schedule_id } = req.params;
    const { student_id, counseling_date, counseling_time, counseling_type } = req.body;
    const { branch } = req.user;
    console.log(`[API PUT /jungsi/counseling-schedules/update/${schedule_id}] ${branch} 지점 상담 수정 요청:`, req.body);

    // 유효성 검사
    if (!student_id || !counseling_date || !counseling_time) { 
         return res.status(400).json({ success: false, message: '학생, 날짜, 시간은 필수 항목입니다.' });
    }
    const timeRegex = /^\d{2}:\d{2}$/; 
    if (!timeRegex.test(counseling_time)) { 
        return res.status(400).json({ success: false, message: '시간 형식이 올바르지 않습니다 (HH:MM).' });
    }
    // ⭐️ 30분 단위 검사 로직은 프론트엔드에서 5분 단위로 변경했으므로, 여기서는 5분 단위로 수정
    const minutes = parseInt(counseling_time.split(':')[1], 10); 
    if (minutes % 5 !== 0) { // 30 -> 5
        return res.status(400).json({ success: false, message: '시간은 5분 단위여야 합니다.' }); // 30분 -> 5분
    }

    let connection;
    try {
        connection = await db.getConnection();
        await connection.beginTransaction();

        // 1. 수정 권한 확인 (해당 ID가 로그인한 지점 소속인지)
        const [ownerCheck] = await connection.query(
            'SELECT schedule_id FROM `상담일정` WHERE schedule_id = ? AND branch_name = ?',
            [schedule_id, branch]
        );
        if (ownerCheck.length === 0) {
            await connection.rollback();
            console.warn(` -> 수정 권한 없음 (ID: ${schedule_id}, Branch: ${branch})`);
            return res.status(403).json({ success: false, message: '수정 권한이 없는 상담 일정입니다.' });
        }

        // 2. ⭐️ 시간 중복 체크 (변경하려는 시간 + 30분 이내 겹침 + 자기 자신 제외)
        const [conflictCheck] = await connection.query(
            `SELECT schedule_id FROM \`상담일정\`
             WHERE branch_name = ? 
               AND counseling_date = ? 
               AND ABS(TIME_TO_SEC(TIMEDIFF(counseling_time, ?))) < 1800 
               AND schedule_id != ?`, // 1800초 = 30분, 자기 자신 제외
            [branch, counseling_date, counseling_time, schedule_id]
        );
        if (conflictCheck.length > 0) {
            await connection.rollback();
            console.warn(` -> 시간 중복 발생! (${counseling_date} ${counseling_time})`);
            return res.status(409).json({ success: false, message: '해당 시간 30분 이내에 이미 다른 상담 일정이 있습니다.' });
        }

        // 3. DB 수정
        const [result] = await connection.query(
            `UPDATE \`상담일정\` SET
                student_id = ?, counseling_date = ?, counseling_time = ?, counseling_type = ?
             WHERE schedule_id = ?`,
            [student_id, counseling_date, counseling_time, counseling_type || null, schedule_id]
        );
        await connection.commit();

        if (result.affectedRows > 0) {
            console.log(` -> 상담 일정 수정 성공 (ID: ${schedule_id})`);
            res.json({ success: true, message: '상담 일정이 수정되었습니다.' });
        } else {
            // 이 경우는 ownerCheck에서 걸러지므로 거의 없음
            console.warn(` -> 수정할 상담 일정 없음 (ID: ${schedule_id})`);
            res.status(404).json({ success: false, message: '수정할 상담 일정을 찾을 수 없습니다.' });
        }

    } catch (err) {
        if (connection) await connection.rollback();
        console.error('❌ 상담 일정 수정 오류:', err);
         if (err.code === 'ER_NO_REFERENCED_ROW_2') {
             return res.status(400).json({ success: false, message: '선택한 학생 정보가 유효하지 않습니다.' });
        }
        res.status(500).json({ success: false, message: 'DB 수정 중 오류 발생' });
    } finally {
        if (connection) connection.release();
    }
});

// PUT /jungsi/counseling-schedules/update/:schedule_id : 상담 일정 수정 (로그인한 지점)
app.put('/jungsi/counseling-schedules/update/:schedule_id', authMiddleware, async (req, res) => {
    const { schedule_id } = req.params;
    const { student_id, counseling_date, counseling_time, counseling_type } = req.body;
    const { branch } = req.user;
    console.log(`[API PUT /jungsi/counseling-schedules/update/${schedule_id}] ${branch} 지점 상담 수정 요청:`, req.body);

    // 유효성 검사
    if (!student_id || !counseling_date || !counseling_time) { /* ... (추가 API와 동일) ... */ }
    const timeRegex = /^\d{2}:\d{2}$/; if (!timeRegex.test(counseling_time)) { /* ... */ }
    const minutes = parseInt(counseling_time.split(':')[1], 10); if (minutes % 30 !== 0) { /* ... */ }

    let connection;
    try {
        connection = await db.getConnection();
        await connection.beginTransaction();

        // 1. 수정 권한 확인 (해당 ID가 로그인한 지점 소속인지)
        const [ownerCheck] = await connection.query(
            'SELECT schedule_id FROM `상담일정` WHERE schedule_id = ? AND branch_name = ?',
            [schedule_id, branch]
        );
        if (ownerCheck.length === 0) {
            await connection.rollback();
            console.warn(` -> 수정 권한 없음 (ID: ${schedule_id}, Branch: ${branch})`);
            return res.status(403).json({ success: false, message: '수정 권한이 없는 상담 일정입니다.' });
        }

        // 2. 시간 중복 체크 (변경하려는 시간 + 자기 자신 제외)
        const [conflictCheck] = await connection.query(
            `SELECT schedule_id FROM \`상담일정\`
             WHERE branch_name = ? AND counseling_date = ? AND counseling_time = ? AND schedule_id != ?`, // 자기 자신 제외 조건 추가
            [branch, counseling_date, counseling_time, schedule_id]
        );
        if (conflictCheck.length > 0) {
            await connection.rollback();
            console.warn(` -> 시간 중복 발생! (${counseling_date} ${counseling_time})`);
            return res.status(409).json({ success: false, message: '해당 시간에 이미 다른 상담 일정이 있습니다.' });
        }

        // 3. DB 수정
        const [result] = await connection.query(
            `UPDATE \`상담일정\` SET
                student_id = ?, counseling_date = ?, counseling_time = ?, counseling_type = ?
             WHERE schedule_id = ?`,
            [student_id, counseling_date, counseling_time, counseling_type || null, schedule_id]
        );
        await connection.commit();

        if (result.affectedRows > 0) {
            console.log(` -> 상담 일정 수정 성공 (ID: ${schedule_id})`);
            res.json({ success: true, message: '상담 일정이 수정되었습니다.' });
        } else {
            // 이 경우는 ownerCheck에서 걸러지므로 거의 없음
            console.warn(` -> 수정할 상담 일정 없음 (ID: ${schedule_id})`);
            res.status(404).json({ success: false, message: '수정할 상담 일정을 찾을 수 없습니다.' });
        }

    } catch (err) {
        if (connection) await connection.rollback();
        console.error('❌ 상담 일정 수정 오류:', err);
         if (err.code === 'ER_NO_REFERENCED_ROW_2') {
             return res.status(400).json({ success: false, message: '선택한 학생 정보가 유효하지 않습니다.' });
        }
        res.status(500).json({ success: false, message: 'DB 수정 중 오류 발생' });
    } finally {
        if (connection) connection.release();
    }
});

// DELETE /jungsi/counseling-schedules/delete/:schedule_id : 상담 일정 삭제 (로그인한 지점)
app.delete('/jungsi/counseling-schedules/delete/:schedule_id', authMiddleware, async (req, res) => {
    const { schedule_id } = req.params;
    const { branch } = req.user;
    console.log(`[API DELETE /jungsi/counseling-schedules/delete/${schedule_id}] ${branch} 지점 상담 삭제 요청`);

    let connection;
    try {
        connection = await db.getConnection();
        await connection.beginTransaction();

        // 1. 삭제 권한 확인 (해당 ID가 로그인한 지점 소속인지)
        const [ownerCheck] = await connection.query(
            'SELECT schedule_id FROM `상담일정` WHERE schedule_id = ? AND branch_name = ?',
            [schedule_id, branch]
        );
        if (ownerCheck.length === 0) {
            await connection.rollback();
            console.warn(` -> 삭제 권한 없음 (ID: ${schedule_id}, Branch: ${branch})`);
            return res.status(403).json({ success: false, message: '삭제 권한이 없는 상담 일정입니다.' });
        }

        // 2. DB 삭제
        const [result] = await connection.query(
            'DELETE FROM `상담일정` WHERE schedule_id = ?',
            [schedule_id]
        );
        await connection.commit();

        if (result.affectedRows > 0) {
            console.log(` -> 상담 일정 삭제 성공 (ID: ${schedule_id})`);
            res.json({ success: true, message: '상담 일정이 삭제되었습니다.' });
        } else {
            console.warn(` -> 삭제할 상담 일정 없음 (ID: ${schedule_id})`);
            res.status(404).json({ success: false, message: '삭제할 상담 일정을 찾을 수 없습니다.' });
        }

    } catch (err) {
        if (connection) await connection.rollback();
        console.error('❌ 상담 일정 삭제 오류:', err);
        res.status(500).json({ success: false, message: 'DB 삭제 중 오류 발생' });
    } finally {
        if (connection) connection.release();
    }
});

// GET /jungsi/students/names-by-branch : 상담 일정 등록 시 학생 목록 불러오기
app.get('/jungsi/students/names-by-branch', authMiddleware, async (req, res) => {
    const { branch } = req.user;
    const { year } = req.query; // 학년도 쿼리 파라미터 (예: ?year=2026)
    console.log(`[API GET /jungsi/students/names-by-branch] ${branch} 지점 학생 이름 목록 조회 요청 (Year: ${year || '전체'})`);

    try {
        let sql = 'SELECT student_id, student_name FROM `학생기본정보` WHERE branch_name = ?';
        const params = [branch];
        if (year) {
            sql += ' AND 학년도 = ?'; // 학년도 필터링 추가
            params.push(year);
        }
        sql += ' ORDER BY student_name ASC'; // 이름순 정렬

        const [students] = await db.query(sql, params);
        console.log(` -> ${students.length}명 조회 완료`);
        res.json({ success: true, students: students });
    } catch (err) {
        console.error('❌ 지점 학생 이름 조회 오류:', err);
        res.status(500).json({ success: false, message: 'DB 조회 중 오류 발생' });
    }
});


// =============================================
// ⭐️ 지점 메모 API
// =============================================

// GET /jungsi/branch-memos : '로그인한 지점'의 메모 조회
app.get('/jungsi/branch-memos', authMiddleware, async (req, res) => {
    const { branch } = req.user;
    console.log(`[API GET /jungsi/branch-memos] ${branch} 지점 메모 목록 조회 요청`);
    try {
        const [memos] = await db.query(
            'SELECT memo_id, memo_content, created_by, created_at, updated_at FROM `지점메모` WHERE branch_name = ? ORDER BY created_at DESC',
            [branch]
        );
        console.log(` -> 메모 ${memos.length}건 조회 완료`);
        res.json({ success: true, memos: memos });
    } catch (err) {
        console.error('❌ 지점 메모 조회 오류:', err);
        res.status(500).json({ success: false, message: 'DB 조회 중 오류 발생' });
    }
});

// POST /jungsi/branch-memos/add : 새 메모 추가 (로그인한 지점)
app.post('/jungsi/branch-memos/add', authMiddleware, async (req, res) => {
    const { memo_content } = req.body;
    const { branch, userid } = req.user;
    console.log(`[API POST /jungsi/branch-memos/add] ${branch} 지점 메모 추가 요청 (User: ${userid}):`, req.body);

    if (!memo_content) {
        return res.status(400).json({ success: false, message: '메모 내용은 필수 항목입니다.' });
    }

    try {
        const [result] = await db.query(
            'INSERT INTO `지점메모` (branch_name, memo_content, created_by) VALUES (?, ?, ?)',
            [branch, memo_content, userid]
        );
        console.log(` -> 메모 추가 성공 (ID: ${result.insertId})`);
        res.status(201).json({ success: true, message: '메모가 추가되었습니다.', memo_id: result.insertId });
    } catch (err) {
        console.error('❌ 지점 메모 추가 오류:', err);
        res.status(500).json({ success: false, message: 'DB 삽입 중 오류 발생' });
    }
});

// PUT /jungsi/branch-memos/update/:memo_id : 메모 수정 (로그인한 지점)
app.put('/jungsi/branch-memos/update/:memo_id', authMiddleware, async (req, res) => {
    const { memo_id } = req.params;
    const { memo_content } = req.body;
    const { branch, userid } = req.user;
    console.log(`[API PUT /jungsi/branch-memos/update/${memo_id}] ${branch} 지점 메모 수정 요청 (User: ${userid}):`, req.body);


    if (!memo_content) {
        return res.status(400).json({ success: false, message: '메모 내용은 필수 항목입니다.' });
    }

    let connection;
    try {
        connection = await db.getConnection();
        await connection.beginTransaction();

        // 1. 수정 권한 확인 (메모 ID가 해당 지점 소속인지)
        const [ownerCheck] = await connection.query(
            'SELECT memo_id, created_by FROM `지점메모` WHERE memo_id = ? AND branch_name = ?',
            [memo_id, branch]
        );
        if (ownerCheck.length === 0) {
            await connection.rollback();
            console.warn(` -> 수정 권한 없음 (Memo ID: ${memo_id}, Branch: ${branch})`);
            return res.status(403).json({ success: false, message: '수정 권한이 없는 메모입니다.' });
        }

        // (선택적: 본인 작성 메모만 수정 가능하게 하려면)
        // const originalAuthor = ownerCheck[0].created_by;
        // if (originalAuthor !== userid && userRole !== 'admin') { // Admin은 남의 메모도 수정 가능
        //     await connection.rollback();
        //     console.warn(` -> 메모 작성자 불일치 (Author: ${originalAuthor}, Requester: ${userid})`);
        //     return res.status(403).json({ success: false, message: '본인이 작성한 메모만 수정할 수 있습니다.' });
        // }

        // 2. DB 수정
        const [result] = await connection.query(
            'UPDATE `지점메모` SET memo_content = ? WHERE memo_id = ?',
            [memo_content, memo_id]
        );
        await connection.commit();

        if (result.affectedRows > 0) {
            console.log(` -> 메모 수정 성공 (ID: ${memo_id})`);
            res.json({ success: true, message: '메모가 수정되었습니다.' });
        } else {
            console.warn(` -> 수정할 메모 없음 (ID: ${memo_id})`);
            res.status(404).json({ success: false, message: '수정할 메모를 찾을 수 없습니다.' });
        }
    } catch (err) {
        if (connection) await connection.rollback();
        console.error('❌ 지점 메모 수정 오류:', err);
        res.status(500).json({ success: false, message: 'DB 수정 중 오류 발생' });
    } finally {
        if (connection) connection.release();
    }
});

// DELETE /jungsi/branch-memos/delete/:memo_id : 메모 삭제 (로그인한 지점)
app.delete('/jungsi/branch-memos/delete/:memo_id', authMiddleware, async (req, res) => {
    const { memo_id } = req.params;
    const { branch, userid } = req.user;
    console.log(`[API DELETE /jungsi/branch-memos/delete/${memo_id}] ${branch} 지점 메모 삭제 요청 (User: ${userid})`);

    let connection;
    try {
        connection = await db.getConnection();
        await connection.beginTransaction();

        // 1. 삭제 권한 확인 (메모 ID가 해당 지점 소속인지)
        const [ownerCheck] = await connection.query(
            'SELECT memo_id, created_by FROM `지점메모` WHERE memo_id = ? AND branch_name = ?',
            [memo_id, branch]
        );
        if (ownerCheck.length === 0) {
            await connection.rollback();
            console.warn(` -> 삭제 권한 없음 (Memo ID: ${memo_id}, Branch: ${branch})`);
            return res.status(403).json({ success: false, message: '삭제 권한이 없는 메모입니다.' });
        }

        // (선택적: 본인 작성 메모만 삭제 가능하게 하려면)
        // const originalAuthor = ownerCheck[0].created_by;
        // if (originalAuthor !== userid && userRole !== 'admin') { // Admin은 남의 메모도 삭제 가능
        //     await connection.rollback();
        //     console.warn(` -> 메모 작성자 불일치 (Author: ${originalAuthor}, Requester: ${userid})`);
        //     return res.status(403).json({ success: false, message: '본인이 작성한 메모만 삭제할 수 있습니다.' });
        // }

        // 2. DB 삭제
        const [result] = await connection.query(
            'DELETE FROM `지점메모` WHERE memo_id = ?',
            [memo_id]
        );
        await connection.commit();

        if (result.affectedRows > 0) {
            console.log(` -> 메모 삭제 성공 (ID: ${memo_id})`);
            res.json({ success: true, message: '메모가 삭제되었습니다.' });
        } else {
            console.warn(` -> 삭제할 메모 없음 (ID: ${memo_id})`);
            res.status(404).json({ success: false, message: '삭제할 메모를 찾을 수 없습니다.' });
        }
    } catch (err) {
        if (connection) await connection.rollback();
        console.error('❌ 지점 메모 삭제 오류:', err);
        res.status(500).json({ success: false, message: 'DB 삭제 중 오류 발생' });
    } finally {
        if (connection) connection.release();
    }
});


//----------------------------------학생들 관리 API

app.get('/jungsi/student/my-profile', authStudentOnlyMiddleware, async (req, res) => {
    const { student_id } = req; 

    try {
        const sql = `
            SELECT
                b.student_id, b.student_name, b.school_name, b.grade, b.gender, b.branch_name, b.학년도,
                s.입력유형,
                s.국어_선택과목, s.국어_원점수, s.국어_표준점수, s.국어_백분위, s.국어_등급,
                s.수학_선택과목, s.수학_원점수, s.수학_표준점수, s.수학_백분위, s.수학_등급,
                s.영어_원점수, s.영어_등급,
                s.한국사_원점수, s.한국사_등급,
                s.탐구1_선택과목, s.탐구1_원점수, s.탐구1_표준점수, s.탐구1_백분위, s.탐구1_등급,
                s.탐구2_선택과목, s.탐구2_원점수, s.탐구2_표준점수, s.탐구2_백분위, s.탐구2_등급
            FROM 학생기본정보 b
            LEFT JOIN 학생수능성적 s ON b.student_id = s.student_id AND b.학년도 = s.학년도
            WHERE b.student_id = ?;
        `;
        const [rows] = await db.query(sql, [student_id]);

        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: '학생 정보를 찾을 수 없습니다.' });
        }

        const s = rows[0]; // ⭐️ DB에서 가져온 원본 데이터

        // ⭐️ DB 원본 데이터 로깅 (확인용)
        console.log(`[my-profile API] DB Raw Data for student ${student_id}:`, s); 
        
        // scoresData 객체 생성
        const scoresData = s.입력유형 ? {
            입력유형: s.입력유형,
            국어_선택과목: s.국어_선택과목, 국어_원점수: s.국어_원점수, 국어_표준점수: s.국어_표준점수, 국어_백분위: s.국어_백분위, 국어_등급: s.국어_등급,
            수학_선택과목: s.수학_선택과목, 수학_원점수: s.수학_원점수, 수학_표준점수: s.수학_표준점수, 수학_백분위: s.수학_백분위, 수학_등급: s.수학_등급,
            영어_원점수: s.영어_원점수, 영어_등급: s.영어_등급,
            한국사_원점수: s.한국사_원점수, 한국사_등급: s.한국사_등급,
            
            // ▼▼▼▼▼ 여기를 다시 한번 확인! ▼▼▼▼▼
            탐구1_선택과목: s.탐구1_선택과목, 
            탐구1_원점수: s.탐구1_원점수, 
            탐구1_표준점수: s.탐구1_표준점수, 
            탐구1_백분위: s.탐구1_백분위, // ✅ 백분위 컬럼 값
            탐구1_등급: s.탐구1_등급,      // ✅ 등급 컬럼 값
            탐구2_선택과목: s.탐구2_선택과목, 
            탐구2_원점수: s.탐구2_원점수, 
            탐구2_표준점수: s.탐구2_표준점수, 
            탐구2_백분위: s.탐구2_백분위, // ✅ 백분위 컬럼 값
            탐구2_등급: s.탐구2_등급       // ✅ 등급 컬럼 값
            // ▲▲▲▲▲ 확인 끝 ▲▲▲▲▲

        } : null; 

        const profile = {
            student_id: s.student_id,
            student_name: s.student_name,
            school_name: s.school_name,
            grade: s.grade,
            gender: s.gender,
            branch_name: s.branch_name,
            학년도: s.학년도,
            scores: scoresData
        };
        
        // ⭐️ 프론트로 보내기 직전 데이터 로깅 (확인용)
        console.log(`[my-profile API] Data sent to client for student ${student_id}:`, profile);

        res.json({ success: true, profile: profile });

    } catch (err) {
        console.error('❌ [학생 API] 내 프로필 조회 오류:', err);
        res.status(500).json({ success: false, message: '서버 오류' });
    }
});


/**
 * ⭐️ [학생 API 2] 내 수능 성적 저장/수정
 * (mypage.html에서 '저장' 시 호출)
 */
app.post('/jungsi/student/my-score', authStudentOnlyMiddleware, async (req, res) => {
    // ⭐️ 미들웨어에서 주입된 ID 사용 (req.student_id)
    const { student_id } = req; 
    
    // ⭐️ 프론트에서는 '학년도', '입력유형', 'scores 객체'만 받음
    const { 학년도, 입력유형, scores } = req.body;
    
    if (!학년도 || !입력유형 || !scores) {
        return res.status(400).json({ success: false, message: '학년도, 입력유형, 성적 정보(scores)는 필수입니다.' });
    }

    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        // 1. (가채점 변환용) 등급컷 데이터 로드
        const [allCuts] = await conn.query(
            'SELECT 선택과목명, 원점수, 표준점수, 백분위, 등급 FROM `정시예상등급컷` WHERE 학년도 = ? AND 모형 = ?',
            [학년도, '수능'] // 모형은 '수능'으로 가정
        );
        const cutsMap = new Map();
        allCuts.forEach(cut => {
            const key = cut.선택과목명;
            if (!cutsMap.has(key)) cutsMap.set(key, []);
            cutsMap.get(key).push(cut);
        });

        // 2. 저장할 데이터 객체(savedData) 생성
        // ⭐️ 기존 'set-wide' API 로직 재활용
        const savedData = { 
            student_id: student_id, // ⭐️ ID 강제 주입
            학년도: 학년도, 입력유형: 입력유형,
            국어_선택과목: scores.국어_선택과목, 국어_원점수: scores.국어_원점수,
            수학_선택과목: scores.수학_선택과목, 수학_원점수: scores.수학_원점수,
            영어_원점수: scores.영어_원점수, 한국사_원점수: scores.한국사_원점수,
            탐구1_선택과목: scores.탐구1_선택과목, 탐구1_원점수: scores.탐구1_원점수,
            탐구2_선택과목: scores.탐구2_선택과목, 탐구2_원점수: scores.탐구2_원점수,
            국어_표준점수: null, 국어_백분위: null, 국어_등급: null,
            수학_표준점수: null, 수학_백분위: null, 수학_등급: null,
            영어_등급: null, 한국사_등급: null,
            탐구1_표준점수: null, 탐구1_백분위: null, 탐구1_등급: null,
            탐구2_표준점수: null, 탐구2_백분위: null, 탐구2_등급: null,
        };

        // 3. 점수 변환 또는 복사
if (입력유형 === 'raw') { // (가채점)
            // ... (가채점 로직은 그대로 둠) ...
            if (scores.영어_원점수 != null) savedData.영어_등급 = getEnglishGrade(scores.영어_원점수);
            if (scores.한국사_원점수 != null) savedData.한국사_등급 = getHistoryGrade(scores.한국사_원점수);
            const relativeSubjects = [
                { prefix: '국어', score: scores.국어_원점수, subject: scores.국어_선택과목 },
                { prefix: '수학', score: scores.수학_원점수, subject: scores.수학_선택과목 },
                { prefix: '탐구1', score: scores.탐구1_원점수, subject: scores.탐구1_선택과목 },
                { prefix: '탐구2', score: scores.탐구2_원점수, subject: scores.탐구2_선택과목 },
            ];
            for (const s of relativeSubjects) {
                if (s.score != null && s.subject && cutsMap.has(s.subject)) {
                    const cuts = cutsMap.get(s.subject);
                    const estimated = interpolateScore(s.score, cuts);
                    savedData[`${s.prefix}_표준점수`] = estimated.std;
                    savedData[`${s.prefix}_백분위`] = estimated.pct;
                    savedData[`${s.prefix}_등급`] = estimated.grade;
                }
            }
        } else { // (실채점 - official)
            // ▼▼▼▼▼ 여기가 수정된 부분 ▼▼▼▼▼
            
            // 1. 실채점 값 복사 (기존과 동일)
            savedData.국어_표준점수 = scores.국어_표준점수 || null;
            savedData.국어_백분위 = scores.국어_백분위 || null;
            savedData.국어_등급 = scores.국어_등급 || null;
            savedData.수학_표준점수 = scores.수학_표준점수 || null;
            savedData.수학_백분위 = scores.수학_백분위 || null;
            savedData.수학_등급 = scores.수학_등급 || null;
            // 영어/한국사는 등급만 사용 (원점수는 있어도 되고 없어도 됨)
            savedData.영어_등급 = scores.영어_등급 || getEnglishGrade(scores.영어_원점수); 
            savedData.한국사_등급 = scores.한국사_등급 || getHistoryGrade(scores.한국사_원점수);
            savedData.탐구1_표준점수 = scores.탐구1_표준점수 || null;
            savedData.탐구1_백분위 = scores.탐구1_백분위 || null;
            savedData.탐구1_등급 = scores.탐구1_등급 || null;
            savedData.탐구2_표준점수 = scores.탐구2_표준점수 || null;
            savedData.탐구2_백분위 = scores.탐구2_백분위 || null;
            savedData.탐구2_등급 = scores.탐구2_등급 || null;
            
            // ⭐️ 2. [핵심 수정] 실채점일 경우 원점수 필드를 강제로 null 처리!
            savedData.국어_원점수 = null;
            savedData.수학_원점수 = null;
            savedData.영어_원점수 = null; // 영어 원점수도 비워줌 (등급만 있으면 됨)
            savedData.한국사_원점수 = null; // 한국사 원점수도 비워줌 (등급만 있으면 됨)
            savedData.탐구1_원점수 = null;
            savedData.탐구2_원점수 = null;
            
            // ▲▲▲▲▲ 수정 끝 ▲▲▲▲▲
        }

        // 4. DB에 UPSERT (저장/수정)
        // ⭐️ 기존 'set-wide' API의 SQL 재활용
        const sql = `
            INSERT INTO \`학생수능성적\` (
                student_id, 학년도, 입력유형,
                국어_선택과목, 국어_원점수, 국어_표준점수, 국어_백분위, 국어_등급,
                수학_선택과목, 수학_원점수, 수학_표준점수, 수학_백분위, 수학_등급,
                영어_원점수, 영어_등급,
                한국사_원점수, 한국사_등급,
                탐구1_선택과목, 탐구1_원점수, 탐구1_표준점수, 탐구1_백분위, 탐구1_등급,
                탐구2_선택과목, 탐구2_원점수, 탐구2_표준점수, 탐구2_백분위, 탐구2_등급
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                입력유형=VALUES(입력유형),
                국어_선택과목=VALUES(국어_선택과목), 국어_원점수=VALUES(국어_원점수), 국어_표준점수=VALUES(국어_표준점수), 국어_백분위=VALUES(국어_백분위), 국어_등급=VALUES(국어_등급),
                수학_선택과목=VALUES(수학_선택과목), 수학_원점수=VALUES(수학_원점수), 수학_표준점수=VALUES(수학_표준점수), 수학_백분위=VALUES(수학_백분위), 수학_등급=VALUES(수학_등급),
                영어_원점수=VALUES(영어_원점수), 영어_등급=VALUES(영어_등급),
                한국사_원점수=VALUES(한국사_원점수), 한국사_등급=VALUES(한국사_등급),
                탐구1_선택과목=VALUES(탐구1_선택과목), 탐구1_원점수=VALUES(탐구1_원점수), 탐구1_표준점수=VALUES(탐구1_표준점수), 탐구1_백분위=VALUES(탐구1_백분위), 탐구1_등급=VALUES(탐구1_등급),
                탐구2_선택과목=VALUES(탐구2_선택과목), 탐구2_원점수=VALUES(탐구2_원점수), 탐구2_표준점수=VALUES(탐구2_표준점수), 탐구2_백분위=VALUES(탐구2_백분위), 탐구2_등급=VALUES(탐구2_등급);
        `;
        const params = [
            savedData.student_id, savedData.학년도, savedData.입력유형,
            savedData.국어_선택과목, savedData.국어_원점수, savedData.국어_표준점수, savedData.국어_백분위, savedData.국어_등급,
            savedData.수학_선택과목, savedData.수학_원점수, savedData.수학_표준점수, savedData.수학_백분위, savedData.수학_등급,
            savedData.영어_원점수, savedData.영어_등급,
            savedData.한국사_원점수, savedData.한국사_등급,
            savedData.탐구1_선택과목, savedData.탐구1_원점수, savedData.탐구1_표준점수, savedData.탐구1_백분위, savedData.탐구1_등급,
            savedData.탐구2_선택과목, savedData.탐구2_원점수, savedData.탐구2_표준점수, savedData.탐구2_백분위, savedData.탐구2_등급
        ];

        await conn.query(sql, params);
        await conn.commit();
        
        res.json({ success: true, message: '성적이 저장되었습니다.', savedData: savedData });

    } catch (err) {
        await conn.rollback();
        console.error('❌ [학생 API] 내 성적 저장 오류:', err); 
        res.status(500).json({ success: false, message: '서버 오류 발생', error: err.message }); 
    } finally {
        conn.release();
    }
});

// app.post('/jungsi/student/save-university', authStudentOnlyMiddleware, async (req, res) => {
//     // ⭐️ account_id 와 jungsi_student_id 모두 사용
//     const { student_id: jungsiStudentId } = req; 
//     const { account_id: studentAccountId } = req.user; // 토큰에서 가져옴
//     const { universityId, 학년도 } = req.body; 

//     console.log(`[API /student/save-university v3] 계정ID: ${studentAccountId}, 정시ID: ${jungsiStudentId}, 학년도: ${학년도}, 대학ID: ${universityId} 저장 요청`);

//     if (!universityId || !학년도 || !studentAccountId || !jungsiStudentId) {
//         return res.status(400).json({ success: false, message: '필수 정보 누락 (학생ID, 대학ID, 학년도)' });
//     }

//     try {
//         // --- 1. 학생 성적(S_data) 조회 (jungsi DB) ---
//         const studentScoreSql = `
//             SELECT * FROM 학생수능성적 
//             WHERE student_id = ? AND 학년도 = ?`;
//         const [scoreRows] = await db.query(studentScoreSql, [jungsiStudentId, 학년도]); // jungsi DB 사용
        
//         if (scoreRows.length === 0) {
//             console.log(` -> 학생 성적 없음 (정시ID: ${jungsiStudentId}, Year: ${학년도})`);
//             return res.status(404).json({ success: false, message: '수능 성적 정보가 없습니다. 마이페이지에서 먼저 입력해주세요.' });
//         }
//         const studentScoreData = scoreRows[0];
        
//         // S_data 객체 만들기 (jungsical.js 요구 형식)
//         const S_data = {
//              subjects: [
//                 { name: '국어', subject: studentScoreData.국어_선택과목, std: studentScoreData.국어_표준점수, percentile: studentScoreData.국어_백분위, grade: studentScoreData.국어_등급 },
//                 { name: '수학', subject: studentScoreData.수학_선택과목, std: studentScoreData.수학_표준점수, percentile: studentScoreData.수학_백분위, grade: studentScoreData.수학_등급 },
//                 { name: '영어', grade: studentScoreData.영어_등급 },
//                 { name: '한국사', grade: studentScoreData.한국사_등급 },
//                 // 탐구 과목이 있을 경우에만 배열에 추가
//                 ...(studentScoreData.탐구1_선택과목 ? [{ 
//                     name: '탐구', 
//                     subject: studentScoreData.탐구1_선택과목, 
//                     std: studentScoreData.탐구1_표준점수, 
//                     percentile: studentScoreData.탐구1_백분위, 
//                     grade: studentScoreData.탐구1_등급 
//                 }] : []),
//                 ...(studentScoreData.탐구2_선택과목 ? [{ 
//                     name: '탐구', 
//                     subject: studentScoreData.탐구2_선택과목, 
//                     std: studentScoreData.탐구2_표준점수, 
//                     percentile: studentScoreData.탐구2_백분위, 
//                     grade: studentScoreData.탐구2_등급 
//                 }] : [])
//             ]
//         };
//         console.log(` -> 학생 성적(S_data) 조회 완료`);

//         // --- 2. 대학 정보(F_data) 조회 (jungsi DB) ---
//         const formulaSql = `
//             SELECT b.*, r.* FROM \`정시기본\` AS b 
//             JOIN \`정시반영비율\` AS r ON b.U_ID = r.U_ID AND b.학년도 = r.학년도 
//             WHERE b.U_ID = ? AND b.학년도 = ?`;
//         const [formulaRows] = await db.query(formulaSql, [universityId, 학년도]); // jungsi DB 사용
        
//         if (formulaRows.length === 0) {
//              console.log(` -> 대학 정보 없음 (ID: ${universityId}, Year: ${학년도})`);
//             return res.status(404).json({ success: false, message: '대학 정보를 찾을 수 없습니다.' });
//         }
//         const F_data = formulaRows[0];
//         const 모집군 = F_data.군; // 군 정보 저장 (저장에는 안 쓰지만 로깅용)
//         console.log(` -> 대학 정보(F_data) 조회 완료 (군: ${모집군})`);

//         // --- 3. 계산용 추가 정보 조회 (jungsi DB) ---
//         const convSql = `
//             SELECT 계열, 백분위, 변환표준점수 
//             FROM \`정시탐구변환표준\` 
//             WHERE U_ID=? AND 학년도=?`;
//         const [convRows] = await db.query(convSql, [universityId, 학년도]);
//         const convMap = { '사탐': {}, '과탐': {} };
//         convRows.forEach(r => { 
//             if (convMap[r.계열]) { // 사탐, 과탐 외 다른 값이 들어오는 것 방지
//                 convMap[r.계열][String(r.백분위)] = Number(r.변환표준점수); 
//             }
//         });
//         F_data.탐구변표 = convMap; // F_data 객체에 변표 정보 추가
        
//         const cfg = safeParse(F_data.score_config, {}) || {}; // safeParse 함수 필요
//         // 최고표점 로딩 조건 (jungsical.js와 동일하게)
//         const mustLoadYearMax = 
//             cfg?.korean_math?.max_score_method === 'highest_of_year' ||
//             cfg?.inquiry?.max_score_method     === 'highest_of_year' ||
//             (F_data.계산유형 === '특수공식'); 
            
//         let highestMap = null;
//         if (mustLoadYearMax) {
//             const exam = cfg?.highest_exam || '수능';
//             // loadYearHighestMap 함수는 jungsical.js 에서 require 해야 함
//             highestMap = await loadYearHighestMap(db, 학년도, exam); 
//         }
//         console.log(` -> 계산용 추가 정보 조회 완료 (highestMap 로드 여부: ${!!highestMap})`);

//         // --- 4. 점수 계산 (jungsical 함수 사용) ---
//         let calculatedScore = null;
//         try {
//             // calculateScoreWithConv 함수는 jungsical.js 에서 require 해야 함
//             const result = calculateScoreWithConv(F_data, S_data, convMap, null, highestMap); // 로그 콜백 null
//             calculatedScore = result.totalScore ? parseFloat(result.totalScore) : null;
//              console.log(` -> 점수 계산 완료: ${calculatedScore}`);
//         } catch (calcError) { 
//              console.error(` -> 점수 계산 중 오류 발생:`, calcError); 
//              // 계산 실패 시 calculatedScore는 null 유지
//         }

//         // --- 5. 학생 DB에 저장 (jungsimaxstudent DB 사용!) ---
//         try {
//             const insertSql = `
//                 INSERT INTO jungsimaxstudent.student_saved_universities 
//                     (account_id, U_ID, 학년도, calculated_suneung_score) VALUES (?, ?, ?, ?)
//                 ON DUPLICATE KEY UPDATE 
//                     calculated_suneung_score = VALUES(calculated_suneung_score), 
//                     saved_at = NOW()`;
//             // ⭐️ dbStudent 사용! account_id 사용!
//             const [insertResult] = await dbStudent.query(insertSql, [studentAccountId, universityId, 학년도, calculatedScore]); 
            
//             console.log(` -> 학생 DB 저장/업데이트 완료 (Rows affected: ${insertResult.affectedRows})`);
            
//             // affectedRows: 1이면 INSERT 성공, 2이면 UPDATE 성공 (ON DUPLICATE KEY UPDATE의 특징)
//             const isUpdate = insertResult.affectedRows === 2;
//             const message = isUpdate ? '이미 저장된 대학 (점수 업데이트됨).' : '저장대학 목록에 추가됨!';
            
//             res.json({ 
//                 success: true, 
//                 message: message, 
//                 calculatedScore: calculatedScore, 
//                 savedId: insertResult.insertId, // INSERT 시 ID 반환, UPDATE 시 0 또는 기존 ID 반환 (MySQL 버전에 따라 다름)
//                 updated: isUpdate 
//             });

//         } catch (dbError) {
//              console.error('❌ 학생 DB 저장 오류:', dbError);
//              throw dbError; 
//         }

//     } catch (err) {
//         console.error('❌ /student/save-university API 최종 오류:', err);
//         // 여기서 rollback은 필요 없음 (트랜잭션 미사용)
//         res.status(500).json({ success: false, message: err.message || '서버 처리 중 오류 발생' });
//     } 
//     // finally 불필요 (풀 자동 반환)
// });

app.post('/jungsi/student/save-university', authStudentOnlyMiddleware, async (req, res) => {
    // ⭐️ account_id 와 jungsi_student_id 모두 사용
    const { student_id: jungsiStudentId } = req;
    const { account_id: studentAccountId } = req.user; // 토큰에서 가져옴
    // ▼▼▼▼▼ 1. req.body에서 calculatedScore 받는지 확인! ▼▼▼▼▼
    const { universityId, 학년도, calculatedScore } = req.body; // ⭐️⭐️⭐️ calculatedScore 추가! ⭐️⭐️⭐️
    // ▲▲▲▲▲ 1. req.body에서 calculatedScore 받는지 확인! ▲▲▲▲▲

    console.log(`[API /student/save-university] 계정ID: ${studentAccountId}, 정시ID: ${jungsiStudentId}, 학년도: ${학년도}, 대학ID: ${universityId}, 점수: ${calculatedScore} 저장 요청`); // ⭐️ 로그에 점수 추가

    if (!universityId || !학년도 || !studentAccountId || !jungsiStudentId) {
        return res.status(400).json({ success: false, message: '필수 정보 누락 (학생ID, 대학ID, 학년도)' });
    }

    // --- 점수 계산 로직은 삭제 또는 주석 처리 ---

    // --- 학생 DB에 저장 (jungsimaxstudent DB 사용!) ---
    try {
        const insertSql = `
            INSERT INTO jungsimaxstudent.student_saved_universities
                (account_id, U_ID, 학년도, calculated_suneung_score) VALUES (?, ?, ?, ?) -- 컬럼 4개
            ON DUPLICATE KEY UPDATE
                calculated_suneung_score = VALUES(calculated_suneung_score), -- 업데이트 시에도 점수 반영
                saved_at = NOW()`;

        // ▼▼▼▼▼ 2. 쿼리 파라미터에 calculatedScore 넘겨주는지 확인! ▼▼▼▼▼
        const scoreToSave = (calculatedScore !== null && !isNaN(parseFloat(calculatedScore))) ? parseFloat(calculatedScore) : null;
        const [insertResult] = await dbStudent.query(insertSql, [studentAccountId, universityId, 학년도, scoreToSave]); // ⭐️⭐️⭐️ 파라미터 4개 확인! ⭐️⭐️⭐️
        // ▲▲▲▲▲ 2. 쿼리 파라미터에 calculatedScore 넘겨주는지 확인! ▲▲▲▲▲

        console.log(` -> 학생 DB 저장/업데이트 완료 (Rows affected: ${insertResult.affectedRows})`);
        const isUpdate = insertResult.affectedRows === 2;
        const message = isUpdate ? '이미 저장된 대학 (점수 업데이트됨).' : '저장대학 목록에 추가됨!';

        res.json({ success: true, message: message, calculatedScore: scoreToSave, savedId: insertResult.insertId, updated: isUpdate });

    } catch (dbError) {
         console.error('❌ 학생 DB 저장 오류:', dbError);
         res.status(500).json({ success: false, message: dbError.message || 'DB 저장 중 오류 발생' });
    }
});

app.get('/jungsi/student/saved-universities', authStudentOnlyMiddleware, async (req, res) => {
    const { account_id: studentAccountId } = req.user; // 학생 계정 DB ID
    console.log(`[API /student/saved-universities] 학생계정ID: ${studentAccountId} 저장 목록 조회 요청`);
      console.log(`[API /student/saved-universities] 학생계정ID: ${studentAccountId} 저장 목록 조회 요청`);
  console.log(`🔍 [DEBUG] 토큰 전체 정보:`, req.user); 
  console.log(`🔍 [DEBUG] account_id 타입:`, typeof studentAccountId, studentAccountId);  

    if (!studentAccountId) return res.status(403).json({ success: false, message: '학생 계정 ID 없음' });

    try {
        const sql = `
            SELECT 
                su.saved_id, su.U_ID, su.학년도, su.calculated_suneung_score, su.saved_at,
                jb.대학명, jb.학과명, jb.군, jb.logo_url -- jungsi DB에서 대학 정보 JOIN
            FROM jungsimaxstudent.student_saved_universities su -- 학생 DB 테이블
            JOIN jungsi.정시기본 jb ON su.U_ID = jb.U_ID AND su.학년도 = jb.학년도 -- jungsi DB 테이블 JOIN
            WHERE su.account_id = ?
            ORDER BY FIELD(jb.군, '가', '나', '다'), su.saved_at DESC; -- 군별 정렬, 최신순 정렬
        `;
        // ⭐️ dbStudent 풀 사용! account_id 사용!
        const [savedList] = await dbStudent.query(sql, [studentAccountId]); 
        
        console.log(` -> 저장된 대학 ${savedList.length}건 조회 완료`);
        res.json({ success: true, list: savedList });

    } catch (err) {
        console.error('❌ 학생 저장 대학 목록 조회 오류:', err);
        res.status(500).json({ success: false, message: 'DB 조회 중 오류 발생' });
    }
});

// =============================================
// ⭐️ 학생용 저장대학 삭제 API (신규)
// =============================================
// POST /jungsi/student/remove-university (DELETE 대신 POST 사용)
app.post('/jungsi/student/remove-university', authStudentOnlyMiddleware, async (req, res) => {
    const { account_id: studentAccountId } = req.user;
    const { savedId } = req.body; // 프론트에서 saved_id를 받음

    console.log(`[API /student/remove-university] 학생계정ID: ${studentAccountId}, 저장ID: ${savedId} 삭제 요청`);

    if (!savedId) return res.status(400).json({ success: false, message: '삭제할 항목 ID(savedId) 필요' });
    if (!studentAccountId) return res.status(403).json({ success: false, message: '학생 계정 ID 없음' });

    try {
        const deleteSql = `
            DELETE FROM jungsimaxstudent.student_saved_universities 
            WHERE saved_id = ? AND account_id = ? -- 본인 것만 삭제 가능하도록 account_id 조건 추가
        `;
        // ⭐️ dbStudent 풀 사용! account_id 사용!
        const [result] = await dbStudent.query(deleteSql, [savedId, studentAccountId]);

        if (result.affectedRows > 0) {
            console.log(` -> 저장된 대학 삭제 완료 (saved_id: ${savedId})`);
            res.json({ success: true, message: '저장 목록에서 삭제되었습니다.' });
        } else {
            console.log(` -> 삭제할 항목 없거나 권한 없음 (saved_id: ${savedId}, account_id: ${studentAccountId})`);
            res.status(404).json({ success: false, message: '삭제할 항목이 없거나 권한이 없습니다.' });
        }
    } catch (err) {
         console.error('❌ 학생 저장 대학 삭제 오류:', err);
         res.status(500).json({ success: false, message: 'DB 삭제 중 오류 발생' });
    }
});

app.get('/jungsi/public/schools/:year', async (req, res) => {
  const { year } = req.params;
  try {
    const [rows] = await db.promise().query(`
      SELECT 
        b.U_ID,
        b.대학명    AS university,
        b.학과명    AS department,
        b.군        AS gun,
        b.광역      AS regionWide,
        b.시구      AS regionLocal,
        b.교직      AS teacher,
        b.모집정원  AS quota
      FROM 정시기본 b
      WHERE b.학년도 = ?
      ORDER BY b.U_ID ASC
    `, [year]);

    res.json({ success:true, list: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success:false, message:'DB 오류' });
  }
});

/* ===========================
   특정 학교 실기종목 조회
   =========================== */
app.post('/jungsi/public/school-details', authMiddleware, async (req, res) => {
  const { U_ID, year } = req.body;
  if (!U_ID || !year) {
    return res.status(400).json({ success:false, message:'U_ID 또는 year 누락' });
  }

  try {
    const [rows] = await db.promise().query(`
      SELECT DISTINCT 종목명
      FROM 정시실기배점
      WHERE U_ID = ? AND 학년도 = ?
    `, [U_ID, year]);

    const events = rows.map(r => r.종목명?.trim()).filter(Boolean);
    res.json({ success:true, data:{ U_ID, events } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success:false, message:'DB 오류' });
  }
});

/* ===========================
   학생 개인 선호 저장
   =========================== */
app.post('/jungsi/public/save-preference', authMiddleware, async (req, res) => {
  let { year, picks, student_id } = req.body;
  if (req.user.role === 'student') student_id = req.user.user_id;
  if (!student_id || !year || !picks)
    return res.status(400).json({ success:false, message:'필수값 누락' });

  const guns = ['가','나','다'];
  for (const g of guns) {
    const arr = Array.isArray(picks[g]) ? picks[g] : [];
    if (arr.length > 3)
      return res.status(400).json({ success:false, message:`${g}군 최대 3개 제한` });
  }

  try {
    const gun_ga = JSON.stringify(picks['가'] || []);
    const gun_na = JSON.stringify(picks['나'] || []);
    const gun_da = JSON.stringify(picks['다'] || []);
    await db.promise().query(`
      INSERT INTO jungsimaxstudent (student_id, year, gun_ga, gun_na, gun_da, updated_at)
      VALUES (?, ?, ?, ?, ?, NOW())
      ON DUPLICATE KEY UPDATE
        gun_ga = VALUES(gun_ga),
        gun_na = VALUES(gun_na),
        gun_da = VALUES(gun_da),
        updated_at = NOW()
    `, [student_id, year, gun_ga, gun_na, gun_da]);

    res.json({ success:true, message:'저장 완료' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success:false, message:'DB 오류' });
  }
});

/* ===========================
   학생 개인 선호 불러오기
   =========================== */
app.get('/jungsi/public/get-preference/:year', authMiddleware, async (req, res) => {
  const { year } = req.params;
  let student_id = req.query.student_id;
  if (req.user.role === 'student') student_id = req.user.user_id;
  if (!student_id)
    return res.status(400).json({ success:false, message:'student_id 누락' });

  try {
    const [rows] = await db.promise().query(`
      SELECT gun_ga, gun_na, gun_da
      FROM jungsimaxstudent
      WHERE student_id = ? AND year = ?
      LIMIT 1
    `, [student_id, year]);

    if (!rows.length)
      return res.json({ success:true, picks:{ '가':[], '나':[], '다':[] } });

    const { gun_ga, gun_na, gun_da } = rows[0];
    res.json({
      success:true,
      picks:{
        '가': JSON.parse(gun_ga || '[]'),
        '나': JSON.parse(gun_na || '[]'),
        '다': JSON.parse(gun_da || '[]')
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success:false, message:'DB 오류' });
  }
});

// jungsi.js 파일의 app.listen(...) 바로 위에 추가

// ⭐️ [신규 API] 학생용 - 필터링에 사용할 '광역' 지역 목록 조회
app.get('/jungsi/public/regions/:year', async (req, res) => {
    const { year } = req.params;
    if (!year) {
        return res.status(400).json({ success: false, message: '학년도(year)가 필요합니다.' });
    }

    console.log(`[API /public/regions] Year: ${year} 지역 목록 요청`);

    try {
        const sql = `
            SELECT DISTINCT 광역 
            FROM 정시기본 
            WHERE 학년도 = ? AND 광역 IS NOT NULL AND 광역 != ''
            ORDER BY 
                CASE 
                    WHEN 광역 = '서울' THEN 1
                    WHEN 광역 = '경기' THEN 2
                    WHEN 광역 = '인천' THEN 3
                    ELSE 4 
                END, 광역 ASC
        `;
        const [rows] = await db.query(sql, [year]);
        
        // ['서울', '경기', '인천', '강원', ...] 형태의 배열로 변환
        const regions = rows.map(r => r.광역); 
        
        console.log(` -> Found ${regions.length} regions.`);
        res.json({ success: true, regions: regions });

    } catch (err) {
        console.error("❌ 지역 목록 조회 API 오류:", err);
        res.status(500).json({ success: false, message: "DB 오류", error: err.message });
    }
});

// =============================================
// ⭐️ [신규] 학생 성적 기록 저장 API (saved_list.html 용)
// =============================================
// POST /jungsi/student/save-history
// jungsi.js 파일의 app.listen(...) 바로 위에 있는
// 기존 /jungsi/student/save-history API를 이걸로 교체!

// =============================================
// ⭐️ [신규] 학생 성적 기록 저장 API (하루 한 번 UPSERT 로직)
// =============================================
// POST /jungsi/student/save-history
app.post('/jungsi/student/save-history', authStudentOnlyMiddleware, async (req, res) => {
    // 1. 학생 ID (account_id) 가져오기
    const { account_id: studentAccountId } = req.user;

    // 2. 프론트엔드(모달)에서 보낸 점수 정보 받기
    const {
        U_ID,
        year, // 학년도
        suneungScore,
        naeshinScore,
        silgiRecordsJson, // 실기 세부 기록 (JSON 배열)
        silgiScore,
        totalScore
    } = req.body;

    console.log(`[API /save-history] 학생(${studentAccountId}) 대학(${U_ID}) ${year}학년도 점수 기록 저장/업데이트 요청:`, req.body);

    // 3. 필수 값 확인
    if (!studentAccountId || !U_ID || !year) {
        return res.status(400).json({ success: false, message: '학생ID, 대학ID, 학년도 정보가 필요합니다.' });
    }

    // 4. DB 작업 (트랜잭션 사용)
    let connection;
    try {
        connection = await dbStudent.getConnection(); // dbStudent 풀 사용
        await connection.beginTransaction(); // ⭐️ 트랜잭션 시작

        // 5. ⭐️ 오늘 날짜(CURDATE())로 이미 저장된 기록이 있는지 확인 (FOR UPDATE로 잠금)
        const checkSql = `
            SELECT history_id FROM student_score_history
            WHERE account_id = ? AND U_ID = ? AND 학년도 = ? AND DATE(record_date) = CURDATE()
            LIMIT 1
            FOR UPDATE
        `;
        const [existingRows] = await connection.query(checkSql, [studentAccountId, U_ID, year]);

        // 6. 저장할 파라미터 준비
        const params = [
            suneungScore || null,
            naeshinScore || null,
            silgiRecordsJson ? JSON.stringify(silgiRecordsJson) : null,
            silgiScore || null,
            totalScore || null
        ];

        if (existingRows.length > 0) {
            // 7a. ⭐️ 오늘 기록이 있으면: UPDATE (점수 덮어쓰고, 시간도 최신으로 갱신)
            const existingHistoryId = existingRows[0].history_id;
            console.log(` -> 기존 기록(${existingHistoryId}) 발견. 오늘 날짜로 업데이트합니다.`);
            
            const updateSql = `
                UPDATE student_score_history SET
                    suneung_score = ?, 
                    naeshin_score = ?, 
                    silgi_records_json = ?,
                    silgi_score = ?, 
                    total_score = ?, 
                    record_date = NOW()
                WHERE history_id = ?
            `;
            await connection.query(updateSql, [...params, existingHistoryId]);
            await connection.commit(); // ⭐️ 커밋
            
            res.json({ 
                success: true, 
                message: '오늘의 성적 기록을 업데이트했습니다.', 
                historyId: existingHistoryId, 
                updated: true // ⭐️ 프론트에 업데이트 되었다고 알려줌
            });

        } else {
            // 7b. ⭐️ 오늘 기록이 없으면: INSERT (새 기록 추가)
            console.log(" -> 오늘 기록 없음. 새 기록을 추가합니다.");
            
            const insertSql = `
                INSERT INTO student_score_history
                    (account_id, U_ID, 학년도, suneung_score, naeshin_score,
                     silgi_records_json, silgi_score, total_score, record_date)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
            `;
            const [result] = await connection.query(insertSql, [studentAccountId, U_ID, year, ...params]);
            await connection.commit(); // ⭐️ 커밋
            
            res.status(201).json({ 
                success: true, 
                message: '성적 기록이 새로 저장되었습니다.', 
                historyId: result.insertId, 
                updated: false // ⭐️ 프론트에 새로 추가되었다고 알려줌
            });
        }

    } catch (err) {
        if (connection) await connection.rollback(); // ⭐️ 에러 시 롤백
        console.error('❌ 학생 성적 기록 저장/업데이트 API 오류:', err);
        res.status(500).json({ success: false, message: 'DB 처리 중 오류 발생', error: err.message });
    } finally {
        if (connection) connection.release(); // ⭐️ 커넥션 반환
    }
});

// GET /jungsi/student/get-history/:uid/:year API는 수정할 필요 없어! (그대로 두면 됨)
// =============================================
// ⭐️ [신규] 학생 성적 기록 조회 API (history_view.html 용)
// =============================================
// GET /jungsi/student/get-history/:uid/:year
app.get('/jungsi/student/get-history/:uid/:year', authStudentOnlyMiddleware, async (req, res) => {
    // 1. 학생 ID (account_id) 가져오기
    const { account_id: studentAccountId } = req.user;
    
    // 2. URL 파라미터에서 대학ID, 학년도 가져오기
    const { uid, year } = req.params;
    const U_ID = uid; // 변수명 맞추기

    console.log(`[API /get-history] 학생(${studentAccountId}) 대학(${U_ID}) ${year}학년도 기록 조회 요청`);

    // 3. DB에서 조회 (dbStudent 사용)
    try {
        const selectSql = `
            SELECT 
                history_id, 
                record_date, 
                suneung_score, 
                naeshin_score, 
                silgi_records_json, 
                silgi_score, 
                total_score
            FROM student_score_history
            WHERE account_id = ? AND U_ID = ? AND 학년도 = ?
            ORDER BY record_date DESC -- 최신순으로 정렬
        `;
        
        const [historyList] = await dbStudent.query(selectSql, [studentAccountId, U_ID, year]);
        
        console.log(` -> ${historyList.length}건 조회 완료`);

        // (중요) silgi_records_json 컬럼 타입이 JSON 이라면
        // mysql2에서 이미 JS 객체(배열)로 넘어오기 때문에
        // 여기서 JSON.parse를 다시 할 필요가 없다.
        // 그대로 프론트로 전달하면 history_view.html 에서 바로 쓸 수 있음.
        if (historyList.length > 0) {
            console.log('예시 history row:', {
                history_id: historyList[0].history_id,
                silgi_type: typeof historyList[0].silgi_records_json,
                silgi_value: historyList[0].silgi_records_json
            });
        }
        
        // 그대로 전달
        res.json({ success: true, history: historyList });

    } catch (err) {
        console.error('❌ 학생 성적 기록 조회 API 오류:', err);
        res.status(500).json({
            success: false,
            message: 'DB 조회 중 오류 발생',
            error: err.message
        });
    }
});

// jungsi.js 파일 하단 app.listen(...) 바로 위에 추가

// =============================================
// ⭐️ [신규] 학생 실기 훈련 관련 API (5개)
// =============================================

// --- 헬퍼 함수 (silgical.js 에서 가져옴 - getEventRules) ---
function getEventRules(eventName) {
    eventName = eventName || '';
    const LOW_IS_BETTER_KEYWORDS = [ 'm', 'run', '런', '왕복', '초', '벽','지그','z' ];
    let method = 'higher_is_better';
    if (LOW_IS_BETTER_KEYWORDS.some((k) => eventName.includes(k))) {
        method = 'lower_is_better';
    }
    if (eventName.includes('던지기') || eventName.includes('멀리뛰기')) {
        method = 'higher_is_better';
    }
    return { method };
}


// --- API 1: 내 운동 종목 설정 저장/수정 ---
// POST /jungsi/student/practical/settings
app.post('/jungsi/student/practical/settings', authStudentOnlyMiddleware, async (req, res) => {
    const { account_id } = req.user; // 미들웨어에서 account_id 주입 가정
    const { tracked_events } = req.body; // 프론트에서 ["종목1", "종목2"] 형태의 배열 전송 예상

    console.log(`[API /practical/settings] 학생(${account_id}) 추적 종목 설정 요청:`, tracked_events);

    if (!Array.isArray(tracked_events)) {
        return res.status(400).json({ success: false, message: 'tracked_events는 배열 형태여야 합니다.' });
    }

    try {
        const sql = `
            INSERT INTO jungsimaxstudent.student_practical_settings (account_id, tracked_events)
            VALUES (?, ?)
            ON DUPLICATE KEY UPDATE tracked_events = VALUES(tracked_events), updated_at = NOW()
        `;
        // 배열을 JSON 문자열로 변환하여 저장
        await dbStudent.query(sql, [account_id, JSON.stringify(tracked_events)]);

        console.log(` -> 설정 저장 완료`);
        res.json({ success: true, message: '추적할 운동 종목 설정을 저장했습니다.' });

    } catch (err) {
        console.error('❌ 학생 운동 설정 저장 오류:', err);
        res.status(500).json({ success: false, message: 'DB 저장 중 오류 발생' });
    }
});


// --- API 2: 종목별 목표 저장/수정 ---
// POST /jungsi/student/practical/goal
app.post('/jungsi/student/practical/goal', authStudentOnlyMiddleware, async (req, res) => {
    const { account_id } = req.user;
    const { event_name, goal_value } = req.body; // 프론트에서 종목명과 목표값 전송

    console.log(`[API /practical/goal] 학생(${account_id}) 종목(${event_name}) 목표(${goal_value}) 설정 요청`);

    if (!event_name || goal_value === undefined || goal_value === null || goal_value === '') {
        return res.status(400).json({ success: false, message: '종목명(event_name)과 목표값(goal_value)은 필수입니다.' });
    }

    const goalValueNum = parseFloat(goal_value);
    if (isNaN(goalValueNum) || goalValueNum < 0) {
         // 목표 삭제 요청으로 간주 (음수나 빈 문자열 등) -> 실제로는 null 또는 0 저장
         console.log(` -> 목표 삭제 요청으로 처리 (값: ${goal_value})`);
         // 여기서 해당 레코드를 DELETE 하거나, goal_value를 null로 업데이트 할 수 있음
         // 여기서는 UPSERT를 이용해 0 또는 null로 업데이트하는 방식 선택
         // (만약 삭제를 원하면 DELETE 쿼리 추가)
         // goalValueNum = null; // null 허용 시
    }


    try {
        const sql = `
            INSERT INTO jungsimaxstudent.student_practical_goals (account_id, event_name, goal_value)
            VALUES (?, ?, ?)
            ON DUPLICATE KEY UPDATE goal_value = VALUES(goal_value), updated_at = NOW()
        `;
        // 목표값이 유효하지 않으면 0 저장 (또는 null 허용 시 null)
        const valueToSave = (isNaN(goalValueNum) || goalValueNum < 0) ? 0 : goalValueNum;
        await dbStudent.query(sql, [account_id, event_name, valueToSave]);

        console.log(` -> 목표 저장/수정 완료`);
        res.json({ success: true, message: `[${event_name}] 목표 기록을 저장했습니다.` });

    } catch (err) {
        console.error('❌ 학생 운동 목표 저장 오류:', err);
        res.status(500).json({ success: false, message: 'DB 저장 중 오류 발생' });
    }
});


// --- API 3: 오늘 훈련 기록 추가 (+ 하루 3개 제한) ---
// POST /jungsi/student/practical/record
app.post('/jungsi/student/practical/record', authStudentOnlyMiddleware, async (req, res) => {
    const { account_id } = req.user;
    const { event_name, record_date, record_value } = req.body; // 프론트에서 종목명, 날짜, 기록값 전송

    console.log(`[API /practical/record] 학생(${account_id}) 종목(${event_name}) 날짜(${record_date}) 기록(${record_value}) 추가 요청`);

    if (!event_name || !record_date || record_value === undefined || record_value === null || record_value === '') {
        return res.status(400).json({ success: false, message: '종목명, 날짜, 기록값은 필수입니다.' });
    }
    const recordValueNum = parseFloat(record_value);
    if (isNaN(recordValueNum) || recordValueNum < 0) {
        return res.status(400).json({ success: false, message: '기록값은 0 이상의 숫자여야 합니다.' });
    }
    // 날짜 형식 검사 (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(record_date)) {
        return res.status(400).json({ success: false, message: '날짜 형식이 올바르지 않습니다 (YYYY-MM-DD).' });
    }

    let connection;
    try {
        connection = await dbStudent.getConnection();
        await connection.beginTransaction(); // 트랜잭션 시작

        // ⭐️ 1. 해당 날짜, 해당 종목의 기존 기록 개수 확인
        const countSql = `
            SELECT COUNT(*) as count FROM jungsimaxstudent.student_practical_records
            WHERE account_id = ? AND event_name = ? AND record_date = ?
        `;
        const [countRows] = await connection.query(countSql, [account_id, event_name, record_date]);
        const currentCount = countRows[0].count;

        console.log(` -> ${record_date} ${event_name} 현재 기록 개수: ${currentCount}`);

        // ⭐️ 2. 3개 이상이면 에러 반환
        if (currentCount >= 3) {
            await connection.rollback(); // 롤백하고 종료
            console.log(` -> 저장 개수 제한 초과 (최대 3개)`);
            return res.status(429).json({ success: false, message: `[${event_name}] 종목은 하루에 최대 3개의 기록만 저장할 수 있습니다.` }); // 429 Too Many Requests
        }

        // ⭐️ 3. 3개 미만이면 INSERT 실행
        const insertSql = `
            INSERT INTO jungsimaxstudent.student_practical_records (account_id, event_name, record_date, record_value)
            VALUES (?, ?, ?, ?)
        `;
        const [result] = await connection.query(insertSql, [account_id, event_name, record_date, recordValueNum]);

        await connection.commit(); // 커밋 (최종 저장)
        console.log(` -> 기록 추가 성공 (ID: ${result.insertId})`);
        res.status(201).json({ success: true, message: '훈련 기록이 추가되었습니다.', recordId: result.insertId });

    } catch (err) {
        if (connection) await connection.rollback(); // 에러 시 롤백
        console.error('❌ 학생 훈련 기록 추가 오류:', err);
        res.status(500).json({ success: false, message: 'DB 저장 중 오류 발생' });
    } finally {
        if (connection) connection.release(); // 커넥션 반환
    }
});


// --- API 4: 대시보드 데이터 (설정+목표+기록) 한 번에 불러오기 ---
// GET /jungsi/student/practical/dashboard
// --- API 4: 대시보드 데이터 ... ---
app.get('/jungsi/student/practical/dashboard', authStudentOnlyMiddleware, async (req, res) => {
    const { account_id } = req.user;
    console.log(`[API /practical/dashboard] 학생(${account_id}) 대시보드 데이터 요청`);

    try {
        const [settingsRows] = await dbStudent.query(
            'SELECT tracked_events FROM jungsimaxstudent.student_practical_settings WHERE account_id = ?',
            [account_id]
        );
        let trackedEvents = [];
        if (settingsRows.length > 0 && settingsRows[0].tracked_events) {
            const rawDbValue = settingsRows[0].tracked_events;
            console.log(`>>> DEBUG: Raw DB value for tracked_events:`, rawDbValue);
            console.log(`>>> DEBUG: Typeof raw DB value:`, typeof rawDbValue);

            try {
                // ⭐️ 수정된 로직: 타입 체크 후 처리
                if (Array.isArray(rawDbValue)) {
                    // Case 1: 이미 배열 (mysql2가 파싱해준 경우)
                    trackedEvents = rawDbValue;
                    console.log(` -> DB value is already an array.`);
                } else if (typeof rawDbValue === 'string') {
                    // Case 2: 문자열 (파싱 시도)
                    trackedEvents = JSON.parse(rawDbValue);
                    if (!Array.isArray(trackedEvents)) { // 파싱 결과가 배열이 아니면 실패 처리
                         console.warn(` -> Parsed result is not an array:`, trackedEvents);
                         trackedEvents = [];
                    } else {
                         console.log(` -> DB value parsed from string.`);
                    }
                } else {
                    // Case 3: 예상 못한 타입 (NULL, object 등) -> 빈 배열 처리
                     console.warn(` -> Unexpected data type from DB: ${typeof rawDbValue}, treating as empty.`);
                     trackedEvents = [];
                }
            } catch (parseError) {
                 // JSON.parse 실패 시
                 console.error(` -> JSON parsing error (account_id: ${account_id}):`, rawDbValue, parseError);
                 trackedEvents = [];
            }
        }
        console.log(` -> Final trackedEvents (${trackedEvents.length} items):`, trackedEvents);

        // 2. 학생 목표 조회 (모든 종목)
        const [goalRows] = await dbStudent.query(
            'SELECT event_name, goal_value FROM jungsimaxstudent.student_practical_goals WHERE account_id = ?',
            [account_id]
        );
        const goalsMap = {}; // { '종목명': 목표값, ... } 형태로 변환
        goalRows.forEach(row => { goalsMap[row.event_name] = Number(row.goal_value); });
        console.log(` -> 목표 (${goalRows.length}개):`, goalsMap);

        // 3. 학생 기록 조회 (모든 종목, 모든 날짜)
        const [recordRows] = await dbStudent.query(
            'SELECT event_name, record_date, record_value FROM jungsimaxstudent.student_practical_records WHERE account_id = ? ORDER BY record_date ASC', // 날짜 오름차순
            [account_id]
        );
        const recordsMap = {}; // { '종목명': [ {date, value}, ... ], ... } 형태로 변환
        recordRows.forEach(row => {
            const event = row.event_name;
            if (!recordsMap[event]) recordsMap[event] = [];
            // DB DATE 타입을 YYYY-MM-DD 문자열로 변환
            const dateOnly = row.record_date.toISOString().split('T')[0];
            recordsMap[event].push({ date: dateOnly, value: Number(row.record_value) });
        });
        console.log(` -> 기록 (${recordRows.length}개 로드 완료)`);

        // --- 캐싱 방지 헤더 추가 ---
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.setHeader('Surrogate-Control', 'no-store');
        // --- 캐싱 방지 헤더 추가 끝 ---

        // 4. 결과 조합하여 응답
        res.json({
            success: true,
            dashboard: {
                settings: { trackedEvents: trackedEvents },
                goals: goalsMap,
                records: recordsMap
            }
        });

    } catch (err) {
        console.error('❌ 대시보드 데이터 로드 오류:', err);
        res.status(500).json({ success: false, message: '데이터 로드 중 오류 발생' });
    }
});

// --- API 5: 오늘 최고 기록만 불러오기 (saved_list.html 연동용) ---
// GET /jungsi/student/practical/today-best
app.get('/jungsi/student/practical/today-best', authStudentOnlyMiddleware, async (req, res) => {
    const { account_id } = req.user;
    console.log(`[API /practical/today-best] 학생(${account_id}) 오늘 최고 기록 요청`);

    try {
        // 1. 오늘 날짜(CURDATE())의 모든 기록 조회
        const sql = `
            SELECT event_name, record_value
            FROM jungsimaxstudent.student_practical_records
            WHERE account_id = ? AND record_date = CURDATE()
        `;
        const [todayRecords] = await dbStudent.query(sql, [account_id]);

        if (todayRecords.length === 0) {
            console.log(` -> 오늘 기록 없음`);
            return res.json({ success: true, bestRecords: {} }); // 기록 없으면 빈 객체 반환
        }

        // 2. 종목별 최고 기록 집계
        const bestRecordsMap = {};
        todayRecords.forEach(record => {
            const event = record.event_name;
            const value = Number(record.record_value);
            const { method } = getEventRules(event); // 기록 방식 확인 (lower/higher)

            if (bestRecordsMap[event] === undefined) {
                // 해당 종목의 첫 기록이면 그냥 저장
                bestRecordsMap[event] = value;
            } else {
                // 기존 최고 기록과 비교하여 업데이트
                if (method === 'lower_is_better' && value < bestRecordsMap[event]) {
                    bestRecordsMap[event] = value; // 더 낮은 값(더 좋은 기록)으로 업데이트
                } else if (method === 'higher_is_better' && value > bestRecordsMap[event]) {
                    bestRecordsMap[event] = value; // 더 높은 값(더 좋은 기록)으로 업데이트
                }
            }
        });

        console.log(` -> 오늘 최고 기록 (${Object.keys(bestRecordsMap).length} 종목):`, bestRecordsMap);
        res.json({ success: true, bestRecords: bestRecordsMap });

    } catch (err) {
        console.error('❌ 오늘 최고 기록 조회 오류:', err);
        res.status(500).json({ success: false, message: 'DB 조회 중 오류 발생' });
    }
});

app.get('/jungsi/public/practical-events', async (req, res) => {
    console.log(`[API /public/practical-events] 전체 실기 종목 목록 조회 요청`);

    try {
        // DB에서 중복 없이 모든 종목명 조회 (ORDER BY 추가)
        const sql = `
            SELECT DISTINCT 종목명 
            FROM jungsi.정시실기배점 
            WHERE 종목명 IS NOT NULL AND 종목명 != ''
            ORDER BY 종목명 ASC 
        `; // 가나다 순 정렬 추가
        const [rows] = await db.query(sql); // jungsi DB 사용

        // 결과 배열에서 '종목명' 값만 추출
        const eventNames = rows.map(row => row.종목명);

        console.log(` -> 총 ${eventNames.length}개의 실기 종목명 조회 완료`);
        res.json({ success: true, events: eventNames });

    } catch (err) {
        console.error('❌ 전체 실기 종목 목록 조회 오류:', err);
        res.status(500).json({ success: false, message: 'DB 조회 중 오류 발생' });
    }
});





// jungsi.js 파일

// ======================================================================
// ⭐️ 2. 학생용 공지사항 API (jungsimaxstudent DB 사용, 조회만 가능)
// ======================================================================

// GET /jungsi/student/announcements : 학생은 자기 지점 공지만 조회
// ======================================================================
// ⭐️ 2. 학생용 공지사항 API (jungsimaxstudent DB 사용, 조회만 가능)
// ======================================================================

// GET /jungsi/student/announcements : 학생은 자기 지점 공지만 조회
// --- 권한 확인 헬퍼 함수 (직급 또는 admin 역할 기반) ---
const hasAdminPermission = (user) => {
    // 토큰에 position 정보가 있는지 확인하고, 해당 직급인지 또는 role이 admin인지 체크
    // 26susi 로그인 시 토큰에 position 정보가 포함되어야 함
    return user && (
        (user.position && ['원장', '부원장', '팀장'].includes(user.position)) ||
        user.role === 'admin'
    );
};



// ======================================================================
// ⭐️ 학생 공지사항 관련 API (jungsimaxstudent DB 사용, Collation 수정됨)
// ======================================================================

// GET /jungsi/student/announcements : 공지사항 목록 조회 (선생님/원장/학생/관리자)
app.get('/jungsi/student/announcements', authMiddleware, async (req, res) => {
    const { branch, userid, role, position } = req.user;
    console.log(`[API GET /student/announcements] 사용자(${userid}, ${role}, ${position}) 공지사항 목록 조회 요청 (Branch: ${branch})`);
    try {
        // ⭐️ SQL 쿼리 수정: JOIN 시 COLLATE utf8mb4_unicode_ci 추가
        let sql = `
            SELECT
                a.notice_id, a.title, a.content, a.created_by, a.created_at, a.updated_at, a.branch_name,
                b.이름 AS author_name 
            FROM jungsimaxstudent.공지사항 a
            LEFT JOIN \`26susi\`.원장회원 b
            
              ON a.created_by COLLATE utf8mb4_unicode_ci = b.아이디 COLLATE utf8mb4_unicode_ci
            
        `; // WHERE 절 추가를 위해 세미콜론 제거
        const params = [];

        // 관리 권한 없으면 지점 필터링
        if (!hasAdminPermission(req.user)) {
             if (!branch) {
                 console.warn(` -> 사용자(${userid}) 토큰에 지점 정보 없음. 전체 공지만 조회합니다.`);
                 sql += ' WHERE a.branch_name IS NULL'; // 테이블 별칭 사용
             } else {
                 // 지점 정보 있으면 해당 지점 공지 + 전체 공지 조회
                 sql += ' WHERE (a.branch_name = ? OR a.branch_name IS NULL)'; // 테이블 별칭 사용 및 괄호 추가
                 params.push(branch);
             }
        } else {
            console.log(` -> 관리 권한 사용자(${userid}) 요청. 모든 공지사항을 조회합니다.`);
            // 관리자는 WHERE 조건 없이 조회
        }

        sql += ' ORDER BY a.created_at DESC'; // 최신순 정렬 (테이블 별칭 사용)
        const [announcements] = await dbStudent.query(sql, params); // dbStudent 사용!

        console.log(` -> 공지사항 ${announcements.length}건 조회 완료 (작성자 이름 포함)`);
        res.json({ success: true, announcements: announcements }); // author_name 포함된 데이터 전송

    } catch (err) {
        console.error('❌ 공지사항 조회 오류 (JOIN 포함):', err);
        if (err.code === 'ER_NO_SUCH_TABLE') {
             res.status(404).json({ success: false, message: '공지사항 또는 원장회원 테이블을 찾을 수 없습니다.' });
        } else if (err.code === 'ER_MIX_OF_COLLATION' || err.message.includes('Illegal mix of collations')) { // Collation 에러 더 확실하게 확인
             console.error(' -> Collation mix error confirmed.');
             res.status(500).json({ success: false, message: '데이터 정렬 방식 충돌 오류 발생. DB 컬럼 설정을 확인하세요.' });
        } else {
             res.status(500).json({ success: false, message: 'DB 조회 중 오류 발생' });
        }
    }
});
// --- API 2: 새 학생 공지 추가 (관리 권한 필요) ---
// POST /jungsi/admin/student-announcements/add
app.post('/jungsi/admin/student-announcements/add', authMiddleware, async (req, res) => {
    // ⭐️ 내부 권한 체크: hasAdminPermission() 사용
    if (!hasAdminPermission(req.user)) {
        console.warn(`[API POST /admin/student-announcements/add] 접근 거부: ${req.user?.userid} (Position: ${req.user?.position})`);
        return res.status(403).json({ success: false, message: '공지사항 작성 권한(원장/부원장/팀장)이 필요합니다.' });
    }

    const { title, content, target_branch } = req.body;
    const created_by = req.user.userid; // 작성자는 로그인한 사용자 ID
    const branchNameToSave = target_branch ? target_branch : null;
    console.log(`[API POST /admin/student-announcements/add] 사용자 (${created_by}, ${req.user.position}) 학생 공지 추가 요청: Target='${branchNameToSave || '전체'}', Title='${title}'`);
    if (!title) return res.status(400).json({ success: false, message: '제목 필수' });
    try {
        const [result] = await dbStudent.query(
            'INSERT INTO `jungsimaxstudent`.`공지사항` (title, content, created_by, branch_name) VALUES (?, ?, ?, ?)',
            [title, content || null, created_by, branchNameToSave]
        );
        console.log(` -> 학생 공지사항 추가 성공 (ID: ${result.insertId})`);
        res.status(201).json({ success: true, message: '학생 공지사항 추가됨', notice_id: result.insertId });
    } catch (err) {
        console.error('❌ 학생 공지사항 추가 오류:', err);
        res.status(500).json({ success: false, message: 'DB 삽입 중 오류 발생' });
    }
});

// --- API 3: 학생 공지 수정 (관리 권한 필요) ---
// PUT /jungsi/admin/student-announcements/update/:notice_id
app.put('/jungsi/admin/student-announcements/update/:notice_id', authMiddleware, async (req, res) => {
    // ⭐️ 내부 권한 체크: hasAdminPermission() 사용
    if (!hasAdminPermission(req.user)) {
        console.warn(`[API PUT /admin/student-announcements/update] 접근 거부: ${req.user?.userid} (Position: ${req.user?.position})`);
        return res.status(403).json({ success: false, message: '공지사항 수정 권한(원장/부원장/팀장)이 필요합니다.' });
    }

    const { notice_id } = req.params;
    const { title, content, target_branch } = req.body;
    const user_id = req.user.userid;
    const branchNameToSave = target_branch ? target_branch : null;
    console.log(`[API PUT /admin/student-announcements/update/${notice_id}] 사용자 (${user_id}, ${req.user.position}) 학생 공지 수정 요청: ...`);
    if (!title) return res.status(400).json({ success: false, message: '제목 필수' });
    try {
        // (선택적 강화: 본인 글만 수정 가능하게 하려면 created_by = ? 조건 추가)
        const [result] = await dbStudent.query(
            'UPDATE `jungsimaxstudent`.`공지사항` SET title = ?, content = ?, branch_name = ? WHERE notice_id = ?',
            [title, content || null, branchNameToSave, notice_id]
        );
        if (result.affectedRows > 0) {
            console.log(` -> 학생 공지사항 수정 성공 (ID: ${notice_id})`);
            res.json({ success: true, message: '학생 공지사항 수정됨' });
        } else {
             res.status(404).json({ success: false, message: '수정할 학생 공지사항 없음' });
        }
    } catch (err) {
        console.error('❌ 학생 공지사항 수정 오류:', err);
        res.status(500).json({ success: false, message: 'DB 수정 중 오류 발생' });
    }
});

// --- API 4: 학생 공지 삭제 (관리 권한 필요) ---
// DELETE /jungsi/admin/student-announcements/delete/:notice_id
app.delete('/jungsi/admin/student-announcements/delete/:notice_id', authMiddleware, async (req, res) => {
    // ⭐️ 내부 권한 체크: hasAdminPermission() 사용
    if (!hasAdminPermission(req.user)) {
        console.warn(`[API DELETE /admin/student-announcements/delete] 접근 거부: ${req.user?.userid} (Position: ${req.user?.position})`);
        return res.status(403).json({ success: false, message: '공지사항 삭제 권한(원장/부원장/팀장)이 필요합니다.' });
    }

    const { notice_id } = req.params;
    const user_id = req.user.userid;
    console.log(`[API DELETE /admin/student-announcements/delete/${notice_id}] 사용자 (${user_id}, ${req.user.position}) 학생 공지 삭제 요청`);
    try {
        // (선택적 강화: 본인 글만 삭제 가능하게 하려면 created_by = ? 조건 추가)
        const [result] = await dbStudent.query(
            'DELETE FROM `jungsimaxstudent`.`공지사항` WHERE notice_id = ?',
            [notice_id]
        );
        if (result.affectedRows > 0) {
            console.log(` -> 학생 공지사항 삭제 성공 (ID: ${notice_id})`);
            res.json({ success: true, message: '학생 공지사항 삭제됨' });
        } else {
            res.status(404).json({ success: false, message: '삭제할 학생 공지사항 없음' });
        }
    } catch (err) {
        console.error('❌ 학생 공지사항 삭제 오류:', err);
        res.status(500).json({ success: false, message: 'DB 삭제 중 오류 발생' });
    }
});
// GET /jungsi/admin/student-branches API는 공개 API로 뒀으니 그대로 두면 됨.

app.get('/jungsi/admin/student-branches', async (req, res) => { // ⭐️ authMiddleware, isAdminMiddleware 제거!
    console.log(`[API /admin/student-branches] 학생 지점 목록 조회 요청 (Public)`); // ⭐️ 로그 수정

    try {
        // ⭐️ dbStudent (jungsimaxstudent DB) 사용!
        // student_account 테이블에서 NULL이나 빈 문자열이 아닌 고유한 branch 값을 가져옴
        const sql = `
            SELECT DISTINCT branch AS branchName
            FROM \`jungsimaxstudent\`.\`student_account\`
            WHERE branch IS NOT NULL AND branch != ''
            ORDER BY branch ASC
        `;
        const [branches] = await dbStudent.query(sql); // dbStudent 사용!

        // 결과 형식: ['강남', '강동', '일산', ...]
        const branchNames = branches.map(b => b.branchName);
        console.log(` -> ${branchNames.length}개의 학생 지점 목록 조회 완료`);

        // 결과 응답
        res.json({ success: true, branches: branchNames });

    } catch (err) {
        console.error('❌ 학생 지점 목록 조회 API 오류:', err);
        res.status(500).json({ success: false, message: 'DB 조회 중 오류 발생' });
    }
});

// =============================================
// ⭐️ 학생용: 오늘 할당된 운동 조회 API (teacher_userid 로 수정됨)
// =============================================
// GET /jungsi/student/today-assignment
app.get('/jungsi/student/today-assignment', authStudentOnlyMiddleware, async (req, res) => {
    const { account_id } = req.user;
    console.log(`[API GET /student/today-assignment] 학생(${account_id}) 오늘 운동 조회 요청`);
    try {
        // ⭐️ SQL 쿼리 수정: 선생님 이름 + 경험치 값 가져오기
        const sql = `
            SELECT
                tda.assignment_id, tda.teacher_userid, tda.assignment_date, tda.exercise_name, tda.category, tda.sub_category,
                tda.target_weight, tda.target_sets, tda.target_reps, tda.target_notes, tda.is_completed,
                ow.이름 AS teacher_name, -- ⭐️ 선생님 이름
                me.exp_value -- ⭐️ 경험치 값 추가
            FROM jungsimaxstudent.teacher_daily_assignments AS tda
            LEFT JOIN \`26susi\`.원장회원 AS ow
              ON tda.teacher_userid COLLATE utf8mb4_unicode_ci = ow.아이디 COLLATE utf8mb4_unicode_ci
            LEFT JOIN jungsimaxstudent.master_exercises AS me -- ⭐️ 경험치 값 JOIN
              ON tda.exercise_name = me.exercise_name
            WHERE tda.student_account_id = ? AND tda.assignment_date = CURDATE()
            ORDER BY tda.created_at ASC
        `;
        const [assignments] = await dbStudent.query(sql, [account_id]); // dbStudent 사용 확인
        console.log(` -> 오늘 할당된 운동 ${assignments.length}건 조회 완료 (선생님 이름 포함)`);
        // ⭐️ 응답 데이터에 teacher_name 포함됨
        res.json({ success: true, assignments: assignments });
    } catch (err) {
        console.error(`❌ 오늘 운동 조회 API 오류 (학생ID: ${account_id}):`, err);
        // Collation 에러 처리 추가
        if (err.code === 'ER_MIX_OF_COLLATION') {
             res.status(500).json({ success: false, message: '데이터 정렬 방식 충돌 오류 발생' });
        } else {
             res.status(500).json({ success: false, message: 'DB 조회 중 오류가 발생했습니다.' });
        }
    }
});
// =============================================
// ⭐️ (신규) 학생용: 운동 완료 상태 변경 API
// =============================================
// POST /jungsi/student/assignment/complete
app.post('/jungsi/student/assignment/complete', authStudentOnlyMiddleware, async (req, res) => {
    const { account_id } = req.user; // 학생 계정 ID
    const { assignment_id, is_completed } = req.body; // 프론트에서 과제 ID와 체크 상태(true/false) 받음

    console.log(`[API POST /assignment/complete] 학생(${account_id}) 운동(${assignment_id}) 완료 상태 변경 요청: ${is_completed}`);

    if (assignment_id === undefined || is_completed === undefined) {
        return res.status(400).json({ success: false, message: '과제 ID(assignment_id)와 완료 상태(is_completed)는 필수입니다.' });
    }
    const completedValue = Boolean(is_completed); // 확실하게 boolean으로 변환

    try {
        // ⭐️ 기존 완료 상태 및 운동 정보 확인 (중복 경험치 방지 + 경험치 값 조회)
        const [existingAssignment] = await dbStudent.query(
            `SELECT tda.is_completed, tda.exercise_name, me.exp_value
             FROM jungsimaxstudent.teacher_daily_assignments AS tda
             LEFT JOIN jungsimaxstudent.master_exercises AS me ON tda.exercise_name = me.exercise_name
             WHERE tda.assignment_id = ? AND tda.student_account_id = ?`,
            [assignment_id, account_id]
        );

        if (existingAssignment.length === 0) {
            return res.status(404).json({ success: false, message: '해당 운동 과제를 찾을 수 없습니다.' });
        }

        const wasCompleted = existingAssignment[0].is_completed;
        const expValue = existingAssignment[0].exp_value || 1; // 경험치 값 (기본값 1)

        // 완료 상태 업데이트
        const sql = `
            UPDATE jungsimaxstudent.teacher_daily_assignments
            SET
                is_completed = ?,
                completion_timestamp = ? -- 완료 시 현재 시간, 미완료 시 NULL
            WHERE assignment_id = ? AND student_account_id = ? -- 본인 것만 수정 가능
        `;
        const completionTime = completedValue ? new Date() : null; // 완료 시 현재 시간, 아니면 NULL
        // ⭐️ dbStudent 풀 사용!
        const [result] = await dbStudent.query(sql, [completedValue, completionTime, assignment_id, account_id]);

        if (result.affectedRows > 0) {
            console.log(` -> 운동(${assignment_id}) 완료 상태 업데이트 성공`);

            // ⭐️ 경험치 추가 로직 (운동별 경험치 값 사용)
            let levelInfo = null;

            // 미완료 → 완료로 변경될 때만 경험치 추가
            if (!wasCompleted && completedValue) {
                levelInfo = await addExpAndCheckLevelUp(account_id, expValue);
                console.log(` -> +${expValue} EXP 지급 완료!`, levelInfo);
            }
            // 완료 → 미완료로 변경될 때 경험치 차감
            else if (wasCompleted && !completedValue) {
                levelInfo = await addExpAndCheckLevelUp(account_id, -expValue);
                console.log(` -> -${expValue} EXP 차감 완료`, levelInfo);
            }

            res.json({
                success: true,
                message: '완료 상태가 업데이트되었습니다.',
                levelInfo: levelInfo // 레벨 정보 포함
            });
        } else {
            console.warn(` -> 업데이트할 운동 과제 없거나 권한 없음 (ID: ${assignment_id}, 학생: ${account_id})`);
            res.status(404).json({ success: false, message: '해당 운동 과제를 찾을 수 없거나 업데이트 권한이 없습니다.' });
        }

    } catch (err) {
        console.error(`❌ 운동 완료 상태 업데이트 API 오류 (과제ID: ${assignment_id}):`, err);
        res.status(500).json({ success: false, message: 'DB 업데이트 중 오류가 발생했습니다.' });
    }
});

// =============================================
// ⭐️ [신규] 관리자용: 지점 소속 원장/강사 목록 조회 API (sean8320 전용)
// =============================================
// GET /jungsi/admin/teachers-in-branch
app.get('/jungsi/admin/teachers-in-branch', authMiddleware, async (req, res) => {
    // ⭐️ 권한 확인 추가/수정
    if (!hasAdminPermission(req.user)) {
        console.warn(`[API /admin/teachers-in-branch] 접근 거부: ${req.user?.userid} (Position: ${req.user?.position})`);
        return res.status(403).json({ success: false, message: '관리자 권한(원장/부원장/팀장)이 필요합니다.' });
    }
    // ... (기존 API 로직) ...
    const { branch } = req.user; // 이제 관리자도 자기 지점만 조회? -> 아니면 전체 조회? 로직 수정 필요할 수 있음
    console.log(`[API /admin/teachers-in-branch] ${branch} 지점 선생님 목록 조회 요청 (by ${req.user.userid})`);
    try {
        const sql = `
            SELECT 아이디 AS userid, 이름 AS name
            FROM \`26susi\`.\`원장회원\`
            WHERE 지점명 = ? AND 승인여부 = 'O' ORDER BY 이름 ASC
        `;
        const [teachers] = await dbSusi.query(sql, [branch]); // 현재는 로그인한 관리자의 지점만 조회함
        res.json({ success: true, teachers: teachers });
    } catch (err) {
        console.error('❌ 지점 선생님 목록 조회 API 오류:', err);
        res.status(500).json({ success: false, message: 'DB 조회 중 오류 발생' });
    }
});

// =============================================
// ⭐️ [신규] 관리자용: 학생 반 배정 관리 API (sean8320 전용)
// =============================================

// --- API 1: 특정 학년도/지점의 학생 목록 + 배정 정보 조회 ---
// GET /jungsi/admin/students-for-assignment?year=YYYY
app.get('/jungsi/admin/students-for-assignment', authMiddleware, async (req, res) => {
    // ⭐️ 권한 확인 추가/수정
    if (!hasAdminPermission(req.user)) {
        console.warn(`[API /admin/students-for-assignment] 접근 거부: ${req.user?.userid} (Position: ${req.user?.position})`);
        return res.status(403).json({ success: false, message: '관리자 권한(원장/부원장/팀장)이 필요합니다.' });
    }
    // ... (기존 API 로직) ...
     const { year } = req.query;
     const { branch } = req.user;
     console.log(`[API /admin/students-for-assignment] ${branch} 지점 ${year}학년도 학생 목록 조회 요청 (by ${req.user.userid})`);
     // ... (이하 로직 동일) ...
     try {
         const sql = `
             SELECT sa.account_id, sa.userid, sa.name AS student_name,
                    sassign.class_name, sassign.teacher_userid, sassign.year
             FROM jungsimaxstudent.student_account sa
             LEFT JOIN jungsimaxstudent.student_assignments sassign
               ON sa.account_id = sassign.student_account_id AND sassign.year = ?
             WHERE sa.branch = ?
             ORDER BY sa.name ASC
         `;
         const [students] = await dbStudent.query(sql, [year, branch]);
         res.json({ success: true, students: students });
     } catch (err) {
          console.error('❌ 학생 목록 조회(배정용) API 오류:', err);
          res.status(500).json({ success: false, message: 'DB 조회 중 오류 발생' });
      }
});


// --- API 2: 학생 배정 정보 일괄 저장/수정 (UPSERT) ---
// POST /jungsi/admin/save-assignments
app.post('/jungsi/admin/save-assignments', authMiddleware, async (req, res) => {
    // ⭐️ 권한 확인 추가/수정
    if (!hasAdminPermission(req.user)) {
        console.warn(`[API /admin/save-assignments] 접근 거부: ${req.user?.userid} (Position: ${req.user?.position})`);
        return res.status(403).json({ success: false, message: '관리자 권한(원장/부원장/팀장)이 필요합니다.' });
    }
    // ... (기존 API 로직) ...
     const { year, assignments } = req.body;
     console.log(`[API /admin/save-assignments] ${year}학년도 학생 ${assignments?.length || 0}명 배정 정보 저장 요청 (by ${req.user.userid})`);
     // ... (이하 로직 동일) ...
     let connection;
     try {
         connection = await dbStudent.getConnection();
         await connection.beginTransaction();
         const sql = `
             INSERT INTO jungsimaxstudent.student_assignments
                 (student_account_id, class_name, teacher_userid, year, created_at)
             VALUES (?, ?, ?, ?, NOW())
             ON DUPLICATE KEY UPDATE
                 class_name = VALUES(class_name),
                 teacher_userid = VALUES(teacher_userid),
                 created_at = NOW()
         `;
         let updatedCount = 0;
         let insertedCount = 0;
         for (const item of assignments) {
             // 유효성 검사 추가 (class_name 또는 teacher_userid 둘 중 하나라도 있어야 함)
             if (!item.student_account_id || (!item.class_name && !item.teacher_userid)) {
                 console.warn('Skipping invalid assignment item:', item);
                 continue;
             }
             const params = [
                 item.student_account_id,
                 item.class_name || null, // 비어있으면 null
                 item.teacher_userid || null, // 비어있으면 null
                 year
             ];
             const [result] = await connection.query(sql, params);
             if (result.affectedRows === 1) insertedCount++;
             else if (result.affectedRows === 2) updatedCount++;
         }
         await connection.commit();
         res.json({ success: true, message: `총 ${insertedCount + updatedCount}명의 학생 배정 정보가 저장/수정되었습니다.` });
     } catch (err) {
         if (connection) await connection.rollback();
         console.error('❌ 학생 배정 정보 저장 API 오류:', err);
         res.status(500).json({ success: false, message: 'DB 처리 중 오류 발생', error: err.message });
     } finally {
         if (connection) connection.release();
     }
});

// =============================================
// ⭐️ [신규] 선생님용: 운동 할당 페이지 API (3개)
// =============================================

// --- API 1: (선생님용) 내 담당 학생 목록 조회 ---
app.get('/jungsi/teacher/my-students', authMiddleware, async (req, res) => {
    // 1. 로그인한 사용자 정보 (userid, branch, position 등)
    const { userid, branch, position, role } = req.user;
    const { year } = req.query;
    const isMgmt = hasAdminPermission(req.user); // 관리 권한(원장/부원장/팀장) 여부 확인

    console.log(`[API /teacher/my-students] 사용자(${userid}, ${position}) ${year}학년도 학생 목록 조회 (Mgmt: ${isMgmt})`);

    if (!year) {
        return res.status(400).json({ success: false, message: '학년도(year) 쿼리 파라미터가 필요합니다.' });
    }
    if (!branch) {
         return res.status(403).json({ success: false, message: '사용자 토큰에 지점 정보가 없습니다.' });
    }

    let sql;
    let params;

    if (isMgmt) {
        // ⭐️ 관리 권한 사용자: 해당 지점의 *모든* 학생 조회
        console.log(` -> 관리 권한: ${branch} 지점 ${year}년도 모든 학생 조회`);
        // ⭐️ (수정) 최신 상태 + 오늘 운동 현황 조회를 위한 서브쿼리 추가
        sql = `
            SELECT
                sa.account_id, sa.userid, sa.name AS student_name,
                sa.gender, sa.grade,
                sassign.class_name,
                ( -- 1. 최신 '부상' 척도
                    SELECT stn.injury_level FROM jungsimaxstudent.student_teacher_notes stn
                    WHERE stn.student_account_id = sa.account_id AND stn.category = '부상'
                    ORDER BY stn.note_date DESC LIMIT 1
                ) AS recent_injury_level,
                ( -- 2. 최신 '상담' 메모 존재 여부 (가장 최신 날짜)
                    SELECT stn.note_date FROM jungsimaxstudent.student_teacher_notes stn
                    WHERE stn.student_account_id = sa.account_id AND stn.category = '상담'
                    ORDER BY stn.note_date DESC LIMIT 1
                ) AS recent_counseling_date,
                ( -- 3. 최신 '멘탈' 메모 존재 여부 (가장 최신 날짜)
                    SELECT stn.note_date FROM jungsimaxstudent.student_teacher_notes stn
                    WHERE stn.student_account_id = sa.account_id AND stn.category = '멘탈'
                    ORDER BY stn.note_date DESC LIMIT 1
                ) AS recent_mental_date,

                -- ▼▼▼▼▼ [일일퀘스트 추가] 오늘 운동 현황 ▼▼▼▼▼
                (
                    SELECT COUNT(*)
                    FROM jungsimaxstudent.teacher_daily_assignments tda
                    WHERE tda.student_account_id = sa.account_id AND tda.assignment_date = CURDATE()
                ) AS today_total_assignments,
                (
                    SELECT COUNT(*)
                    FROM jungsimaxstudent.teacher_daily_assignments tda
                    WHERE tda.student_account_id = sa.account_id AND tda.assignment_date = CURDATE() AND tda.is_completed = 1
                ) AS today_completed_assignments
                -- ▲▲▲▲▲ [일일퀘스트 추가] 오늘 운동 현황 ▲▲▲▲▲

            FROM jungsimaxstudent.student_account sa
            LEFT JOIN jungsimaxstudent.student_assignments sassign
              ON sa.account_id = sassign.student_account_id AND sassign.year = ?
            WHERE sa.branch = ?
            ORDER BY sa.name ASC
        `;
        params = [year, branch];
    } else {
        // ⭐️ 일반 사용자: 기존처럼 *자신에게 배정된* 학생만 조회
        console.log(` -> 일반 사용자: ${branch} 지점 ${year}년도 ${userid} 담당 학생 조회`);
        // ⭐️ (수정) 최신 상태 + 오늘 운동 현황 조회를 위한 서브쿼리 추가
        sql = `
            SELECT
                sa.account_id, sa.userid, sa.name AS student_name,
                sa.gender, sa.grade,
                sassign.class_name,
                ( -- 1. 최신 '부상' 척도
                    SELECT stn.injury_level FROM jungsimaxstudent.student_teacher_notes stn
                    WHERE stn.student_account_id = sa.account_id AND stn.category = '부상'
                    ORDER BY stn.note_date DESC LIMIT 1
                ) AS recent_injury_level,
                ( -- 2. 최신 '상담' 메모 존재 여부 (가장 최신 날짜)
                    SELECT stn.note_date FROM jungsimaxstudent.student_teacher_notes stn
                    WHERE stn.student_account_id = sa.account_id AND stn.category = '상담'
                    ORDER BY stn.note_date DESC LIMIT 1
                ) AS recent_counseling_date,
                ( -- 3. 최신 '멘탈' 메모 존재 여부 (가장 최신 날짜)
                    SELECT stn.note_date FROM jungsimaxstudent.student_teacher_notes stn
                    WHERE stn.student_account_id = sa.account_id AND stn.category = '멘탈'
                    ORDER BY stn.note_date DESC LIMIT 1
                ) AS recent_mental_date,

                -- ▼▼▼▼▼ [일일퀘스트 추가] 오늘 운동 현황 ▼▼▼▼▼
                (
                    SELECT COUNT(*)
                    FROM jungsimaxstudent.teacher_daily_assignments tda
                    WHERE tda.student_account_id = sa.account_id AND tda.assignment_date = CURDATE()
                ) AS today_total_assignments,
                (
                    SELECT COUNT(*)
                    FROM jungsimaxstudent.teacher_daily_assignments tda
                    WHERE tda.student_account_id = sa.account_id AND tda.assignment_date = CURDATE() AND tda.is_completed = 1
                ) AS today_completed_assignments
                -- ▲▲▲▲▲ [일일퀘스트 추가] 오늘 운동 현황 ▲▲▲▲▲

            FROM jungsimaxstudent.student_assignments sassign
            JOIN jungsimaxstudent.student_account sa ON sassign.student_account_id = sa.account_id
            WHERE sassign.teacher_userid = ?
              AND sassign.year = ?
              AND sa.branch = ?
            ORDER BY sa.name ASC
        `;
        params = [userid, year, branch]; // teacher_userid 사용
    }

    try {
        const [students] = await dbStudent.query(sql, params); // dbStudent 사용!
        console.log(` -> ${students.length}명의 학생 정보 조회 완료 (운동 현황 포함)`); // 로그 수정
        res.json({ success: true, students: students }); // ⭐️ 운동 현황 필드 2개 포함되어 응답
    } catch (err) {
        console.error('❌ 학생 목록 조회(운동 할당용) API 오류:', err);
        res.status(500).json({ success: false, message: 'DB 조회 중 오류 발생' });
    }
});
// --- API 3: (선생님용) 데일리 운동 할당 (일괄 저장) ---
// --- API 3: (선생님용) 데일리 운동 할당 (일괄 저장) ---
// POST /jungsi/teacher/assign-workout
app.post('/jungsi/teacher/assign-workout', authMiddleware, async (req, res) => {
    // 1. 로그인한 사용자 정보
    const { userid: teacher_userid, branch: userBranch } = req.user;

    // 2. 요청 본문 데이터 - 다중 학생 지원
    const { student_account_id, student_account_ids, assignment_date, assignments } = req.body;

    // ⭐️ 다중 학생 또는 단일 학생 처리
    let studentIds = [];
    if (student_account_ids && Array.isArray(student_account_ids)) {
        studentIds = student_account_ids;
    } else if (student_account_id) {
        studentIds = [student_account_id];
    }

    console.log(`[API /teacher/assign-workout] 사용자(${teacher_userid})가 ${studentIds.length}명의 학생에게 ${assignment_date} 운동 할당`);

    // 3. 유효성 검사
    if (studentIds.length === 0 || !assignment_date || !Array.isArray(assignments)) {
        return res.status(400).json({ success: false, message: '학생, 날짜, 운동 목록이 필요합니다.' });
    }

    let connection;
    try {
        connection = await dbStudent.getConnection();
        await connection.beginTransaction();

        const results = {
            success: [],
            failed: []
        };

        // ⭐️ 각 학생에 대해 반복 처리
        for (const currentStudentId of studentIds) {
            try {
                // 4. 보안 검사: 운동을 할당할 학생이 로그인한 사용자와 *같은 지점* 소속인지 확인
                const [studentCheck] = await connection.query(
                    'SELECT account_id, name, branch FROM jungsimaxstudent.student_account WHERE account_id = ?',
                    [currentStudentId]
                );

                if (studentCheck.length === 0 || studentCheck[0].branch !== userBranch) {
                    console.warn(` -> 권한 없음: 학생(${currentStudentId})이 사용자 지점(${userBranch}) 소속이 아님.`);
                    results.failed.push({
                        student_id: currentStudentId,
                        reason: '다른 지점 학생이거나 존재하지 않는 학생입니다.'
                    });
                    continue;
                }

                const studentName = studentCheck[0].name;
                console.log(` -> 학생 ${studentName}(${currentStudentId}) 지점 확인 완료 (${studentCheck[0].branch})`);

                // ⭐️ 5-1. 삭제 처리: 전송받은 목록에 없는 기존 퀘스트 삭제 (완료되지 않은 것만)
                const assignedExerciseNames = assignments.map(a => a.exercise_name);
                if (assignedExerciseNames.length > 0) {
                    // 전송받은 운동명 목록에 없는 미완료 퀘스트 삭제
                    const [deleteResult] = await connection.query(
                        `DELETE FROM jungsimaxstudent.teacher_daily_assignments
                         WHERE student_account_id = ? AND assignment_date = ? AND teacher_userid = ?
                         AND is_completed = 0 AND exercise_name NOT IN (?)`,
                        [currentStudentId, assignment_date, teacher_userid, assignedExerciseNames]
                    );
                    if (deleteResult.affectedRows > 0) {
                        console.log(` -> 학생 ${studentName}(${currentStudentId}) ${deleteResult.affectedRows}개 퀘스트 삭제됨`);
                    }
                } else {
                    // 전송받은 운동이 없으면, 해당 날짜의 미완료 퀘스트 모두 삭제
                    const [deleteResult] = await connection.query(
                        `DELETE FROM jungsimaxstudent.teacher_daily_assignments
                         WHERE student_account_id = ? AND assignment_date = ? AND teacher_userid = ?
                         AND is_completed = 0`,
                        [currentStudentId, assignment_date, teacher_userid]
                    );
                    if (deleteResult.affectedRows > 0) {
                        console.log(` -> 학생 ${studentName}(${currentStudentId}) ${deleteResult.affectedRows}개 퀘스트 삭제됨 (전체)`);
                    }
                }

                // 5-2. 새 운동 추가/업데이트
                if (assignments.length > 0) {
                    let insertedCount = 0;
                    let updatedCount = 0;

                    for (const item of assignments) {
                        // 같은 학생, 같은 날짜, 같은 운동이 이미 있는지 확인
                        const [existing] = await connection.query(
                            `SELECT assignment_id FROM jungsimaxstudent.teacher_daily_assignments
                             WHERE student_account_id = ? AND assignment_date = ? AND exercise_name = ?`,
                            [currentStudentId, assignment_date, item.exercise_name]
                        );

                        if (existing.length > 0) {
                            // 기존 퀘스트 업데이트
                            await connection.query(
                                `UPDATE jungsimaxstudent.teacher_daily_assignments
                                 SET category = ?, sub_category = ?, target_weight = ?, target_sets = ?, target_reps = ?, target_notes = ?
                                 WHERE assignment_id = ?`,
                                [item.category, item.sub_category || null, item.target_weight || null,
                                 item.target_sets || null, item.target_reps || null, item.target_notes || null,
                                 existing[0].assignment_id]
                            );
                            updatedCount++;
                        } else {
                            // 새 퀘스트 추가
                            await connection.query(
                                `INSERT INTO jungsimaxstudent.teacher_daily_assignments
                                    (teacher_userid, student_account_id, assignment_date, exercise_name, category, sub_category,
                                     target_weight, target_sets, target_reps, target_notes, is_completed, created_at)
                                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                                [teacher_userid, currentStudentId, assignment_date,
                                 item.exercise_name, item.category, item.sub_category || null,
                                 item.target_weight || null, item.target_sets || null, item.target_reps || null, item.target_notes || null,
                                 false, new Date()]
                            );
                            insertedCount++;
                        }
                    }
                    console.log(` -> 학생 ${studentName}(${currentStudentId}) ${insertedCount}개 추가, ${updatedCount}개 업데이트 완료`);
                }

                results.success.push({
                    student_id: currentStudentId,
                    student_name: studentName,
                    assignment_count: assignments.length
                });

            } catch (studentError) {
                console.error(`❌ 학생(${currentStudentId}) 처리 중 오류:`, studentError);
                results.failed.push({
                    student_id: currentStudentId,
                    reason: studentError.message
                });
            }
        }

        // 7. 커밋
        await connection.commit();

        // 8. 결과 반환
        const totalStudents = studentIds.length;
        const successCount = results.success.length;
        const failedCount = results.failed.length;

        let message = '';
        if (successCount === totalStudents) {
            message = `✅ ${successCount}명의 학생에게 데일리 운동이 성공적으로 할당되었습니다.`;
        } else if (successCount > 0) {
            message = `⚠️ ${successCount}명 성공, ${failedCount}명 실패했습니다.`;
        } else {
            message = `❌ 모든 학생에게 할당 실패했습니다.`;
        }

        res.status(201).json({
            success: successCount > 0,
            message: message,
            results: results,
            total: totalStudents,
            success_count: successCount,
            failed_count: failedCount
        });

    } catch (err) {
        if (connection) await connection.rollback();
        console.error('❌ 데일리 운동 할당 API 오류:', err);
        res.status(500).json({ success: false, message: 'DB 처리 중 오류 발생', error: err.message });
    } finally {
        if (connection) connection.release();
    }
});

// --- API 2: (선생님용) 운동 마스터 목록 조회 ---
// GET /jungsi/master-exercises
app.get('/jungsi/master-exercises', authMiddleware, async (req, res) => {
    console.log(`[API /master-exercises] 전체 운동 마스터 목록 조회 요청 (by ${req.user.userid})`);

    try {
        const sql = `
            SELECT exercise_id, exercise_name, category, sub_category, default_unit
            FROM jungsimaxstudent.master_exercises
            WHERE is_active = TRUE -- ⭐️ 활성화된 운동만
            ORDER BY
                FIELD(category, 'Skill', 'Weight', 'Other'), -- 실기 -> 웨이트 -> 기타 순
                FIELD(sub_category, '상체', '하체', '코어', '달리기', '점프'), -- 세부 카테고리 순
                exercise_name ASC -- 이름순
        `;
        // ⭐️ dbStudent 사용!
        const [exercises] = await dbStudent.query(sql);

        console.log(` -> ${exercises.length}개의 활성화된 운동 목록 조회 완료`);
        res.json({ success: true, exercises: exercises });

    } catch (err) {
        console.error('❌ 운동 마스터 목록 조회 API 오류:', err);
        res.status(500).json({ success: false, message: 'DB 조회 중 오류 발생' });
    }
});

app.get('/jungsi/teacher/assignments/:student_account_id/:date', authMiddleware, async (req, res) => {
    // 1. URL 파라미터 및 로그인 사용자 정보
    const { student_account_id, date: assignment_date } = req.params;
    const { userid: requester_userid, branch: requester_branch, position, role } = req.user;
    const isMgmt = hasAdminPermission(req.user); // 관리 권한 확인 (파일 상단에 함수 정의 필요)

    console.log(`[API GET /teacher/assignments] 사용자(${requester_userid}, ${position})가 학생(${student_account_id})의 ${assignment_date} 운동 목록 조회 요청`);

    // 날짜 형식 검사 (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!student_account_id || !assignment_date || !dateRegex.test(assignment_date)) {
        return res.status(400).json({ success: false, message: '학생 ID 또는 날짜 형식이 올바르지 않습니다.' });
    }

    try {
        // --- 보안 검사 ---
        // 1. 요청된 학생이 사용자의 지점 소속인지 확인
        const [studentCheck] = await dbStudent.query(
            'SELECT account_id, name, branch FROM jungsimaxstudent.student_account WHERE account_id = ?',
            [student_account_id]
        );
        if (studentCheck.length === 0 || studentCheck[0].branch !== requester_branch) {
            console.warn(` -> 권한 없음: 학생(${student_account_id})이 사용자 지점(${requester_branch}) 소속이 아님.`);
            return res.status(403).json({ success: false, message: '조회 권한이 없는 학생입니다 (다른 지점 학생).' });
        }
        console.log(` -> 학생 지점(${studentCheck[0].branch}) 확인 완료`);

        // (선택적) 관리자가 아니면, 해당 학생이 자신에게 배정된 학생인지 추가 확인 가능
        // if (!isMgmt) { ... }

        // --- 데이터 조회 ---
        // 할당된 운동 목록 + 담당 선생님 이름(26susi.원장회원 JOIN) 조회
        const sql = `
            SELECT
                tda.assignment_id, tda.teacher_userid, tda.assignment_date, tda.exercise_name,
                tda.category, tda.sub_category, tda.target_weight, tda.target_sets,
                tda.target_reps, tda.target_notes, tda.is_completed, tda.created_at,
                ow.이름 AS teacher_name -- ⭐️ 26susi DB에서 선생님 이름 가져오기
            FROM jungsimaxstudent.teacher_daily_assignments AS tda
            LEFT JOIN \`26susi\`.원장회원 AS ow -- ⭐️ LEFT JOIN 사용
              -- ▼▼▼ COLLATE 추가 (Collation 충돌 방지) ▼▼▼
              ON tda.teacher_userid COLLATE utf8mb4_unicode_ci = ow.아이디 COLLATE utf8mb4_unicode_ci
              -- ▲▲▲ COLLATE 추가 ▲▲▲
            WHERE tda.student_account_id = ? AND tda.assignment_date = ?
            ORDER BY tda.created_at ASC -- 할당된 순서대로
        `;
        // ⭐️ dbStudent 사용!
        const [assignments] = await dbStudent.query(sql, [student_account_id, assignment_date]);

        console.log(` -> ${assignment_date} 날짜의 운동 ${assignments.length}건 조회 완료 (선생님 이름 포함)`);
        res.json({ success: true, assignments: assignments });

    } catch (err) {
        console.error(`❌ 특정 날짜 운동 목록 조회 API 오류 (학생ID: ${student_account_id}):`, err);
        if (err.code === 'ER_MIX_OF_COLLATION') {
             res.status(500).json({ success: false, message: '데이터 정렬 방식 충돌 오류 발생' });
        } else {
             res.status(500).json({ success: false, message: 'DB 조회 중 오류 발생' });
        }
    }
});




// jungsi.js 파일 하단 app.listen(...) 바로 위에 추가

// =============================================
// ⭐️ [신규] 선생님용: 학생 특이사항 메모 API (2개)
// =============================================

// --- API 1: (선생님용) 특정 학생의 메모 이력 조회 ---
// GET /jungsi/teacher/notes/:student_account_id
app.get('/jungsi/teacher/notes/:student_account_id', authMiddleware, async (req, res) => {
    const { student_account_id } = req.params;
    const { branch, userid: teacher_userid } = req.user;

    console.log(`[API /teacher/notes GET] 선생님(${teacher_userid})이 학생(${student_account_id}) 메모 조회 (지점: ${branch})`);

    if (!student_account_id) {
        return res.status(400).json({ success: false, message: '학생 ID(student_account_id)가 필요합니다.' });
    }

    try {
        // (보안) 학생 지점 확인 (기존과 동일)
        const [studentCheck] = await dbStudent.query(
            'SELECT account_id FROM student_account WHERE account_id = ? AND branch = ?',
            [student_account_id, branch]
        );
        if (studentCheck.length === 0) {
            console.warn(` -> 권한 없음: 학생(${student_account_id})이 ${branch} 지점 소속이 아님.`);
            return res.status(403).json({ success: false, message: '조회 권한이 없는 학생입니다.' });
        }

        // ⭐️ SQL 수정: injury_level 컬럼 조회 추가
        const sql = `
            SELECT note_id, student_account_id, teacher_userid, note_date, note_content, category, injury_level
            FROM jungsimaxstudent.student_teacher_notes
            WHERE student_account_id = ?
            ORDER BY note_date DESC
        `;
        const [notes] = await dbStudent.query(sql, [student_account_id]);

        console.log(` -> 학생(${student_account_id}) 메모 ${notes.length}건 조회 완료`);
        res.json({ success: true, notes: notes });

    } catch (err) {
        console.error('❌ 학생 메모 조회 API 오류:', err);
        res.status(500).json({ success: false, message: 'DB 조회 중 오류 발생' });
    }
});


// --- API 2: (선생님용) 새 메모 저장 (injury_level 추가) ---
// POST /jungsi/teacher/notes/add
app.post('/jungsi/teacher/notes/add', authMiddleware, async (req, res) => {
    // ⭐️ 1. req.body에서 injury_level 받기
    const { student_account_id, note_content, category, injury_level } = req.body;
    const { userid: teacher_userid, branch } = req.user;

    console.log(`[API /teacher/notes POST] 선생님(${teacher_userid})이 학생(${student_account_id})에게 메모 작성 (척도: ${injury_level})`);

    // 3. 유효성 검사 (기존과 동일)
    if (!student_account_id || !note_content) {
        return res.status(400).json({ success: false, message: '학생 ID와 메모 내용은 필수입니다.' });
    }

    try {
        // (보안) 학생 지점 확인 (기존과 동일)
        const [studentCheck] = await dbStudent.query(
            'SELECT account_id FROM student_account WHERE account_id = ? AND branch = ?',
            [student_account_id, branch]
        );
        if (studentCheck.length === 0) {
            return res.status(403).json({ success: false, message: '메모 작성 권한이 없는 학생입니다.' });
        }

        // ⭐️ 2. SQL 수정: injury_level 컬럼 추가
        const sql = `
            INSERT INTO jungsimaxstudent.student_teacher_notes
                (student_account_id, teacher_userid, note_content, category, injury_level, note_date)
            VALUES (?, ?, ?, ?, ?, NOW())
        `;
        // ⭐️ 3. 파라미터 수정: injury_level 추가
        //    (카테고리가 '부상'이 아니면 injury_level은 null로 저장)
        const finalInjuryLevel = (category === '부상' && injury_level) ? injury_level : null;
        
        const [result] = await dbStudent.query(sql, [
            student_account_id, 
            teacher_userid, 
            note_content, 
            category || null, 
            finalInjuryLevel
        ]);

        console.log(` -> 메모 저장 성공 (ID: ${result.insertId})`);

        // ⭐️ 4. 응답 객체(insertedNote)에 injury_level 추가
        res.status(201).json({
            success: true,
            message: '메모가 저장되었습니다.',
            insertedNote: {
                note_id: result.insertId,
                student_account_id: parseInt(student_account_id),
                teacher_userid: teacher_userid,
                note_content: note_content,
                category: category || null,
                injury_level: finalInjuryLevel, // ⭐️ 추가
                note_date: new Date()
            }
        });

    } catch (err) {
        console.error('❌ 학생 메모 저장 API 오류:', err);
        res.status(500).json({ success: false, message: 'DB 저장 중 오류 발생' });
    }
});
// =============================================
// GET /jungsi/teacher/student-saved-list/:student_account_id/:year
app.get('/jungsi/teacher/student-saved-list/:student_account_id/:year', authMiddleware, async (req, res) => {
    // 1. URL 파라미터 및 로그인한 선생님 정보
    const { student_account_id, year } = req.params;
    const { branch, userid: teacher_userid } = req.user;

    console.log(`[API /teacher/student-saved-list] 선생님(${teacher_userid})이 학생(${student_account_id}, ${year}년도) 저장 대학 목록 조회`);

    if (!student_account_id || !year) {
        return res.status(400).json({ success: false, message: '학생 ID와 학년도가 필요합니다.' });
    }

    try {
        // 2. (보안) 해당 학생이 요청한 선생님 지점 소속인지 확인
        const [studentCheck] = await dbStudent.query(
            'SELECT account_id FROM student_account WHERE account_id = ? AND branch = ?',
            [student_account_id, branch]
        );
        if (studentCheck.length === 0) {
            console.warn(` -> 권한 없음: 학생(${student_account_id})이 ${branch} 지점 소속이 아님.`);
            return res.status(403).json({ success: false, message: '조회 권한이 없는 학생입니다.' });
        }

        // 3. 학생이 저장한 대학 목록 + 대학 정보 + 실기 종목(GROUP_CONCAT) 조회
        //    (학생DB의 student_saved_universities와 정시DB의 정시기본, 정시반영비율, 정시_컷점수, 정시실기배점 JOIN)
        const sql = `
            SELECT
                su.saved_id, su.U_ID, su.calculated_suneung_score,
                jb.대학명, jb.학과명, jb.군,
                r.수능 AS 수능비율, r.내신 AS 내신비율, r.실기 AS 실기비율,
                jc.수능컷 AS 지원컷, jc.총점컷,
                -- ⭐️ 이 대학의 모든 실기 종목을 콤마(,)로 연결해서 가져옴
                GROUP_CONCAT(DISTINCT je.종목명 ORDER BY je.종목명 SEPARATOR ', ') AS events
            FROM jungsimaxstudent.student_saved_universities su
            JOIN jungsi.정시기본 jb
              ON su.U_ID = jb.U_ID AND su.학년도 = jb.학년도
            LEFT JOIN jungsi.정시반영비율 r -- 비율 정보
              ON su.U_ID = r.U_ID AND su.학년도 = r.학년도
            LEFT JOIN jungsi.정시_컷점수 jc -- 컷 점수 정보 (현재 로그인한 지점 기준)
              ON su.U_ID = jc.U_ID AND su.학년도 = jc.학년도 AND jc.branch_name = ?
            LEFT JOIN jungsi.정시실기배점 je -- 실기 종목이 없는 대학도 있으므로 LEFT JOIN
              ON su.U_ID = je.U_ID AND su.학년도 = je.학년도
            WHERE su.account_id = ? AND su.학년도 = ?
            GROUP BY su.saved_id, su.U_ID, su.calculated_suneung_score,
                     jb.대학명, jb.학과명, jb.군,
                     r.수능, r.내신, r.실기, jc.수능컷, jc.총점컷
            ORDER BY FIELD(jb.군, '가', '나', '다'), jb.대학명;
        `;
        // ⭐️ dbStudent 사용! (branch를 파라미터로 추가)
        const [savedList] = await dbStudent.query(sql, [branch, student_account_id, year]);

        console.log(` -> 학생(${student_account_id})의 저장 대학 ${savedList.length}건 (실기 종목 포함) 조회 완료`);

        // 4. (선택) events 문자열을 배열로 변환
        const formattedList = savedList.map(item => ({
            ...item,
            events: item.events ? item.events.split(', ') : [] // "종목1, 종목2" -> ["종목1", "종목2"]
        }));

        res.json({ success: true, savedUniversities: formattedList });

    } catch (err) {
        console.error('❌ 학생 저장 대학 목록 조회 API 오류:', err);
        res.status(500).json({ success: false, message: 'DB 조회 중 오류 발생' });
    }
});

app.get('/jungsi/teacher/student-score-history/:student_account_id/:year', authMiddleware, async (req, res) => {
    // 1. URL 파라미터 및 로그인한 선생님 정보
    const { student_account_id, year } = req.params;
    const { u_id } = req.query; // ⭐️ 특정 대학만 필터링 (선택적)
    const { branch, userid: teacher_userid } = req.user;

    console.log(`[API /teacher/student-score-history] 선생님(${teacher_userid})이 학생(${student_account_id}, ${year}년도) 점수 기록 조회 (U_ID: ${u_id || '전체'})`);

    if (!student_account_id || !year) {
        return res.status(400).json({ success: false, message: '학생 ID와 학년도가 필요합니다.' });
    }

    try {
        // 2. (보안) 해당 학생이 요청한 선생님 지점 소속인지 확인
        const [studentCheck] = await dbStudent.query(
            'SELECT account_id FROM student_account WHERE account_id = ? AND branch = ?',
            [student_account_id, branch]
        );
        if (studentCheck.length === 0) {
            console.warn(` -> 권한 없음: 학생(${student_account_id})이 ${branch} 지점 소속이 아님.`);
            return res.status(403).json({ success: false, message: '조회 권한이 없는 학생입니다.' });
        }

        // 3. 학생의 점수 기록 조회 (최신순) - ⭐️ U_ID 필터링 추가
        let sql;
        let params;

        if (u_id) {
            // 특정 대학(U_ID)만 필터링
            sql = `
                SELECT
                    history_id, account_id, U_ID, 학년도,
                    record_date, suneung_score, naeshin_score,
                    silgi_records_json, silgi_score, total_score
                FROM jungsimaxstudent.student_score_history
                WHERE account_id = ? AND 학년도 = ? AND U_ID = ?
                ORDER BY record_date DESC
            `;
            params = [student_account_id, year, u_id];
        } else {
            // 전체 대학 조회 (기존 동작)
            sql = `
                SELECT
                    history_id, account_id, U_ID, 학년도,
                    record_date, suneung_score, naeshin_score,
                    silgi_records_json, silgi_score, total_score
                FROM jungsimaxstudent.student_score_history
                WHERE account_id = ? AND 학년도 = ?
                ORDER BY record_date DESC
            `;
            params = [student_account_id, year];
        }

        const [history] = await dbStudent.query(sql, params);

        console.log(` -> 학생(${student_account_id})의 점수 기록 ${history.length}건 조회 완료 (U_ID: ${u_id || '전체'})`);

        res.json({ success: true, history });

    } catch (err) {
        console.error('❌ 학생 점수 기록 조회 API 오류:', err);
        res.status(500).json({ success: false, message: 'DB 조회 중 오류 발생' });
    }
});


// GET /jungsi/teacher/record-view/students?year=YYYY&view=my|all
app.get('/jungsi/teacher/record-view/students', authMiddleware, async (req, res) => {
    const { year, view } = req.query;
    const { userid, branch, position, role } = req.user;
    const isMgmt = hasAdminPermission(req.user); // 관리 권한 확인

    console.log(`[API /record-view/students] 사용자(${userid}, ${position}) ${year}년도 학생 목록 조회 (View: ${view}, Mgmt: ${isMgmt})`);

    if (!year) {
        return res.status(400).json({ success: false, message: '학년도(year) 쿼리 파라미터가 필요합니다.' });
    }
    if (!branch) {
         return res.status(403).json({ success: false, message: '사용자 토큰에 지점 정보가 없습니다.' });
    }

    let sql;
    let params;

    // 보기 옵션('all' 또는 'my')과 관리 권한(isMgmt)에 따라 쿼리 분기
    if (view === 'all' && isMgmt) {
        // 관리자가 '전체 학생' 보기 선택 시: 해당 지점의 모든 학생 조회
        console.log(` -> 관리자 전체 보기: ${branch} 지점 ${year}년도 모든 학생 조회`);
        sql = `
            SELECT sa.account_id, sa.name as student_name, sa.grade, sa.gender, sassign.class_name
            FROM jungsimaxstudent.student_account sa
            LEFT JOIN jungsimaxstudent.student_assignments sassign
              ON sa.account_id = sassign.student_account_id AND sassign.year = ?
            WHERE sa.branch = ?
            ORDER BY sa.name ASC
        `;
        params = [year, branch];
    } else {
        // 일반 사용자 또는 관리자가 '우리 반' 보기 선택 시: 담당 학생만 조회
        console.log(` -> 담당 학생 보기: ${branch} 지점 ${year}년도 ${userid} 담당 학생 조회`);
        sql = `
            SELECT sa.account_id, sa.name as student_name, sa.grade, sa.gender, sassign.class_name
            FROM jungsimaxstudent.student_assignments sassign
            JOIN jungsimaxstudent.student_account sa ON sassign.student_account_id = sa.account_id
            WHERE sassign.teacher_userid = ? AND sassign.year = ? AND sa.branch = ?
            ORDER BY sa.name ASC
        `;
        params = [userid, year, branch]; // teacher_userid 사용
    }

    try {
        const [students] = await dbStudent.query(sql, params); // dbStudent 사용!
        console.log(` -> ${students.length}명의 학생 조회 완료`);
        res.json({ success: true, students: students });
    } catch (err) {
        console.error('❌ 학생 목록 조회(기록 열람용) API 오류:', err);
        res.status(500).json({ success: false, message: 'DB 조회 중 오류 발생' });
    }
});

// --- API 2: 특정 학생의 기록 및 목표 조회 ---
// GET /jungsi/teacher/record-view/records/:account_id
app.get('/jungsi/teacher/record-view/records/:account_id', authMiddleware, async (req, res) => {
    const { account_id } = req.params;
    const { userid, branch, position, role } = req.user;
    const isMgmt = hasAdminPermission(req.user); // 관리 권한 확인

    console.log(`[API /record-view/records] 사용자(${userid}, ${position}) 학생(${account_id}) 기록/목표 조회`);

    if (!account_id) {
         return res.status(400).json({ success: false, message: '학생 account_id가 필요합니다.' });
    }

    try {
        // --- 보안 검사 ---
        // 1. 요청된 학생이 사용자의 지점 소속인지 확인
        const [studentCheck] = await dbStudent.query(
            'SELECT account_id, name FROM jungsimaxstudent.student_account WHERE account_id = ? AND branch = ?',
            [account_id, branch]
        );
        if (studentCheck.length === 0) {
            console.warn(` -> 권한 없음: 학생(${account_id})이 사용자 지점(${branch}) 소속이 아님.`);
            return res.status(403).json({ success: false, message: '조회 권한이 없는 학생입니다 (다른 지점 학생).' });
        }
        const studentName = studentCheck[0].name; // 로그용

        // 2. 관리자가 아니면, 해당 학생이 자신에게 배정된 학생인지 추가 확인 (가장 최근 년도 기준)
        if (!isMgmt) {
            const [assignmentCheck] = await dbStudent.query(
                `SELECT assignment_id FROM jungsimaxstudent.student_assignments
                 WHERE student_account_id = ? AND teacher_userid = ?
                 ORDER BY year DESC LIMIT 1`, // 가장 최근 배정 정보 확인
                [account_id, userid]
            );
            if (assignmentCheck.length === 0) {
                 console.warn(` -> 권한 없음: 사용자(${userid})에게 학생(${account_id})이 배정되지 않음.`);
                 return res.status(403).json({ success: false, message: '조회 권한이 없는 학생입니다 (담당 학생 아님).' });
            }
        }
        console.log(` -> 권한 확인 완료 (학생: ${studentName})`);

        // --- 데이터 조회 ---
        // 1. 학생 실기 기록 조회 (종목별, 최신순)
        const [recordRows] = await dbStudent.query(
            `SELECT record_id, event_name, record_date, record_value
             FROM jungsimaxstudent.student_practical_records
             WHERE account_id = ?
             ORDER BY event_name ASC, record_date DESC`, // 종목별 정렬 후 날짜 내림차순
            [account_id]
        );

        // 2. 학생 실기 목표 조회
        const [goalRows] = await dbStudent.query(
            'SELECT goal_id, event_name, goal_value FROM jungsimaxstudent.student_practical_goals WHERE account_id = ?',
            [account_id]
        );

        // --- 데이터 가공 ---
        // 기록을 종목별로 그룹화
        const recordsGrouped = {};
        recordRows.forEach(r => {
            if (!recordsGrouped[r.event_name]) {
                recordsGrouped[r.event_name] = [];
            }
            recordsGrouped[r.event_name].push({
                 record_id: r.record_id,
                 date: r.record_date, //.toISOString().split('T')[0], // YYYY-MM-DD 형식 원하면 주석 해제
                 value: r.record_value
             });
        });

        // 목표를 종목명-값 맵으로 변환
        const goalsMap = {};
        goalRows.forEach(g => {
            goalsMap[g.event_name] = g.goal_value;
        });

        console.log(` -> 기록 ${recordRows.length}건, 목표 ${goalRows.length}건 조회 및 가공 완료`);
        res.json({ success: true, records: recordsGrouped, goals: goalsMap });

    } catch (err) {
        console.error(`❌ 학생 기록/목표 조회 API 오류 (학생ID: ${account_id}):`, err);
        res.status(500).json({ success: false, message: 'DB 조회 중 오류 발생' });
    }
});

// jungsi.js 파일 하단 app.listen(...) 바로 위에 추가

// =============================================
// ⭐️ [신규] 선생님용: 학생 특이사항 메모 삭제 API
// =============================================
// DELETE /jungsi/teacher/notes/delete/:note_id
app.delete('/jungsi/teacher/notes/delete/:note_id', authMiddleware, async (req, res) => {
    const { note_id } = req.params;
    const { userid, branch } = req.user; // 로그인한 사용자 정보

    console.log(`[API /teacher/notes DELETE] 사용자(${userid})가 메모(${note_id}) 삭제 요청`);

    if (!note_id) {
        return res.status(400).json({ success: false, message: '메모 ID가 필요합니다.' });
    }

    let connection;
    try {
        connection = await dbStudent.getConnection();
        await connection.beginTransaction();

        // 1. 삭제하려는 메모 정보 조회 (지점 확인 및 작성자 확인용)
        const [ownerCheck] = await connection.query(
            `SELECT n.note_id, n.teacher_userid, s.branch
             FROM jungsimaxstudent.student_teacher_notes n
             JOIN jungsimaxstudent.student_account s ON n.student_account_id = s.account_id
             WHERE n.note_id = ?`,
            [note_id]
        );

        if (ownerCheck.length === 0) {
            await connection.rollback();
            console.warn(` -> 삭제할 메모 없음 (ID: ${note_id})`);
            return res.status(404).json({ success: false, message: '삭제할 메모를 찾을 수 없습니다.' });
        }
        
        const noteInfo = ownerCheck[0];
        
        // 2. (보안) 메모가 로그인한 사용자의 지점 소속인지 확인
        if (noteInfo.branch !== branch) {
            await connection.rollback();
            console.warn(` -> 권한 없음: 메모(${note_id})가 ${branch} 지점 소속이 아님.`);
            return res.status(403).json({ success: false, message: '삭제 권한이 없는 메모입니다 (다른 지점).' });
        }

        // ⭐️ 3. (보안) 삭제 권한 확인: 관리자(원장/팀장 등)이거나, 본인이 쓴 글인지
        const isMgmt = hasAdminPermission(req.user); // ⭐️ 관리자 여부 확인
        const isAuthor = (req.user.userid === noteInfo.teacher_userid);
        
        if (!isMgmt && !isAuthor) {
             await connection.rollback();
             console.warn(` -> 권한 없음: 메모 작성자(${noteInfo.teacher_userid})와 요청자(${userid})가 다름 (관리자 아님).`);
             return res.status(403).json({ success: false, message: '본인이 작성한 메모만 삭제할 수 있습니다.' });
        }
        
        console.log(` -> 삭제 권한 확인 (isMgmt: ${isMgmt}, isAuthor: ${isAuthor})`);

        // 4. 메모 삭제 실행
        const [result] = await connection.query(
            'DELETE FROM jungsimaxstudent.student_teacher_notes WHERE note_id = ?',
            [note_id]
        );

        await connection.commit();

        if (result.affectedRows > 0) {
            console.log(` -> 메모 삭제 성공 (ID: ${note_id})`);
            res.json({ success: true, message: '메모가 삭제되었습니다.' });
        } else {
            // 이 경우는 거의 없지만, 동시성 문제 대비
            console.warn(` -> 삭제할 메모 없음 (ID: ${note_id}) - 쿼리 실행 후 0 rows`);
            res.status(404).json({ success: false, message: '삭제할 메모를 찾을 수 없습니다.' });
        }

    } catch (err) {
        if (connection) await connection.rollback();
        console.error('❌ 학생 메모 삭제 API 오류:', err);
        res.status(500).json({ success: false, message: 'DB 삭제 중 오류 발생' });
    } finally {
        if (connection) connection.release();
    }
});


// ----------원장용----------------
// =============================================
// ⭐️ 원장 권한 확인 미들웨어 (신규)
// =============================================
const isDirectorMiddleware = (req, res, next) => {
    // authMiddleware가 req.user를 설정했다고 가정
    // ⭐️ 토큰에 position 정보가 있고 '원장'인지 확인
    if (req.user && req.user.position === '원장') {
        console.log(` -> [권한 확인] ✅ 원장 사용자 (${req.user.userid}), 통과`);
        next(); // 원장이면 통과
    } else {
        console.warn(` -> [권한 확인] ❌ 원장 권한 필요 (요청자: ${req.user?.userid}, 직급: ${req.user?.position})`);
        res.status(403).json({ success: false, message: '원장 권한이 필요합니다.' });
    }
};

// =============================================
// ⭐️ 원장용 종합 관리 API
// =============================================

// --- 1.1. 지점 전체 학생 목록 조회 ---
// GET /jungsi/director/students?year=YYYY&class_name=...&teacher_userid=...&search=...
app.get('/jungsi/director/students', authMiddleware, isDirectorMiddleware, async (req, res) => {
    const { year, class_name, teacher_userid, search } = req.query;
    const { branch } = req.user; // 원장의 지점

    console.log(`[API /director/students] ${branch} 지점 ${year}년도 전체 학생 목록 조회`);

    if (!year) return res.status(400).json({ success: false, message: 'year 파라미터 필수' });

    try {
        let sql = `
            SELECT
                sa.account_id, sa.userid, sa.name AS student_name,
                sa.grade, sa.gender,
                sassign.class_name, sassign.teacher_userid,
                (SELECT stn.injury_level FROM jungsimaxstudent.student_teacher_notes stn WHERE stn.student_account_id = sa.account_id AND stn.category = '부상' ORDER BY stn.note_date DESC LIMIT 1) AS recent_injury_level,
                (SELECT stn.note_date FROM jungsimaxstudent.student_teacher_notes stn WHERE stn.student_account_id = sa.account_id AND stn.category = '상담' ORDER BY stn.note_date DESC LIMIT 1) AS recent_counseling_date,
                (SELECT stn.note_date FROM jungsimaxstudent.student_teacher_notes stn WHERE stn.student_account_id = sa.account_id AND stn.category = '멘탈' ORDER BY stn.note_date DESC LIMIT 1) AS recent_mental_date
            FROM jungsimaxstudent.student_account sa
            LEFT JOIN jungsimaxstudent.student_assignments sassign
              ON sa.account_id = sassign.student_account_id AND sassign.year = ?
            WHERE sa.branch = ?
        `;
        const params = [year, branch];

        // 필터링 조건 추가
        if (class_name) {
            sql += ' AND sassign.class_name = ?';
            params.push(class_name);
        }
        if (teacher_userid) {
            sql += ' AND sassign.teacher_userid = ?';
            params.push(teacher_userid);
        }
        if (search) {
            sql += ' AND (sa.name LIKE ? OR sa.userid LIKE ?)';
            params.push(`%${search}%`, `%${search}%`);
        }

        sql += ' ORDER BY sa.name ASC';

        const [students] = await dbStudent.query(sql, params);
        console.log(` -> ${students.length}명 학생 조회 완료`);
        res.json({ success: true, students: students });

    } catch (err) {
        console.error('❌ /director/students API 오류:', err);
        res.status(500).json({ success: false, message: 'DB 조회 중 오류 발생' });
    }
});

// --- 1.2. 특정 학생 상세 정보 조회 ---
// GET /jungsi/director/student/:account_id/details
app.get('/jungsi/director/student/:account_id/details', authMiddleware, isDirectorMiddleware, async (req, res) => {
    const { account_id } = req.params;
    const { branch: directorBranch } = req.user;

    console.log(`[API /director/student/details] 학생(${account_id}) 상세 정보 조회`);

    if (!account_id) return res.status(400).json({ success: false, message: 'account_id 필요' });

    let connection;
    try {
        connection = await dbStudent.getConnection(); // 여러 DB 접근을 위해 커넥션 사용

        // 1. 학생 기본 정보 및 소속 지점 확인
        const [studentInfoRows] = await connection.query(
            'SELECT * FROM jungsimaxstudent.student_account WHERE account_id = ?', [account_id]
        );
        if (studentInfoRows.length === 0) {
            return res.status(404).json({ success: false, message: '학생 정보를 찾을 수 없음' });
        }
        const studentInfo = studentInfoRows[0];
        if (studentInfo.branch !== directorBranch) {
            return res.status(403).json({ success: false, message: '다른 지점 학생 정보 조회 불가' });
        }

        // 2. 수능 성적 조회 (jungsi DB)
        // 학생 기본 정보의 account_id와 jungsi DB의 학생 ID(student_id) 매핑 필요
        // 여기서는 student_account 테이블에 매핑 정보가 있다고 가정 (없으면 JOIN 필요)
        const studentIdJungsi = studentInfo.jungsi_student_id; // 예시 필드명, 실제 필드명 확인 필요!
        let scores = null;
        if (studentIdJungsi) {
            const [scoreRows] = await db.query( // ⭐️ jungsi DB 사용 (db)
                'SELECT * FROM 학생수능성적 WHERE student_id = ? ORDER BY 학년도 DESC LIMIT 1', // 가장 최근 성적
                [studentIdJungsi]
            );
            if (scoreRows.length > 0) scores = scoreRows[0];
        }

        // 3. 실기 기록 조회 (jungsimaxstudent DB)
        const [practicalRecords] = await connection.query(
            'SELECT event_name, record_date, record_value FROM student_practical_records WHERE account_id = ? ORDER BY event_name, record_date DESC', [account_id]
        );
        const recordsGrouped = {};
        practicalRecords.forEach(r => {
            if (!recordsGrouped[r.event_name]) recordsGrouped[r.event_name] = [];
            recordsGrouped[r.event_name].push({ date: r.record_date, value: r.record_value });
        });

        // 4. 실기 목표 조회 (jungsimaxstudent DB)
        const [practicalGoals] = await connection.query(
            'SELECT event_name, goal_value FROM student_practical_goals WHERE account_id = ?', [account_id]
        );
        const goalsMap = {};
        practicalGoals.forEach(g => { goalsMap[g.event_name] = g.goal_value; });

        // 5. 모든 메모 조회 (jungsimaxstudent DB)
        const [allNotes] = await connection.query(
            `SELECT n.*, t.이름 as teacher_name
             FROM student_teacher_notes n
             LEFT JOIN \`26susi\`.원장회원 t ON n.teacher_userid COLLATE utf8mb4_unicode_ci = t.아이디 COLLATE utf8mb4_unicode_ci
             WHERE n.student_account_id = ? ORDER BY n.note_date DESC`,
            [account_id]
        );

        // 6. 저장 대학 목록 조회 (jungsimaxstudent DB)
        const [savedUniversities] = await connection.query(
            `SELECT su.*, jb.대학명, jb.학과명, jb.군
             FROM student_saved_universities su
             JOIN jungsi.정시기본 jb ON su.U_ID = jb.U_ID AND su.학년도 = jb.학년도
             WHERE su.account_id = ? ORDER BY su.학년도 DESC, FIELD(jb.군, '가', '나', '다')`,
            [account_id]
        );

        res.json({
            success: true,
            studentDetails: {
                basicInfo: studentInfo,
                scores: scores,
                practicalRecords: recordsGrouped,
                practicalGoals: goalsMap,
                allNotes: allNotes,
                savedUniversities: savedUniversities
            }
        });

    } catch (err) {
        console.error(`❌ /director/student/${account_id}/details API 오류:`, err);
        res.status(500).json({ success: false, message: 'DB 조회 중 오류 발생' });
    } finally {
        if (connection) connection.release();
    }
});


// --- 2.1. 지점 전체 강사 목록 조회 ---
// GET /jungsi/director/teachers
app.get('/jungsi/director/teachers', authMiddleware, isDirectorMiddleware, async (req, res) => {
    const { branch } = req.user;
    console.log(`[API /director/teachers] ${branch} 지점 전체 강사 목록 조회`);

    try {
        // ⭐️ dbSusi (26susi DB) 사용
        const [teachers] = await dbSusi.query(
            `SELECT 아이디 AS userid, 이름 AS name, 직급 AS position, 승인여부
             FROM 원장회원
             WHERE 지점명 = ?
             ORDER BY FIELD(직급, '원장', '부원장', '팀장', '강사'), 이름 ASC`,
            [branch]
        );
        console.log(` -> ${teachers.length}명 강사 조회 완료`);
        res.json({ success: true, teachers: teachers });
    } catch (err) {
        console.error('❌ /director/teachers API 오류:', err);
        res.status(500).json({ success: false, message: 'DB 조회 중 오류 발생' });
    }
});

// --- 2.2. 특정 강사 담당 학생 목록 조회 ---
// GET /jungsi/director/teacher/:teacher_userid/assigned-students?year=YYYY
app.get('/jungsi/director/teacher/:teacher_userid/assigned-students', authMiddleware, isDirectorMiddleware, async (req, res) => {
    const { teacher_userid } = req.params;
    const { year } = req.query;
    const { branch } = req.user; // 원장 지점

    console.log(`[API /director/teacher/assigned-students] 강사(${teacher_userid}) ${year}년도 담당 학생 목록 조회`);

    if (!year || !teacher_userid) return res.status(400).json({ success: false, message: 'year, teacher_userid 필수' });

    try {
        // (보안 강화) 조회하려는 강사가 원장 지점 소속인지 확인
        const [teacherCheck] = await dbSusi.query(
            'SELECT 아이디 FROM 원장회원 WHERE 아이디 = ? AND 지점명 = ?',
            [teacher_userid, branch]
        );
        if (teacherCheck.length === 0) {
            return res.status(403).json({ success: false, message: '조회 권한 없는 강사' });
        }

        // ⭐️ dbStudent 사용
        const [students] = await dbStudent.query(
            `SELECT sa.account_id, sa.name AS student_name, sa.grade, sa.gender, sassign.class_name
             FROM student_assignments sassign
             JOIN student_account sa ON sassign.student_account_id = sa.account_id
             WHERE sassign.teacher_userid = ? AND sassign.year = ? AND sa.branch = ?
             ORDER BY sa.name ASC`,
            [teacher_userid, year, branch]
        );
        console.log(` -> ${students.length}명 학생 조회 완료`);
        res.json({ success: true, assignedStudents: students });
    } catch (err) {
        console.error(`❌ /director/teacher/${teacher_userid}/assigned-students API 오류:`, err);
        res.status(500).json({ success: false, message: 'DB 조회 중 오류 발생' });
    }
});

// --- 2.3. 강사 계정 정보 수정 (권한/상태) ---
// PUT /jungsi/director/teacher/:teacher_userid/account
app.put('/jungsi/director/teacher/:teacher_userid/account', authMiddleware, isDirectorMiddleware, async (req, res) => {
    const { teacher_userid } = req.params;
    const { position, 승인여부 } = req.body;
    const { branch: directorBranch } = req.user;

    console.log(`[API /director/teacher/account] 강사(${teacher_userid}) 정보 수정 요청:`, req.body);

    if (!position && !승인여부) {
        return res.status(400).json({ success: false, message: '수정할 정보(position 또는 승인여부) 필요' });
    }

    // 값 유효성 검사 (예시)
    const validPositions = ['원장', '부원장', '팀장', '강사'];
    const validStatus = ['O', 'N', 'X'];
    if (position && !validPositions.includes(position)) {
        return res.status(400).json({ success: false, message: '유효하지 않은 직급' });
    }
    if (승인여부 && !validStatus.includes(승인여부)) {
        return res.status(400).json({ success: false, message: '유효하지 않은 승인 상태' });
    }

    let connection;
    try {
        connection = await dbSusi.getConnection(); // ⭐️ dbSusi 사용
        await connection.beginTransaction();

        // 1. 수정 대상 강사가 원장 지점 소속인지 확인
        const [ownerCheck] = await connection.query(
            'SELECT 아이디 FROM 원장회원 WHERE 아이디 = ? AND 지점명 = ?',
            [teacher_userid, directorBranch]
        );
        if (ownerCheck.length === 0) {
            await connection.rollback();
            return res.status(403).json({ success: false, message: '수정 권한 없는 강사' });
        }

        // 2. 정보 업데이트
        const updates = [];
        const params = [];
        if (position) {
            updates.push('직급 = ?');
            params.push(position);
        }
        if (승인여부) {
            updates.push('승인여부 = ?');
            params.push(승인여부);
        }
        params.push(teacher_userid); // WHERE 절 파라미터

        const sql = `UPDATE 원장회원 SET ${updates.join(', ')} WHERE 아이디 = ?`;
        const [result] = await connection.query(sql, params);

        await connection.commit();

        if (result.affectedRows > 0) {
            console.log(` -> 강사(${teacher_userid}) 정보 업데이트 성공`);
            res.json({ success: true, message: '강사 정보가 업데이트되었습니다.' });
        } else {
            res.status(404).json({ success: false, message: '해당 강사를 찾을 수 없음' });
        }
    } catch (err) {
        if (connection) await connection.rollback();
        console.error(`❌ /director/teacher/${teacher_userid}/account API 오류:`, err);
        res.status(500).json({ success: false, message: 'DB 업데이트 중 오류 발생' });
    } finally {
        if (connection) connection.release();
    }
});


// --- 3.1. 반별/강사별 학생 수 조회 ---
// GET /jungsi/director/stats/student-distribution?year=YYYY
app.get('/jungsi/director/stats/student-distribution', authMiddleware, isDirectorMiddleware, async (req, res) => {
    const { year } = req.query;
    const { branch } = req.user;

    console.log(`[API /director/stats/student-distribution] ${branch} 지점 ${year}년도 학생 분포 통계 조회`);

    if (!year) return res.status(400).json({ success: false, message: 'year 파라미터 필수' });

    try {
        // ⭐️ dbStudent 사용
        // 학생 계정 테이블(sa)과 배정 테이블(sassign)을 LEFT JOIN 하여 조회
        const sql = `
            SELECT
                IFNULL(sassign.class_name, '미배정') AS class_group,
                IFNULL(sassign.teacher_userid, '미배정') AS teacher_group,
                COUNT(sa.account_id) AS student_count
            FROM jungsimaxstudent.student_account sa
            LEFT JOIN jungsimaxstudent.student_assignments sassign
              ON sa.account_id = sassign.student_account_id AND sassign.year = ?
            WHERE sa.branch = ?
            GROUP BY class_group, teacher_group
        `;
        const [rows] = await dbStudent.query(sql, [year, branch]);

        // 결과 가공
        const byClass = {};
        const byTeacher = {};
        rows.forEach(row => {
            // 반별 집계
            if (!byClass[row.class_group]) byClass[row.class_group] = 0;
            byClass[row.class_group] += row.student_count;

            // 강사별 집계
            if (!byTeacher[row.teacher_group]) byTeacher[row.teacher_group] = 0;
            byTeacher[row.teacher_group] += row.student_count;
        });

        console.log(` -> 학생 분포 통계 집계 완료`);
        res.json({
            success: true,
            distribution: {
                byClass: byClass,
                byTeacher: byTeacher
            }
        });

    } catch (err) {
        console.error('❌ /director/stats/student-distribution API 오류:', err);
        res.status(500).json({ success: false, message: 'DB 조회 또는 집계 중 오류 발생' });
    }
});

//실기요청부분
// ================================
// 정시 실기모드 관리 (토큰 없이)
// ================================

// 👉 스키마+테이블명 정확히 맞춤
const PRACTICAL_TABLE = '정시반영비율';

// 1) 작업자 구간 정의
const PRACTICAL_WORKER_SLOTS = [
  { name: '대전', start: 0, end: 40 },    // 0~39
  { name: '강남', start: 40, end: 80 },   // 40~79
  { name: '울산', start: 80, end: 120 },  // 80~119
  { name: '대구', start: 120, end: 999999 } // 나머지 전부
];

// 헬퍼
function findPracticalWorkerByIndex(idx) {
  return PRACTICAL_WORKER_SLOTS.find(w => idx >= w.start && idx < w.end)
      || PRACTICAL_WORKER_SLOTS[PRACTICAL_WORKER_SLOTS.length - 1];
}

/**
 * GET /jungsi/practical-mode/workers
 * → 현재 작업자 구간 정보
 */
app.get('/jungsi/practical-mode/workers', (req, res) => {
  res.json({
    success: true,
    workers: PRACTICAL_WORKER_SLOTS
  });
});

/**
 * GET /jungsi/practical-mode/list?year=2026&worker=대전
 * - 실기 비율이 있는 학과만
 * - 작업자 구간별 분할
 * - 토큰 없음
 */
// jungsi.js 안에 그대로 추가
app.get('/jungsi/practical-mode/list', async (req, res) => {
  const year = req.query.year ? Number(req.query.year) : new Date().getFullYear() + 1; // 2026
  const worker = (req.query.worker || '').trim();  // '대전', '강남' 등

  // ⭐️ [수정 1] 작업자(worker)가 없으면 "전체" 대신 무조건 빈 배열 반환
  if (!worker) {
    console.log(`[practical-mode/list] 작업자(worker) 파라미터가 없어 빈 값 반환`);
    return res.json({ success: true, year, count: 0, items: [] });
  }

  // ⭐️ [수정 2] 작업자 순서 정의
  const regions = ['대전', '강남', '울산', '대구'];
  const workerIndex = regions.indexOf(worker);

  if (workerIndex === -1) {
    console.log(`[practical-mode/list] 정의되지 않은 작업자: ${worker}`);
    return res.json({ success: true, year, count: 0, items: [] });
  }

  try {
    // ⭐️ [수정 3] 1단계: n/4 계산을 위해 '총 개수' 먼저 조회
    const countSql = `
      SELECT COUNT(*) as totalCount
      FROM 정시반영비율 AS r
      WHERE r.학년도 = ?
        AND (r.실기 IS NOT NULL AND r.실기 <> '' AND r.실기 <> '0')
    `;
    const [countRows] = await db.query(countSql, [year]);
    const totalCount = countRows[0].totalCount;

    if (totalCount === 0) {
      return res.json({ success: true, year, count: 0, items: [] });
    }

    // ⭐️ [수정 4] 2단계: 공평 배분 (LIMIT, OFFSET) 계산
    const totalRegions = regions.length; // 4
    const baseChunkSize = Math.floor(totalCount / totalRegions); // 100 / 4 = 25
    const remainder = totalCount % totalRegions; // 101 % 4 = 1 (1명 남음)

    let offset = 0;
    // 현재 작업자(workerIndex) 직전까지의 offset 누적
    for (let i = 0; i < workerIndex; i++) {
      // 나머지(remainder)는 앞 순서 작업자(0, 1, ...)부터 1개씩 나눠줌
      const sizeForThisRegion = (i < remainder) ? (baseChunkSize + 1) : baseChunkSize;
      offset += sizeForThisRegion;
    }
    // 현재 작업자가 가져갈 개수(limit)
    const limit = (workerIndex < remainder) ? (baseChunkSize + 1) : baseChunkSize;

    console.log(`[practical-mode/list] Querying: year=${year}, worker=${worker} (Total: ${totalCount}, Limit: ${limit}, Offset: ${offset})`);

    if (limit === 0) {
      // 할당량이 0이면 쿼리 안 하고 바로 반환
      return res.json({ success: true, year, count: 0, items: [] });
    }

    // ⭐️ [수정 5] 3단계: 계산된 limit, offset으로 실제 데이터 조회 (JOIN 쿼리는 동일)
    const [rows] = await db.query(
      `
      SELECT
        r.id as _idx,
        r.학년도,
        r.U_ID,
        b.대학명,
        b.학과명,
        r.실기,
        r.실기총점,
        r.실기모드
      FROM 정시반영비율 AS r
      JOIN 정시기본 AS b ON r.U_ID = b.U_ID AND r.학년도 = b.학년도
      WHERE r.학년도 = ?
        AND (r.실기 IS NOT NULL AND r.실기 <> '' AND r.실기 <> '0')
      ORDER BY r.id ASC
      LIMIT ? OFFSET ?
      `,
      [year, limit, offset] // ⭐️ 계산된 limit, offset 적용
    );

    // ⭐️ [수정 6] 프론트가 기대하는 'items' 키로 응답 (동일)
    res.json({
      success: true,
      year,
      count: rows.length,
      items: rows
    });
  } catch (err) {
    console.error('/jungsi/practical-mode/list error', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /jungsi/practical-mode/set
 * body: { U_ID: 123, mode: "basic" | "special" }
 * - 실기모드 변경
 * - 토큰 없음
 */
// 실기모드(basic/special) 저장
app.post('/jungsi/practical-mode/set', async (req, res) => {
  const { id, mode } = req.body; // mode: 'basic' | 'special'
  if (!id || !mode) {
    return res.status(400).json({ success: false, message: 'id 와 mode 는 필수입니다.' });
  }

  if (!['basic', 'special'].includes(mode)) {
    return res.status(400).json({ success: false, message: 'mode 는 basic 또는 special 만 가능합니다.' });
  }

  try {
    const [result] = await db.query(
      `UPDATE 정시반영비율 SET 실기모드 = ? WHERE id = ?`,
      [mode, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: '해당 id 를 가진 행이 없습니다.' });
    }

    res.json({ success: true, id, mode });
  } catch (err) {
    console.error('/jungsi/practical-mode/save error', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// jungsi.js 안쪽

app.post('/jungsi/match-original-weights', authMiddleware, async (req, res) => {
  const limit = Number(req.body.limit || 200); // 한 번에 200개만

  try {
    // 1. 매칭 안 된 원본 가져오기
    const [rows] = await db.query(`
      SELECT id, 학년도, 대학명, 학과명
      FROM 정시_원본반영표
      WHERE (매칭_U_ID IS NULL OR 매칭_U_ID = '' OR 매칭상태 = '대기')
      LIMIT ?
    `, [limit]);

    if (rows.length === 0) {
      return res.json({ success: true, message: '매칭할 데이터 없음', matched: 0 });
    }

    let matched = 0, failed = 0, multi = 0;

    for (const r of rows) {
      // 2. 정시기본에서 찾기
      const [cands] = await db.query(`
        SELECT U_ID
        FROM 정시기본
        WHERE 학년도 = ? AND 대학명 = ? AND 학과명 = ?
      `, [r.학년도, r.대학명, r.학과명]);

      if (cands.length === 1) {
        // 성공
        await db.query(`
          UPDATE 정시_원본반영표
          SET 매칭_U_ID = ?, 매칭상태 = '성공'
          WHERE id = ?
        `, [cands[0].U_ID, r.id]);
        matched++;
      } else if (cands.length === 0) {
        // 실패
        await db.query(`
          UPDATE 정시_원본반영표
          SET 매칭상태 = '실패'
          WHERE id = ?
        `, [r.id]);
        failed++;
      } else {
        // 여러개
        await db.query(`
          UPDATE 정시_원본반영표
          SET 매칭상태 = '여러개'
          WHERE id = ?
        `, [r.id]);
        multi++;
      }
    }

    res.json({
      success: true,
      message: '매칭 완료',
      matched,
      failed,
      multi,
      processed: rows.length
    });

  } catch (err) {
    console.error('match-original-weights error', err);
    res.status(500).json({ success: false, message: '서버 오류', error: err.message });
  }
});

// jungsi.js 안
app.post('/jungsi/apply-original-weights', authMiddleware, async (req, res) => {
  const limit = Number(req.body.limit || 200);

  try {
    const [rows] = await db.query(`
      SELECT id, 학년도, 매칭_U_ID,
             국어_raw, 수학_raw, 영어_raw, 탐구_raw, 탐구수_raw, 한국사_raw
      FROM 정시_원본반영표
      WHERE 매칭_U_ID IS NOT NULL
        AND 매칭_U_ID <> ''
        AND 매칭상태 = '성공'
      LIMIT ?
    `, [limit]);

    let updated = 0;

    for (const r of rows) {
      const kor  = parseCell(r.국어_raw);
      const math = parseCell(r.수학_raw);
      const eng  = parseCell(r.영어_raw);
      const inq  = parseCell(r.탐구_raw);
      const hist = parseHistory(r.한국사_raw);

      // 몇 개가 괄호인지
      const choiceFlags = [
        isChoice(kor),
        isChoice(math),
        isChoice(eng),
        isChoice(inq)
      ];
      const choiceCount = choiceFlags.filter(Boolean).length;

      // ✅ 여기 안전하게
      const weight =
        (kor  && kor.weight)  ||
        (math && math.weight) ||
        (eng  && eng.weight)  ||
        (inq  && inq.weight)  ||
        null;

      const inqCount = r.탐구수_raw ? Number(r.탐구수_raw) : null;

      let 선택형여부 = 0;
      let 선택조건   = null;

      if (choiceCount === 4) {
        선택형여부 = 1;
        선택조건 = inqCount === 1 ? '국수영탐택1' : '국수영탐택2';
      } else if (choiceCount === 3) {
        선택형여부 = 1;
        if (isChoice(kor) && isChoice(math) && isChoice(eng)) {
          선택조건 = inqCount === 1 ? '국수영택1' : '국수영택2';
        } else if (isChoice(inq)) {
          선택조건 = inqCount === 1 ? '탐구택1' : '탐구택2';
        } else {
          선택조건 = '선택형';
        }
      } else if (choiceCount === 2) {
        if (isChoice(inq)) {
          선택형여부 = 1;
          선택조건 = inqCount === 1 ? '탐구택1' : '탐구택2';
        } else {
          선택형여부 = 1;
          선택조건 = '선택형';
        }
      } else if (choiceCount === 1) {
        선택형여부 = 1;
        선택조건 = '선택형';
      } else {
        선택형여부 = 0;
        선택조건 = null;
      }

      const 한국사방식 = hist.mode;
      const 한국사점수 = hist.value;

      await db.query(`
        UPDATE 정시반영비율
        SET
          선택형여부 = ?,
          선택조건   = ?,
          선택가중치 = ?,
          한국사방식 = ?,
          한국사점수 = ?
        WHERE U_ID = ? AND 학년도 = ?
      `, [
        선택형여부,
        선택조건,
        weight,
        한국사방식,
        한국사점수,
        r.매칭_U_ID,
        r.학년도
      ]);

      updated++;
    }

    res.json({ success: true, updated, processed: rows.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }

  // ===== helper =====
  function isChoice(obj) {
    return obj && (obj.type === 'choice' || obj.type === 'weight');
  }

  function parseCell(raw) {
    if (!raw) return null;
    const s = raw.trim();
    if (s.startsWith('(') && s.endsWith(')')) {
      const inner = s.slice(1, -1);
      if (inner.includes('/')) {
        return { type: 'weight', weight: inner }; // (80/20)
      }
      const num = Number(inner);
      return { type: 'choice', value: isNaN(num) ? inner : num }; // (35)
    }
    const num = Number(s);
    if (!isNaN(num)) return { type: 'fixed', value: num };
    return { type: 'raw', value: s };
  }

  function parseHistory(raw) {
    if (!raw) return { mode: null, value: null };
    const s = raw.trim();
    if (s.startsWith('[') && s.endsWith(']')) {
      const inner = s.slice(1, -1);
      const num = Number(inner);
      return { mode: '점수', value: isNaN(num) ? null : num };
    }
    if (s === '가감점') return { mode: '가감점', value: null };
    if (s === '가산점' || s === '가산') return { mode: '가산점', value: null };
    if (s === '감점') return { mode: '감점', value: null };
    if (s === '필수응시') return { mode: '필수응시', value: null };
    const num = Number(s);
    if (!isNaN(num)) return { mode: '점수', value: num };
    return { mode: null, value: null };
  }
});

// jungsi.js 파일의 /jungsi/filter-data/:year API를 이걸로 교체

// jungsi.js 파일의 /jungsi/filter-data/:year API를 이걸로 교체

// =============================================
// ⭐️ [수정] 필터링용 통합 데이터 조회 API (v4.1 - '기타' 비율 추가)
// =============================================
// GET /jungsi/filter-data/:year
app.get('/jungsi/filter-data/:year', authMiddleware, async (req, res) => {
    const { year } = req.params;
    const { branch } = req.user; // 로그인한 사용자의 지점명

    console.log(`[API /jungsi/filter-data] year=${year}, branch=${branch}`);

    if (!year) {
        return res.status(400).json({ success: false, message: '학년도 파라미터가 필요합니다.' });
    }

    try {
        // ✅ '기타' 컬럼 추가됨
        const sql = `
            SELECT
                jb.U_ID,
                jb.대학명,
                jb.학과명,
                jb.군,
                jb.광역 AS '지역',
                jb.시구,
                jb.교직,
                jb.모집정원,

                -- 원본 반영표에서 가져오는 과목 raw
                jov.국어_raw,
                jov.수학_raw,
                jov.영어_raw,
                jov.탐구_raw,
                jov.한국사_raw,
                jov.탐구수_raw,

                -- 비율
                jrb.수능,
                jrb.내신,
                jrb.실기,
                jrb.기타, -- ⭐️⭐️⭐️ [추가] '기타' 컬럼 ⭐️⭐️⭐️

                -- 실기 종목 모아주기
                GROUP_CONCAT(DISTINCT je.종목명 SEPARATOR ',') AS practical_events,

                -- ✅ MAX 컷
                max_cut.수능컷 AS max_suneung_cut,
                max_cut.총점컷 AS max_total_cut,
                max_cut.\`25년총점컷\` AS max_total_cut_25,

                -- ✅ 로그인한 지점 컷
                branch_cut.수능컷 AS branch_suneung_cut,
                branch_cut.총점컷 AS branch_total_cut,
                branch_cut.\`25년총점컷\` AS branch_total_cut_25

            FROM 정시기본 jb
            -- 원본 반영표
            LEFT JOIN 정시_원본반영표 jov
              ON jb.U_ID = jov.매칭_U_ID
             AND jb.학년도 = jov.학년도

            -- 실기배점(여러 줄) -> GROUP_CONCAT
            LEFT JOIN 정시실기배점 je
              ON jb.U_ID = je.U_ID
             AND jb.학년도 = je.학년도

            -- 수능/내신/실기/기타 비율
            LEFT JOIN 정시반영비율 jrb
              ON jb.U_ID = jrb.U_ID
             AND jb.학년도 = jrb.학년도

            -- ✅ MAX 컷점수
            LEFT JOIN 정시_컷점수 max_cut
              ON jb.U_ID = max_cut.U_ID
             AND jb.학년도 = max_cut.학년도
             AND max_cut.branch_name = 'MAX'

            -- ✅ 로그인한 지점 컷점수
            LEFT JOIN 정시_컷점수 branch_cut
              ON jb.U_ID = branch_cut.U_ID
             AND jb.학년도 = branch_cut.학년도
             AND branch_cut.branch_name = ?

            WHERE jb.학년도 = ?

            GROUP BY
                jb.U_ID,
                jb.대학명,
                jb.학과명,
                jb.군,
                jb.광역,
                jb.시구,
                jb.교직,
                jb.모집정원,
                jov.국어_raw,
                jov.수학_raw,
                jov.영어_raw,
                jov.탐구_raw,
                jov.한국사_raw,
                jov.탐구수_raw,
                jrb.수능,
                jrb.내신,
                jrb.실기,
                jrb.기타, -- ⭐️⭐️⭐️ [추가] '기타' 컬럼 (GROUP BY에도 필수) ⭐️⭐️⭐️
                max_cut.수능컷,
                max_cut.총점컷,
                max_cut.\`25년총점컷\`,
                branch_cut.수능컷,
                branch_cut.총점컷,
                branch_cut.\`25년총점컷\`

            ORDER BY jb.대학명, jb.학과명;
        `;

        // 순서 중요: [branch, year]
        const [rows] = await db.query(sql, [branch, year]);
        console.log(` -> /jungsi/filter-data ${rows.length}건 조회됨 (컷+기타 포함)`); // ⭐️ 로그 수정

        return res.json({
            success: true,
            data: rows
        });
    } catch (err) {
        console.error('❌ /jungsi/filter-data 오류:', err);
        return res.status(500).json({
            success: false,
            message: 'DB 조회 중 오류가 발생했습니다.'
        });
    }
});


// =============================================
// ⭐️ [신규] 퀘스트(운동) 목록 관리 API (관리자 전용)
// =============================================

// --- 1. 관리자용: 전체 운동 목록 조회 (활성/비활성 포함) ---
// GET /jungsi/admin/master-exercises
app.get('/jungsi/admin/master-exercises', authMiddleware, async (req, res) => {
    // ⭐️ 관리 권한 확인
    if (!hasAdminPermission(req.user)) {
        return res.status(403).json({ success: false, message: '접근 권한이 없습니다.' });
    }
    console.log(`[API /admin/master-exercises] 관리자(${req.user.userid}) 전체 운동 목록 조회`);
    try {
        const [exercises] = await dbStudent.query(
            `  SELECT * FROM master_exercises
             ORDER BY category, sub_category, exercise_name`
        );
        res.json({ success: true, exercises: exercises });
    } catch (err) {
        console.error('❌ /admin/master-exercises GET 오류:', err);
        res.status(500).json({ success: false, message: 'DB 조회 오류' });
    }
});

// --- 2. 관리자용: 기존 카테고리/세부 카테고리 목록 조회 (Datalist용) ---
// GET /jungsi/admin/exercise-categories
app.get('/jungsi/admin/exercise-categories', authMiddleware, async (req, res) => {
    if (!hasAdminPermission(req.user)) {
        return res.status(403).json({ success: false, message: '접근 권한이 없습니다.' });
    }
    try {
        const [cats] = await dbStudent.query(
            `SELECT DISTINCT category FROM jungsimaxstudent.master_exercises WHERE category IS NOT NULL AND category != '' ORDER BY category`
        );
        const [subCats] = await dbStudent.query(
            `SELECT DISTINCT sub_category FROM jungsimaxstudent.master_exercises WHERE sub_category IS NOT NULL AND sub_category != '' ORDER BY sub_category`
        );
        res.json({
            success: true,
            categories: cats.map(c => c.category),
            subCategories: subCats.map(s => s.sub_category)
        });
    } catch (err) {
        console.error('❌ /admin/exercise-categories GET 오류:', err);
        res.status(500).json({ success: false, message: 'DB 조회 오류' });
    }
});

// --- 3. 관리자용: 새 운동 추가 (is_active 값 1/0으로 수정) ---
// POST /jungsi/admin/master-exercises
app.post('/jungsi/admin/master-exercises', authMiddleware, async (req, res) => {
    if (!hasAdminPermission(req.user)) {
        return res.status(403).json({ success: false, message: '접근 권한이 없습니다.' });
    }
    const { exercise_name, category, sub_category, is_active, exp_value } = req.body;
    if (!exercise_name) {
        return res.status(400).json({ success: false, message: '운동명(exercise_name)은 필수입니다.' });
    }
    console.log(`[API /admin/master-exercises POST] 새 운동 추가: ${exercise_name}`);
    try {
        const sql = `
            INSERT INTO jungsimaxstudent.master_exercises
                (exercise_name, category, sub_category, is_active, exp_value, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, NOW(), NOW())
        `;

        // ▼▼▼▼▼ [수정] true/false 대신 1/0 전달 ▼▼▼▼▼
        const isActiveValue = (is_active !== false) ? 1 : 0; // 기본값 1(true)
        const expValueInt = parseInt(exp_value) || 1; // 기본값 1 EXP
        // ▲▲▲▲▲ [수정] 끝 ▲▲▲▲▲

        const [result] = await dbStudent.query(sql, [
            exercise_name,
            category || 'Other',
            sub_category || null,
            isActiveValue, // ⭐️ 수정된 값 사용
            expValueInt // ⭐️ 경험치 값 추가
        ]);
        res.status(201).json({ success: true, message: '새 운동 추가 완료', insertedId: result.insertId });
    } catch (err) {
        console.error('❌ /admin/master-exercises POST 오류:', err);
        if (err.code === 'ER_DUP_ENTRY') {
            res.status(409).json({ success: false, message: '이미 존재하는 운동 이름입니다.' });
        } else {
            res.status(500).json({ success: false, message: 'DB 저장 오류' });
        }
    }
});

// --- 4. 관리자용: 운동 정보 수정 (is_active 값 1/0으로 수정) ---
// PUT /jungsi/admin/master-exercises/:id
app.put('/jungsi/admin/master-exercises/:id', authMiddleware, async (req, res) => {
    if (!hasAdminPermission(req.user)) {
        return res.status(403).json({ success: false, message: '접근 권한이 없습니다.' });
    }
    const { id } = req.params;
    const { exercise_name, category, sub_category, is_active, exp_value } = req.body;
    if (!exercise_name) {
        return res.status(400).json({ success: false, message: '운동명(exercise_name)은 필수입니다.' });
    }
    console.log(`[API /admin/master-exercises PUT] 운동(${id}) 수정: ${exercise_name}`);
    try {
        const sql = `
            UPDATE jungsimaxstudent.master_exercises SET
                exercise_name = ?,
                category = ?,
                sub_category = ?,
                is_active = ?,
                exp_value = ?,
                updated_at = NOW()
            WHERE exercise_id = ?
        `;

        // ▼▼▼▼▼ [수정] true/false 대신 1/0 전달 ▼▼▼▼▼
        const isActiveValue = (is_active !== false) ? 1 : 0; // is_active가 true 또는 undefined이면 1, false면 0
        const expValueInt = parseInt(exp_value) || 1; // 기본값 1 EXP
        // ▲▲▲▲▲ [수정] 끝 ▲▲▲▲▲

        const [result] = await dbStudent.query(sql, [
            exercise_name,
            category || 'Other',
            sub_category || null,
            isActiveValue, // ⭐️ 수정된 값 사용
            expValueInt, // ⭐️ 경험치 값 추가
            id
        ]);
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: '해당 운동을 찾을 수 없습니다.' });
        }
        res.json({ success: true, message: '운동 정보 수정 완료' });
    } catch (err) {
        // ⭐️ 디버깅을 위해 에러 객체 전체를 로깅
        console.error(`❌ /admin/master-exercises PUT (${id}) 오류:`, err); 
        
        if (err.code === 'ER_DUP_ENTRY') {
            res.status(409).json({ success: false, message: '이미 존재하는 운동 이름입니다.' });
        } else {
            res.status(500).json({ success: false, message: 'DB 수정 오류' });
        }
    }
});
// --- 5. 관리자용: 운동 삭제 ---
// DELETE /jungsi/admin/master-exercises/:id
app.delete('/jungsi/admin/master-exercises/:id', authMiddleware, async (req, res) => {
    if (!hasAdminPermission(req.user)) {
        return res.status(403).json({ success: false, message: '접근 권한이 없습니다.' });
    }
    const { id } = req.params;
    console.log(`[API /admin/master-exercises DELETE] 운동(${id}) 삭제`);
    try {
        // (주의: 이 운동을 사용한 기존 할당 내역(teacher_daily_assignments)이 있다면 FK 제약조건 오류가 날 수 있음)
        // (실제 운영 시에는 is_active = false 로 처리하는 것을 권장함)
        const sql = `DELETE FROM jungsimaxstudent.master_exercises WHERE exercise_id = ?`;
        const [result] = await dbStudent.query(sql, [id]);
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: '해당 운동을 찾을 수 없습니다.' });
        }
        res.json({ success: true, message: '운동 삭제 완료' });
    } catch (err) {
        console.error(`❌ /admin/master-exercises DELETE (${id}) 오류:`, err);
        if (err.code === 'ER_ROW_IS_REFERENCED_2') {
             res.status(400).json({ success: false, message: '이 운동을 사용 중인 할당 내역이 있어 삭제할 수 없습니다. 대신 비활성화하세요.' });
        } else {
            res.status(500).json({ success: false, message: 'DB 삭제 오류' });
        }
    }
});

// ⭐️ [신규] GET /jungsi/admin/master-exercises/:id/check-usage - 퀘스트 사용 여부 확인
app.get('/jungsi/admin/master-exercises/:id/check-usage', authMiddleware, async (req, res) => {
    if (!hasAdminPermission(req.user)) {
        return res.status(403).json({ success: false, message: '접근 권한이 없습니다.' });
    }
    const { id } = req.params;
    console.log(`[API /admin/master-exercises/:id/check-usage] 운동(${id}) 사용 여부 확인`);
    try {
        // 해당 exercise_id를 사용하는 할당 내역이 있는지 확인
        const [exercise] = await dbStudent.query(
            'SELECT exercise_name FROM jungsimaxstudent.master_exercises WHERE exercise_id = ?',
            [id]
        );

        if (exercise.length === 0) {
            return res.status(404).json({ success: false, message: '해당 운동을 찾을 수 없습니다.' });
        }

        const exerciseName = exercise[0].exercise_name;

        // exercise_name으로 할당 내역 확인
        const [assignments] = await dbStudent.query(
            'SELECT COUNT(*) as count FROM jungsimaxstudent.teacher_daily_assignments WHERE exercise_name = ?',
            [exerciseName]
        );

        const isInUse = assignments[0].count > 0;
        const assignmentCount = assignments[0].count;

        res.json({
            success: true,
            inUse: isInUse,
            assignmentCount: assignmentCount,
            message: isInUse
                ? `이 퀘스트는 ${assignmentCount}건의 할당 내역에서 사용 중입니다.`
                : '이 퀘스트는 사용되지 않았습니다.'
        });
    } catch (err) {
        console.error(`❌ /admin/master-exercises/:id/check-usage (${id}) 오류:`, err);
        res.status(500).json({ success: false, message: 'DB 조회 오류' });
    }
});

// ⭐️ [신규] 로고 업로드를 위한 Multer 설정
// 1. 폴더가 없으면 생성 (univlogos/temp)
const logosDir = path.join(__dirname, 'univlogos'); // ⭐️ public 빠짐
const tempDir = path.join(logosDir, 'temp');
(async () => {
    // ⭐️ logosDir 는 이미 수동으로 만들었지만, 코드가 확인하는게 안전.
    await fs.mkdir(logosDir, { recursive: true }); 
    await fs.mkdir(tempDir, { recursive: true });
})();

// 2. Multer 설정: 임시 폴더에 파일 저장
const upload = multer({ dest: tempDir });


// =============================================
// ⭐️ [신규 API] 대학 로고 업로드 API (디버깅 강화)
// =============================================
// POST /jungsi/admin/upload-logo
app.post('/jungsi/admin/upload-logo', authMiddleware, upload.single('logoFile'), async (req, res) => {
    const file = req.file;
    const { U_ID, year } = req.body;
    const { branch } = req.user; 

    console.log(`[API /upload-logo] ${branch} 지점, ${year}학년도 U_ID(${U_ID}) 로고 업로드 시도`);
    console.log(` -> 파일 정보:`, file); 
    console.log(` -> 바디 정보:`, req.body); 

    if (!file || !U_ID || !year) {
        if (file) await fs.unlink(file.path);
        return res.status(400).json({ success: false, message: 'U_ID, year, 로고 파일이 모두 필요합니다.' });
    }

    const tempPath = file.path; 
    const ext = path.extname(file.originalname); 
    const newFileName = `${U_ID}${ext}`;
    const permPath = path.join(logosDir, newFileName); 
    const logoUrl = `/univlogos/${newFileName}`; 
    
    console.log(` -> 임시경로: ${tempPath}`);
    console.log(` -> 영구경로: ${permPath}`);
    console.log(` -> DB URL: ${logoUrl}`); 

    try {
        await fs.rename(tempPath, permPath);
        console.log(` -> 파일 이동 성공: ${permPath}`); 

        const sql = 'UPDATE `정시기본` SET `logo_url` = ? WHERE `U_ID` = ? AND `학년도` = ?';
        console.log(` -> DB 실행: ${sql}`, [logoUrl, U_ID, year]); 
        
        const [updateResult] = await db.query(sql, [logoUrl, U_ID, year]);
        
        console.log(' -> [DB UPDATE 결과]', JSON.stringify(updateResult)); 

        // ⭐️ [수정] 덮어쓰기(affectedRows=1, changedRows=0)도 성공으로 처리
        // ⭐️ affectedRows가 0일 때만 (매칭된 row가 없을 때만) 에러
        if (updateResult.affectedRows === 0) {
             console.warn(' -> DB 업데이트 실패: 매칭된 row 없음'); 
             throw new Error('해당 U_ID와 학년도의 대학을 DB에서 찾을 수 없습니다.');
        }

        console.log(` -> 로고 저장/업데이트 성공: ${logoUrl}`);
        res.json({ 
            success: true, 
            message: `U_ID ${U_ID} 로고 저장 완료!`,
            logoUrl: logoUrl 
        });

    } catch (err) {
        if (tempPath) {
             try { await fs.unlink(tempPath); } catch (e) {} // ⭐️ 실패 시 임시 파일 삭제
        }
        console.error('❌ 로고 업로드 API 오류:', err.message); 
        res.status(500).json({ success: false, message: err.message || '서버 오류' });
    }
});
// =============================================
// ⭐️ 로고 업로더용: 학년도별 전체 대학 목록 조회 (디버깅 강화)
// =============================================
// GET /jungsi/admin/all-universities?year=YYYY
app.get('/jungsi/admin/all-universities', authMiddleware, async (req, res) => {
    const { year } = req.query;
    const { branch } = req.user; 

    console.log(`[API /all-universities] ${branch} 지점에서 ${year}학년도 전체 대학 목록(U_ID, 이름, logo_url) 요청`); // ⭐️ logo_url 추가

    if (!year) {
        return res.status(400).json({ success: false, message: '학년도(year) 쿼리 파라미터가 필요합니다.' });
    }

    try {
        const sql = "SELECT U_ID, 대학명, 학과명, logo_url FROM `정시기본` WHERE 학년도 = ? ORDER BY 대학명, 학과명"; // ⭐️ logo_url 추가
        console.log(` -> DB 실행: ${sql}`, [year]); // ⭐️ 디버깅
        
        const [rows] = await db.query(sql, [year]);
        
        console.log(` -> ${rows.length}건 조회 완료.`); // ⭐️ 디버깅
        
        // ⭐️ 디버깅: 로고 URL이 몇 개나 있는지 확인
        const logoCount = rows.filter(r => r.logo_url).length;
        console.log(` -> 그 중 logo_url이 null이 아닌 개수: ${logoCount}개`);

        const universities = rows.map(r => ({
            U_ID: r.U_ID,
            name: `${r.대학명} - ${r.학과명}`,
            logo_url: r.logo_url // ⭐️ 로고 URL 포함
        }));

        res.json({ success: true, universities: universities });

    } catch (err) {
        console.error('❌ /admin/all-universities API 오류:', err);
        res.status(500).json({ success: false, message: 'DB 조회 오류' });
    }
});

// =============================================
// ⭐️ [신규] 실기 배점표 관리 API (Admin 전용)
// =============================================

/**
 * API 1: (Admin) 배점표가 등록된 학교/학과 목록 조회
 * GET /jungsi/admin/practical-table/schools?year=2026
 */
app.get('/jungsi/admin/practical-table/schools', authMiddleware, isAdminMiddleware, async (req, res) => {
    const { year } = req.query;
    if (!year) {
        return res.status(400).json({ success: false, message: 'year 쿼리 파라미터가 필요합니다.' });
    }

    try {
        // 정시실기배점(s)에 데이터가 있는 학교의 기본정보(b)를 조회
        const sql = `
            SELECT DISTINCT b.U_ID, b.대학명, b.학과명
            FROM 정시실기배점 s
            JOIN 정시기본 b ON s.U_ID = b.U_ID AND s.학년도 = b.학년도
            WHERE s.학년도 = ?
            ORDER BY b.대학명, b.학과명
        `;
        const [schools] = await db.query(sql, [year]);
        res.json({ success: true, schools: schools });
    } catch (err) {
        console.error('❌ /admin/practical-table/schools 오류:', err);
        res.status(500).json({ success: false, message: 'DB 조회 오류' });
    }
});

/**
 * API 2: (Admin) 특정 학교/학년도의 전체 배점표 데이터 조회
 * GET /jungsi/admin/practical-table/data?year=2026&U_ID=123
 */
app.get('/jungsi/admin/practical-table/data', authMiddleware, isAdminMiddleware, async (req, res) => {
    const { year, U_ID } = req.query;
    if (!year || !U_ID) {
        return res.status(400).json({ success: false, message: 'year, U_ID 쿼리 파라미터가 필요합니다.' });
    }

    try {
        const sql = `
            SELECT id, 종목명, 성별, 기록, 배점
            FROM 정시실기배점
            WHERE U_ID = ? AND 학년도 = ?
            ORDER BY 종목명, 성별, id ASC
        `; // id 오름차순으로 정렬해야 순서가 맞음
        const [data] = await db.query(sql, [U_ID, year]);
        res.json({ success: true, data: data });
    } catch (err) {
        console.error('❌ /admin/practical-table/data 오류:', err);
        res.status(500).json({ success: false, message: 'DB 조회 오류' });
    }
});

/**
 * API 3: (Admin) 배점표 일괄 저장/수정/삭제 (핵심 API)
 * POST /jungsi/admin/practical-table/bulk-update
 */
app.post('/jungsi/admin/practical-table/bulk-update', authMiddleware, isAdminMiddleware, async (req, res) => {
    const { U_ID, year, updates, additions, deletions } = req.body;
    
    if (!U_ID || !year || !updates || !additions || !deletions) {
        return res.status(400).json({ success: false, message: '필수 데이터(U_ID, year, updates, additions, deletions) 누락' });
    }

    let connection;
    try {
        connection = await db.getConnection();
        await connection.beginTransaction();

        let totalAffected = 0;

        // 1. 삭제 (Deletions)
        if (deletions.length > 0) {
            const deleteSql = 'DELETE FROM 정시실기배점 WHERE id = ? AND U_ID = ?';
            for (const id of deletions) {
                const [result] = await connection.query(deleteSql, [id, U_ID]);
                totalAffected += result.affectedRows;
            }
            console.log(`[실기배점표] ${deletions.length}건 삭제됨`);
        }

        // 2. 수정 (Updates)
        if (updates.length > 0) {
            const updateSql = 'UPDATE 정시실기배점 SET 기록 = ?, 배점 = ?, 종목명 = ?, 성별 = ? WHERE id = ? AND U_ID = ?';
            for (const item of updates) {
                // ⭐️ 모든 필드 수정 가능하게 (종목명, 성별 포함)
                const [result] = await connection.query(updateSql, [
                    item.기록,
                    item.배점,
                    item.종목명, // ⭐️ 추가
                    item.성별,   // ⭐️ 추가
                    item.id,
                    U_ID
                ]);
                totalAffected += result.affectedRows;
            }
            console.log(`[실기배점표] ${updates.length}건 수정됨`);
        }

        // 3. 추가 (Additions)
        if (additions.length > 0) {
            const insertSql = 'INSERT INTO 정시실기배점 (U_ID, 학년도, 종목명, 성별, 기록, 배점) VALUES ?';
            const values = additions.map(item => [
                U_ID,
                year,
                item.종목명,
                item.성별,
                item.기록,
                item.배점
            ]);
            const [result] = await connection.query(insertSql, [values]);
            totalAffected += result.affectedRows;
            console.log(`[실기배점표] ${additions.length}건 추가됨`);
        }

        await connection.commit();
        res.json({ success: true, message: '배점표가 성공적으로 저장되었습니다.', totalAffected: totalAffected });

    } catch (err) {
        if (connection) await connection.rollback();
        console.error('❌ /admin/practical-table/bulk-update 오류:', err);
        res.status(500).json({ success: false, message: 'DB 처리 중 오류 발생', error: err.message });
    } finally {
        if (connection) connection.release();
    }
});

app.get('/jungsi/grade-distribution', async (req, res) => {
  try {
    const { year } = req.query;

    if (!year) {
      return res.status(400).json({
        success: false,
        message: '학년도를 입력하세요.'
      });
    }

    // DB 쿼리
    const connection = await db.getConnection();

    try {
      // 해당 학년도의 모든 학생 성적 조회
      const [students] = await connection.query(`
        SELECT
          b.student_id,
          b.student_name,
          s.국어_선택과목,
          s.국어_등급,
          s.수학_선택과목,
          s.수학_등급,
          s.영어_등급,
          s.한국사_등급,
          s.탐구1_선택과목,
          s.탐구1_등급,
          s.탐구2_선택과목,
          s.탐구2_등급
        FROM 학생기본정보 b
        LEFT JOIN 학생수능성적 s ON b.student_id = s.student_id AND b.학년도 = s.학년도
        WHERE b.학년도 = ?
          AND (s.국어_등급 IS NOT NULL
               OR s.수학_등급 IS NOT NULL
               OR s.영어_등급 IS NOT NULL
               OR s.한국사_등급 IS NOT NULL
               OR s.탐구1_등급 IS NOT NULL
               OR s.탐구2_등급 IS NOT NULL)
      `, [year]);

      // 등급 분포 계산
      const distribution = {
        국어: {},
        수학: {},
        영어: {},
        한국사: {},
        사회탐구: {},
        과학탐구: {}
      };

      // 초기화 함수
      const initGradeCount = () => ({
        '1': 0, '2': 0, '3': 0, '4': 0, '5': 0,
        '6': 0, '7': 0, '8': 0, '9': 0
      });

      // 사회탐구, 과학탐구 과목 목록
      const socialSubjects = ['생활과윤리', '윤리와사상', '한국지리', '세계지리',
                              '동아시아사', '세계사', '정치와법', '경제', '사회문화'];
      const scienceSubjects = ['물리1', '화학1', '생명과학1', '지구과학1',
                               '물리2', '화학2', '생명과학2', '지구과학2'];

      // 각 학생의 성적을 분포에 반영
      students.forEach(student => {
        // 국어
        const korSubj = student.국어_선택과목 || '화법과작문';
        if (!distribution.국어[korSubj]) {
          distribution.국어[korSubj] = initGradeCount();
        }
        if (student.국어_등급) {
          distribution.국어[korSubj][String(student.국어_등급)]++;
        }

        // 수학
        const mathSubj = student.수학_선택과목 || '확률과통계';
        if (!distribution.수학[mathSubj]) {
          distribution.수학[mathSubj] = initGradeCount();
        }
        if (student.수학_등급) {
          distribution.수학[mathSubj][String(student.수학_등급)]++;
        }

        // 영어
        if (!distribution.영어.전체) {
          distribution.영어.전체 = initGradeCount();
        }
        if (student.영어_등급) {
          distribution.영어.전체[String(student.영어_등급)]++;
        }

        // 한국사
        if (!distribution.한국사.전체) {
          distribution.한국사.전체 = initGradeCount();
        }
        if (student.한국사_등급) {
          distribution.한국사.전체[String(student.한국사_등급)]++;
        }

        // 탐구1
        if (student.탐구1_선택과목) {
          const inq1 = student.탐구1_선택과목;
          let category;
          if (socialSubjects.includes(inq1)) {
            category = distribution.사회탐구;
          } else if (scienceSubjects.includes(inq1)) {
            category = distribution.과학탐구;
          }
          if (category) {
            if (!category[inq1]) {
              category[inq1] = initGradeCount();
            }
            if (student.탐구1_등급) {
              category[inq1][String(student.탐구1_등급)]++;
            }
          }
        }

        // 탐구2
        if (student.탐구2_선택과목) {
          const inq2 = student.탐구2_선택과목;
          let category;
          if (socialSubjects.includes(inq2)) {
            category = distribution.사회탐구;
          } else if (scienceSubjects.includes(inq2)) {
            category = distribution.과학탐구;
          }
          if (category) {
            if (!category[inq2]) {
              category[inq2] = initGradeCount();
            }
            if (student.탐구2_등급) {
              category[inq2][String(student.탐구2_등급)]++;
            }
          }
        }
      });

      res.json({
        success: true,
        year: parseInt(year),
        totalStudents: students.length,
        distribution
      });

    } finally {
      connection.release();
    }

  } catch (error) {
    console.error('등급 분포 조회 오류:', error);
    console.error('에러 스택:', error.stack);
    res.status(500).json({
      success: false,
      message: '등급 분포 조회 중 오류가 발생했습니다.',
      error: error.message,
      details: error.toString()
    });
  }
});

app.get('/jungsi/university-applicants/:U_ID/:year', async (req, res) => {
  try {
    const { U_ID, year } = req.params;
    const userBranch = req.decoded?.branch;
    const isAdmin = req.decoded?.userid === 'admin';

    if (!U_ID || !year) {
      return res.status(400).json({
        success: false,
        message: 'U_ID와 학년도를 입력하세요.'
      });
    }

    const connection = await db.getConnection();

    try {
      // 1. 대학 정보 조회 (정시기본 테이블 사용)
      const [universityRows] = await connection.query(`
          SELECT U_ID, 대학명 as university_name, 학과명 as major, 군 as gun, 모집정원 as quota
          FROM 정시기본
          WHERE U_ID = ? AND 학년도 = ?
        `, [U_ID, year]);

      if (universityRows.length === 0) {
        return res.status(404).json({
          success: false,
          message: '해당 대학 정보를 찾을 수 없습니다.'
        });
      }

      const university = universityRows[0];

      // 2. 해당 대학에 지원한 학생 목록 조회 (정시_상담목록 테이블 사용)
      let branchCondition = '';
      let queryParams = [year, U_ID];

      if (!isAdmin && userBranch) {
        branchCondition = 'AND b.branch_name = ?';
        queryParams.push(userBranch);
      }

      const [applicantsRows] = await connection.query(`
        SELECT DISTINCT
          b.student_id,
          b.student_name as name,
          b.school_name,
          b.branch_name as branch,
          s.국어_표준점수 as korean_standard,
          s.국어_백분위 as korean_percentile,
          s.국어_등급 as korean_grade,
          s.수학_표준점수 as math_standard,
          s.수학_백분위 as math_percentile,
          s.수학_등급 as math_grade,
          s.영어_등급 as english_grade,
          s.한국사_등급 as korean_history_grade,
          s.탐구1_표준점수 as inquiry1_standard,
          s.탐구1_백분위 as inquiry1_percentile,
          s.탐구1_등급 as inquiry1_grade,
          s.탐구2_표준점수 as inquiry2_standard,
          s.탐구2_백분위 as inquiry2_percentile,
          s.탐구2_등급 as inquiry2_grade,
          c.모집군 as gun,
          c.상담_수능점수 as suneung_score,
          c.상담_내신점수 as naeshin_score,
          c.상담_실기기록 as practical_records_json,
          c.상담_실기반영점수 as practical_score,
          c.상담_계산총점 as total_score
        FROM 정시_상담목록 c
        INNER JOIN 학생기본정보 b ON c.학생_ID = b.student_id AND c.학년도 = b.학년도
        LEFT JOIN 학생수능성적 s ON b.student_id = s.student_id AND b.학년도 = s.학년도
        WHERE c.학년도 = ?
          AND c.대학학과_ID = ?
          ${branchCondition}
        ORDER BY c.상담_계산총점 DESC, b.student_name
      `, queryParams);

      // 3. 데이터 가공
      const applicants = applicantsRows.map(student => {
        // JSON 형식의 실기 기록 파싱
        // 형식: {"배근력": "220", "좌전굴": "30", "제자리멀리뛰기": "300", "중량메고달리기": "7.4"}
        let practicalRecords = null;
        if (student.practical_records_json) {
          try {
            practicalRecords = typeof student.practical_records_json === 'string'
              ? JSON.parse(student.practical_records_json)
              : student.practical_records_json;
          } catch (e) {
            console.error('실기 기록 JSON 파싱 오류:', e);
            practicalRecords = null;
          }
        }

        return {
          student_id: student.student_id,
          name: student.name,
          school_name: student.school_name,
          branch: student.branch,
          korean_standard: student.korean_standard,
          korean_percentile: student.korean_percentile,
          korean_grade: student.korean_grade,
          math_standard: student.math_standard,
          math_percentile: student.math_percentile,
          math_grade: student.math_grade,
          english_grade: student.english_grade,
          korean_history_grade: student.korean_history_grade,
          inquiry1_standard: student.inquiry1_standard,
          inquiry1_percentile: student.inquiry1_percentile,
          inquiry1_grade: student.inquiry1_grade,
          inquiry2_standard: student.inquiry2_standard,
          inquiry2_percentile: student.inquiry2_percentile,
          inquiry2_grade: student.inquiry2_grade,
          suneung_score: parseFloat(student.suneung_score) || 0,
          naeshin_score: parseFloat(student.naeshin_score) || 0,
          practical_score: parseFloat(student.practical_score) || 0,
          practical_records: practicalRecords,  // 파싱된 실기 기록 (객체 형태)
          total_score: parseFloat(student.total_score) || 0,
          gun: student.gun
        };
      });

      // 4. 통계 계산
      const scores = applicants.map(a => a.total_score);
      const stats = {
        total_count: applicants.length,
        avg_score: scores.length > 0 ? (scores.reduce((sum, s) => sum + s, 0) / scores.length) : 0,
        max_score: scores.length > 0 ? Math.max(...scores) : 0,
        min_score: scores.length > 0 ? Math.min(...scores) : 0
      };

        res.json({
          success: true,
          university: {
            U_ID: university.U_ID,
            university_name: university.university_name,
            major: university.major,
            gun: university.gun,
            quota: university.quota || 0  // 모집인원
          },
          applicants,
          stats
        });

    } finally {
      connection.release();
    }

  } catch (error) {
    console.error('학교별 지원자 조회 오류:', error);
    console.error('에러 스택:', error.stack);
    res.status(500).json({
      success: false,
      message: '학교별 지원자 조회 중 오류가 발생했습니다.',
      error: error.message
    });
  }
});


// =============================================
// ⭐️ [신규] 실제지원정보 - 학교별 지원자 조회 API
// (정시_최종지원 테이블 사용)
// =============================================
app.get('/jungsi/university-final-applicants/:U_ID/:year', async (req, res) => {
  try {
    const { U_ID, year } = req.params;
    const userBranch = req.decoded?.branch;
    const isAdmin = req.decoded?.userid === 'admin';

    if (!U_ID || !year) {
      return res.status(400).json({
        success: false,
        message: 'U_ID와 학년도를 입력하세요.'
      });
    }

    const connection = await db.getConnection();

    try {
      // 1. 대학 정보 조회 (정시기본 테이블)
      const [universityRows] = await connection.query(`
        SELECT U_ID, 대학명 as university_name, 학과명 as major, 군 as gun, 모집정원 as quota
        FROM 정시기본
        WHERE U_ID = ? AND 학년도 = ?
      `, [U_ID, year]);

      if (universityRows.length === 0) {
        return res.status(404).json({
          success: false,
          message: '해당 대학 정보를 찾을 수 없습니다.'
        });
      }

      const university = universityRows[0];

      // 2. 해당 대학에 실제 지원한 학생 목록 조회 (정시_최종지원 테이블 사용)
      let branchCondition = '';
      let queryParams = [year, U_ID];

      if (!isAdmin && userBranch) {
        branchCondition = 'AND b.branch_name = ?';
        queryParams.push(userBranch);
      }

      const [applicantsRows] = await connection.query(`
        SELECT DISTINCT
          b.student_id,
          b.student_name as name,
          b.school_name,
          b.branch_name as branch,
          s.국어_표준점수 as korean_standard,
          s.국어_백분위 as korean_percentile,
          s.국어_등급 as korean_grade,
          s.수학_표준점수 as math_standard,
          s.수학_백분위 as math_percentile,
          s.수학_등급 as math_grade,
          s.영어_등급 as english_grade,
          s.한국사_등급 as korean_history_grade,
          s.탐구1_표준점수 as inquiry1_standard,
          s.탐구1_백분위 as inquiry1_percentile,
          s.탐구1_등급 as inquiry1_grade,
          s.탐구2_표준점수 as inquiry2_standard,
          s.탐구2_백분위 as inquiry2_percentile,
          s.탐구2_등급 as inquiry2_grade,
          fa.모집군 as gun,
          fa.지원_수능점수 as suneung_score,
          fa.지원_내신점수 as naeshin_score,
          fa.지원_실기기록 as practical_records_json,
          fa.지원_실기총점 as practical_score,
          fa.지원_총점 as total_score,
          fa.결과_1단계 as result_1st,
          fa.결과_최초 as result_first,
          fa.결과_최종 as result_final,
          fa.최종등록_여부 as registered
        FROM 정시_최종지원 fa
        INNER JOIN 학생기본정보 b ON fa.학생_ID = b.student_id AND fa.학년도 = b.학년도
        LEFT JOIN 학생수능성적 s ON b.student_id = s.student_id AND b.학년도 = s.학년도
        WHERE fa.학년도 = ?
          AND fa.대학학과_ID = ?
          ${branchCondition}
        ORDER BY COALESCE(NULLIF(fa.지원_총점, 0), NULLIF(fa.지원_수능점수, 0), 0) DESC, b.student_name
      `, queryParams);

      // 3. 데이터 가공
      const applicants = applicantsRows.map(student => {
        // JSON 형식의 실기 기록 파싱
        let practicalRecords = null;
        if (student.practical_records_json) {
          try {
            practicalRecords = typeof student.practical_records_json === 'string'
              ? JSON.parse(student.practical_records_json)
              : student.practical_records_json;
          } catch (e) {
            console.error('실기 기록 JSON 파싱 오류:', e);
            practicalRecords = null;
          }
        }

        return {
          student_id: student.student_id,
          name: student.name,
          school_name: student.school_name,
          branch: student.branch,
          korean_standard: student.korean_standard,
          korean_percentile: student.korean_percentile,
          korean_grade: student.korean_grade,
          math_standard: student.math_standard,
          math_percentile: student.math_percentile,
          math_grade: student.math_grade,
          english_grade: student.english_grade,
          korean_history_grade: student.korean_history_grade,
          inquiry1_standard: student.inquiry1_standard,
          inquiry1_percentile: student.inquiry1_percentile,
          inquiry1_grade: student.inquiry1_grade,
          inquiry2_standard: student.inquiry2_standard,
          inquiry2_percentile: student.inquiry2_percentile,
          inquiry2_grade: student.inquiry2_grade,
          suneung_score: parseFloat(student.suneung_score) || 0,
          naeshin_score: parseFloat(student.naeshin_score) || 0,
          practical_score: parseFloat(student.practical_score) || 0,
          practical_records: practicalRecords,
          total_score: parseFloat(student.total_score) || 0,
          gun: student.gun,
          result_1st: student.result_1st,
          result_first: student.result_first,
          result_final: student.result_final,
          registered: student.registered
        };
      });

      // 4. 통계 계산
      const stats = {
        total_count: applicants.length
      };

      res.json({
        success: true,
        university: {
          U_ID: university.U_ID,
          university_name: university.university_name,
          major: university.major,
          gun: university.gun,
          quota: university.quota || 0
        },
        applicants,
        stats
      });

    } finally {
      connection.release();
    }

  } catch (error) {
    console.error('학교별 실제지원자 조회 오류:', error);
    console.error('에러 스택:', error.stack);
    res.status(500).json({
      success: false,
      message: '학교별 실제지원자 조회 중 오류가 발생했습니다.',
      error: error.message
    });
  }
});

// =============================================
// 학생 레벨 시스템 API
// =============================================

/**
 * 학생 레벨 및 경험치 조회
 * GET /jungsi/student/level
 */
app.get('/jungsi/student/level', authStudentOnlyMiddleware, async (req, res) => {
    const { account_id } = req.user;

    try {
        // 학생 레벨 정보 조회
        let [levelData] = await dbStudent.query(
            `SELECT sl.*, sa.name AS student_name
             FROM student_levels sl
             JOIN student_account sa ON sl.student_account_id = sa.account_id
             WHERE sl.student_account_id = ?`,
            [account_id]
        );

        // 레벨 데이터가 없으면 초기화
        if (levelData.length === 0) {
            await dbStudent.query(
                `INSERT INTO student_levels (student_account_id, current_level, current_exp, total_exp_earned)
                 VALUES (?, 1, 0, 0)`,
                [account_id]
            );
            [levelData] = await dbStudent.query(
                `SELECT sl.*, sa.name AS student_name
                 FROM student_levels sl
                 JOIN student_account sa ON sl.student_account_id = sa.account_id
                 WHERE sl.student_account_id = ?`,
                [account_id]
            );
        }

        const currentLevel = levelData[0].current_level;
        const currentExp = levelData[0].current_exp;

        // 현재 레벨 요구사항 및 다음 레벨 요구사항 조회
        const [levelReqs] = await dbStudent.query(
            `SELECT * FROM level_requirements WHERE level >= ? ORDER BY level ASC LIMIT 2`,
            [currentLevel]
        );

        const currentLevelReq = levelReqs.find(r => r.level === currentLevel);
        const nextLevelReq = levelReqs.find(r => r.level > currentLevel);

        // 진행률 계산
        let progress = 0;
        if (nextLevelReq) {
            const expNeeded = nextLevelReq.exp_required - (currentLevelReq ? currentLevelReq.exp_required : 0);
            const expGained = currentExp - (currentLevelReq ? currentLevelReq.exp_required : 0);
            progress = Math.min(100, Math.max(0, (expGained / expNeeded) * 100));
        } else {
            progress = 100; // 만렙
        }

        res.json({
            success: true,
            level: {
                student_name: levelData[0].student_name,
                current_level: currentLevel,
                current_exp: currentExp,
                total_exp_earned: levelData[0].total_exp_earned,
                exp_for_current_level: currentLevelReq ? currentLevelReq.exp_required : 0,
                exp_for_next_level: nextLevelReq ? nextLevelReq.exp_required : null,
                is_max_level: !nextLevelReq,
                progress_percentage: Math.round(progress)
            }
        });

    } catch (err) {
        console.error(`❌ 학생 레벨 조회 API 오류:`, err);
        res.status(500).json({ success: false, message: '레벨 정보 조회 중 오류가 발생했습니다.' });
    }
});

/**
 * 학생 레벨업 히스토리 조회
 * GET /jungsi/student/level/history
 */
app.get('/jungsi/student/level/history', authStudentOnlyMiddleware, async (req, res) => {
    const { account_id } = req.user;

    try {
        const [history] = await dbStudent.query(
            `SELECT * FROM student_level_history
             WHERE student_account_id = ?
             ORDER BY leveled_up_at DESC`,
            [account_id]
        );

        res.json({
            success: true,
            history: history
        });

    } catch (err) {
        console.error(`❌ 레벨업 히스토리 조회 API 오류:`, err);
        res.status(500).json({ success: false, message: '히스토리 조회 중 오류가 발생했습니다.' });
    }
});

/**
 * 모든 레벨 요구사항 조회 (레벨 표 보기용)
 * GET /jungsi/level-requirements
 */
app.get('/jungsi/level-requirements', authStudentOnlyMiddleware, async (req, res) => {
    try {
        const [requirements] = await dbStudent.query(
            `SELECT * FROM level_requirements ORDER BY level ASC`
        );

        res.json({
            success: true,
            requirements: requirements
        });

    } catch (err) {
        console.error(`❌ 레벨 요구사항 조회 API 오류:`, err);
        res.status(500).json({ success: false, message: '레벨 요구사항 조회 중 오류가 발생했습니다.' });
    }
});

/**
 * 최초 레벨 달성자 조회 (최근 7일)
 * GET /jungsi/level/first-achievers
 */
app.get('/jungsi/level/first-achievers', authStudentOnlyMiddleware, async (req, res) => {
    try {
        const [achievers] = await dbStudent.query(
            `SELECT level, student_name, branch, achieved_at
             FROM level_first_achievers
             WHERE achieved_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
             ORDER BY achieved_at DESC
             LIMIT 10`
        );

        res.json({
            success: true,
            achievers: achievers
        });

    } catch (err) {
        console.error(`❌ 최초 달성자 조회 API 오류:`, err);
        res.status(500).json({ success: false, message: '최초 달성자 조회 중 오류가 발생했습니다.' });
    }
});

/**
 * 전체 랭킹 조회 (레벨 & 경험치 순)
 * GET /jungsi/ranking/all
 */
app.get('/jungsi/ranking/all', authStudentOnlyMiddleware, async (req, res) => {
    try {
        const [rankings] = await dbStudent.query(
            `SELECT
                sl.student_account_id,
                sa.name,
                sa.branch,
                sa.grade,
                sl.current_level,
                sl.current_exp,
                sl.total_exp_earned
             FROM student_levels sl
             JOIN student_account sa ON sl.student_account_id = sa.account_id
             WHERE sa.status = '승인'
             ORDER BY sl.current_level DESC, sl.current_exp DESC, sl.total_exp_earned DESC
             LIMIT 100`
        );

        // 순위 추가
        const rankedList = rankings.map((student, index) => ({
            rank: index + 1,
            ...student
        }));

        res.json({
            success: true,
            rankings: rankedList
        });

    } catch (err) {
        console.error(`❌ 전체 랭킹 조회 API 오류:`, err);
        res.status(500).json({ success: false, message: '랭킹 조회 중 오류가 발생했습니다.' });
    }
});

/**
 * 지점별 랭킹 조회
 * GET /jungsi/ranking/branch?branch=일산
 */
app.get('/jungsi/ranking/branch', authStudentOnlyMiddleware, async (req, res) => {
    const { branch } = req.query;

    if (!branch) {
        return res.status(400).json({ success: false, message: '지점명이 필요합니다.' });
    }

    try {
        const [rankings] = await dbStudent.query(
            `SELECT
                sl.student_account_id,
                sa.name,
                sa.branch,
                sa.grade,
                sl.current_level,
                sl.current_exp,
                sl.total_exp_earned
             FROM student_levels sl
             JOIN student_account sa ON sl.student_account_id = sa.account_id
             WHERE sa.status = '승인' AND sa.branch = ?
             ORDER BY sl.current_level DESC, sl.current_exp DESC, sl.total_exp_earned DESC
             LIMIT 100`,
            [branch]
        );

        // 순위 추가
        const rankedList = rankings.map((student, index) => ({
            rank: index + 1,
            ...student
        }));

        res.json({
            success: true,
            branch: branch,
            rankings: rankedList
        });

    } catch (err) {
        console.error(`❌ 지점별 랭킹 조회 API 오류:`, err);
        res.status(500).json({ success: false, message: '랭킹 조회 중 오류가 발생했습니다.' });
    }
});

/**
 * 내 랭킹 조회 (전체 & 지점)
 * GET /jungsi/ranking/my
 */
app.get('/jungsi/ranking/my', authStudentOnlyMiddleware, async (req, res) => {
    const { account_id } = req.user;

    try {
        // 1. 내 정보 조회
        const [myInfo] = await dbStudent.query(
            `SELECT
                sl.student_account_id,
                sa.name,
                sa.branch,
                sa.grade,
                sl.current_level,
                sl.current_exp,
                sl.total_exp_earned
             FROM student_levels sl
             JOIN student_account sa ON sl.student_account_id = sa.account_id
             WHERE sl.student_account_id = ?`,
            [account_id]
        );

        if (myInfo.length === 0) {
            return res.status(404).json({ success: false, message: '학생 정보를 찾을 수 없습니다.' });
        }

        const myData = myInfo[0];

        // 2. 전체 순위 계산
        const [totalRank] = await dbStudent.query(
            `SELECT COUNT(*) + 1 AS my_rank
             FROM student_levels sl
             JOIN student_account sa ON sl.student_account_id = sa.account_id
             WHERE sa.status = '승인'
             AND (
                 sl.current_level > ? OR
                 (sl.current_level = ? AND sl.current_exp > ?) OR
                 (sl.current_level = ? AND sl.current_exp = ? AND sl.total_exp_earned > ?)
             )`,
            [
                myData.current_level,
                myData.current_level, myData.current_exp,
                myData.current_level, myData.current_exp, myData.total_exp_earned
            ]
        );

        // 3. 지점 순위 계산
        const [branchRank] = await dbStudent.query(
            `SELECT COUNT(*) + 1 AS my_rank
             FROM student_levels sl
             JOIN student_account sa ON sl.student_account_id = sa.account_id
             WHERE sa.status = '승인' AND sa.branch = ?
             AND (
                 sl.current_level > ? OR
                 (sl.current_level = ? AND sl.current_exp > ?) OR
                 (sl.current_level = ? AND sl.current_exp = ? AND sl.total_exp_earned > ?)
             )`,
            [
                myData.branch,
                myData.current_level,
                myData.current_level, myData.current_exp,
                myData.current_level, myData.current_exp, myData.total_exp_earned
            ]
        );

        res.json({
            success: true,
            myInfo: myData,
            totalRank: totalRank[0].my_rank,
            branchRank: branchRank[0].my_rank
        });

    } catch (err) {
        console.error(`❌ 내 랭킹 조회 API 오류:`, err);
        res.status(500).json({ success: false, message: '내 랭킹 조회 중 오류가 발생했습니다.' });
    }
});

// =============================================
// ⭐️ [신규] 자동 운동 분배 관련 API
// =============================================

// GET /jungsi/practical-events - 실기 종목 목록 조회
app.get('/jungsi/practical-events', authMiddleware, async (req, res) => {
    console.log(`[API GET /practical-events] 실기 종목 목록 조회 요청`);
    try {
        const [events] = await dbStudent.query(
            `SELECT event_id, event_name, event_description, is_active
             FROM jungsimaxstudent.practical_events
             WHERE is_active = 1
             ORDER BY event_id ASC`
        );
        res.json({ success: true, events: events });
    } catch (err) {
        console.error('❌ 실기 종목 목록 조회 오류:', err);
        res.status(500).json({ success: false, message: 'DB 조회 중 오류 발생' });
    }
});

// GET /jungsi/practical-events/:event_id/exercises - 특정 종목에 매핑된 운동 목록 조회
app.get('/jungsi/practical-events/:event_id/exercises', authMiddleware, async (req, res) => {
    const { event_id } = req.params;
    console.log(`[API GET /practical-events/${event_id}/exercises] 종목별 운동 매핑 조회`);
    try {
        const [exercises] = await dbStudent.query(
            `SELECT pee.mapping_id, pee.priority, me.exercise_id, me.exercise_name,
                    me.category, me.sub_category, me.exp_value
             FROM jungsimaxstudent.practical_event_exercises pee
             JOIN jungsimaxstudent.master_exercises me ON pee.exercise_id = me.exercise_id
             WHERE pee.event_id = ? AND pee.is_active = 1 AND me.is_active = 1
             ORDER BY pee.priority DESC, me.exercise_name ASC`,
            [event_id]
        );
        res.json({ success: true, exercises: exercises });
    } catch (err) {
        console.error(`❌ 종목별 운동 매핑 조회 오류 (event_id: ${event_id}):`, err);
        res.status(500).json({ success: false, message: 'DB 조회 중 오류 발생' });
    }
});

// POST /jungsi/auto-assign-workout - 자동 운동 분배 API
app.post('/jungsi/auto-assign-workout', authMiddleware, async (req, res) => {
    const { userid: teacher_userid, branch: userBranch } = req.user;
    const { student_account_ids, assignment_date, event_ids, exercise_count } = req.body;

    // 기본값: 운동 개수 2-3개
    const minCount = exercise_count?.min || 2;
    const maxCount = exercise_count?.max || 3;

    console.log(`[API /auto-assign-workout] 사용자(${teacher_userid})가 ${student_account_ids?.length || 0}명에게 자동 운동 분배 요청`);
    console.log(` -> 종목 ID: ${event_ids}, 운동 개수: ${minCount}-${maxCount}개`);

    // 유효성 검사
    if (!student_account_ids || !Array.isArray(student_account_ids) || student_account_ids.length === 0) {
        return res.status(400).json({ success: false, message: '학생을 선택해주세요.' });
    }
    if (!assignment_date) {
        return res.status(400).json({ success: false, message: '할당 날짜를 선택해주세요.' });
    }
    if (!event_ids || !Array.isArray(event_ids) || event_ids.length === 0) {
        return res.status(400).json({ success: false, message: '종목을 선택해주세요.' });
    }

    let connection;
    try {
        connection = await dbStudent.getConnection();
        await connection.beginTransaction();

        // 1. 선택된 종목들에 매핑된 운동 목록 조회
        const [allExercises] = await connection.query(
            `SELECT DISTINCT pee.exercise_id, me.exercise_name, me.category, me.sub_category,
                    pee.priority, pee.event_id
             FROM jungsimaxstudent.practical_event_exercises pee
             JOIN jungsimaxstudent.master_exercises me ON pee.exercise_id = me.exercise_id
             WHERE pee.event_id IN (?) AND pee.is_active = 1 AND me.is_active = 1
             ORDER BY pee.priority DESC`,
            [event_ids]
        );

        if (allExercises.length === 0) {
            await connection.rollback();
            return res.status(400).json({ success: false, message: '선택한 종목에 매핑된 운동이 없습니다.' });
        }

        // 2. 종목별로 운동 그룹화
        const exercisesByEvent = {};
        event_ids.forEach(eventId => {
            exercisesByEvent[eventId] = allExercises.filter(ex => ex.event_id == eventId);
        });

        const results = { success: [], failed: [] };

        // 3. 각 학생에 대해 반복
        for (const studentId of student_account_ids) {
            try {
                // 3-1. 학생 지점 확인
                const [studentCheck] = await connection.query(
                    'SELECT account_id, name, branch FROM jungsimaxstudent.student_account WHERE account_id = ?',
                    [studentId]
                );

                if (studentCheck.length === 0 || studentCheck[0].branch !== userBranch) {
                    results.failed.push({
                        student_id: studentId,
                        reason: '다른 지점 학생이거나 존재하지 않는 학생입니다.'
                    });
                    continue;
                }

                const studentName = studentCheck[0].name;

                // 3-2. 각 종목에서 랜덤으로 운동 선택 (priority 가중치 적용)
                const selectedExercises = [];
                const usedExerciseIds = new Set();

                for (const eventId of event_ids) {
                    const eventExercises = exercisesByEvent[eventId] || [];
                    if (eventExercises.length === 0) continue;

                    // 가중치 기반 랜덤 선택을 위한 풀 생성
                    const weightedPool = [];
                    eventExercises.forEach(ex => {
                        // 이미 선택된 운동은 제외
                        if (usedExerciseIds.has(ex.exercise_id)) return;
                        // priority 값만큼 풀에 추가 (높을수록 선택 확률 높음)
                        for (let i = 0; i < (ex.priority || 1); i++) {
                            weightedPool.push(ex);
                        }
                    });

                    if (weightedPool.length === 0) continue;

                    // 랜덤으로 운동 개수 결정 (min ~ max)
                    const countToSelect = Math.floor(Math.random() * (maxCount - minCount + 1)) + minCount;

                    // 선택할 개수만큼 반복
                    for (let i = 0; i < countToSelect && weightedPool.length > 0; i++) {
                        const randomIndex = Math.floor(Math.random() * weightedPool.length);
                        const selected = weightedPool[randomIndex];

                        if (!usedExerciseIds.has(selected.exercise_id)) {
                            selectedExercises.push(selected);
                            usedExerciseIds.add(selected.exercise_id);
                            // 풀에서 해당 운동 모두 제거
                            for (let j = weightedPool.length - 1; j >= 0; j--) {
                                if (weightedPool[j].exercise_id === selected.exercise_id) {
                                    weightedPool.splice(j, 1);
                                }
                            }
                        }
                    }
                }

                if (selectedExercises.length === 0) {
                    results.failed.push({
                        student_id: studentId,
                        student_name: studentName,
                        reason: '할당할 운동이 없습니다.'
                    });
                    continue;
                }

                // 3-3. 선택된 운동들을 teacher_daily_assignments에 삽입
                let insertedCount = 0;
                for (const exercise of selectedExercises) {
                    // 중복 체크 (같은 날짜, 같은 학생, 같은 운동)
                    const [existing] = await connection.query(
                        `SELECT assignment_id FROM jungsimaxstudent.teacher_daily_assignments
                         WHERE student_account_id = ? AND assignment_date = ? AND exercise_name = ?`,
                        [studentId, assignment_date, exercise.exercise_name]
                    );

                    if (existing.length === 0) {
                        await connection.query(
                            `INSERT INTO jungsimaxstudent.teacher_daily_assignments
                                (teacher_userid, student_account_id, assignment_date, exercise_name,
                                 category, sub_category, is_completed, created_at)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                            [teacher_userid, studentId, assignment_date, exercise.exercise_name,
                             exercise.category, exercise.sub_category || null, false, new Date()]
                        );
                        insertedCount++;
                    }
                }

                results.success.push({
                    student_id: studentId,
                    student_name: studentName,
                    assigned_exercises: selectedExercises.map(e => e.exercise_name),
                    assignment_count: insertedCount
                });

                console.log(` -> 학생 ${studentName}(${studentId})에게 ${insertedCount}개 운동 자동 할당 완료`);

            } catch (studentError) {
                console.error(`❌ 학생(${studentId}) 처리 중 오류:`, studentError);
                results.failed.push({
                    student_id: studentId,
                    reason: studentError.message
                });
            }
        }

        await connection.commit();

        const successCount = results.success.length;
        const failedCount = results.failed.length;

        let message = '';
        if (successCount === student_account_ids.length) {
            message = `✅ ${successCount}명의 학생에게 자동 운동이 할당되었습니다.`;
        } else if (successCount > 0) {
            message = `⚠️ ${successCount}명 성공, ${failedCount}명 실패했습니다.`;
        } else {
            message = `❌ 모든 학생에게 할당 실패했습니다.`;
        }

        res.status(201).json({
            success: successCount > 0,
            message: message,
            results: results,
            total: student_account_ids.length,
            success_count: successCount,
            failed_count: failedCount
        });

    } catch (err) {
        if (connection) await connection.rollback();
        console.error('❌ 자동 운동 분배 API 오류:', err);
        res.status(500).json({ success: false, message: 'DB 처리 중 오류 발생', error: err.message });
    } finally {
        if (connection) connection.release();
    }
});

// =============================================
// ⭐️ [신규] 종목-운동 매핑 관리 API (관리자용)
// =============================================

// GET /jungsi/admin/practical-events - 모든 종목 목록 (관리자용)
app.get('/jungsi/admin/practical-events', authMiddleware, async (req, res) => {
    const { position, role } = req.user;
    const isMgmt = ['원장', '부원장', '팀장'].includes(position) || role === 'admin';
    if (!isMgmt) {
        return res.status(403).json({ success: false, message: '관리 권한이 없습니다.' });
    }

    try {
        const [events] = await dbStudent.query(
            `SELECT pe.event_id, pe.event_name, pe.event_description, pe.is_active,
                    (SELECT COUNT(*) FROM jungsimaxstudent.practical_event_exercises pee
                     WHERE pee.event_id = pe.event_id AND pee.is_active = 1) AS exercise_count
             FROM jungsimaxstudent.practical_events pe
             ORDER BY pe.event_id ASC`
        );
        res.json({ success: true, events: events });
    } catch (err) {
        console.error('❌ 관리자 종목 목록 조회 오류:', err);
        res.status(500).json({ success: false, message: 'DB 조회 중 오류 발생' });
    }
});

// POST /jungsi/admin/practical-event-exercises - 운동-종목 매핑 추가
app.post('/jungsi/admin/practical-event-exercises', authMiddleware, async (req, res) => {
    const { position, role } = req.user;
    const isMgmt = ['원장', '부원장', '팀장'].includes(position) || role === 'admin';
    if (!isMgmt) {
        return res.status(403).json({ success: false, message: '관리 권한이 없습니다.' });
    }

    const { event_id, exercise_id, priority } = req.body;
    if (!event_id || !exercise_id) {
        return res.status(400).json({ success: false, message: '종목 ID와 운동 ID가 필요합니다.' });
    }

    try {
        await dbStudent.query(
            `INSERT INTO jungsimaxstudent.practical_event_exercises
             (event_id, exercise_id, priority, is_active, created_at)
             VALUES (?, ?, ?, 1, NOW())
             ON DUPLICATE KEY UPDATE priority = VALUES(priority), is_active = 1`,
            [event_id, exercise_id, priority || 1]
        );
        res.json({ success: true, message: '운동-종목 매핑이 추가되었습니다.' });
    } catch (err) {
        console.error('❌ 운동-종목 매핑 추가 오류:', err);
        res.status(500).json({ success: false, message: 'DB 처리 중 오류 발생' });
    }
});

// DELETE /jungsi/admin/practical-event-exercises/:mapping_id - 운동-종목 매핑 삭제
app.delete('/jungsi/admin/practical-event-exercises/:mapping_id', authMiddleware, async (req, res) => {
    const { position, role } = req.user;
    const isMgmt = ['원장', '부원장', '팀장'].includes(position) || role === 'admin';
    if (!isMgmt) {
        return res.status(403).json({ success: false, message: '관리 권한이 없습니다.' });
    }

    const { mapping_id } = req.params;
    try {
        await dbStudent.query(
            'DELETE FROM jungsimaxstudent.practical_event_exercises WHERE mapping_id = ?',
            [mapping_id]
        );
        res.json({ success: true, message: '매핑이 삭제되었습니다.' });
    } catch (err) {
        console.error('❌ 운동-종목 매핑 삭제 오류:', err);
        res.status(500).json({ success: false, message: 'DB 처리 중 오류 발생' });
    }
});

// GET /jungsi/admin/exercise-event-mappings/:exercise_id - 특정 운동의 종목 매핑 조회
app.get('/jungsi/admin/exercise-event-mappings/:exercise_id', authMiddleware, async (req, res) => {
    const { exercise_id } = req.params;
    try {
        const [mappings] = await dbStudent.query(
            `SELECT pee.mapping_id, pee.event_id, pee.priority, pe.event_name
             FROM jungsimaxstudent.practical_event_exercises pee
             JOIN jungsimaxstudent.practical_events pe ON pee.event_id = pe.event_id
             WHERE pee.exercise_id = ? AND pee.is_active = 1`,
            [exercise_id]
        );
        res.json({ success: true, mappings: mappings });
    } catch (err) {
        console.error('❌ 운동별 종목 매핑 조회 오류:', err);
        res.status(500).json({ success: false, message: 'DB 조회 중 오류 발생' });
    }
});

// PUT /jungsi/admin/exercise-event-mappings/:exercise_id - 특정 운동의 종목 매핑 일괄 업데이트
app.put('/jungsi/admin/exercise-event-mappings/:exercise_id', authMiddleware, async (req, res) => {
    const { position, role } = req.user;
    const isMgmt = ['원장', '부원장', '팀장'].includes(position) || role === 'admin';
    if (!isMgmt) {
        return res.status(403).json({ success: false, message: '관리 권한이 없습니다.' });
    }

    const { exercise_id } = req.params;
    const { event_mappings } = req.body; // [{ event_id, priority }]

    if (!Array.isArray(event_mappings)) {
        return res.status(400).json({ success: false, message: 'event_mappings 배열이 필요합니다.' });
    }

    let connection;
    try {
        connection = await dbStudent.getConnection();
        await connection.beginTransaction();

        // 기존 매핑 삭제
        await connection.query(
            'DELETE FROM jungsimaxstudent.practical_event_exercises WHERE exercise_id = ?',
            [exercise_id]
        );

        // 새 매핑 추가
        for (const mapping of event_mappings) {
            if (mapping.event_id) {
                await connection.query(
                    `INSERT INTO jungsimaxstudent.practical_event_exercises
                     (event_id, exercise_id, priority, is_active, created_at)
                     VALUES (?, ?, ?, 1, NOW())`,
                    [mapping.event_id, exercise_id, mapping.priority || 1]
                );
            }
        }

        await connection.commit();
        res.json({ success: true, message: '종목 매핑이 업데이트되었습니다.' });
    } catch (err) {
        if (connection) await connection.rollback();
        console.error('❌ 종목 매핑 업데이트 오류:', err);
        res.status(500).json({ success: false, message: 'DB 처리 중 오류 발생' });
    } finally {
        if (connection) connection.release();
    }
});

app.listen(port, () => {
    console.log(`정시 계산(jungsi) 서버가 ${port} 포트에서 실행되었습니다.`);
    console.log(`규칙 설정 페이지: http://supermax.kr:${port}/setting`);
    console.log(`대량 점수 편집 페이지: http://supermax.kr:${port}/bulk-editor`);
});

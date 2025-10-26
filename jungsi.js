const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const jwt = require('jsonwebtoken');
const path = require('path');
const fetch = require('node-fetch');
const app = express();
const port = 9090;

const JWT_SECRET = 'super-secret-key!!';

app.use(cors());

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



// async function loadYearHighestMap(db, year, exam) {
//   try { // DB 에러 방지용 try-catch 추가
//     const [rows] = await db.query(
//       'SELECT 과목명, 최고점 FROM `정시최고표점` WHERE 학년도=? AND 모형=?',
//       [year, exam]
//     );
//     const map = {};
//     rows.forEach(r => { map[r.과목명] = Number(r.최고점); });
//     return map;
//   } catch (err) {
//     console.error(`Error loading highest map for ${year} ${exam}:`, err);
//     return {}; // 에러 시 빈 객체 반환
//   }
// }

// function guessInquiryGroup(subjectName='') {
//   const s = String(subjectName);
//   const sci = ['물리','화학','생명','지구'];
//   if (sci.some(w => s.includes(w))) return '과탐';
//   // 그 외에는 사탐으로 간주 (직탐 등 예외처리 필요 시 추가)
//   return '사탐';
// }

// jungsical.js에서 계산 함수 가져오기 (이미 되어있다면 이 부분은 생략 가능)
// 만약 jungsical.js export 방식이 다르다면 맞춰서 수정 필요
// let calculateScoreWithConv; // 전역 변수로 선언
// try {
//     // calculateScoreWithConv 함수가 jungsical 모듈의 export 객체에 포함되어 있다고 가정
//     const jungsicalModule = require('./jungsical.js')(db, authMiddleware);
//     if (typeof jungsicalModule.calculateScoreWithConv === 'function') {
//         calculateScoreWithConv = jungsicalModule.calculateScoreWithConv;
//     } else {
//         // jungsical.js 가 router만 export 하는 경우, calculateScoreWithConv 정의를 여기로 복사해야 할 수도 있음
//         console.error("!!! calculateScoreWithConv 함수를 jungsical.js에서 찾을 수 없습니다. !!!");
//         // 임시 방편으로 calculateScoreWithConv 함수 정의를 여기에 직접 넣거나,
//         // jungsical.js의 export 방식을 수정해야 함.
//         // calculateScoreWithConv = function(...) { /* jungsical.js의 함수 내용 복사 */ };
//     }
// } catch (e) {
//     console.error("jungsical.js 로드 또는 calculateScoreWithConv 가져오기 실패:", e);
//     // calculateScoreWithConv 함수 정의를 복사하는 방식으로 대체 필요
// }

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

// ⭐️ [신규 API] 등급컷 데이터 벌크 저장 (덮어쓰기)
app.post('/jungsi/grade-cuts/set-bulk', authMiddleware, async (req, res, next) => {
    
    // 1. 요청 바디에서 데이터 추출
    const { year, exam_type, subject, cuts } = req.body;

    // 2. 유효성 검사: cuts 배열이 비어있는지 확인
    if (!cuts || !Array.isArray(cuts) || cuts.length === 0) {
        // 400 Bad Request
        return res.status(400).json({ 
            success: false, 
            message: '저장할 등급컷 데이터(cuts)가 없습니다.' 
        });
    }

    try {
        // 3. DB에 Bulk Insert하기 위한 'values' 배열 생성
        const values = cuts.map(cut => [
            year,
            exam_type,
            subject,
            cut.원점수,     // `idx_unique_cut` 키의 일부
            cut.표준점수,
            cut.백분위,
            cut.등급
        ]);

        // 4. 🚀 핵심 SQL 쿼리: INSERT ... ON DUPLICATE KEY UPDATE
        const sql = `
            INSERT INTO \`정시예상등급컷\` 
                (학년도, 모형, 선택과목명, 원점수, 표준점수, 백분위, 등급) 
            VALUES ?  -- ? 하나로 [values] 배열 전체를 넘김
            ON DUPLICATE KEY UPDATE
                표준점수 = VALUES(표준점수),
                백분위 = VALUES(백분위),
                등급 = VALUES(등급)
        `;

        // 5. 쿼리 실행 (db 변수는 상단에서 require한 DB 커넥션)
        const [result] = await db.query(sql, [values]);

        // 6. 성공 응답
        res.json({ 
            success: true, 
            message: `[${year} ${exam_type} ${subject}] 등급컷 ${result.affectedRows}건이 성공적으로 저장/업데이트되었습니다.` 
        });

    } catch (err) {
        // 7. DB 에러 처리 (로그 남기기)
        console.error(`[set-bulk] 등급컷 저장 중 DB 오류 발생:`, err);
        
        // jungsi.js:459:24 에러 로그를 남기기 위해 next(err) 호출
        // (파일 맨 마지막에 에러 핸들링 미들웨어가 있어야 함)
        next(err); 
    }
});








// --- 웹페이지 제공 라우트 ---
app.get('/setting', (req, res) => { res.sendFile(path.join(__dirname, 'setting.html')); });
app.get('/bulk-editor', (req, res) => { res.sendFile(path.join(__dirname, 'scores_bulk_editor.html')); });

// ⭐️ [신규] 로그인 페이지 서빙 라우트
app.get('/jungsilogin', (req, res) => {
    res.sendFile(path.join(__dirname, 'jungsilogin.html'));
});


app.listen(port, () => {
    // ... (기존 console.log) ...
    console.log(`정시 계산(jungsi) 서버가 ${port} 포트에서 실행되었습니다.`);
    console.log(`규칙 설정 페이지: http://supermax.kr:${port}/setting`);
    console.log(`대량 점수 편집 페이지: http://supermax.kr:${port}/bulk-editor`);
    // ⭐️ [신규] 로그인 페이지 주소
    console.log(`로그인 페이지: http://supermax.kr:${port}/jungsilogin`);
});

// ⭐️ [신규] 1단계에서 만든 헬퍼 함수들 불러오기
const { 
  interpolateScore, 
  getEnglishGrade, 
  getHistoryGrade 
} = require('./utils/scoreEstimator.js');

// ... (기존의 다른 app.get, app.post 코드들) ...


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

app.get('/jungsi/public/schools/:year', async (req, res) => { // authMiddleware 없음
    const { year } = req.params;
    const { region, exclude_events } = req.query; // teaching 필터는 프론트에서 처리

    console.log(`[API /public/schools v4] Year: ${year}, Filters:`, req.query);

    try {
        // ⭐️ SQL 쿼리 수정: GROUP BY 단순화 및 MAX() 집계 함수 사용
        let sql = `
            WITH RankedScores AS (
                SELECT
                    대학학과_ID,
                    상담_수능점수,
                    NTILE(10) OVER (PARTITION BY 대학학과_ID ORDER BY 상담_수능점수 DESC) as decile
                FROM 정시_상담목록
                WHERE 학년도 = ? AND 상담_수능점수 IS NOT NULL
            ), Top10Cutoffs AS (
                SELECT
                    대학학과_ID,
                    MIN(상담_수능점수) as top10_cutoff
                FROM RankedScores
                WHERE decile = 1
                GROUP BY 대학학과_ID
            )
            SELECT
                b.U_ID, b.대학명 AS university, b.학과명 AS department, b.군 AS gun,
                b.광역 AS regionWide, b.시구 AS regionLocal, b.교직 AS teacher,
                b.모집정원 AS quota,
                GROUP_CONCAT(DISTINCT ev.종목명 ORDER BY ev.종목명 SEPARATOR ',') AS events,
                MAX(t10.top10_cutoff) as top10_cutoff -- ⭐️ MAX() 집계 함수 사용
            FROM 정시기본 b
            LEFT JOIN 정시실기배점 ev ON b.U_ID = ev.U_ID AND b.학년도 = ev.학년도
            LEFT JOIN Top10Cutoffs t10 ON b.U_ID = t10.대학학과_ID
        `;
        // WHERE 절과 파라미터 처리
        const whereClauses = ['b.학년도 = ?'];
        const params = [year, year]; // CTE용 year, 메인 쿼리용 year

        if (region) {
            const regions = region.split(',').map(r => r.trim()).filter(Boolean);
            if (regions.length > 0) {
                whereClauses.push('b.광역 IN (?)');
                params.push(regions);
            }
        }

        if (exclude_events) {
            const eventsToExclude = exclude_events.split(',').map(e => e.trim()).filter(Boolean);
            if (eventsToExclude.length > 0) {
                whereClauses.push(`
                    b.U_ID NOT IN (
                        SELECT DISTINCT U_ID FROM 정시실기배점 WHERE 학년도 = ? AND 종목명 IN (?)
                    )
                `);
                params.push(year, eventsToExclude);
            }
        }

        sql += ` WHERE ${whereClauses.join(' AND ')}`;
        sql += ` GROUP BY b.U_ID `; // ⭐️⭐️⭐️ GROUP BY b.U_ID 로 단순화 ⭐️⭐️⭐️
        sql += ` ORDER BY b.대학명, b.학과명 ASC`;

        console.log("Executing SQL v4:", sql);
        console.log("With Params v4:", params);

        const [rows] = await db.query(sql, params);

        console.log(` -> Found ${rows.length} universities matching criteria (with top10 cut).`);

        const formattedRows = rows.map(row => ({
            ...row,
            events: row.events ? row.events.split(',') : [],
            top10_cutoff: row.top10_cutoff ? parseFloat(row.top10_cutoff.toFixed(2)) : null
        }));

        res.json({ success: true, universities: formattedRows });

    } catch (err) {
        console.error("❌ 공개 학교 목록 조회 오류 (v4 - top10 cut 포함):", err);
        // ⭐️ 에러 발생 시 더 자세한 정보 로깅
        console.error("Error Code:", err.code);
        console.error("Error SQL State:", err.sqlState);
        console.error("Error Message:", err.message);
        res.status(500).json({ success: false, message: "DB 오류가 발생했습니다.", error: err.message }); // 에러 메시지 포함
    }
});

// --- 상담 목록 일괄 저장 (덮어쓰기: Delete then Insert) ---
app.post('/jungsi/counseling/wishlist/bulk-save', authMiddleware, async (req, res) => {
  const { 학생_ID, 학년도, wishlistItems } = req.body;
  if (!학생_ID || !학년도 || !Array.isArray(wishlistItems))
    return res.status(400).json({ success:false, message:'학생_ID/학년도/wishlistItems 필요' });

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const sql = `
      INSERT INTO jungsi.정시_상담목록
        (학생_ID, 학년도, 모집군, 대학학과_ID,
         상담_수능점수, 상담_내신점수, 상담_실기기록, 상담_실기반영점수,
         상담_계산총점)
      VALUES (?,?,?,?, ?,?,?,?, ?)
      ON DUPLICATE KEY UPDATE
         모집군=VALUES(모집군),
         상담_수능점수=VALUES(상담_수능점수),
         상담_내신점수=VALUES(상담_내신점수),
         상담_실기기록=VALUES(상담_실기기록),
         상담_실기반영점수=VALUES(상담_실기반영점수),
         상담_계산총점=VALUES(상담_계산총점)
    `;

    for (const it of wishlistItems) {
      const silgiJSON = it.상담_실기기록 && Object.keys(it.상담_실기기록).length
        ? JSON.stringify(it.상담_실기기록) : null;

      await conn.query(sql, [
        학생_ID, 학년도, it.모집군, it.대학학과_ID,
        it.상담_수능점수 ?? null,
        it.상담_내신점수 ?? null,
        silgiJSON,
        it.상담_실기반영점수 ?? null,
        it.상담_계산총점 ?? null
      ]);
    }

    await conn.commit();
    res.json({ success:true, saved:wishlistItems.length });
  } catch (e) {
    await conn.rollback();
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
        지원_내신점수, 지원_실기기록, 지원_실기총점, 지원_실기상세,
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

        // Upsert 실행
        const sql = `
            INSERT INTO 정시_최종지원
                (학생_ID, 학년도, 모집군, 대학학과_ID, 지원_내신점수, 지원_실기기록, 지원_실기총점, 지원_실기상세,
                 결과_1단계, 결과_최초, 결과_최종, 최종등록_여부, 메모)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                대학학과_ID = VALUES(대학학과_ID), 지원_내신점수 = VALUES(지원_내신점수),
                지원_실기기록 = VALUES(지원_실기기록), 지원_실기총점 = VALUES(지원_실기총점), 지원_실기상세 = VALUES(지원_실기상세),
                결과_1단계 = VALUES(결과_1단계), 결과_최초 = VALUES(결과_최초), 결과_최종 = VALUES(결과_최종),
                최종등록_여부 = VALUES(최종등록_여부), 메모 = VALUES(메모), 수정일시 = CURRENT_TIMESTAMP
        `;
        const params = [
            학생_ID, 학년도, 모집군, 대학학과_ID,
            지원_내신점수 === undefined || 지원_내신점수 === null ? null : Number(지원_내신점수),
            지원_실기기록 === undefined || 지원_실기기록 === null || Object.keys(지원_실기기록).length === 0 ? null : JSON.stringify(지원_실기기록),
            지원_실기총점 === undefined || 지원_실기총점 === null ? null : Number(지원_실기총점),
            지원_실기상세 === undefined || 지원_실기상세 === null ? null : JSON.stringify(지원_실기상세),
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

    if (!studentAccountId) return res.status(403).json({ success: false, message: '학생 계정 ID 없음' });

    try {
        const sql = `
            SELECT 
                su.saved_id, su.U_ID, su.학년도, su.calculated_suneung_score, su.saved_at,
                jb.대학명, jb.학과명, jb.군 -- jungsi DB에서 대학 정보 JOIN
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

// --- 여기 아래에 app.listen(...) 이 와야 함 ---

// --- app.listen(...) 이 이 아래에 와야 함 ---

app.listen(port, () => {
    console.log(`정시 계산(jungsi) 서버가 ${port} 포트에서 실행되었습니다.`);
    console.log(`규칙 설정 페이지: http://supermax.kr:${port}/setting`);
    console.log(`대량 점수 편집 페이지: http://supermax.kr:${port}/bulk-editor`);
});

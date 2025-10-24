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

const authMiddleware = (req, res, next) => { /* 이전과 동일 */ console.log(`[jungsi 서버] ${req.path} 경로에 대한 인증 검사를 시작합니다.`); const authHeader = req.headers['authorization']; const token = authHeader && authHeader.split(' ')[1]; if (!token) { return res.status(401).json({ success: false, message: '인증 토큰이 필요합니다.' }); } try { req.user = jwt.verify(token, JWT_SECRET); console.log(` -> [인증 성공] ✅ 사용자: ${req.user.userid}, 다음 단계로 진행합니다.`); next(); } catch (err) { return res.status(403).json({ success: false, message: '토큰이 유효하지 않습니다.' }); } };
const db = mysql.createPool({ host: '211.37.174.218', user: 'maxilsan', password: 'q141171616!', database: 'jungsi', charset: 'utf8mb4', waitForConnections: true, connectionLimit: 10, queueLimit: 0 });


// ⭐️ [핵심 1] jungsical.js 파일(계산기 부품)을 불러온다.
const jungsicalRouter = require('./jungsical.js')(db, authMiddleware);
// ⭐️ [신규] silgical.js 파일(실기 계산기 부품)을 불러온다.
const silgicalRouter = require('./silgical.js')(db, authMiddleware); //

// --- API 목록 ---
// ⭐️ [핵심 2] '/jungsi' 라는 주소로 들어오는 모든 요청은 jungsicalRouter(계산기 부품)에게 넘긴다.
app.use('/jungsi', jungsicalRouter);
app.use('/silgi', silgicalRouter);

// --- API 목록 ---
// [API #1] 특정 '학년도'의 전체 학교 목록 조회 (모든 규칙 포함 버전)
app.get('/jungsi/schools/:year', authMiddleware, async (req, res) => {
    const { year } = req.params;
    try {
        // --- ⭐️ 수정: SELECT 목록에 r.실기 추가 ---
        const sql = `
          SELECT
              b.U_ID, b.대학명, b.학과명, b.군,
              r.실기, -- ⭐️ 실기 반영 비율 컬럼 추가
              r.selection_rules, r.bonus_rules, r.score_config, r.계산유형
          FROM \`정시기본\` AS b
          LEFT JOIN \`정시반영비율\` AS r ON b.U_ID = r.U_ID AND b.학년도 = r.학년도
          WHERE b.학년도 = ?
          ORDER BY b.U_ID ASC
        `;
        // --- ⭐️ 수정 끝 ---
        const [schools] = await db.query(sql, [year]);
        res.json({ success: true, schools });
    } catch (err) {
        console.error("❌ 학교 목록 조회 오류:", err);
        res.status(500).json({ success: false, message: "DB 오류" });
    }
});
// jungsi.js 파일에서 이 부분을 찾아서 교체

app.post('/jungsi/school-details', authMiddleware, async (req, res) => { 
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
        // 학생 기본 정보와 학생 수능 성적을 LEFT JOIN으로 가져옴 (학년도 기준)
        const sql = `
            SELECT
                b.student_id, b.student_name, b.school_name, b.grade, b.gender,
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

        // 프론트엔드가 쓰기 편하게 가공 (성적 정보 없으면 null)
        const formattedStudents = students.map(s => {
            // scores 객체 생성 로직 (null 처리 포함)
            const scoresData = s.입력유형 ? {
                    입력유형: s.입력유형,
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

    const { 학년도, students } = req.body; // students는 [{ student_name, school_name, grade, gender }, ...] 배열

    // 필수 값 및 형식 검사
    if (!학년도 || !Array.isArray(students) || students.length === 0) {
        return res.status(400).json({ success: false, message: '학년도와 학생 정보 배열(students)은 필수입니다.' });
    }

    const conn = await db.getConnection();
    try {
        await conn.beginTransaction(); // 트랜잭션 시작

        let insertedCount = 0;
        const insertErrors = []; // 오류 발생 학생 저장

        // INSERT 쿼리 (학생기본정보 테이블)
        const sql = `
            INSERT INTO \`학생기본정보\` 
                (학년도, branch_name, student_name, school_name, grade, gender) 
             VALUES (?, ?, ?, ?, ?, ?)
        `;

        // 학생 배열 반복 처리
        for (const student of students) {
            // 각 학생 정보 유효성 검사 (서버에서도 한 번 더)
            if (!student.student_name || !student.grade || !student.gender) {
                insertErrors.push({ name: student.student_name || '이름 없음', reason: '필수 정보 누락' });
                continue; // 다음 학생으로 건너뛰기
            }

            try {
                // INSERT 실행 파라미터 준비
                const params = [
                    학년도,
                    branch, // 토큰에서 가져온 지점 이름 사용
                    student.student_name,
                    student.school_name || null, // 학교명은 없을 수 있음
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
                 insertErrors.push({ name: student.student_name, reason: err.code === 'ER_DUP_ENTRY' ? '중복 의심' : 'DB 오류' });
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
    // 프론트에서 보낸 수정된 정보
    const { student_name, school_name, grade, gender } = req.body;

    // 필수 값 검사
    if (!student_name || !grade || !gender) {
        return res.status(400).json({ success: false, message: '이름, 학년, 성별은 필수 입력 항목입니다.' });
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

        // 2. 학생 정보 업데이트 실행
        const sql = `
            UPDATE \`학생기본정보\` SET 
                student_name = ?, 
                school_name = ?, 
                grade = ?, 
                gender = ?
            WHERE student_id = ? 
        `;
        const params = [student_name, school_name || null, grade, gender, student_id];
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


// ⭐️ [신규 API] 학생 정보 삭제
app.delete('/jungsi/students/delete/:student_id', authMiddleware, async (req, res) => {
    const { branch } = req.user; // 토큰에서 지점 이름
    const { student_id } = req.params; // URL 경로에서 학생 ID 가져오기

    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        // 1. (보안) 삭제하려는 학생이 진짜 이 지점 소속인지 확인
        const [ownerCheck] = await conn.query(
            'SELECT student_id FROM `학생기본정보` WHERE student_id = ? AND branch_name = ?',
            [student_id, branch]
        );
        if (ownerCheck.length === 0) {
            await conn.rollback();
            return res.status(403).json({ success: false, message: '삭제 권한이 없는 학생입니다.' });
        }

        // 2. 학생 정보 삭제 실행 (ON DELETE CASCADE 설정 덕분에 관련 성적도 자동 삭제됨)
        const sql = 'DELETE FROM `학생기본정보` WHERE student_id = ?';
        const [result] = await conn.query(sql, [student_id]);

        // 3. 커밋
        await conn.commit();

        if (result.affectedRows > 0) {
            res.json({ success: true, message: '학생 정보가 삭제되었습니다.' });
        } else {
            res.status(404).json({ success: false, message: '해당 학생을 찾을 수 없습니다.' });
        }

    } catch (err) {
        await conn.rollback();
        console.error('❌ 학생 삭제 API 오류:', err);
        res.status(500).json({ success: false, message: '서버 오류 발생', error: err.message });
    } finally {
        conn.release();
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

app.get('/jungsi/public/schools/:year', /* authMiddleware 없음! */ async (req, res) => {
    const { year } = req.params;
    try {
        // 내용은 위 API와 동일
        const sql = `
          SELECT b.U_ID, b.대학명, b.학과명, b.군, r.실기,
                 r.selection_rules, r.bonus_rules, r.score_config, r.계산유형
          FROM \`정시기본\` AS b
          LEFT JOIN \`정시반영비율\` AS r ON b.U_ID = r.U_ID AND b.학년도 = r.학년도
          WHERE b.학년도 = ?
          ORDER BY b.U_ID ASC
        `;
        const [schools] = await db.query(sql, [year]);
        // 간단 로깅 (선택 사항)
        console.log(`[Public API] /public/schools/${year} 호출됨.`);
        res.json({ success: true, schools });
    } catch (err) {
        console.error("❌ 공개 학교 목록 조회 오류:", err);
        res.status(500).json({ success: false, message: "DB 오류" });
    }
});

// =============================================
// ⭐️ 정시_상담목록 API (counsel.html 용) - 생략 없음!
// =============================================

// --- 상담 목록 조회 (특정 학생, 특정 학년도) ---
// GET /jungsi/counseling/wishlist/:student_id/:year
app.get('/jungsi/counseling/wishlist/:student_id/:year', authMiddleware, async (req, res) => {
    const { student_id, year } = req.params;
    const { branch } = req.user;

    try {
        // 보안: 해당 학생이 이 지점 소속인지 확인
        const [ownerCheck] = await db.query(
            'SELECT student_id FROM 학생기본정보 WHERE student_id = ? AND branch_name = ? AND 학년도 = ?',
            [student_id, branch, year]
        );
        if (ownerCheck.length === 0) {
            return res.status(403).json({ success: false, message: '조회 권한이 없는 학생입니다.' });
        }

        // 상담 목록 조회 (대학 정보 포함 JOIN)
        const sql = `
            SELECT
                wl.*,
                jb.대학명, jb.학과명
            FROM 정시_상담목록 wl
            JOIN 정시기본 jb ON wl.대학학과_ID = jb.U_ID AND wl.학년도 = jb.학년도
            WHERE wl.학생_ID = ? AND wl.학년도 = ?
            ORDER BY FIELD(wl.모집군, '가', '나', '다'), wl.수정일시 DESC
        `;
        const [wishlistItems] = await db.query(sql, [student_id, year]);

        res.json({ success: true, wishlist: wishlistItems });

    } catch (err) {
        console.error('❌ 상담 목록 조회 오류:', err); // 에러 로그
        res.status(500).json({ success: false, message: 'DB 조회 중 오류가 발생했습니다.' }); // 500 에러 응답
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
// ⭐️ [신규] 지점별 최종 지원 목록 + 실기 일정 조회 API
// =============================================
// GET /jungsi/final-apply/list-by-branch/:year
app.get('/jungsi/final-apply/list-by-branch/:year', authMiddleware, async (req, res) => {
    const { year } = req.params;
    const { branch } = req.user; // 토큰에서 지점 이름 가져오기

    console.log(`[API /final-apply/list-by-branch] Year: ${year}, Branch: ${branch}`);

    if (!year || !branch) {
        return res.status(400).json({ success: false, message: '학년도 파라미터와 지점 정보가 필요합니다.' });
    }

    try {
        const sql = `
            SELECT
                fa.최종지원_ID, -- 각 행을 식별할 기본 키
                fa.학생_ID,
                si.student_name, -- 학생 이름
                jb.대학명,
                jb.학과명,
                fa.모집군,
                fa.실기날짜, -- 기존에 저장된 날짜
                fa.실기시간  -- 기존에 저장된 시간
            FROM 정시_최종지원 AS fa
            JOIN 학생기본정보 AS si ON fa.학생_ID = si.student_id AND si.branch_name = ? AND si.학년도 = fa.학년도 -- 지점 필터링 + 학년도 조인
            JOIN 정시기본 AS jb ON fa.대학학과_ID = jb.U_ID AND fa.학년도 = jb.학년도 -- 대학 정보 조인
            WHERE fa.학년도 = ?
            ORDER BY si.student_name, FIELD(fa.모집군, '가', '나', '다'); -- 학생 이름, 군 순서로 정렬
        `;
        const [rows] = await db.query(sql, [branch, year]);
        console.log(` -> Found ${rows.length} final applications for branch ${branch}, year ${year}`);
        res.json({ success: true, list: rows });

    } catch (err) {
        console.error(`❌ /final-apply/list-by-branch API 오류 (Year: ${year}, Branch: ${branch}):`, err);
        res.status(500).json({ success: false, message: 'DB 조회 중 오류가 발생했습니다.' });
    }
});

// =============================================
// ⭐️ [신규] 실기 날짜/시간 저장/수정 API
// =============================================
// POST /jungsi/final-apply/update-schedule
app.post('/jungsi/final-apply/update-schedule', authMiddleware, async (req, res) => {
    // 필요한 정보: 최종지원_ID, 실기날짜, 실기시간
    const { 최종지원_ID, 실기날짜, 실기시간 } = req.body;
    const { branch } = req.user; // 권한 확인용

    console.log(`[API /final-apply/update-schedule] Request Body:`, req.body);

    if (!최종지원_ID) {
        return res.status(400).json({ success: false, message: '최종지원_ID는 필수 항목입니다.' });
    }
    // 날짜 형식 유효성 검사 (간단하게)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (실기날짜 && !dateRegex.test(실기날짜) && 실기날짜 !== '') {
         return res.status(400).json({ success: false, message: '실기 날짜 형식이 올바르지 않습니다 (YYYY-MM-DD).' });
    }
     // 시간 형식 유효성 검사 (간단하게)
     const timeRegex = /^\d{2}:\d{2}$/;
     if (실기시간 && !timeRegex.test(실기시간) && 실기시간 !== '') {
         return res.status(400).json({ success: false, message: '실기 시간 형식이 올바르지 않습니다 (HH:MM).' });
     }


    let connection;
    try {
        connection = await db.getConnection();
        await connection.beginTransaction();

        // 1. 보안: 해당 최종지원 항목이 이 지점 소속 학생의 것인지 확인
        const [ownerCheck] = await connection.query(
            `SELECT fa.최종지원_ID
             FROM 정시_최종지원 fa
             JOIN 학생기본정보 si ON fa.학생_ID = si.student_id
             WHERE fa.최종지원_ID = ? AND si.branch_name = ?`,
            [최종지원_ID, branch]
        );

        if (ownerCheck.length === 0) {
            await connection.rollback();
            console.log(` -> 수정 권한 없음 (ID: ${최종지원_ID}, Branch: ${branch})`);
            return res.status(403).json({ success: false, message: '수정 권한이 없는 항목입니다.' });
        }

        // 2. DB에 UPDATE 실행
        const updateSql = `
            UPDATE 정시_최종지원 SET
                실기날짜 = ?,
                실기시간 = ?,
                수정일시 = NOW()
            WHERE 최종지원_ID = ?
        `;
        // 빈 문자열이 오면 NULL로 저장
        const dateToSave = 실기날짜 === '' ? null : 실기날짜;
        const timeToSave = 실기시간 === '' ? null : 실기시간;

        const [updateResult] = await connection.query(updateSql, [dateToSave, timeToSave, 최종지원_ID]);

        await connection.commit(); // 성공 시 커밋

        if (updateResult.affectedRows > 0) {
            console.log(` -> 실기 일정 업데이트 완료 (ID: ${최종지원_ID})`);
            res.json({ success: true, message: '실기 일정이 저장되었습니다.' });
        } else {
            // 이 경우는 ownerCheck에서 걸러지므로 거의 발생하지 않음
            console.log(` -> 업데이트 대상 없음 (ID: ${최종지원_ID})`);
            res.status(404).json({ success: false, message: '업데이트할 항목을 찾을 수 없습니다.' });
        }

    } catch (err) {
        if (connection) await connection.rollback(); // 오류 시 롤백
        console.error('❌ 실기 일정 저장/수정 오류:', err);
        res.status(500).json({ success: false, message: 'DB 처리 중 오류가 발생했습니다.' });
    } finally {
        if (connection) connection.release(); // 커넥션 반환
    }
});

// --- app.listen(...) 이 이 아래에 와야 함 ---

app.listen(port, () => {
    console.log(`정시 계산(jungsi) 서버가 ${port} 포트에서 실행되었습니다.`);
    console.log(`규칙 설정 페이지: http://supermax.kr:${port}/setting`);
    console.log(`대량 점수 편집 페이지: http://supermax.kr:${port}/bulk-editor`);
});

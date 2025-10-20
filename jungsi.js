const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const jwt = require('jsonwebtoken');
const path = require('path');

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
app.post('/jungsi/grade-cuts/set-bulk', authMiddleware, async (req, res) => {
    // (보안 강화) 관리자만 이 기능을 사용하게 하려면 여기서 req.user 체크 필요
    // if (!isAdmin(req.user)) return res.status(403).json({...});

    const { year, exam_type, subject, cuts } = req.body;
    if (!year || !exam_type || !subject || !Array.isArray(cuts) || cuts.length === 0) {
        return res.status(400).json({ success: false, message: '필수 데이터(학년도, 모형, 과목명, cuts 배열)가 누락되었거나 형식이 잘못되었습니다.' });
    }

    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        // 1. 해당 조건의 기존 데이터 삭제
        await conn.query(
            'DELETE FROM `정시예상등급컷` WHERE 학년도 = ? AND 모형 = ? AND 선택과목명 = ?',
            [year, exam_type, subject]
        );

        // 2. 새로운 데이터 벌크 INSERT
        const values = cuts.map(cut => [
            year,
            exam_type,
            subject,
            cut.원점수,
            cut.표준점수,
            cut.백분위,
            cut.등급
        ]);

        if (values.length > 0) {
            await conn.query(
                `INSERT INTO \`정시예상등급컷\` 
                    (학년도, 모형, 선택과목명, 원점수, 표준점수, 백분위, 등급) 
                 VALUES ?`,
                [values] // 배열의 배열 형태로 전달
            );
        }

        await conn.commit();
        res.json({ success: true, message: `총 ${cuts.length}건의 등급컷 데이터가 저장되었습니다.` });

    } catch (err) {
        await conn.rollback();
        console.error('❌ 등급컷 저장 API 오류:', err);
        res.status(500).json({ success: false, message: 'DB 처리 중 오류 발생', error: err.message });
    } finally {
        conn.release();
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

app.get('/jungsi/score-configs/:year', authMiddleware, async (req, res) => {
    const { year } = req.params;
    if (!year) {
        return res.status(400).json({ success: false, message: '학년도 파라미터가 필요합니다.' });
    }

    try {
        // 정시기본 정보와 정시반영비율 정보를 JOIN하여 필요한 컬럼만 선택
        const sql = `
            SELECT 
                b.U_ID, b.대학명, b.학과명, 
                r.score_config, -- 점수 설정 JSON (또는 null)
                r.총점          -- 총점 (또는 null)
            FROM \`정시기본\` AS b
            LEFT JOIN \`정시반영비율\` AS r ON b.U_ID = r.U_ID AND b.학년도 = r.학년도
            WHERE b.학년도 = ?
            ORDER BY b.U_ID ASC; -- ID 순 정렬
        `;
        const [configs] = await db.query(sql, [year]);

        // score_config가 JSON 문자열일 수 있으므로 파싱 시도
        const formattedConfigs = configs.map(item => {
            let parsedConfig = null;
            if (item.score_config) {
                try {
                    parsedConfig = JSON.parse(item.score_config);
                } catch (e) {
                    console.warn(`[API /score-configs] U_ID ${item.U_ID}의 score_config 파싱 실패:`, item.score_config);
                    // 파싱 실패 시 원본 문자열이나 빈 객체 반환 (선택)
                    parsedConfig = {}; 
                }
            }
            return {
                U_ID: item.U_ID,
                대학명: item.대학명,
                학과명: item.학과명,
                score_config: parsedConfig || {}, // 파싱된 객체 또는 빈 객체
                총점: item.총점 ? Number(item.총점) : 1000 // 총점 없으면 기본 1000
            };
        });

        res.json({ success: true, configs: formattedConfigs });

    } catch (err) {
        console.error('❌ 점수 설정 조회 API 오류:', err);
        res.status(500).json({ success: false, message: 'DB 조회 중 오류 발생' });
    }
});

// ⭐️ [신규 API] 점수 설정 개요 페이지 전용 데이터 조회
app.get('/jungsi/overview-configs/:year', authMiddleware, async (req, res) => {
    const { year } = req.params;
    if (!year) {
        return res.status(400).json({ success: false, message: '학년도 파라미터가 필요합니다.' });
    }

    try {
        // 정시기본 정보와 정시반영비율 정보를 JOIN
        const sql = `
            SELECT
                b.U_ID, b.대학명, b.학과명,
                r.score_config, -- 점수 설정 (문자열 또는 객체일 수 있음)
                r.총점          -- 총점
            FROM \`정시기본\` AS b
            LEFT JOIN \`정시반영비율\` AS r ON b.U_ID = r.U_ID AND b.학년도 = r.학년도
            WHERE b.학년도 = ?
            ORDER BY b.U_ID ASC;
        `;
        const [configs] = await db.query(sql, [year]);

        // score_config 처리 및 최종 데이터 포맷팅
        const formattedConfigs = configs.map(item => {
            let parsedConfig = {}; // 기본값 빈 객체

            if (item.score_config) {
                if (typeof item.score_config === 'object' && item.score_config !== null) {
                    // 1. 이미 객체인 경우
                    parsedConfig = item.score_config;
                } else if (typeof item.score_config === 'string') {
                    // 2. 문자열인 경우 파싱 시도
                    try {
                        parsedConfig = JSON.parse(item.score_config);
                        // 파싱 결과가 객체가 아닐 경우 대비 (예: "null" 문자열)
                        if (typeof parsedConfig !== 'object' || parsedConfig === null) {
                             parsedConfig = {};
                        }
                    } catch (e) {
                        // 3. 파싱 실패 시
                        console.warn(`[API /overview-configs] U_ID ${item.U_ID}의 score_config 문자열 파싱 실패:`, item.score_config);
                        parsedConfig = {}; // 빈 객체 사용
                    }
                } else {
                    // 4. 예상치 못한 타입
                     console.warn(`[API /overview-configs] U_ID ${item.U_ID}의 score_config 타입 이상함:`, typeof item.score_config);
                     parsedConfig = {};
                }
            }

            return {
                U_ID: item.U_ID,
                대학명: item.대학명,
                학과명: item.학과명,
                score_config: parsedConfig, // 처리된 객체
                총점: item.총점 ? Number(item.총점) : 1000 // 총점 없으면 기본 1000
            };
        });

        res.json({ success: true, configs: formattedConfigs });

    } catch (err) {
        console.error('❌ 개요 설정 조회 API 오류:', err);
        res.status(500).json({ success: false, message: 'DB 조회 중 오류 발생' });
    }
});

app.listen(port, () => {
    console.log(`정시 계산(jungsi) 서버가 ${port} 포트에서 실행되었습니다.`);
    console.log(`규칙 설정 페이지: http://supermax.kr:${port}/setting`);
    console.log(`대량 점수 편집 페이지: http://supermax.kr:${port}/bulk-editor`);
});

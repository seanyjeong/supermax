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
const sql = `
  SELECT 
      b.U_ID, b.대학명, b.학과명, b.군,   -- ★ 군 추가
      r.selection_rules, r.bonus_rules, r.score_config, r.계산유형 
  FROM \`정시기본\` AS b
  LEFT JOIN \`정시반영비율\` AS r ON b.U_ID = r.U_ID AND b.학년도 = r.학년도
  WHERE b.학년도 = ?
  ORDER BY b.U_ID ASC
`;
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










// --- 웹페이지 제공 라우트 ---
app.get('/setting', (req, res) => { res.sendFile(path.join(__dirname, 'setting.html')); });
app.get('/bulk-editor', (req, res) => { res.sendFile(path.join(__dirname, 'scores_bulk_editor.html')); });

app.listen(port, () => {
    console.log(`정시 계산(jungsi) 서버가 ${port} 포트에서 실행되었습니다.`);
    console.log(`규칙 설정 페이지: http://supermax.kr:${port}/setting`);
    console.log(`대량 점수 편집 페이지: http://supermax.kr:${port}/bulk-editor`);
});

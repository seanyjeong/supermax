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

// --- API 목록 ---
app.get('/jungsi/schools/:year', authMiddleware, async (req, res) => { const { year } = req.params; try { const sql = `SELECT b.U_ID, b.대학명, b.학과명, r.selection_rules FROM \`정시기본\` AS b LEFT JOIN \`정시반영비율\` AS r ON b.U_ID = r.U_ID AND b.학년도 = r.학년도 WHERE b.학년도 = ? ORDER BY b.U_ID ASC`; const [schools] = await db.query(sql, [year]); res.json({ success: true, schools }); } catch (err) { console.error("❌ 학교 목록 조회 오류:", err); res.status(500).json({ success: false, message: "DB 오류" }); } });
app.post('/jungsi/school-details', authMiddleware, async (req, res) => { const { U_ID, year } = req.body; if (!U_ID || !year) { return res.status(400).json({ success: false, message: "U_ID와 학년도(year)가 필요합니다." }); } try { const sql = `SELECT b.*, r.* FROM \`정시기본\` AS b JOIN \`정시반영비율\` AS r ON b.U_ID = r.U_ID AND b.학년도 = r.학년도 WHERE b.U_ID = ? AND b.학년도 = ?`; const [results] = await db.query(sql, [U_ID, year]); if (results.length === 0) { return res.status(404).json({ success: false, message: "해당 학과/학년도 정보를 찾을 수 없습니다." }); } res.json({ success: true, data: results[0] }); } catch (err) { console.error("❌ 학과 상세 조회 오류:", err); res.status(500).json({ success: false, message: "DB 오류" }); } });
app.post('/jungsi/rules/set', authMiddleware, async (req, res) => { const { U_ID, year, rules } = req.body; if (!U_ID || !year) { return res.status(400).json({ success: false, message: "U_ID와 학년도(year)가 필요합니다." }); } if (rules !== null && typeof rules !== 'object') { return res.status(400).json({ success: false, message: "규칙은 JSON 객체 또는 null이어야 합니다." }); } try { const sql = "UPDATE `정시반영비율` SET `selection_rules` = ? WHERE `U_ID` = ? AND `학년도` = ?"; const [result] = await db.query(sql, [JSON.stringify(rules), U_ID, year]); if (result.affectedRows === 0) { return res.status(404).json({ success: false, message: "해당 학과/학년도를 찾을 수 없습니다." }); } res.json({ success: true, message: `[${year}학년도] 선택 규칙이 저장되었습니다.` }); } catch (err) { console.error("❌ 규칙 저장 오류:", err); res.status(500).json({ success: false, message: "DB 오류" }); } });
app.post('/jungsi/scores/bulk-save', authMiddleware, async (req, res) => { const { year, scores_data } = req.body; if (!year || !Array.isArray(scores_data)) { return res.status(400).json({ success: false, message: "학년도(year)와 점수 데이터가 필요합니다." }); } const textToJson = (text) => { if (!text || text.trim() === '') return null; const scores = text.trim().split(/[\s,]+/).filter(Boolean); const scoreJson = {}; scores.forEach((score, index) => { if (index < 9) { scoreJson[String(index + 1)] = isNaN(parseFloat(score)) ? score : parseFloat(score); } }); return JSON.stringify(scoreJson); }; try { await Promise.all(scores_data.map(item => { const englishJson = textToJson(item.english_text); const historyJson = textToJson(item.history_text); const sql = "UPDATE `정시반영비율` SET `english_scores` = ?, `history_scores` = ? WHERE `U_ID` = ? AND `학년도` = ?"; return db.query(sql, [englishJson, historyJson, item.U_ID, year]); })); res.json({ success: true, message: `[${year}학년도] ${scores_data.length}개 학과의 등급 점수가 모두 저장되었습니다!` }); } catch (err) { console.error("❌ 등급 점수 대량 저장 오류:", err); res.status(500).json({ success: false, message: "DB 대량 저장 중 오류 발생" }); } });
app.post('/jungsi/bonus-rules/set', authMiddleware, async (req, res) => { const { U_ID, year, rules } = req.body; if (!U_ID || !year) { return res.status(400).json({ success: false, message: "U_ID와 학년도(year)가 필요합니다." }); } if (rules !== null && typeof rules !== 'object') { return res.status(400).json({ success: false, message: "가산점 규칙은 JSON 객체 또는 null이어야 합니다." }); } try { const sql = "UPDATE `정시반영비율` SET `bonus_rules` = ? WHERE `U_ID` = ? AND `학년도` = ?"; const [result] = await db.query(sql, [JSON.stringify(rules), U_ID, year]); if (result.affectedRows === 0) { return res.status(404).json({ success: false, message: "해당 학과/학년도를 찾을 수 없습니다." }); } res.json({ success: true, message: `[${year}학년도] 가산점 규칙이 저장되었습니다.` }); } catch (err) { console.error("❌ 가산점 규칙 저장 오류:", err); res.status(500).json({ success: false, message: "DB 오류" }); } });
app.post('/jungsi/special-formula/set', authMiddleware, async (req, res) => { const { U_ID, year, formula_type, formula_text } = req.body; if (!U_ID || !year) { return res.status(400).json({ success: false, message: "U_ID와 학년도(year)가 필요합니다." }); } try { const sql = "UPDATE `정시반영비율` SET `계산유형` = ?, `특수공식` = ? WHERE `U_ID` = ? AND `학년도` = ?"; const formulaToSave = (formula_type === '특수공식') ? formula_text : null; const [result] = await db.query(sql, [formula_type, formulaToSave, U_ID, year]); if (result.affectedRows === 0) { return res.status(404).json({ success: false, message: "해당 학과/학년도를 찾을 수 없습니다." }); } res.json({ success: true, message: `[${year}학년도] 계산 유형이 저장되었습니다.` }); } catch (err) { console.error("❌ 특수 공식 저장 오류:", err); res.status(500).json({ success: false, message: "DB 오류" }); } });

// ⭐️⭐️⭐️ [여기!] 빠진 '점수 반영 방식' 저장 API 추가 ⭐️⭐️⭐️
app.post('/jungsi/score-config/set', authMiddleware, async (req, res) => {
    const { U_ID, year, config } = req.body;
    if (!U_ID || !year) { return res.status(400).json({ success: false, message: "U_ID와 학년도(year)가 필요합니다." }); }
    if (typeof config !== 'object') { return res.status(400).json({ success: false, message: "점수 반영 방식(config)은 JSON 객체여야 합니다." }); }
    try {
        const sql = "UPDATE `정시반영비율` SET `score_config` = ? WHERE `U_ID` = ? AND `학년도` = ?";
        const [result] = await db.query(sql, [JSON.stringify(config), U_ID, year]);
        if (result.affectedRows === 0) { return res.status(404).json({ success: false, message: "해당 학과/학년도를 찾을 수 없습니다." }); }
        res.json({ success: true, message: `[${year}학년도] 점수 반영 방식이 저장되었습니다.` });
    } catch (err) {
        console.error("❌ 점수 반영 방식 저장 오류:", err);
        res.status(500).json({ success: false, message: "DB 오류" });
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

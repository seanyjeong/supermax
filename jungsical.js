const express = require('express');
const router = express.Router();

// -------------------------------------------------------------------
// ⭐️⭐️⭐️ 계산 엔진의 심장! (이전 jungsi.js에 있던 함수) ⭐️⭐️⭐️
function calculateScore(formulaData, studentScores) {
    const breakdown = {};

    const parseRatio = (value) => {
        if (!value) return 0;
        const stringValue = String(value).replace(/[()]/g, '');
        return parseFloat(stringValue) || 0;
    };

    breakdown.korean = (studentScores.koreanScore || 0) * (parseRatio(formulaData.국어) / 100);
    breakdown.math = (studentScores.mathScore || 0) * (parseRatio(formulaData.수학) / 100);
    breakdown.inquiry = (studentScores.inquiryScore || 0) * (parseRatio(formulaData.탐구) / 100);

    try {
        if (formulaData.english_scores) {
            const englishScoreTable = formulaData.english_scores;
            const studentGrade = studentScores.englishGrade || '9';
            breakdown.english = englishScoreTable[studentGrade] || 0;
        } else {
            breakdown.english = (studentScores.englishScore || 0) * (parseRatio(formulaData.영어) / 100);
        }
    } catch (e) {
        console.error("영어 점수 JSON 파싱 오류:", e);
        breakdown.english = 0;
    }

    let historyScore = 0;
    const historyRule = formulaData.한국사;
    // (한국사 계산 로직은 나중에 DB에 데이터 넣고 나서 수정해야 함)

    breakdown.history = historyScore;

    let finalScore = breakdown.korean + breakdown.math + breakdown.english + breakdown.inquiry + breakdown.history;
    
    return {
        totalScore: finalScore,
        breakdown: breakdown
    };
}
// -------------------------------------------------------------------


// 이 함수는 jungsi.js에서 db와 authMiddleware를 받아와서 라우터를 완성하는 역할을 해.
module.exports = function(db, authMiddleware) {
    
    // 이제 app.post가 아니라 router.post를 사용!
    // 주소도 '/jungsi/calculate'가 아니라 '/calculate'로 짧아짐 (앞부분은 jungsi.js에서 붙여줌)
    router.post('/calculate', authMiddleware, async (req, res) => {
        const loginUserId = req.user.userid;
        const { U_ID, year, studentScores } = req.body;

        if (!U_ID || !year || !studentScores) {
            return res.status(400).json({ success: false, message: "학과 U_ID, 학년도(year), 학생 점수(studentScores)가 모두 필요합니다." });
        }

        console.log(`[계산 요청] 사용자: ${loginUserId}, 학과 U_ID: ${U_ID}, 학년도: ${year}`);
        console.log(`[입력 점수]`, studentScores);

        try {
            const sql = `
                SELECT b.*, r.* FROM \`정시기본\` AS b
                JOIN \`정시반영비율\` AS r ON b.U_ID = r.U_ID AND b.학년도 = r.학년도
                WHERE b.U_ID = ? AND b.학년도 = ?
            `;
            const [results] = await db.query(sql, [U_ID, year]);

            if (results.length === 0) {
                return res.status(404).json({ success: false, message: "해당 학과/학년도의 계산 공식을 찾을 수 없습니다." });
            }
            
            const formulaData = results[0];

            // 위에서 만든 '계산 엔진' 함수 호출
            const finalScore = calculateScore(formulaData, studentScores);

            res.json({
                success: true,
                message: `[${year}학년도] U_ID ${U_ID} 학과 점수 계산 성공`,
                result: finalScore 
            });

        } catch (err) {
            console.error("❌ 계산 처리 중 오류:", err);
            res.status(500).json({ success: false, message: "계산 중 서버 오류가 발생했습니다." });
        }
    });

    // 완성된 라우터를 반환
    return router;
};

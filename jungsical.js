const express = require('express');
const router = express.Router();

// -------------------------------------------------------------------
// ⭐️⭐️⭐️ [초강력 업그레이드] 실전 계산 엔진! ⭐️⭐️⭐️
function calculateScore(formulaData, studentScores) {
    const breakdown = {}; // 과목별 최종 점수를 저장할 객체

    // --- Helper 함수: 괄호 벗기고 깨끗한 숫자로 ---
    const parseRatio = (value) => {
        if (!value) return 0;
        const stringValue = String(value).replace(/[()]/g, '');
        return parseFloat(stringValue) || 0;
    };

    // --- 1. 이 학교의 모든 규칙(설정값)을 변수에 저장 ---
    const calcMethod = formulaData.계산방식 || '환산';
    const suneungTotalScore = parseRatio(formulaData.수능);
    const config = formulaData.score_config || {};
    const km_type = config.korean_math?.type || '백분위';
    const inq_type = config.inquiry?.type || '백분위';
    const eng_type = config.english?.type || 'grade_conversion';

    // --- 2. 학생의 성적표에서 과목별 정보 분리 ---
    const studentSubjects = studentScores.subjects || [];
    const getSubject = (name) => studentSubjects.find(s => s.name === name) || {};
    const getInquirySubjects = () => studentSubjects.filter(s => s.name === '탐구');

    const koreanInfo = getSubject('국어');
    const mathInfo = getSubject('수학');
    const englishInfo = getSubject('영어');
    const historyInfo = getSubject('한국사');
    const inquiryInfos = getInquirySubjects();

    // --- 3. 과목별 '학생의 원점수' 정하기 (어떤 점수를 쓸지 결정) ---
    const scores = {
        korean: km_type === '표준점수' ? (koreanInfo.std || 0) : (koreanInfo.percentile || 0),
        math: km_type === '표준점수' ? (mathInfo.std || 0) : (mathInfo.percentile || 0)
    };
    
    // ⭐️ [핵심 수정] '탐구수'를 보고 과목 '객체'를 선택하고, 점수를 계산! ⭐️
    let inquiryScoreToUse = 0;
    let finalInquirySubjects = []; // 최종적으로 선택된 탐구 '과목 객체'들을 저장할 배열

    const inquiryCount = parseInt(formulaData.탐구수) || (inquiryInfos.length > 0 ? inquiryInfos.length : 1);
    const scoreKey = (inq_type === '표준점수' || inq_type === '변환표준점수') ? 'std' : 'percentile';

    if (inquiryInfos.length > 0) {
        // 점수가 높은 순서대로 탐구 과목들을 정렬
        const sortedInquiry = [...inquiryInfos].sort((a, b) => (b[scoreKey] || 0) - (a[scoreKey] || 0));

        if (inquiryCount === 1) {
            finalInquirySubjects = [sortedInquiry[0]]; // 1과목이면 제일 잘 본 과목 '객체' 하나만 선택
        } else {
            finalInquirySubjects = sortedInquiry.slice(0, 2); // 2과목이면 둘 다 선택
        }

        // 선택된 과목들의 점수 합계를 구함
        const totalInquiryScore = finalInquirySubjects.reduce((sum, subject) => sum + (subject[scoreKey] || 0), 0);
        
        // 최종적으로 사용할 탐구 점수 (평균 또는 단일 점수)
        inquiryScoreToUse = totalInquiryScore / finalInquirySubjects.length;
    }
    scores.inquiry = inquiryScoreToUse;

    console.log("-> 최종 선택된 탐구 과목:", finalInquirySubjects.map(s => s.subject));
    // TODO: 여기서 `finalInquirySubjects` 배열을 순회하면서 `bonus_rules`에 있는 가산점 규칙을 적용해야 함.
    // 예: for (const subject of finalInquirySubjects) { if (isBonusSubject(subject.subject)) { ... } }


    // --- 4. '계산 방식'에 따라 과목별 점수 계산 ---
    if (calcMethod === '직접') {
        console.log("-> '직접' 계산 방식을 사용합니다.");
        breakdown.korean = scores.korean * (parseRatio(formulaData.국어) / 100);
        breakdown.math = scores.math * (parseRatio(formulaData.수학) / 100);
        breakdown.inquiry = scores.inquiry * (parseRatio(formulaData.탐구) / 100);
    } else { // '환산' 계산
        console.log("-> '환산' 계산 방식을 사용합니다.");
        const maxScores = {
            korean: km_type === '표준점수' ? 200 : 100,
            math: km_type === '표준점수' ? 200 : 100,
            inquiry: (inq_type === '표준점수' || inq_type === '변환표준점수') ? 100 : 100
        };
        breakdown.korean = (suneungTotalScore * (parseRatio(formulaData.국어) / 100)) * (scores.korean / maxScores.korean);
        breakdown.math = (suneungTotalScore * (parseRatio(formulaData.수학) / 100)) * (scores.math / maxScores.math);
        breakdown.inquiry = (suneungTotalScore * (parseRatio(formulaData.탐구) / 100)) * (scores.inquiry / maxScores.inquiry);
    }
    
    // --- 5. 영어 & 한국사 점수 계산 ---
    breakdown.english = 0;
    if (eng_type === 'grade_conversion' && formulaData.english_scores) {
        breakdown.english = formulaData.english_scores[englishInfo.grade] || 0;
    } else if (eng_type === 'fixed_max_score' && config.english?.max_score) {
        const baseScore = formulaData.english_scores ? (formulaData.english_scores[englishInfo.grade] || 0) : 0;
        breakdown.english = (config.english.max_score / 100) * baseScore;
    }

    breakdown.history = 0;
    if (formulaData.history_scores) {
        breakdown.history = formulaData.history_scores[historyInfo.grade] || 0;
    }

    // --- 6. 최종 합산 ---
    let finalScore = (breakdown.korean || 0) + (breakdown.math || 0) + (breakdown.inquiry || 0) + (breakdown.english || 0);
    finalScore += (breakdown.history || 0);
    
    return {
        totalScore: finalScore.toFixed(3),
        calculationMethod: calcMethod,
        breakdown: breakdown
    };
}
// -------------------------------------------------------------------

module.exports = function(db, authMiddleware) {
    
    router.post('/calculate', authMiddleware, async (req, res) => {
        const loginUserId = req.user.userid;
        const { U_ID, year, studentScores } = req.body;

        if (!U_ID || !year || !studentScores) {
            return res.status(400).json({ success: false, message: "U_ID, year, studentScores가 모두 필요합니다." });
        }

        console.log(`[계산 요청] 사용자: ${loginUserId}, 학과 U_ID: ${U_ID}, 학년도: ${year}`);
        console.log(`[입력 점수]`, studentScores);

        try {
            const sql = `SELECT b.*, r.* FROM \`정시기본\` AS b JOIN \`정시반영비율\` AS r ON b.U_ID = r.U_ID AND b.학년도 = r.학년도 WHERE b.U_ID = ? AND b.학년도 = ?`;
            const [results] = await db.query(sql, [U_ID, year]);

            if (results.length === 0) {
                return res.status(404).json({ success: false, message: "해당 학과/학년도의 계산 공식을 찾을 수 없습니다." });
            }
            
            const formulaData = results[0];

            const calculationResult = calculateScore(formulaData, studentScores);

            res.json({
                success: true,
                message: `[${year}학년도] U_ID ${U_ID} 학과 점수 계산 성공`,
                result: calculationResult
            });

        } catch (err) {
            console.error("❌ 계산 처리 중 오류:", err);
            res.status(500).json({ success: false, message: "계산 중 서버 오류가 발생했습니다." });
        }
    });

    return router;
};

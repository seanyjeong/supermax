const express = require('express');
const router = express.Router();

// -------------------------------------------------------------------
// ⭐️⭐️⭐️ [진짜 최종 수정] 모든 과목 비율 계산 기능 탑재! ⭐️⭐️⭐️
function calculateScore(formulaData, studentScores) {
    const breakdown = {}; // 과목별 최종 점수를 저장할 객체

    // --- Helper 함수: 괄호 벗기고 깨끗한 숫자로 ---
    const parseRatio = (value) => {
        if (!value || isNaN(parseFloat(String(value).replace(/[()]/g, '')))) {
            return 0; // 값이 없거나, 숫자로 변환할 수 없으면 0으로 처리 (예: '감점')
        }
        const stringValue = String(value).replace(/[()]/g, '');
        return parseFloat(stringValue);
    };

    // --- 1. 규칙 및 점수 종류 확인 ---
    const calcMethod = formulaData.계산방식 || '환산';
    const suneungTotalScore = parseRatio(formulaData.수능);
    const config = formulaData.score_config || {};
    const km_type = config.korean_math?.type || '백분위';
    const eng_type = config.english?.type || 'grade_conversion';
    const inq_type = config.inquiry?.type || '백분위';

    // --- 2. 학생의 '성적표'에서 과목별 정보 가져오기 ---
    const studentSubjects = studentScores.subjects || [];
    const getSubject = (name) => studentSubjects.find(s => s.name === name) || {};
    const getInquirySubjects = () => studentSubjects.filter(s => s.name === '탐구');
    const koreanInfo = getSubject('국어');
    const mathInfo = getSubject('수학');
    const englishInfo = getSubject('영어');
    const historyInfo = getSubject('한국사');
    const inquiryInfos = getInquirySubjects();
    
    // --- 3. 과목별 '원점수' 준비 ---
    const studentRawScores = {
        '국어': km_type === '표준점수' ? (koreanInfo.std || 0) : (koreanInfo.percentile || 0),
        '수학': km_type === '표준점수' ? (mathInfo.std || 0) : (mathInfo.percentile || 0),
        '영어': englishInfo.grade || 9, // 영어는 등급을 기본으로 사용
        '탐구': 0, // 탐구는 아래에서 따로 계산
    };

    // '탐구수'에 따라 탐구 원점수 계산
    const inquiryCount = parseInt(formulaData.탐구수) || (inquiryInfos.length > 0 ? inquiryInfos.length : 1);
    const scoreKey = (inq_type === '표준점수' || inq_type === '변환표준점수') ? 'std' : 'percentile';
    if (inquiryInfos.length > 0) {
        const sortedInquiry = [...inquiryInfos].sort((a, b) => (b[scoreKey] || 0) - (a[scoreKey] || 0));
        if (inquiryCount === 1) {
            studentRawScores.탐구 = sortedInquiry[0][scoreKey] || 0;
        } else {
            const totalInquiryScore = (sortedInquiry[0]?.[scoreKey] || 0) + (sortedInquiry[1]?.[scoreKey] || 0);
            studentRawScores.탐구 = totalInquiryScore / 2;
        }
    }
    
    // --- 4. [핵심 로직] 모든 과목에 대해 비율 계산 시도 ---
    const subjectsToCalculate = ['국어', '수학', '영어', '탐구'];
    subjectsToCalculate.forEach(subjectName => {
        const ratio = parseRatio(formulaData[subjectName]);
        
        if (ratio > 0) { // ⭐️ 과목의 반영 비율이 숫자로 존재할 경우!
            let scoreToUse = studentRawScores[subjectName];
            
            // 영어는 비율 계산 전, 등급을 점수로 한번 변환해야 함
            if (subjectName === '영어' && formulaData.english_scores) {
                scoreToUse = formulaData.english_scores[studentRawScores.영어] || 0;
            }

            if (calcMethod === '직접') {
                breakdown[subjectName] = scoreToUse * (ratio / 100);
            } else { // '환산'
                let maxScore = 100; // 기본 만점
                if (subjectName === '국어' || subjectName === '수학') {
                    maxScore = km_type === '표준점수' ? 200 : 100;
                } else if (subjectName === '탐구') {
                    maxScore = (inq_type === '표준점수' || inq_type === '변환표준점수') ? 100 : 100;
                } else if (subjectName === '영어') {
                    // 영어를 비율로 환산할 때의 만점 기준 (보통 100 또는 학교 지정 만점)
                    maxScore = config.english?.max_score || 100;
                }
                breakdown[subjectName] = (suneungTotalScore * (ratio / 100)) * (scoreToUse / maxScore);
            }
        } else {
             // ⭐️ 비율이 숫자가 아닐 경우 (예: 영어 '감점'), 기존 방식대로 처리
             if (subjectName === '영어' && formulaData.english_scores) {
                breakdown.english = formulaData.english_scores[studentRawScores.영어] || 0;
             }
        }
    });

    // --- 5. 한국사 점수 계산 (가/감점) ---
    breakdown.history = 0;
    if (formulaData.history_scores) {
        breakdown.history = formulaData.history_scores[historyInfo.grade] || 0;
    }

    // --- 6. 최종 합산 ---
    let finalScore = (breakdown.국어 || 0) + (breakdown.수학 || 0) + (breakdown.영어 || 0) + (breakdown.탐구 || 0);
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
        const { U_ID, year, studentScores } = req.body;
        if (!U_ID || !year || !studentScores) {
            return res.status(400).json({ success: false, message: "U_ID, year, studentScores가 모두 필요합니다." });
        }
        try {
            const sql = `SELECT b.*, r.* FROM \`정시기본\` AS b JOIN \`정시반영비율\` AS r ON b.U_ID = r.U_ID AND b.학년도 = r.학년도 WHERE b.U_ID = ? AND b.학년도 = ?`;
            const [results] = await db.query(sql, [U_ID, year]);
            if (results.length === 0) {
                return res.status(404).json({ success: false, message: "해당 학과/학년도의 계산 공식을 찾을 수 없습니다." });
            }
            const formulaData = results[0];
            const calculationResult = calculateScore(formulaData, studentScores);
            res.json({ success: true, message: `[${year}학년도] U_ID ${U_ID} 학과 점수 계산 성공`, result: calculationResult });
        } catch (err) {
            console.error("❌ 계산 처리 중 오류:", err);
            res.status(500).json({ success: false, message: "계산 중 서버 오류가 발생했습니다." });
        }
    });
    return router;
};

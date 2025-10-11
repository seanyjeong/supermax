const express = require('express');
const router = express.Router();

function calculateScore(formulaData, studentScores) {
    const breakdown = {};
    const calculationLog = []; // ⭐️ [핵심] 계산 과정을 기록할 '영수증'

    calculationLog.push("---------- 계산 시작 ----------");

    const parseRatio = (value) => { if (!value || isNaN(parseFloat(String(value).replace(/[()]/g, '')))) return 0; const stringValue = String(value).replace(/[()]/g, ''); return parseFloat(stringValue); };
    const calcMethod = formulaData.계산방식 || '환산';
    const suneungTotalScore = parseRatio(formulaData.수능);
    const config = formulaData.score_config || {};
    const km_type = config.korean_math?.type || '백분위';
    const inq_type = config.inquiry?.type || '백분위';
    const eng_type = config.english?.type || 'grade_conversion';

    calculationLog.push(`[계산 방식] 전체: ${calcMethod}, 수능 총점: ${suneungTotalScore}`);
    calculationLog.push(`[점수 종류] 국어/수학: ${km_type}, 탐구: ${inq_type}, 영어: ${eng_type}`);

    const studentSubjects = studentScores.subjects || [];
    const getSubject = (name) => studentSubjects.find(s => s.name === name) || {};
    const getInquirySubjects = () => studentSubjects.filter(s => s.name === '탐구');
    const koreanInfo = getSubject('국어');
    const mathInfo = getSubject('수학');
    const englishInfo = getSubject('영어');
    const historyInfo = getSubject('한국사');
    const inquiryInfos = getInquirySubjects();
    
    const studentRawScores = {
        '국어': km_type === '표준점수' ? (koreanInfo.std || 0) : (koreanInfo.percentile || 0),
        '수학': km_type === '표준점수' ? (mathInfo.std || 0) : (mathInfo.percentile || 0),
        '영어': englishInfo.grade || 9,
        '탐구': 0,
    };
    calculationLog.push(`[학생 원점수] 국어: ${studentRawScores['국어']}, 수학: ${studentRawScores['수학']}`);

    let inquiryScoreToUse = 0;
    const inquiryCount = parseInt(formulaData.탐구수) || (inquiryInfos.length > 0 ? inquiryInfos.length : 1);
    const scoreKey = (inq_type === '표준점수' || inq_type === '변환표준점수') ? 'std' : 'percentile';
    if (inquiryInfos.length > 0) {
        const sortedInquiry = [...inquiryInfos].sort((a, b) => (b[scoreKey] || 0) - (a[scoreKey] || 0));
        const selectedSubjects = (inquiryCount === 1) ? [sortedInquiry[0]] : sortedInquiry.slice(0, 2);
        const totalInquiryScore = selectedSubjects.reduce((sum, subject) => sum + (subject[scoreKey] || 0), 0);
        inquiryScoreToUse = totalInquiryScore / selectedSubjects.length;
        calculationLog.push(`[탐구] ${inquiryCount}과목 반영. 선택과목: ${selectedSubjects.map(s=>s.subject).join(', ')}, 최종 점수: ${inquiryScoreToUse.toFixed(3)}`);
    }
    studentRawScores.탐구 = inquiryScoreToUse;

    const subjectsToCalculate = ['국어', '수학', '영어', '탐구'];
    subjectsToCalculate.forEach(subjectName => {
        const ratio = parseRatio(formulaData[subjectName]);
        if (ratio > 0) {
            let scoreToUse = studentRawScores[subjectName];
            let maxScore = 100;
            
            if (subjectName === '영어') {
                if (formulaData.english_scores) scoreToUse = formulaData.english_scores[studentRawScores.영어] || 0;
                maxScore = config.english?.max_score || 100;
            } else if (subjectName === '국어' || subjectName === '수학') {
                maxScore = km_type === '표준점수' ? 200 : 100;
            } else if (subjectName === '탐구') {
                maxScore = (inq_type === '표준점수' || inq_type === '변환표준점수') ? 100 : 100;
            }

            if (calcMethod === '직접') {
                breakdown[subjectName] = scoreToUse * (ratio / 100);
                calculationLog.push(`[${subjectName}] 직접 계산: ${scoreToUse} * ${ratio / 100} = ${breakdown[subjectName].toFixed(3)}`);
            } else {
                breakdown[subjectName] = (suneungTotalScore * (ratio / 100)) * (scoreToUse / maxScore);
                calculationLog.push(`[${subjectName}] 환산 계산: (${suneungTotalScore} * ${ratio/100}) * (${scoreToUse} / ${maxScore}) = ${breakdown[subjectName].toFixed(3)}`);
            }
        } else {
             if (subjectName === '영어' && formulaData.english_scores) {
                breakdown.english = formulaData.english_scores[studentRawScores.영어] || 0;
                calculationLog.push(`[영어] 등급별 환산점수: ${studentRawScores.영어}등급 -> ${breakdown.english}점`);
             }
        }
    });

    breakdown.history = 0;
    if (formulaData.history_scores) {
        breakdown.history = formulaData.history_scores[historyInfo.grade] || 0;
        calculationLog.push(`[한국사] 등급별 가/감점: ${historyInfo.grade}등급 -> ${breakdown.history}점`);
    }

    let finalScore = (breakdown.국어 || 0) + (breakdown.수학 || 0) + (breakdown.영어 || 0) + (breakdown.탐구 || 0);
    finalScore += (breakdown.history || 0);
    calculationLog.push(`---------- 최종 합산 ----------`);
    calculationLog.push(`국어(${breakdown.국어?.toFixed(2)||0}) + 수학(${breakdown.수학?.toFixed(2)||0}) + 영어(${breakdown.영어?.toFixed(2)||0}) + 탐구(${breakdown.탐구?.toFixed(2)||0}) + 한국사(${breakdown.history||0}) = ${finalScore.toFixed(3)}`);
    
    return {
        totalScore: finalScore.toFixed(3),
        calculationMethod: calcMethod,
        breakdown: breakdown,
        calculationLog: calculationLog // ⭐️ '영수증'을 결과에 포함해서 반환!
    };
}

module.exports = function(db, authMiddleware) {
    router.post('/calculate', authMiddleware, async (req, res) => {
        const { U_ID, year, studentScores } = req.body;
        if (!U_ID || !year || !studentScores) { return res.status(400).json({ success: false, message: "U_ID, year, studentScores가 모두 필요합니다." }); }
        try {
            const sql = `SELECT b.*, r.* FROM \`정시기본\` AS b JOIN \`정시반영비율\` AS r ON b.U_ID = r.U_ID AND b.학년도 = r.학년도 WHERE b.U_ID = ? AND b.학년도 = ?`;
            const [results] = await db.query(sql, [U_ID, year]);
            if (results.length === 0) { return res.status(404).json({ success: false, message: "해당 학과/학년도의 계산 공식을 찾을 수 없습니다." }); }
            const formulaData = results[0];
            const calculationResult = calculateScore(formulaData, studentScores);
            res.json({ success: true, message: `[${year}학년도] U_ID ${U_ID} 학과 점수 계산 성공`, result: calculationResult });
        } catch (err) { console.error("❌ 계산 처리 중 오류:", err); res.status(500).json({ success: false, message: "계산 중 서버 오류가 발생했습니다." }); }
    });
    return router;
};

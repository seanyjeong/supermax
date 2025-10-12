const express = require('express');
const router = express.Router();

function calculateScore(formulaData, studentScores) {
    const calculationLog = [];
    calculationLog.push("---------- 계산 시작 ----------");

    // --- 1. 기본 정보 및 학생 점수 준비 ---
    const config = formulaData.score_config || {};
    const km_type = config.korean_math?.type || '백분위';
    const inq_type = config.inquiry?.type || '백분위';
    
    const studentSubjects = studentScores.subjects || [];
    const subjectsData = { '국어': studentSubjects.find(s=>s.name==='국어')||{}, '수학': studentSubjects.find(s=>s.name==='수학')||{}, '영어': studentSubjects.find(s=>s.name==='영어')||{}, '한국사': studentSubjects.find(s=>s.name==='한국사')||{}, '탐구': studentSubjects.filter(s=>s.name==='탐구') };

    const rawScores = {
        '국어': km_type === '표준점수' ? (subjectsData['국어'].std || 0) : (subjectsData['국어'].percentile || 0),
        '수학': km_type === '표준점수' ? (subjectsData['수학'].std || 0) : (subjectsData['수학'].percentile || 0),
        '영어': 0, // 영어는 아래에서 특별히 계산
        '한국사': subjectsData['한국사'].grade || 9,
        '탐구': 0
    };
    
    // 영어 원점수 계산 (비율 계산에 참여하기 위한 점수)
    if (formulaData.english_scores) {
        rawScores.영어 = formulaData.english_scores[subjectsData['영어'].grade] || 0;
    }

    const inquiryCount = parseInt(formulaData.탐구수) || 1;
    const scoreKey = (inq_type === '표준점수' || inq_type === '변환표준점수') ? 'std' : 'percentile';
    if (subjectsData['탐구'].length > 0) {
        const sortedInquiry = [...subjectsData['탐구']].sort((a, b) => (b[scoreKey] || 0) - (a[scoreKey] || 0));
        const selectedInquiry = sortedInquiry.slice(0, inquiryCount);
        rawScores.탐구 = selectedInquiry.reduce((sum, s) => sum + (s[scoreKey] || 0), 0) / selectedInquiry.length;
    }
    calculationLog.push(`[학생 원점수] 국:${rawScores['국어']} 수:${rawScores['수학']} 영:${rawScores['영어']} 탐:${rawScores['탐구']}`);

    // --- 2. 수능 점수 계산 ---
    let suneungScore = 0;
    const selectionRules = formulaData.selection_rules;
    const schoolTotalScore = formulaData.총점 || 1000;
    const suneungRatio = (parseFloat(formulaData.수능) || 0) / 100;
    
    calculationLog.push(`[학교 정보] 총점:${schoolTotalScore}, 수능비율:${suneungRatio}`);

    // ⭐️ [분기] 선택 규칙(selection_rules) 유무에 따라 계산 방식 분리
    if (selectionRules && Object.keys(selectionRules).length > 0) {
        // [A] 선택 규칙이 있을 경우 (네가 만든 rank, mix 로직)
        calculationLog.push("\n---------- 선택 규칙 계산 ----------");
        const rulesArray = Array.isArray(selectionRules) ? selectionRules : [selectionRules];
        let usedSubjects = new Set();
        let calculatedScoreSum = 0;
        let totalRatioSum = 0;

        rulesArray.forEach((rule, index) => {
            const candidateSubjects = rule.from
                .filter(subjectName => !usedSubjects.has(subjectName))
                .map(subjectName => ({ name: subjectName, score: rawScores[subjectName] }))
                .sort((a, b) => b.score - a.score);
            
            if (rule.type === 'select_n') {
                const selected = candidateSubjects.slice(0, rule.count);
                calculationLog.push(`[규칙 ${index+1}: 상위 ${rule.count}개 선택] -> [${selected.map(s=>s.name).join(', ')}]`);
                selected.forEach(subject => {
                    const ratio = parseFloat(formulaData[subject.name]) || 0;
                    calculatedScoreSum += subject.score * (ratio / 100);
                    totalRatioSum += ratio;
                    usedSubjects.add(subject.name);
                });
            }
            // TODO: select_ranked_weights 로직 추가
        });
        
        // 선택된 과목들의 점수를 최종 환산
        if (totalRatioSum > 0) {
            suneungScore = (calculatedScoreSum * (schoolTotalScore / totalRatioSum)) * suneungRatio;
            calculationLog.push(`[선택과목 합산] (점수*비율 합:${calculatedScoreSum.toFixed(3)}) * (${schoolTotalScore} / ${totalRatioSum}) * ${suneungRatio} = ${suneungScore.toFixed(3)}`);
        }

    } else {
        // [B] 선택 규칙이 없을 경우 ('기본 비율' 계산)
        calculationLog.push("\n---------- 기본 비율 계산 ----------");
        let calculatedScoreSum = 0;
        let totalRatioSum = 0;
        ['국어', '수학', '영어', '탐구'].forEach(subjectName => {
            const ratio = parseFloat(formulaData[subjectName]) || 0;
            if (ratio > 0) {
                calculatedScoreSum += rawScores[subjectName] * (ratio / 100);
                totalRatioSum += ratio;
            }
        });
        if (totalRatioSum > 0) {
            suneungScore = (calculatedScoreSum * (schoolTotalScore / totalRatioSum)) * suneungRatio;
            calculationLog.push(`[기본과목 합산] (점수*비율 합:${calculatedScoreSum.toFixed(3)}) * (${schoolTotalScore} / ${totalRatioSum}) * ${suneungRatio} = ${suneungScore.toFixed(3)}`);
        }
    }

    // 3. 한국사 가/감점 적용
    let historyScore = 0;
    if (formulaData.history_scores) {
        historyScore = formulaData.history_scores[subjectsData['한국사'].grade] || 0;
        calculationLog.push(`\n[한국사] 가/감점: ${historyScore}점`);
    }

    // 최종 합산
    const finalScore = suneungScore + historyScore;
    calculationLog.push(`\n---------- 최종 합산 ----------`);
    calculationLog.push(`수능환산점수(${suneungScore.toFixed(3)}) + 한국사(${historyScore}) = ${finalScore.toFixed(3)}`);

    return { totalScore: finalScore.toFixed(3), breakdown: {}, calculationLog };
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
        } catch (err) {
            console.error("❌ 계산 처리 중 오류:", err);
            res.status(500).json({ success: false, message: "계산 중 서버 오류가 발생했습니다." });
        }
    });
    return router;
};

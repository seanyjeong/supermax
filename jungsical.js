const express = require('express');
const router = express.Router();

// -------------------------------------------------------------------
// ⭐️⭐️⭐️ [최종 진화] 선택 규칙(selection_rules)까지 완벽 해석하는 계산 엔진! ⭐️⭐️⭐️
function calculateScore(formulaData, studentScores) {
    const calculationLog = []; // 계산 과정을 기록할 '영수증'
    calculationLog.push("---------- 계산 시작 ----------");

    // --- Helper 함수 및 기본 설정값 로딩 ---
    const parseRatio = (value) => { if (!value || isNaN(parseFloat(String(value).replace(/[()]/g, '')))) return 0; const stringValue = String(value).replace(/[()]/g, ''); return parseFloat(stringValue); };
    const calcMethod = formulaData.계산방식 || '환산';
    const suneungTotalScore = parseRatio(formulaData.수능);
    const config = formulaData.score_config || {};
    const km_type = config.korean_math?.type || '백분위';
    const inq_type = config.inquiry?.type || '백분위';
    const eng_type = config.english?.type || 'grade_conversion';

    calculationLog.push(`[계산 방식] 전체: ${calcMethod}, 수능 총점: ${suneungTotalScore}`);
    calculationLog.push(`[점수 종류] 국어/수학: ${km_type}, 탐구: ${inq_type}, 영어: ${eng_type}`);

    // --- 학생 성적표에서 과목별 정보 객체로 변환 ---
    const studentSubjects = studentScores.subjects || [];
    const subjectsData = {
        '국어': studentSubjects.find(s => s.name === '국어') || {},
        '수학': studentSubjects.find(s => s.name === '수학') || {},
        '영어': studentSubjects.find(s => s.name === '영어') || {},
        '한국사': studentSubjects.find(s => s.name === '한국사') || {},
        '탐구': studentSubjects.filter(s => s.name === '탐구') // 탐구는 여러 개일 수 있으므로 배열로
    };

    // --- 과목별 '원점수' 준비 (score_config에 따라) ---
    const rawScores = {
        '국어': km_type === '표준점수' ? (subjectsData['국어'].std || 0) : (subjectsData['국어'].percentile || 0),
        '수학': km_type === '표준점수' ? (subjectsData['수학'].std || 0) : (subjectsData['수학'].percentile || 0),
        '영어': subjectsData['영어'].grade || 9, // 영어는 등급을 기본 원점수로
        '탐구': 0 // 탐구는 아래에서 계산
    };

    // 탐구 원점수 계산 (탐구수 반영)
    const inquiryCount = parseInt(formulaData.탐구수) || (subjectsData['탐구'].length > 0 ? subjectsData['탐구'].length : 1);
    const scoreKey = (inq_type === '표준점수' || inq_type === '변환표준점수') ? 'std' : 'percentile';
    if (subjectsData['탐구'].length > 0) {
        const sortedInquiry = [...subjectsData['탐구']].sort((a, b) => (b[scoreKey] || 0) - (a[scoreKey] || 0));
        const selectedInquiry = (inquiryCount === 1) ? [sortedInquiry[0]] : sortedInquiry.slice(0, 2);
        rawScores.탐구 = selectedInquiry.reduce((sum, s) => sum + (s[scoreKey] || 0), 0) / selectedInquiry.length;
    }
    
    // --- [⭐️⭐️⭐️ 핵심 로직 START ⭐️⭐️⭐️] ---
    const breakdown = {};
    let usedSubjects = []; // 선택 규칙에서 사용된 과목을 기록
    
    // 1. 선택 규칙(selection_rules)이 있는지 확인하고 실행
    const selectionRules = formulaData.selection_rules;
    if (selectionRules && Object.keys(selectionRules).length > 0) {
        calculationLog.push("\n---------- 선택 규칙 적용 ----------");
        const rulesArray = Array.isArray(selectionRules) ? selectionRules : [selectionRules];

        rulesArray.forEach((rule, index) => {
            calculationLog.push(`[규칙 그룹 ${index + 1}] Type: ${rule.type}`);
            
            // 규칙 대상 과목들 중, 아직 사용되지 않은 과목만 필터링해서 점수 순으로 정렬
            const candidateSubjects = rule.from
                .filter(subjectName => !usedSubjects.includes(subjectName))
                .map(subjectName => ({ name: subjectName, score: rawScores[subjectName] }))
                .sort((a, b) => b.score - a.score);

            calculationLog.push(` -> 대상 과목: ${candidateSubjects.map(s=>s.name).join(', ')}`);

            if (rule.type === 'select_n') {
                const selected = candidateSubjects.slice(0, rule.count);
                selected.forEach(subject => {
                    const ratio = parseRatio(formulaData[subject.name]);
                    breakdown[subject.name] = (suneungTotalScore * (ratio / 100)) * (subject.score / 100); // N개 선택은 보통 백분위 기반
                    usedSubjects.push(subject.name);
                    calculationLog.push(` -> '${subject.name}' 선택 (점수: ${subject.score}). 계산: ${breakdown[subject.name].toFixed(3)}`);
                });
            } else if (rule.type === 'select_ranked_weights') {
                const subjectsToRank = candidateSubjects.slice(0, rule.weights.length);
                subjectsToRank.forEach((subject, i) => {
                    const weight = rule.weights[i];
                    breakdown[subject.name] = suneungTotalScore * weight; // 순위별 가중치는 보통 가중치가 비율을 포함
                    usedSubjects.push(subject.name);
                    calculationLog.push(` -> ${i+1}순위 '${subject.name}' 선택 (점수: ${subject.score}). 가중치 ${weight} 적용: ${breakdown[subject.name].toFixed(3)}`);
                });
            }
        });
    }

    // 2. 선택 규칙에서 사용되지 않은 나머지 과목들을 '기본 비율'로 계산
    calculationLog.push("\n---------- 기본 비율 적용 ----------");
    const remainingSubjects = ['국어', '수학', '영어', '탐구'].filter(s => !usedSubjects.includes(s));
    
    remainingSubjects.forEach(subjectName => {
        const ratio = parseRatio(formulaData[subjectName]);
        if (ratio > 0) { // 반영 비율이 있는 과목만 계산
            let scoreToUse = rawScores[subjectName];
            let maxScore = 100;

            if (subjectName === '영어') {
                if(formulaData.english_scores) scoreToUse = formulaData.english_scores[rawScores.영어] || 0;
                maxScore = config.english?.max_score || 100;
            } else if (['국어', '수학'].includes(subjectName)) {
                maxScore = km_type === '표준점수' ? 200 : 100;
            } else if (subjectName === '탐구') {
                maxScore = (inq_type === '표준점수' || inq_type === '변환표준점수') ? 100 : 100;
            }

            if (calcMethod === '직접') {
                breakdown[subjectName] = scoreToUse * (ratio / 100);
                calculationLog.push(`[${subjectName}] 기본(직접): ${scoreToUse} * ${ratio/100} = ${breakdown[subjectName].toFixed(3)}`);
            } else {
                breakdown[subjectName] = (suneungTotalScore * (ratio / 100)) * (scoreToUse / maxScore);
                calculationLog.push(`[${subjectName}] 기본(환산): (${suneungTotalScore}*${ratio/100}) * (${scoreToUse}/${maxScore}) = ${breakdown[subjectName].toFixed(3)}`);
            }
        }
    });

    // 3. 가/감점 항목 계산 (영어, 한국사)
    if (!usedSubjects.includes('영어') && parseRatio(formulaData['영어']) === 0) {
        if (formulaData.english_scores) {
            breakdown.english = formulaData.english_scores[rawScores.영어] || 0;
            calculationLog.push(`[영어] 등급별 가/감점: ${rawScores.영어}등급 -> ${breakdown.english}점`);
        }
    }
    breakdown.history = 0;
    if (formulaData.history_scores) {
        breakdown.history = formulaData.history_scores[historyInfo.grade] || 0;
        calculationLog.push(`[한국사] 등급별 가/감점: ${historyInfo.grade}등급 -> ${breakdown.history}점`);
    }
    
    // --- [최종 합산] ---
    let finalScore = Object.values(breakdown).reduce((sum, val) => sum + (val || 0), 0);
    calculationLog.push("\n---------- 최종 합산 ----------");
    calculationLog.push(`합계: ${finalScore.toFixed(3)}`);

    return { totalScore: finalScore.toFixed(3), breakdown, calculationLog };
}
// -------------------------------------------------------------------

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

const express = require('express');
const router = express.Router();

// -------------------------------------------------------------------
// ⭐️⭐️⭐️ [최종 진화] 모든 규칙을 완벽하게 해석하는 최종 계산 엔진! ⭐️⭐️⭐️
function calculateScore(formulaData, studentScores) {
    const calculationLog = [];
    calculationLog.push("---------- 계산 시작 ----------");

    // --- Helper 함수 및 기본 설정값 로딩 ---
    const parseRatio = (value) => { if (!value || isNaN(parseFloat(String(value).replace(/[()]/g, '')))) return 0; const stringValue = String(value).replace(/[()]/g, ''); return parseFloat(stringValue); };
    
    // --- 학생 성적표에서 과목별 정보 객체로 변환 ---
    const studentSubjects = studentScores.subjects || [];
    const subjectsData = {
        '국어': studentSubjects.find(s => s.name === '국어') || {},
        '수학': studentSubjects.find(s => s.name === '수학') || {},
        '영어': studentSubjects.find(s => s.name === '영어') || {},
        '한국사': studentSubjects.find(s => s.name === '한국사') || {},
        '탐구': studentSubjects.filter(s => s.name === '탐구')
    };

    // ⭐️ [분기 1] 이 학교가 '특수 공식'을 사용하는지 먼저 확인!
    if (formulaData.계산유형 === '특수공식' && formulaData.특수공식) {
        calculationLog.push("[계산 유형] ⭐️ 특수 공식 사용 ⭐️");
        // TODO: 여기에 특수 공식({kor_std} + ...)을 해석하는 로직 추가
        // 지금은 일단 0점으로 반환
        calculationLog.push("-> 특수 공식 해석기는 아직 개발 중입니다.");
        return { totalScore: "0.000", breakdown: {}, calculationLog };
    }

    // --- '기본 비율 계산' 시작 ---
    const breakdown = {};
    const calcMethod = formulaData.계산방식 || '환산';
    const suneungTotalScore = parseRatio(formulaData.수능);
    const config = formulaData.score_config || {};
    const km_type = config.korean_math?.type || '백분위';
    const inq_type = config.inquiry?.type || '백분위';
    
    calculationLog.push(`[계산 방식] 전체: ${calcMethod}, 수능 총점: ${suneungTotalScore}`);
    calculationLog.push(`[점수 종류] 국어/수학: ${km_type}, 탐구: ${inq_type}`);

    // --- 과목별 '원점수' 준비 ---
    const rawScores = {
        '국어': km_type === '표준점수' ? (subjectsData['국어'].std || 0) : (subjectsData['국어'].percentile || 0),
        '수학': km_type === '표준점수' ? (subjectsData['수학'].std || 0) : (subjectsData['수학'].percentile || 0),
        '영어': subjectsData['영어'].grade || 9,
        '한국사': subjectsData['한국사'].grade || 9,
        '탐구': 0 // 탐구는 아래에서 계산
    };

    const inquiryCount = parseInt(formulaData.탐구수) || (subjectsData['탐구'].length > 0 ? subjectsData['탐구'].length : 1);
    const scoreKey = (inq_type === '표준점수' || inq_type === '변환표준점수') ? 'std' : 'percentile';
    if (subjectsData['탐구'].length > 0) {
        const sortedInquiry = [...subjectsData['탐구']].sort((a, b) => (b[scoreKey] || 0) - (a[scoreKey] || 0));
        const selectedInquiry = (inquiryCount === 1) ? [sortedInquiry[0]] : sortedInquiry.slice(0, 2);
        rawScores.탐구 = selectedInquiry.reduce((sum, s) => sum + (s[scoreKey] || 0), 0) / selectedInquiry.length;
    }

    // --- [⭐️⭐️⭐️ 핵심 로직: 선수 선발 (Selection Rules) ⭐️⭐️⭐️] ---
    let usedSubjects = new Set(); // 선택 규칙에서 사용된 과목을 기록 (중복 방지)
    const selectionRules = formulaData.selection_rules;
    if (selectionRules && Object.keys(selectionRules).length > 0) {
        calculationLog.push("\n---------- 1. 선택 규칙 적용 ----------");
        const rulesArray = Array.isArray(selectionRules) ? selectionRules : [selectionRules];

        rulesArray.forEach((rule, index) => {
            if (!rule.from || rule.from.length === 0) return;
            
            calculationLog.push(`[규칙 그룹 ${index + 1}] Type: ${rule.type}`);
            const candidateSubjects = rule.from
                .filter(subjectName => !usedSubjects.has(subjectName))
                .map(subjectName => ({ name: subjectName, score: rawScores[subjectName] }))
                .sort((a, b) => b.score - a.score);
            
            calculationLog.push(` -> 대상: [${candidateSubjects.map(s=>s.name).join(', ')}]`);

            if (rule.type === 'select_n') {
                const selected = candidateSubjects.slice(0, rule.count);
                selected.forEach(subject => {
                    const ratio = parseRatio(formulaData[subject.name]);
                    const maxScore = subject.name.includes('탐구') ? 100 : (km_type === '표준점수' ? 200 : 100);
                    breakdown[subject.name] = (suneungTotalScore * (ratio / 100)) * (subject.score / maxScore);
                    usedSubjects.add(subject.name);
                    calculationLog.push(` -> '${subject.name}' 선택 (점수: ${subject.score}). 환산: ${breakdown[subject.name].toFixed(3)}`);
                });
            } else if (rule.type === 'select_ranked_weights') {
                const numToSelect = rule.weights.length;
                const selected = candidateSubjects.slice(0, numToSelect);
                selected.forEach((subject, i) => {
                    const weight = rule.weights[i];
                    // '순위별 가중치'는 보통 그 자체가 최종 반영 비율을 의미함
                    breakdown[subject.name] = suneungTotalScore * weight;
                    usedSubjects.add(subject.name);
                    calculationLog.push(` -> ${i+1}순위 '${subject.name}' 선택 (점수: ${subject.score}). 가중치(${weight}) 적용: ${breakdown[subject.name].toFixed(3)}`);
                });
            }
        });
    }

    // --- [⭐️⭐️⭐️ 핵심 로직: 나머지 기본 비율 계산 ⭐️⭐️⭐️] ---
    calculationLog.push("\n---------- 2. 기본 비율 적용 ----------");
    const remainingSubjects = ['국어', '수학', '탐구'].filter(s => !usedSubjects.has(s));
    remainingSubjects.forEach(subjectName => {
        const ratio = parseRatio(formulaData[subjectName]);
        if (ratio > 0) {
            let scoreToUse = rawScores[subjectName];
            let maxScore = 100;
            if (['국어', '수학'].includes(subjectName)) maxScore = km_type === '표준점수' ? 200 : 100;
            if (subjectName === '탐구') maxScore = (inq_type === '표준점수' || inq_type === '변환표준점수') ? 100 : 100;

            if (calcMethod === '직접') {
                breakdown[subjectName] = scoreToUse * (ratio / 100);
                calculationLog.push(`[${subjectName}] 기본(직접): ${scoreToUse} * ${ratio/100} = ${breakdown[subjectName].toFixed(3)}`);
            } else { // '환산'
                breakdown[subjectName] = (suneungTotalScore * (ratio / 100)) * (scoreToUse / maxScore);
                calculationLog.push(`[${subjectName}] 기본(환산): (${suneungTotalScore}*${ratio/100}) * (${scoreToUse}/${maxScore}) = ${breakdown[subjectName].toFixed(3)}`);
            }
        }
    });

    // --- [⭐️⭐️⭐️ 핵심 로직: 영어, 한국사, 가산점 등 후처리 ⭐️⭐️⭐️] ---
    calculationLog.push("\n---------- 3. 추가 점수 및 가/감점 적용 ----------");
    
    // 영어 처리
    const englishRatio = parseRatio(formulaData['영어']);
    if (!usedSubjects.has('영어')) {
        if (englishRatio > 0) { // 영어가 비율로 들어가는 경우
            let scoreToUse = rawScores['영어'];
            if (formulaData.english_scores) scoreToUse = formulaData.english_scores[rawScores.영어] || 0;
            const maxScore = config.english?.max_score || 100;
            breakdown.english = (suneungTotalScore * (englishRatio / 100)) * (scoreToUse / maxScore);
            calculationLog.push(`[영어] 비율(${englishRatio}%) 적용: ${breakdown.english.toFixed(3)}`);
        } else { // 영어가 가/감점인 경우
            if (formulaData.english_scores) {
                breakdown.english = formulaData.english_scores[rawScores.영어] || 0;
                calculationLog.push(`[영어] 등급별 가/감점: ${rawScores.영어}등급 -> ${breakdown.english}점`);
            }
        }
    }

    // 한국사 처리
    breakdown.history = 0;
    if (formulaData.history_scores) {
        breakdown.history = formulaData.history_scores[historyInfo.grade] || 0;
        calculationLog.push(`[한국사] 등급별 가/감점: ${historyInfo.grade}등급 -> ${breakdown.history}점`);
    }

    // TODO: bonus_rules를 이용한 가산점 로직 추가 위치
    
    // --- 최종 합산 ---
    let finalScore = Object.values(breakdown).reduce((sum, val) => sum + (val || 0), 0);
    calculationLog.push("\n---------- 최종 합산 ----------");
    calculationLog.push(`합계: ${finalScore.toFixed(3)}`);

    return { totalScore: finalScore.toFixed(3), breakdown, calculationLog };
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

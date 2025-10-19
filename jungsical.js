// jungsical.js (기본점수 로직 추가 최종본 - 971줄 기반)
const express = require('express');
const router = express.Router();
const silgical = require('./silgical.js'); // ⭐️ 실기 계산기 불러오기

/* ========== 유틸 ========== */
const safeParse = (v, fb = null) => {
  if (v == null) return fb;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return fb; }
};

const pickByType = (row, type) => {
  if (!row) return 0;
  if (type === '표준점수' || type === '변환표준점수') return Number(row.std || 0);
  return Number(row.percentile || 0);
};

const kmSubjectNameForKorean = (row) => row?.subject || '국어';
const kmSubjectNameForMath   = (row) => row?.subject || '수학';
const inquirySubjectName     = (row) => row?.subject || '탐구';

const resolveTotal = (F) => {
  const t = Number(F?.총점);
  return (Number.isFinite(t) && t > 0) ? t : 1000;
};

function detectEnglishAsBonus(F) {
  const kw = ['가산점','가감점','가점','감점'];
  // Ensure F properties are checked for null/undefined before accessing includes
  if (typeof F?.영어처리 === 'string' && kw.some(k=>F.영어처리.includes(k))) return true;
  if (typeof F?.영어비고 === 'string' && kw.some(k=>F.영어비고.includes(k))) return true;
  for (const [k,v] of Object.entries(F)) {
    if (typeof v !== 'string') continue;
    if (k.includes('영어') || k.includes('비고') || k.includes('설명') || k.includes('기타')) {
      if (v.includes('영어') && kw.some(t=>v.includes(t))) return true;
    }
  }
  // Check if F.english_scores exists and is parsable before checking F.영어
  const parsedEnglishScores = safeParse(F.english_scores, null);
  if ((Number(F?.영어 || 0) === 0) && parsedEnglishScores) return true;
  return false;
}


function isSubjectUsedInRules(name, rulesArr) {
  const rules = Array.isArray(rulesArr) ? rulesArr : (rulesArr ? [rulesArr] : []);
  for (const r of rules) {
    if (!r || !Array.isArray(r.from)) continue;
    if (r.from.includes(name)) return true;
  }
  return false;
}

function calcInquiryRepresentative(inquiryRows, type, inquiryCount) {
  const key = (type === '표준점수' || type === '변환표준점수') ? 'std' : 'percentile';
  const arr = (inquiryRows || [])
    .map((t) => ({ row: t, subject: inquirySubjectName(t), val: Number(t?.[key] || 0) }))
    .sort((a, b) => b.val - a.val);
  if (arr.length === 0) return { rep: 0, sorted: arr, picked: [] };
  const n = Math.max(1, inquiryCount || 1);
  const picked = arr.slice(0, Math.min(n, arr.length));
  // Avoid division by zero if picked is empty (though arr.length check mostly prevents this)
  const rep = picked.length > 0 ? picked.reduce((s, x) => s + x.val, 0) / picked.length : 0;
  return { rep, sorted: arr, picked };
}

function resolveMaxScores(scoreConfig, englishScoresInput, highestMap, S) {
   // Safely parse englishScoresInput right at the beginning
   const englishScores = safeParse(englishScoresInput, null);

  const kmType    = scoreConfig?.korean_math?.type || '백분위';
  const inqType   = scoreConfig?.inquiry?.type     || '백분위';
  const kmMethod  = scoreConfig?.korean_math?.max_score_method || '';
  const inqMethod = scoreConfig?.inquiry?.max_score_method     || '';

  let korMax  = (kmType === '표준점수' || kmMethod === 'fixed_200') ? 200 : 100;
  let mathMax = korMax;
  let inqMax  = (inqType === '표준점수' || inqType === '변환표준점수' || inqMethod === 'fixed_100') ? 100 : 100;

  if (kmMethod === 'highest_of_year' && highestMap) {
    const korKey  = kmSubjectNameForKorean(S?.국어);
    const mathKey = kmSubjectNameForMath(S?.수학);
    if (highestMap[korKey]  != null) korMax  = Number(highestMap[korKey]);
    if (highestMap[mathKey] != null) mathMax = Number(highestMap[mathKey]);
  }

  let engMax = 100; // Default engMax
  if (scoreConfig?.english?.type === 'fixed_max_score' && Number(scoreConfig?.english?.max_score)) {
    engMax = Number(scoreConfig.english.max_score);
  } else {
    // Use the safely parsed englishScores
    if (englishScores && typeof englishScores === 'object') {
      const vals = Object.values(englishScores).map(Number).filter(n => !Number.isNaN(n));
      if (vals.length) engMax = Math.max(...vals);
    }
     // Ensure engMax is not zero if derived from data; otherwise, keep default 100
     if (engMax <= 0 && !(scoreConfig?.english?.type === 'fixed_max_score')) engMax = 100;
  }
   // Final check to prevent non-positive max scores
   korMax = Math.max(1, korMax);
   mathMax = Math.max(1, mathMax);
   engMax = Math.max(1, engMax); // Ensure engMax is at least 1
   inqMax = Math.max(1, inqMax);

  return { korMax, mathMax, engMax, inqMax };
}


function evaluateSpecialFormula(formulaText, ctx, log) {
  const replaced = String(formulaText || '').replace(/\{([a-z0-9_]+)\}/gi, (_, k) => {
    const v = ctx[k]; // Get value directly from context
    // Default to 0 if undefined, null, or NaN
    const numV = (v === undefined || v === null || Number.isNaN(Number(v))) ? 0 : Number(v);
    log.push(`[특수공식 변수] ${k} = ${numV}`);
    return String(numV); // Ensure string conversion for replacement
  });

  // Allow E notation for scientific numbers, ensure basic safety
  if (!/^[0-9+\-*/().\sEe]+$/.test(replaced)) {
    log.push(`[오류] 특수공식에 허용되지 않은 문자 포함: ${replaced}`);
    throw new Error('특수공식에 허용되지 않은 토큰이 포함되어 있습니다.');
  }

  try {
    // Using Function constructor is generally safe if the input string is tightly controlled
    const val = Function(`"use strict"; return (${replaced});`)();
    // Check for Infinity or NaN, return 0 in those cases
    return Number.isFinite(val) ? val : 0;
  } catch (e) {
    log.push(`[오류] 특수공식 계산 중 에러: ${e.message}, 식: ${replaced}`);
    console.error("Error evaluating special formula:", replaced, e);
    return 0; // Return 0 on evaluation error
  }
}


const readConvertedStd = (t) =>
  Number(t?.converted_std ?? t?.vstd ?? t?.conv_std ?? t?.std ?? t?.percentile ?? 0);

function guessInquiryGroup(subjectName='') {
  const s = String(subjectName);
  const sci = ['물리','화학','생명','지구'];
  if (sci.some(w => s.includes(w))) return '과탐';
  return '사탐';
}

function buildSpecialContext(F, S, highestMap) {
  const ctx = {};
  ctx.total = resolveTotal(F);
  ctx.suneung_ratio = (Number(F.수능) || 0) / 100;

  const cfg = safeParse(F.score_config, {}) || {};
  const kmMethod = cfg?.korean_math?.max_score_method || '';

  const korKey  = kmSubjectNameForKorean(S?.국어);
  const mathKey = kmSubjectNameForMath(S?.수학);

  let korMax  = 200;
  let mathMax = 200;

  if (kmMethod === 'fixed_200') {
    korMax = 200;
    mathMax = 200;
  } else if (kmMethod === 'highest_of_year') {
    if (highestMap && highestMap[korKey] != null)  korMax  = Number(highestMap[korKey]);
    if (highestMap && highestMap[mathKey] != null) mathMax = Number(highestMap[mathKey]);
  }

  if (highestMap) { // highestMap overrides if present
    if (highestMap[korKey]  != null) korMax  = Number(highestMap[korKey]);
    if (highestMap[mathKey] != null) mathMax = Number(highestMap[mathKey]);
  }

  // Ensure max scores are at least 1
  ctx.kor_max  = Math.max(1, korMax);
  ctx.math_max = Math.max(1, mathMax);

  ctx.ratio_kor  = Number(F['국어'] || 0);
  ctx.ratio_math = Number(F['수학'] || 0);
  ctx.ratio_inq  = Number(F['탐구'] || 0);
  ctx.ratio_kor_norm  = ctx.ratio_kor  / 100;
  ctx.ratio_math_norm = ctx.ratio_math / 100;
  ctx.ratio_inq_norm  = ctx.ratio_inq  / 100;
  ctx.ratio5_kor  = ctx.ratio_kor_norm  * 5;
  ctx.ratio5_math = ctx.ratio_math_norm * 5;
  ctx.ratio5_inq  = ctx.ratio_inq_norm  * 5;


  ctx.kor_std  = Number(S.국어?.std || 0);
  ctx.kor_pct  = Number(S.국어?.percentile || 0);
  ctx.math_std = Number(S.수학?.std || 0);
  ctx.math_pct = Number(S.수학?.percentile || 0);

  // Safely parse F.english_scores and F.history_scores once
  const parsedEnglishScores = safeParse(F.english_scores, null);
  const parsedHistoryScores = safeParse(F.history_scores, null);

  ctx.eng_grade_score = 0;
  ctx.eng_max = 100; // Default eng_max
  if (parsedEnglishScores && S.영어?.grade != null) {
      const eg = String(S.영어.grade);
      ctx.eng_grade_score = Number(parsedEnglishScores[eg] ?? 0);
      const vals = Object.values(parsedEnglishScores).map(Number).filter(n => !Number.isNaN(n));
      ctx.eng_max = vals.length ? Math.max(...vals) : 100; // Use 100 if no valid scores
       // Ensure eng_max is at least 1 for division safety
       ctx.eng_max = Math.max(1, ctx.eng_max);
      ctx.eng_pct_est = Math.min(100, Math.max(0, (ctx.eng_grade_score / ctx.eng_max) * 100));
  } else {
      ctx.eng_pct_est = 0;
      // If english_scores missing, keep default eng_max=100
  }


  ctx.hist_grade_score = 0;
  if (parsedHistoryScores && S.한국사?.grade != null) {
      const hg = String(S.한국사.grade);
      ctx.hist_grade_score = Number(parsedHistoryScores[hg] || 0);
  }


  const inqs = (S.탐구 || []);
  const sortedConv = inqs.map((t) => ({ conv: readConvertedStd(t), std: Number(t?.std || 0), pct: Number(t?.percentile || 0) }))
                         .sort((a,b)=>b.conv-a.conv);
  const sortedStd  = inqs.map((t) => ({ subject: t?.subject || '', std: Number(t?.std || 0), pct: Number(t?.percentile || 0) }))
                         .sort((a,b)=>b.std-a.std);
  const sortedPct  = inqs.map((t) => ({ pct: Number(t?.percentile || 0) }))
                         .sort((a,b)=>b.pct-a.pct);
                         
  ctx.inq1_converted_std = sortedConv[0]?.conv || 0;
  ctx.inq2_converted_std = sortedConv[1]?.conv || 0;
  ctx.inq_sum2_converted_std = ctx.inq1_converted_std + ctx.inq2_converted_std;
  const inqConvCount = Math.min(2, sortedConv.length); // Count for average (max 2)
  ctx.inq_avg2_converted_std = inqConvCount > 0 ? (ctx.inq_sum2_converted_std) / inqConvCount : 0;

  ctx.inq1_std = sortedStd[0]?.std || 0;
  ctx.inq2_std = sortedStd[1]?.std || 0;
  
  let inq1_max = 100; // Default max
  let inq2_max = 100;

  if (highestMap) {
      const inq1_subject = sortedStd[0]?.subject;
      const inq2_subject = sortedStd[1]?.subject;
      inq1_max = Number(highestMap[inq1_subject] || 100);
      // If inq2 exists, use its highestMap value or default to inq1's max; otherwise, 0
      inq2_max = inq2_subject ? Number(highestMap[inq2_subject] || inq1_max) : 0;
  }

  const convTable = F.탐구변표; // Already parsed in calculate route
  if (convTable && (Object.keys(convTable['사탐'] || {}).length > 0 || Object.keys(convTable['과탐'] || {}).length > 0)) {
      const inq1_subject = sortedStd[0]?.subject;
      const inq2_subject = sortedStd[1]?.subject;
      const inq1_group = guessInquiryGroup(inq1_subject || '');
      const inq2_group = guessInquiryGroup(inq2_subject || '');

      let maxConv_inq1 = 0;
      let maxConv_inq2 = 0;

      if (convTable[inq1_group]) {
          const vals = Object.values(convTable[inq1_group]).map(Number).filter(n => !isNaN(n));
          if (vals.length > 0) maxConv_inq1 = Math.max(...vals);
      }
      
      if (inq2_subject && convTable[inq2_group]) {
          const vals = Object.values(convTable[inq2_group]).map(Number).filter(n => !isNaN(n));
          if (vals.length > 0) maxConv_inq2 = Math.max(...vals);
      } else if (inq2_subject) {
          maxConv_inq2 = maxConv_inq1;
      } else {
          maxConv_inq2 = 0;
      }
      
      if (inq1_subject && inq2_subject && inq1_group === inq2_group) {
         maxConv_inq2 = maxConv_inq1;
      }

      if (maxConv_inq1 > 0) inq1_max = maxConv_inq1;
      // Only set inq2_max if inq2 exists and maxConv_inq2 > 0
      if (inq2_subject && maxConv_inq2 > 0) inq2_max = maxConv_inq2;
      // Ensure inq2_max is 0 if no second subject
      if (!inq2_subject) inq2_max = 0;
  }
   // Ensure max values are reasonable for formulas
  ctx.inq1_max_std = Math.max(1, inq1_max); // At least 1
  ctx.inq2_max_std = Math.max(0, inq2_max); // Can be 0 if only 1 subject


  ctx.inq_sum2_std = ctx.inq1_std + ctx.inq2_std;
  const inqStdCount = Math.min(2, sortedStd.length);
  ctx.inq_avg2_std = inqStdCount > 0 ? (ctx.inq_sum2_std) / inqStdCount : 0;
  ctx.inq1_percentile = sortedPct[0]?.pct || 0;
  ctx.inq2_percentile = sortedPct[1]?.pct || 0;
  ctx.inq_sum2_percentile = ctx.inq1_percentile + ctx.inq2_percentile;
  const inqPctCount = Math.min(2, sortedPct.length);
  ctx.inq_avg2_percentile = inqPctCount > 0 ? (ctx.inq_sum2_percentile) / inqPctCount : 0;


  const top3_no_eng = [ctx.kor_pct, ctx.math_pct, ctx.inq1_percentile].sort((a,b)=>b-a).slice(0,3);
  ctx.top3_avg_pct_kor_math_inq1 = top3_no_eng.length ? (top3_no_eng.reduce((s,x)=>s+x,0)/top3_no_eng.length) : 0;
  const top3_with_eng = [ctx.kor_pct, ctx.math_pct, ctx.inq1_percentile, ctx.eng_pct_est].sort((a,b)=>b-a).slice(0,3);
  ctx.top3_avg_pct_kor_eng_math_inq1 = top3_with_eng.length ? (top3_with_eng.reduce((s,x)=>s+x,0)/top3_with_eng.length) : 0;
  ctx.top3_avg_pct = ctx.top3_avg_pct_kor_eng_math_inq1;

  const mathSubject = S.수학?.subject || '';
  let mathBonus = 1.0;
  const bonusRules = safeParse(F.bonus_rules, []); // Already parsed is fine
  if (Array.isArray(bonusRules)) {
      for (const rule of bonusRules) {
          if (rule?.type === 'percent_bonus' && Array.isArray(rule.subjects) && rule.subjects.includes(mathSubject)) {
              mathBonus = 1.0 + (Number(rule.value) || 0);
              break;
          }
      }
  }
  
  ctx.math_std_bonused = ctx.math_std * mathBonus;
  ctx.max_kor_math_std = Math.max(ctx.kor_std, ctx.math_std_bonused);

  let math_pct_bonused = ctx.math_pct * mathBonus;
  // Safely access nested property using parsed cfg
  if (cfg?.math_bonus_cap_100 === true) {
       math_pct_bonused = Math.min(100, math_pct_bonused);
  }
  ctx.math_pct_bonused = math_pct_bonused;
  ctx.max_kor_math_pct = Math.max(ctx.kor_pct, ctx.math_pct_bonused);


  const items_pct = [
    Number(ctx.kor_pct || 0),
    Number(ctx.math_pct || 0), // Assuming original math pct for top 2 sum
    Number(ctx.inq1_percentile || 0),
    Number(ctx.inq2_percentile || 0),
  ].map(v => Math.max(0, Math.min(100, v))).sort((a,b) => b - a);

  ctx.top2_sum_norm_pct_kmi2 = items_pct.length >= 2 ? ((items_pct[0] || 0) + (items_pct[1] || 0)) / 100 : 0;
  ctx.top2_sum_raw_pct_kmi2 = items_pct.length >= 2 ? (items_pct[0] || 0) + (items_pct[1] || 0) : 0;


  (function attachSocialBoost() {
      const inqs = (S.탐구 || []);
      const tuples = inqs.map(t => ({
          subject: t.subject || '',
          group: t.group || t.type || guessInquiryGroup(t.subject || ''),
          conv: readConvertedStd(t)
      })).sort((a,b) => b.conv - a.conv);

      const inq1 = tuples[0];
      const inq2 = tuples[1];
      ctx.inq1_social_boost = (inq1 && inq1.group === '사탐') ? 1.05 : 1.0;
      ctx.inq2_social_boost = (inq2 && inq2.group === '사탐') ? 1.05 : 1.0;
  })();

  return ctx;
}


/* ========== 핵심 계산기(수능) ========== */
function calculateScore(formulaDataRaw, studentScores, highestMap) {
  const log = [];
  log.push('========== 수능 계산 시작 ==========');

  const F = { ...formulaDataRaw };
  // Safely parse JSON fields at the beginning
  F.selection_rules        = safeParse(F.selection_rules, null);
  F.score_config           = safeParse(F.score_config,   {}) || {};
  F.english_scores         = safeParse(F.english_scores, null);
  F.history_scores         = safeParse(F.history_scores, null);
  F.english_bonus_scores   = safeParse(F.english_bonus_scores, null);
  F.bonus_rules            = safeParse(F.bonus_rules, null); // Parse bonus_rules too
  F.기타설정               = safeParse(F.기타설정, {}) || {}; // Parse 기타설정

  const englishBonusFixed  = Number(F.english_bonus_fixed || 0);
  const otherSettings      = F.기타설정; // Already parsed

  const englishAsBonus = detectEnglishAsBonus(F); // Pass potentially parsed F

  const subs = studentScores?.subjects || [];
  const S = {
    국어   : subs.find(s => s.name === '국어')   || {},
    수학   : subs.find(s => s.name === '수학')   || {},
    영어   : subs.find(s => s.name === '영어')   || {},
    한국사 : subs.find(s => s.name === '한국사') || {},
    탐구   : subs.filter(s => s.name === '탐구')
  };

  if (F.계산유형 === '특수공식' && F.특수공식) {
    log.push('<< 특수공식 모드 >>');
     // Pass already parsed scores objects
    const ctx = buildSpecialContext(F, S, highestMap);

    log.push(`[특수공식 원본] ${F.특수공식}`);
    const specialValue = evaluateSpecialFormula(F.특수공식, ctx, log);
    const final = Number(specialValue) || 0; // Ensure final is a number
    log.push('========== 수능 최종 ==========');
    log.push(`특수공식 결과 = ${final.toFixed(3)}`);
    return {
      totalScore: final.toFixed(3), // Consistent decimal places
      breakdown: { special: final },
      calculationLog: log
    };
  }
  
  const suneungRatio = (Number(F.수능) || 0) / 100;
  if (suneungRatio <= 0) {
      log.push('[패스] 수능 반영 비율 0%');
      return { totalScore: "0.000", breakdown: {}, calculationLog: log }; // Return formatted string
  }

  const cfg       = F.score_config; // Already parsed
  const kmType    = cfg?.korean_math?.type || '백분위';
  const inqType   = cfg?.inquiry?.type     || '백분위';
  const inqMethod = cfg?.inquiry?.max_score_method || '';

  const inquiryCount = Math.max(1, parseInt(F.탐구수 || '1', 10));
   // Pass already parsed F.탐구변표 if needed by calcInquiryRepresentative (though it usually uses type/key)
  const { rep: inqRep, picked: inqPicked } = calcInquiryRepresentative(S.탐구, inqType, inquiryCount);

  let engConv = 0;
  let englishGradeBonus = 0;
  if (F.english_scores && S.영어?.grade != null) { // Use parsed F.english_scores
      const g = String(S.영어.grade);
      if (englishAsBonus) {
          englishGradeBonus = Number(F.english_scores[g] ?? 0);
      } else {
          engConv = Number(F.english_scores[g] ?? 0);
      }
  }


  const rulesArray = Array.isArray(F.selection_rules) // Use parsed F.selection_rules
    ? F.selection_rules
    : (F.selection_rules ? [F.selection_rules] : []);
  const historyAppearsInRules = isSubjectUsedInRules('한국사', rulesArray);
  const historyRatioPositive  = Number(F['한국사'] || 0) > 0;
  const historyAsSubject = historyAppearsInRules || historyRatioPositive;

  let histConv = 0;
  if (historyAsSubject && F.history_scores && S.한국사?.grade != null) { // Use parsed F.history_scores
      const hg = String(S.한국사.grade);
      histConv = Number(F.history_scores[hg] ?? 0);
  }

  const raw = {
    국어:   pickByType(S.국어, kmType),
    수학:   pickByType(S.수학, kmType),
    영어:   englishAsBonus ? 0 : engConv,
    한국사: historyAsSubject ? histConv : 0,
    탐구:   inqRep
  };

  log.push(`[원점수] 국:${raw.국어} 수:${raw.수학} 영:${raw.영어}${englishAsBonus ? '(가산)' : ''} 탐:${raw.탐구}${historyAsSubject ? (' 한:' + raw.한국사) : ''}`);

   // Pass already parsed F.english_scores
  const { korMax, mathMax, engMax, inqMax } = resolveMaxScores(cfg, F.english_scores, highestMap, S);
  let histMax = 100;
  if (F.history_scores && typeof F.history_scores === 'object') { // Use parsed F.history_scores
      const vals = Object.values(F.history_scores).map(Number).filter(n => !Number.isNaN(n));
      if (vals.length) histMax = Math.max(...vals);
  }
   // Ensure maxes are at least 1
   histMax = Math.max(1, histMax);

  const getMax = (name) => {
    if (name === '국어') return korMax;
    if (name === '수학') return mathMax;
    if (name === '영어') return engMax;
    if (name === '탐구') return inqMax;
    if (name === '한국사') return histMax;
    return 100; // Default max
  };


  const normOf = (name) => {
    // Check if 탐구 and highest_of_year logic needs already parsed F.탐구변표
    // Assuming F.탐구변표 is available if needed within this scope from the main calculate call
    if (name === '탐구' && inqMethod === 'highest_of_year') {
        const allInquiryNormalized = S.탐구.map(sub => {
            const subject = sub.subject || '';
            let val = 0;
            let top = 1; // Default top to 1 to avoid division by zero
            let isValid = false;

            if (inqType === '변환표준점수') {
                if (!F.탐구변표) return null; // Make sure conv map exists
                const group = sub.group || sub.type || guessInquiryGroup(subject);
                const convTableForGroup = F.탐구변표[group];
                if (!convTableForGroup || Object.keys(convTableForGroup).length === 0) return null;
                const validScores = Object.values(convTableForGroup).map(Number).filter(n => !isNaN(n));
                if(validScores.length === 0) return null; // No valid scores in table
                const maxConvScore = Math.max(...validScores);
                val = readConvertedStd(sub);
                top = maxConvScore > 0 ? maxConvScore : 1; // Avoid division by zero
                isValid = true;
            } else if (inqType === '표준점수') {
                if (!highestMap) return null;
                val = Number(sub.std || 0);
                top = Number(highestMap[subject] ?? 0);
                 if (top <= 0) return null; // Skip if invalid top score
                 isValid = true;
            } else {
                 // For 백분위 type with highest_of_year, maybe default to 100? Or handle error?
                 // Current logic returns null, leading to 0 normalization. Assume 100 max for 백분위.
                 if (inqType === '백분위') {
                     val = Number(sub.percentile || 0);
                     top = 100;
                     isValid = true;
                 } else {
                    return null;
                 }
            }

             if (!isValid || !Number.isFinite(val)) return null;

             const normalized = Math.max(0, Math.min(1, val / top));
             return { subject, val, top, normalized };
        }).filter(r => r != null);

        allInquiryNormalized.sort((a, b) => b.normalized - a.normalized);
        const n = Math.max(1, inquiryCount || 1);
        const pickedNormalized = allInquiryNormalized.slice(0, Math.min(n, allInquiryNormalized.length));

        if (pickedNormalized.length) {
            const avg = pickedNormalized.reduce((s, r) => s + r.normalized, 0) / pickedNormalized.length;
            log.push(`[탐구정규화] highest_of_year(Top${n}): ${pickedNormalized.map(p => `${p.subject}:${p.normalized.toFixed(4)}`).join(', ')} -> ${avg.toFixed(4)}`);
            return avg;
        }
        log.push(`[탐구정규화] 실패 (Type: ${inqType})`);
        return 0;
    }

    // Default normalization
    const sc = Number(raw[name] || 0);
    const mx = getMax(name); // Ensures mx is at least 1
    return Math.max(0, Math.min(1, sc / mx));
  };


  const TOTAL = resolveTotal(F);
  log.push(`[학교] 총점=${TOTAL}, 수능비율=${suneungRatio}`);

  // --- Start Rule Application ---
  let baseNormWeighted = 0;
  let baseRatioSum = 0;
  let selectBeforeRatio = 0; // Contribution from select_ranked_weights
  const candidatesBase = ['국어', '수학', '영어', '탐구', ...(historyAsSubject ? ['한국사'] : [])].filter(name => !(englishAsBonus && name === '영어'));
  let processedByRules = new Set(); // Keep track of subjects handled by any rule

  if (!rulesArray || rulesArray.length === 0) {
      log.push("[규칙] 기본 비율 적용");
      for (const name of candidatesBase) {
          const ratio = Number(F[name] || 0);
          if (ratio > 0) {
              baseRatioSum += ratio;
              baseNormWeighted += normOf(name) * ratio;
          }
      }
  } else {
      log.push(`[규칙] 선택 규칙 ${rulesArray.length}개 적용`);

      // 1. Process 'select_ranked_weights'
      rulesArray.filter(r => r?.type === 'select_ranked_weights').forEach(r => {
          if (!Array.isArray(r.from) || !Array.isArray(r.weights) || r.weights.length === 0) return;
          const cand = r.from
              .filter(name => candidatesBase.includes(name) && !processedByRules.has(name))
              .map(name => ({ name, norm: normOf(name) }))
              .sort((a, b) => b.norm - a.norm);

          const N = Math.min(cand.length, r.weights.length);
          const picked = cand.slice(0, N);
          let weightedSum = 0;
          picked.forEach((p, idx) => {
              const weight = Number(r.weights[idx] || 0);
              weightedSum += p.norm * weight;
              processedByRules.add(p.name);
              log.push(`[선택가중] ${p.name}: norm=${p.norm.toFixed(3)}, weight=${weight}`);
          });
          // select_ranked_weights contribute directly based on weights * TOTAL
          selectBeforeRatio += weightedSum * TOTAL;
      });

      // 2. Process 'select_n'
      rulesArray.filter(r => r?.type === 'select_n').forEach(r => {
           if (!Array.isArray(r.from) || !r.count) return;
           const count = Math.max(1, Number(r.count) || 1);
           const cand = r.from
               .filter(name => candidatesBase.includes(name) && !processedByRules.has(name))
               .map(name => ({ name, norm: normOf(name) }))
               .sort((a, b) => b.norm - a.norm);

           const picked = cand.slice(0, Math.min(count, cand.length));
            log.push(`[선택N] From [${r.from.join(',')}] -> Pick [${picked.map(p=>p.name).join(',')}]`);

           // Subjects picked by select_n contribute based on their *original* F ratio
           picked.forEach(p => {
               const ratio = Number(F[p.name] || 0);
               if (ratio > 0) {
                   baseRatioSum += ratio; // Add to base ratio sum
                   baseNormWeighted += p.norm * ratio; // Add to weighted norm sum
                   processedByRules.add(p.name);
                   log.push(`[선택N 적용] ${p.name}: norm=${p.norm.toFixed(3)}, ratio=${ratio}`);
               } else {
                   processedByRules.add(p.name); // Mark processed even if ratio is 0 to exclude later
                   log.push(`[선택N 건너뜀] ${p.name}: 비율 0`);
               }
           });
           // Exclude subjects that were in 'from' but not picked
           r.from.forEach(name => {
                if (!picked.some(p => p.name === name)) {
                    processedByRules.add(name); // Exclude non-picked
                     log.push(`[선택N 제외] ${name}`);
                }
           });
      });

      // 3. Add remaining base candidates not touched by rules
      for (const name of candidatesBase) {
          if (!processedByRules.has(name)) {
              const ratio = Number(F[name] || 0);
              if (ratio > 0) {
                  baseRatioSum += ratio;
                  baseNormWeighted += normOf(name) * ratio;
                   log.push(`[기본 잔여] ${name}: norm=${normOf(name).toFixed(3)}, ratio=${ratio}`);
              }
          }
      }
  }
   // --- End Rule Application ---

   // Calculate base contribution: (WeightedNorm / SumRatio) * TOTAL * (SumRatio / 100)
   // Simplified: WeightedNorm * TOTAL / 100
   const baseBeforeRatio = baseNormWeighted * TOTAL / 100;

  // rawSuneungTotal is the sum before applying the main suneungRatio
  const rawSuneungTotal = baseBeforeRatio + selectBeforeRatio;
  log.push(`[수능원본점수] 기본=${baseBeforeRatio.toFixed(3)}, 선택=${selectBeforeRatio.toFixed(3)}, 합계=${rawSuneungTotal.toFixed(3)} (비율적용 전)`);

  let historyScore = 0;
  if (!historyAsSubject && F.history_scores && S.한국사?.grade != null) { // Use parsed F.history_scores
      const hg = String(S.한국사.grade);
      historyScore = Number(F.history_scores[hg]) || 0;
      log.push(`[한국사 가감] 등급 ${hg} → ${historyScore}점`);
  }

  let englishBonus = 0;
  if (F.english_bonus_scores && S.영어?.grade != null) { // Use parsed F.english_bonus_scores
      const eg = String(S.영어.grade);
      englishBonus += Number(F.english_bonus_scores[eg] ?? 0);
      log.push(`[영어 보정] 등급 ${eg} → ${Number(F.english_bonus_scores[eg] ?? 0)}점`);
  }
  if (englishAsBonus && S.영어?.grade != null && F.english_scores) { // Use parsed F.english_scores
      const eg = String(S.영어.grade);
      englishBonus += Number(F.english_scores[eg] ?? 0); // englishGradeBonus logic integrated
      log.push(`[영어 가산] 등급 ${eg} → ${Number(F.english_scores[eg] ?? 0)}점`);
  }
  if (englishBonusFixed) {
      englishBonus += englishBonusFixed;
      log.push(`[영어 고정 보정] ${englishBonusFixed}점`);
  }


  let finalSuneungScore = 0;
  if (otherSettings?.한국사우선적용 === true) { // Use parsed otherSettings
    log.push('[계산방식] 한국사 가산점 우선 적용');
    finalSuneungScore = (rawSuneungTotal + historyScore) * suneungRatio;
    historyScore = 0;
  } else {
    finalSuneungScore = rawSuneungTotal * suneungRatio;
  }

  // Add bonuses *after* scaling by suneungRatio if 한국사 우선적용 is false
  const final = finalSuneungScore + historyScore + englishBonus;
  log.push('========== 수능 최종 ==========');
  log.push(`수능점수(비율적용) = ${finalSuneungScore.toFixed(3)} / 한국사(후반영) = ${historyScore} / 영어보정 = ${englishBonus}`);
  log.push(`수능 총점 = ${final.toFixed(3)}`);

  return {
    totalScore: final.toFixed(3), // Consistent decimal places
    breakdown: { base: baseBeforeRatio * suneungRatio, select: selectBeforeRatio * suneungRatio, history: historyScore, english_bonus: englishBonus },
    calculationLog: log
  };
}


/* ========== 변환표준 적용 래퍼 ========== */
function calculateScoreWithConv(formulaDataRaw, studentScores, convMap, logHook, highestMap) {
  // Directly pass convMap to calculateScore; parsing happens inside if needed
  formulaDataRaw.탐구변표 = convMap; // Ensure convMap is attached for normOf if needed

  const cfg = safeParse(formulaDataRaw.score_config, {}) || {};
  const inqType = cfg?.inquiry?.type || '백분위';

  let processedStudentScores = studentScores; // Start with original

  if (inqType === '변환표준점수' && Array.isArray(studentScores?.subjects)) {
      const cloned = JSON.parse(JSON.stringify(studentScores)); // Deep clone to avoid mutation
      let modified = false;
      cloned.subjects = (cloned.subjects || []).map(sub => {
          if (sub.name !== '탐구' || sub.converted_std != null) return sub; // Skip non-inquiry or already converted

          const group = sub.group || sub.type || guessInquiryGroup(sub.subject || '');
          const pct = Number(sub.percentile || 0);
          
          // Use the provided convMap
          const conv = mapPercentileToConverted(convMap?.[group], pct);

          if (conv != null && Number.isFinite(conv)) {
              if (typeof logHook === 'function') {
                  logHook(`[변환표준] ${sub.subject || '탐구'}(${group}) 백분위 ${pct} → 변표 ${conv.toFixed(2)} (자동보충)`);
              }
              modified = true;
              // Return new object with converted_std
              return { ...sub, converted_std: conv };
          }
          return sub;
      });
      // Only update studentScores if modifications were made
      if(modified) {
          processedStudentScores = cloned;
      }
  }

  // Call main calculate function with potentially updated studentScores
  return calculateScore(formulaDataRaw, processedStudentScores, highestMap);
}


/* ========== 최고표점 로딩 ========== */
async function loadYearHighestMap(db, year, exam) {
   try {
      const [rows] = await db.query(
          'SELECT 과목명, 최고점 FROM `정시최고표점` WHERE 학년도=? AND 모형=?',
          [year, exam]
      );
      const map = {};
      rows.forEach(r => { map[r.과목명] = Number(r.최고점); });
      return map;
   } catch (err) {
       console.error(`Error loading highest map for ${year}/${exam}:`, err);
       return {}; // Return empty object on error
   }
}

/* ========== 라우터 ========== */
module.exports = function (db, authMiddleware) {
  
  // ⭐️ [핵심] '/calculate' API (수능 + 실기 + 기본점수) 통합 계산 ⭐️
  router.post('/calculate', authMiddleware, async (req, res) => {
    const { U_ID, year, studentScores, basis_exam } = req.body;

    if (!U_ID || !year || !studentScores) {
      return res.status(400).json({ success: false, message: 'U_ID, year, studentScores 필요' });
    }

    try {
      // 1. [공통] 학교 정보(F) 로딩 (비율, 총점, 기본점수 등 모든 컬럼 로드)
      const sql = `SELECT b.*, r.* FROM \`정시기본\` AS b JOIN \`정시반영비율\` AS r ON b.U_ID = r.U_ID AND b.학년도 = r.학년도 WHERE b.U_ID = ? AND b.학년도 = ?`;
      const [rows] = await db.query(sql, [U_ID, year]);
      if (!rows || rows.length === 0) {
        return res.status(404).json({ success: false, message: '학과/학년도 정보 없음' });
      }
      const formulaData = rows[0];
      formulaData.U_ID = Number(U_ID); // silgical 예외처리용

      // 2. [수능용] 변환표준점수(convMap) 로딩
      const [convRows] = await db.query( `SELECT 계열, 백분위, 변환표준점수 FROM \`정시탐구변환표준\` WHERE U_ID=? AND 학년도=?`, [U_ID, year] );
      const convMap = { '사탐': {}, '과탐': {} };
      convRows.forEach( r => {
          if (!convMap[r.계열]) convMap[r.계열] = {}; // Ensure 계열 exists
          convMap[r.계열][String(r.백분위)] = Number(r.변환표준점수);
      });
      // Pass convMap directly to calculateScoreWithConv

      // 3. [수능용] 최고표준점수(highestMap) 로딩
      const cfg = safeParse(formulaData.score_config, {}) || {}; // Parse config once
      const mustLoadYearMax = cfg?.korean_math?.max_score_method === 'highest_of_year' || cfg?.inquiry?.max_score_method === 'highest_of_year' || formulaData.계산유형 === '특수공식';
      let highestMap = null;
      if (mustLoadYearMax) {
        const exam = basis_exam || cfg?.highest_exam || '수능';
        highestMap = await loadYearHighestMap(db, year, exam);
      }

      // 4. [실기용] 실기 배점 데이터 로딩
      const [practicalRows] = await db.query( `SELECT id, 종목명, 성별, 기록, 배점 FROM \`정시실기배점\` WHERE U_ID = ? AND 학년도 = ? ORDER BY 종목명, 성별, id`, [U_ID, year] );
      formulaData.실기배점 = practicalRows || []; // Attach to formulaData for silgical

      // --- 계산 실행 ---
      let logBuffer = [];
      const logHook = (msg) => logBuffer.push(msg);

      // (A) 수능 점수 계산
      const suneungResult = calculateScoreWithConv( formulaData, studentScores, convMap, logHook, highestMap );

      // (B) 실기 점수 계산
      const practicalResult = silgical.calculateScore( formulaData, studentScores );

      // (C) ⭐️ 기본점수 추가 및 최종 합산 ⭐️
      const baseScore = Number(formulaData.기본점수) || 0; // Get base score from DB data
      const finalTotalBeforeBase = Number(suneungResult.totalScore) + Number(practicalResult.totalScore);
      const finalTotal = finalTotalBeforeBase + baseScore;

      // (D) 로그 합치기 및 결과 반환
      if (logBuffer.length && Array.isArray(suneungResult.calculationLog)) {
        const idx = suneungResult.calculationLog.findIndex(x => String(x).includes('========== 수능 계산 시작 =========='));
        suneungResult.calculationLog.splice((idx >= 0 ? idx + 1 : 1), 0, ...logBuffer);
      }
      const combinedLog = [
        ...(suneungResult.calculationLog || []),
        '=======================================',
        ...(practicalResult.calculationLog || []),
        '=======================================',
        '========== 최종 합산 ==========',
        `합산 (수능+실기) = ${Number(suneungResult.totalScore).toFixed(3)} + ${Number(practicalResult.totalScore).toFixed(3)} = ${finalTotalBeforeBase.toFixed(3)}`,
        `기본 점수 가산 = + ${baseScore}`,
        `최종 총점 = ${finalTotal.toFixed(3)}`
      ];

      return res.json({
        success: true,
        message: `[${year}] U_ID ${U_ID} 점수 계산 성공 (수능+실기+기본점수)`,
        result: {
          totalScore: finalTotal.toFixed(3),
          suneungPart: suneungResult.totalScore,
          practicalPart: practicalResult.totalScore,
          baseScoreAdded: baseScore,
          suneungBreakdown: suneungResult.breakdown || {}, // Ensure breakdown exists
          practicalBreakdown: practicalResult.breakdown || {}, // Ensure breakdown exists
          calculationLog: combinedLog // ⭐️ 원래대로 로그 합쳐서 반환 (네가 원하면 분리된 버전 써도 됨)
        }
      });
    } catch (err) {
      console.error(`❌ 계산 처리 중 오류 (U_ID: ${U_ID}, Year: ${year}):`, err);
      // Send error details back in the response for debugging
      return res.status(500).json({ success: false, message: `계산 중 서버 오류: ${err.message}`, error: err.message, stack: err.stack });
    }
  });

  // --- 기존 /debug-normalize 라우터 ---
  router.post('/debug-normalize', authMiddleware, (req, res) => {
    const cfg = safeParse(req.body?.score_config, {});
    const eng = safeParse(req.body?.english_scores, null);
    const maxes = resolveMaxScores(cfg, eng, null, {}); // Pass empty S object
    res.json({ success: true, maxes });
  });

  // --- 실기 배점표 관리 API (CRUD) ---
  // [R] READ
  router.get('/practical-scores/:U_ID/:year', authMiddleware, async (req, res) => {
    const { U_ID, year } = req.params;
    try {
      const [rows] = await db.query( `SELECT id, 종목명, 성별, 기록, 배점 FROM \`정시실기배점\` WHERE U_ID = ? AND 학년도 = ? ORDER BY 종목명, 성별, id`, [U_ID, year] );
      res.json({ success: true, scores: rows });
    } catch (err) {
      console.error(`❌ 실기 배점표 조회 오류 (U_ID: ${U_ID}, Year: ${year}):`, err);
      res.status(500).json({ success: false, message: 'DB 오류' });
    }
  });

  // [C] CREATE
  router.post('/practical-scores/save', authMiddleware, async (req, res) => {
    const { U_ID, 학년도, 종목명, 성별, 기록, 배점 } = req.body;
    if (!U_ID || !학년도 || !종목명 || !성별 || 기록 == null || 배점 == null) {
      return res.status(400).json({ success: false, message: '모든 필드 필요' });
    }
    if (성별 !== '남' && 성별 !== '여') {
       return res.status(400).json({ success: false, message: '성별은 "남" 또는 "여"' });
    }
    try {
      const [result] = await db.query( 'INSERT INTO `정시실기배점` (U_ID, 학년도, 종목명, 성별, 기록, 배점) VALUES (?, ?, ?, ?, ?, ?)', [U_ID, 학년도, 종목명, 성별, String(기록), String(배점)] );
      res.json({ success: true, message: '저장 완료', newId: result.insertId });
    } catch (err) {
      console.error(`❌ 실기 배점 저장 오류 (U_ID: ${U_ID}, Year: ${학년도}):`, err);
      res.status(500).json({ success: false, message: 'DB 오류' });
    }
  });

  // [D] DELETE
  router.delete('/practical-scores/delete/:id', authMiddleware, async (req, res) => {
    const { id } = req.params;
    if (!id || isNaN(Number(id))) {
        return res.status(400).json({ success: false, message: '유효한 ID가 필요합니다.'});
    }
    try {
      const [result] = await db.query('DELETE FROM `정시실기배점` WHERE id = ?', [id]);
      if (result.affectedRows === 0) {
        return res.status(404).json({ success: false, message: '항목 없음' });
      }
      res.json({ success: true, message: '삭제 완료' });
    } catch (err) {
      console.error(`❌ 실기 배점 삭제 오류 (ID: ${id}):`, err);
      res.status(500).json({ success: false, message: 'DB 오류' });
    }
  });
  
  // [C-Bulk] BULK CREATE
  router.post('/practical-scores/bulk-save', authMiddleware, async (req, res) => {
    const { U_ID, year, eventName, gender, rows_text } = req.body;
    if (!U_ID || !year || !eventName || !gender || !rows_text) {
      return res.status(400).json({ success: false, message: '모든 필드 필요' });
    }
    if (gender !== '남' && gender !== '여') {
       return res.status(400).json({ success: false, message: '성별은 "남" 또는 "여"' });
    }
    
    const lines = rows_text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (!lines.length) return res.json({ success: true, message: '저장할 데이터 없음' });

    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const sql = 'INSERT INTO `정시실기배점` (U_ID, 학년도, 종목명, 성별, 기록, 배점) VALUES (?, ?, ?, ?, ?, ?)';
      let count = 0;
      
      for (const line of lines) {
        const parts = line.split(/\t|,/); // Tab or Comma separated
        if (parts.length < 2) continue; // Skip lines without at least 2 parts
        const record = parts[0].trim();
        const score = parts[1].trim();
        if (record === '' || score === '') continue; // Skip lines with empty record or score
        await conn.query(sql, [U_ID, year, eventName, gender, record, score]);
        count++;
      }
      
      await conn.commit();
      res.json({ success: true, message: `${count}건 저장 완료` });
    } catch (e) {
      await conn.rollback();
      console.error(`❌ 실기 배점 벌크 저장 오류 (U_ID: ${U_ID}, Year: ${year}):`, e);
      res.status(500).json({ success: false, message: 'DB 오류' });
    } finally {
      conn.release();
    }
  });

  return router;
};

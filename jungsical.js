// jungsical.js
const express = require('express');
const router = express.Router();

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
  if (typeof F?.영어처리 === 'string' && kw.some(k=>F.영어처리.includes(k))) return true;
  if (typeof F?.영어비고 === 'string' && kw.some(k=>F.영어비고.includes(k))) return true;
  for (const [k,v] of Object.entries(F)) {
    if (typeof v !== 'string') continue;
    if (k.includes('영어') || k.includes('비고') || k.includes('설명') || k.includes('기타')) {
      if (v.includes('영어') && kw.some(t=>v.includes(t))) return true;
    }
  }
  if ((Number(F?.영어 || 0) === 0) && F?.english_scores) return true;
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
  const rep = picked.reduce((s, x) => s + x.val, 0) / picked.length;
  return { rep, sorted: arr, picked };
}

function resolveMaxScores(scoreConfig, englishScores, highestMap, S) {
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
  let engMax = 100;
  if (scoreConfig?.english?.type === 'fixed_max_score' && Number(scoreConfig?.english?.max_score)) {
    engMax = Number(scoreConfig.english.max_score);
  } else {
    if (englishScores && typeof englishScores === 'object') {
      const vals = Object.values(englishScores).map(Number).filter(n => !Number.isNaN(n));
      if (vals.length) engMax = Math.max(...vals);
    }
  }
  return { korMax, mathMax, engMax, inqMax };
}

function evaluateSpecialFormula(formulaText, ctx, log) {
  const replaced = String(formulaText || '').replace(/\{([a-z0-9_]+)\}/gi, (_, k) => {
    const v = Number(ctx[k] ?? 0);
    log.push(`[특수공식 변수] ${k} = ${isFinite(v) ? v : 0}`);
    return String(isFinite(v) ? v : 0);
  });
  if (!/^[0-9+\-*/().\s]+$/.test(replaced)) {
    throw new Error('특수공식에 허용되지 않은 토큰이 포함되어 있습니다.');
  }
  const val = Function(`"use strict"; return (${replaced});`)();
  return Number(val) || 0;
}

const readConvertedStd = (t) =>
  Number(t?.converted_std ?? t?.vstd ?? t?.conv_std ?? t?.std ?? t?.percentile ?? 0);

function buildSpecialContext(F, S, highestMap) {
  const ctx = {};
  ctx.total = resolveTotal(F);
  ctx.suneung_ratio = (Number(F.수능) || 0) / 100;

  const cfg = safeParse(F.score_config, {}) || {};
  const kmMethod = cfg?.korean_math?.max_score_method || '';

  const korKey  = kmSubjectNameForKorean(S?.국어);
  const mathKey = kmSubjectNameForMath(S?.수학);

  // 1) 기본값
  let korMax  = 200;
  let mathMax = 200;

  // 2) 설정 기반
  if (kmMethod === 'fixed_200') {
    korMax = 200;
    mathMax = 200;
  } else if (kmMethod === 'highest_of_year') {
    if (highestMap && highestMap[korKey] != null)  korMax  = Number(highestMap[korKey]);
    if (highestMap && highestMap[mathKey] != null) mathMax = Number(highestMap[mathKey]);
  }

  // 3) ★ 특수공식 요구: highestMap이 있으면 설정과 무관하게 최우선으로 사용
  if (highestMap) {
    if (highestMap[korKey]  != null) korMax  = Number(highestMap[korKey]);
    if (highestMap[mathKey] != null) mathMax = Number(highestMap[mathKey]);
  }

  // 0 또는 NaN 방지
  if (!Number.isFinite(korMax)  || korMax  <= 0) korMax  = 1;
  if (!Number.isFinite(mathMax) || mathMax <= 0) mathMax = 1;

  // 컨텍스트에 주입 (★ 특수식에서 사용)
  ctx.kor_max  = korMax;
  ctx.math_max = mathMax;

  // 국/수 표준·백분위
  ctx.kor_std  = Number(S.국어?.std || 0);
  ctx.kor_pct  = Number(S.국어?.percentile || 0);
  ctx.math_std = Number(S.수학?.std || 0);
  ctx.math_pct = Number(S.수학?.percentile || 0);

  // 영어(등급 환산)
  ctx.eng_grade_score = 0;
  if (F.english_scores && S.영어?.grade != null) {
    const eg = String(S.영어.grade);
    ctx.eng_grade_score = Number(F.english_scores[eg] ?? 0);
    const vals = Object.values(F.english_scores).map(Number).filter(n => !Number.isNaN(n));
    const engMax = vals.length ? Math.max(...vals) : 100;
    ctx.eng_pct_est = engMax > 0 ? Math.min(100, Math.max(0, (ctx.eng_grade_score / engMax) * 100)) : 0;
  } else {
    ctx.eng_pct_est = 0;
  }

  // 한국사(등급→환산/감점)
  ctx.hist_grade_score = 0;
  if (F.history_scores && S.한국사?.grade != null) {
    const hg = String(S.한국사.grade);
    ctx.hist_grade_score = Number(F.history_scores[hg] || 0);
  }

  // (이하 탐구·top3 등 기존 내용 유지)
  const inqs = (S.탐구 || []);
  const sortedConv = inqs.map((t) => ({ conv: readConvertedStd(t), std: Number(t?.std || 0), pct: Number(t?.percentile || 0) }))
                         .sort((a,b)=>b.conv-a.conv);
  const sortedStd  = inqs.map((t) => ({ std: Number(t?.std || 0), pct: Number(t?.percentile || 0) }))
                         .sort((a,b)=>b.std-a.std);
  const sortedPct  = inqs.map((t) => ({ pct: Number(t?.percentile || 0) }))
                         .sort((a,b)=>b.pct-a.pct);
  ctx.inq1_converted_std = sortedConv[0]?.conv || 0;
  ctx.inq2_converted_std = sortedConv[1]?.conv || 0;
  ctx.inq_sum2_converted_std = ctx.inq1_converted_std + ctx.inq2_converted_std;
  ctx.inq_avg2_converted_std = (ctx.inq_sum2_converted_std) / (sortedConv.length >= 2 ? 2 : (sortedConv.length || 1));
  ctx.inq1_std = sortedStd[0]?.std || 0;
  ctx.inq2_std = sortedStd[1]?.std || 0;
  ctx.inq_sum2_std = ctx.inq1_std + ctx.inq2_std;
  ctx.inq_avg2_std = (ctx.inq_sum2_std) / (sortedStd.length >= 2 ? 2 : (sortedStd.length || 1));
  ctx.inq1_percentile = sortedPct[0]?.pct || 0;
  ctx.inq2_percentile = sortedPct[1]?.pct || 0;
  ctx.inq_sum2_percentile = ctx.inq1_percentile + ctx.inq2_percentile;
  ctx.inq_avg2_percentile = (ctx.inq_sum2_percentile) / (sortedPct.length >= 2 ? 2 : (sortedPct.length || 1));

  const kor_pct = ctx.kor_pct;
  const math_pct = ctx.math_pct;
  const inq1_pct = ctx.inq1_percentile;
  const eng_pct_est = ctx.eng_pct_est;
  const top3_no_eng = [kor_pct, math_pct, inq1_pct].sort((a,b)=>b-a).slice(0,3);
  ctx.top3_avg_pct_kor_math_inq1 = top3_no_eng.length ? (top3_no_eng.reduce((s,x)=>s+x,0)/top3_no_eng.length) : 0;
  const top3_with_eng = [kor_pct, math_pct, inq1_pct, eng_pct_est].sort((a,b)=>b-a).slice(0,3);
  ctx.top3_avg_pct_kor_eng_math_inq1 = top3_with_eng.length ? (top3_with_eng.reduce((s,x)=>s+x,0)/top3_with_eng.length) : 0;
  ctx.top3_avg_pct = ctx.top3_avg_pct_kor_eng_math_inq1;

  // 편의 파생
  ctx.max_kor_math_std = Math.max(ctx.kor_std, ctx.math_std);
  ctx.max_kor_math_pct = Math.max(ctx.kor_pct, ctx.math_pct);

  return ctx;
}

function mapPercentileToConverted(mapObj, pct) {
  const p = Math.max(0, Math.min(100, Math.round(Number(pct)||0)));
  if (!mapObj) return null;
  if (mapObj[String(p)] != null) return Number(mapObj[String(p)]);
  const keys = Object.keys(mapObj).map(k => parseInt(k,10)).filter(n=>!Number.isNaN(n)).sort((a,b)=>a-b);
  if (!keys.length) return null;
  if (p <= keys[0]) return Number(mapObj[String(keys[0])]);
  if (p >= keys[keys.length-1]) return Number(mapObj[String(keys[keys.length-1])]);
  let lo = keys[0], hi = keys[keys.length-1];
  for (let i=1;i<keys.length;i++){
    if (keys[i] >= p){ hi = keys[i]; lo = keys[i-1]; break; }
  }
  const y1 = Number(mapObj[String(lo)]);
  const y2 = Number(mapObj[String(hi)]);
  const t = (p - lo) / (hi - lo);
  return y1 + (y2 - y1) * t;
}

function guessInquiryGroup(subjectName='') {
  const s = String(subjectName);
  const sci = ['물리','화학','생명','지구'];
  if (sci.some(w => s.includes(w))) return '과탐';
  return '사탐';
}

/* ========== 핵심 계산기(일반) ========== */
function calculateScore(formulaDataRaw, studentScores, highestMap) {
  const log = [];
  log.push('========== 계산 시작 ==========');

  const F = { ...formulaDataRaw };
  F.selection_rules        = safeParse(F.selection_rules, null);
  F.score_config           = safeParse(F.score_config,   {}) || {};
  F.english_scores         = safeParse(F.english_scores, null);
  F.history_scores         = safeParse(F.history_scores, null);
  F.english_bonus_scores   = safeParse(F.english_bonus_scores, null);
  const englishBonusFixed  = Number(F.english_bonus_fixed || 0);
  const otherSettings      = safeParse(F.기타설정, {}) || {};

  const englishAsBonus = detectEnglishAsBonus(F);

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
    const ctx = buildSpecialContext(F, S, highestMap); // 최고표점 맵 전달

    log.push(`[특수공식 원본] ${F.특수공식}`);
    const specialValue = evaluateSpecialFormula(F.특수공식, ctx, log);
    const final = Number(specialValue) || 0;
    log.push('========== 최종 ==========');
    log.push(`특수공식 결과 = ${final.toFixed(3)}`);
    return {
      totalScore: final.toFixed(3),
      breakdown: { special: final },
      calculationLog: log
    };
  }

  const cfg       = F.score_config || {};
  const kmType    = cfg.korean_math?.type || '백분위';
  const inqType   = cfg.inquiry?.type     || '백분위';
  const inqMethod = cfg.inquiry?.max_score_method || '';

  const inquiryCount = Math.max(1, parseInt(F.탐구수 || '1', 10));
  const { rep: inqRep, picked: inqPicked } = calcInquiryRepresentative(S.탐구, inqType, inquiryCount);

  let engConv = 0;
  let englishGradeBonus = 0;
  if (F.english_scores && S.영어?.grade != null) {
    const g = String(S.영어.grade);
    if (englishAsBonus) {
      englishGradeBonus = Number(F.english_scores[g] ?? 0);
    } else {
      engConv = Number(F.english_scores[g] ?? 0);
    }
  }

  const rulesArray = Array.isArray(F.selection_rules)
    ? F.selection_rules
    : (F.selection_rules ? [F.selection_rules] : []);
  const historyAppearsInRules = isSubjectUsedInRules('한국사', rulesArray);
  const historyRatioPositive  = Number(F['한국사'] || 0) > 0;
  const historyAsSubject = historyAppearsInRules || historyRatioPositive;

  let histConv = 0;
  if (historyAsSubject && F.history_scores && S.한국사?.grade != null) {
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

  if (englishAsBonus) { log.push(`[원점수] 국:${raw.국어} / 수:${raw.수학} / 영(가산점모드-과목반영X):0 / 탐(대표):${raw.탐구}`); }
  else { log.push(`[원점수] 국:${raw.국어} / 수:${raw.수학} / 영(환산):${raw.영어} / 탐(대표):${raw.탐구}`); }
  if (historyAsSubject) { log.push(`[원점수] 한국사(과목반영): ${raw.한국사}`); }

  const { korMax, mathMax, engMax, inqMax } = resolveMaxScores(cfg, F.english_scores, highestMap, S);
  let histMax = 100;
  if (F.history_scores && typeof F.history_scores === 'object') {
    const vals = Object.values(F.history_scores).map(Number).filter(n => !Number.isNaN(n));
    if (vals.length) histMax = Math.max(...vals);
  }
  const getMax = (name) => {
    if (name === '국어') return korMax;
    if (name === '수학') return mathMax;
    if (name === '영어') return engMax;
    if (name === '탐구') return inqMax;
    if (name === '한국사') return histMax;
    return 100;
  };

  // ★★★ 탐구 highest_of_year 계산 방식 변경: 점수/각 과목 최고점 → 비율 평균
  const normOf = (name) => {
    if (name === '탐구' && inqMethod === 'highest_of_year' && highestMap && inqPicked.length) {
      const ratios = inqPicked.map(p => {
        const top = Number(highestMap[p.subject] ?? NaN);
        const v   = Number(p.val ?? NaN);
        if (!Number.isFinite(top) || top <= 0 || !Number.isFinite(v)) return null;
        return Math.max(0, Math.min(1, v / top));
      }).filter(r => r != null);

      if (ratios.length) {
        const avg = ratios.reduce((s, r) => s + r, 0) / ratios.length;
        log.push(`[탐구정규화] highest_of_year: ${inqPicked.map(p => `${p.subject}:${(Number(p.val)||0)}/${highestMap[p.subject] ?? '-'}`).join(', ')} → 평균비율=${avg.toFixed(4)}`);
        return avg;
      }
      return 0;
    }

    const sc = Number(raw[name] || 0);
    const mx = getMax(name);
    return mx > 0 ? Math.max(0, Math.min(1, sc / mx)) : 0;
  };

  const TOTAL        = resolveTotal(F);
  const suneungRatio = (Number(F.수능) || 0) / 100;
  log.push(`[학교] 총점=${TOTAL}, 수능비율=${suneungRatio} (DB총점 반영)`);

  const rules = rulesArray;
  const selectWeightSubjects = new Set();
  const selectWeightSum = rules.reduce((acc, r) => {
    if (r && r.type === 'select_ranked_weights') {
      if (Array.isArray(r.from)) r.from.forEach(n => selectWeightSubjects.add(n));
      if (Array.isArray(r.weights)) {
        const w = r.weights.map(Number).reduce((a, b) => a + (b || 0), 0);
        return acc + w;
      }
    }
    return acc;
  }, 0);
  const SW = Math.min(1, Math.max(0, selectWeightSum));
  const TOTAL_select = TOTAL * SW;
  const TOTAL_base   = TOTAL * (1 - SW);

  const selectNRules = rules.filter(r => r?.type === 'select_n' && Array.isArray(r.from) && r.count);
  const selectedBySelectN = new Set();
  if (selectNRules.length) {
    for (const r of selectNRules) {
      const cand = r.from
        .filter(name => !(englishAsBonus && name === '영어'))
        .map(name => ({ name, norm: normOf(name) }))
        .sort((a, b) => b.norm - a.norm);
      const picked = cand.slice(0, Math.min(Number(r.count) || 1, cand.length));
      picked.forEach(p => selectedBySelectN.add(p.name));
      log.push(`[select_n] from=[${r.from.join(', ')}], count=${r.count} -> 선택: ${picked.map(p => p.name).join(', ')}`);
    }
  }

  let baseRatioSum = 0;
  let baseNormWeighted = 0;
  const ratioOf = (name) => Number(F[name] || 0);
  const candidatesBase = ['국어', '수학', '영어', '탐구', ...(historyAsSubject ? ['한국사'] : [])];

  for (const name of candidatesBase) {
    if (englishAsBonus && name === '영어') continue;
    const ratio = ratioOf(name);
    if (ratio <= 0) continue;
    if (selectWeightSubjects.size && selectWeightSubjects.has(name)) continue;
    if (selectNRules.length && !selectedBySelectN.has(name)) continue;
    baseRatioSum += ratio;
    baseNormWeighted += normOf(name) * ratio;
  }

  const baseBeforeRatio = (baseRatioSum > 0 && TOTAL_base > 0)
    ? (baseNormWeighted / baseRatioSum) * TOTAL_base
    : 0;

  let selectBeforeRatio = 0;
  const usedForWeights = new Set();
  for (let i = 0; i < rules.length; i++) {
    const r = rules[i];
    if (!(r && r.type === 'select_ranked_weights' && Array.isArray(r.from) && Array.isArray(r.weights) && r.weights.length)) {
      continue;
    }
    const cand = r.from
      .filter(name => !(englishAsBonus && name === '영어'))
      .filter(name => !usedForWeights.has(name))
      .map(name => ({ name, norm: normOf(name), raw: Number(raw[name] || 0) }))
      .sort((a, b) => b.norm - a.norm);
    const N = Math.min(cand.length, r.weights.length);
    const picked = cand.slice(0, N);
    picked.forEach(p => usedForWeights.add(p.name));
    const wSum = picked.reduce((acc, c, idx) => acc + (Number(r.weights[idx] || 0) * c.norm), 0);
    selectBeforeRatio += wSum * TOTAL;
  }

  const rawSuneungTotal = baseBeforeRatio + selectBeforeRatio;
  log.push(`[수능원본점수] 기본=${baseBeforeRatio.toFixed(3)}, 선택=${selectBeforeRatio.toFixed(3)}, 합계=${rawSuneungTotal.toFixed(3)} (비율적용 전)`);

  let historyScore = 0;
  if (!historyAsSubject && F.history_scores && S.한국사?.grade != null) {
    const hg = String(S.한국사.grade);
    historyScore = Number(F.history_scores[hg]) || 0;
    log.push(`[한국사] 등급 ${hg} → ${historyScore}점`);
  }

  let englishBonus = 0;
  if (F.english_bonus_scores && S.영어?.grade != null) {
    const eg = String(S.영어.grade);
    englishBonus += Number(F.english_bonus_scores[eg] ?? 0);
    log.push(`[영어 보정] 등급 ${eg} → ${Number(F.english_bonus_scores[eg] ?? 0)}점`);
  }
  if (englishAsBonus && S.영어?.grade != null && F.english_scores) {
    const eg = String(S.영어.grade);
    englishBonus += englishGradeBonus;
    log.push(`[영어 보정] (자동판단-가산점모드) 등급 ${eg} → ${englishGradeBonus}점`);
  }
  if (englishBonusFixed) {
    englishBonus += englishBonusFixed;
    log.push(`[영어 보정] 고정 보정 ${englishBonusFixed}점`);
  }

  let finalSuneungScore = 0;
  if (otherSettings.한국사우선적용 === true) {
    log.push('[계산방식] 한국사 가산점 우선 적용');
    finalSuneungScore = (rawSuneungTotal + historyScore) * suneungRatio;
    historyScore = 0;
  } else {
    finalSuneungScore = rawSuneungTotal * suneungRatio;
  }

  const final = finalSuneungScore + historyScore + englishBonus;
  log.push('========== 최종 ==========');
  log.push(`수능점수(최종) = ${finalSuneungScore.toFixed(3)} / 한국사(후반영) = ${historyScore} / 영어보정 = ${englishBonus}`);
  log.push(`총점 = ${final.toFixed(3)}`);

  return {
    totalScore: final.toFixed(3),
    breakdown: { base: baseBeforeRatio * suneungRatio, select: selectBeforeRatio * suneungRatio, history: historyScore, english_bonus: englishBonus },
    calculationLog: log
  };
}

/* ========== 변환표준 적용 래퍼 ========== */
function calculateScoreWithConv(formulaDataRaw, studentScores, convMap, logHook, highestMap) {
  const cfg = safeParse(formulaDataRaw.score_config, {}) || {};
  const inqType = cfg?.inquiry?.type || '백분위';

  if (inqType === '변환표준점수' && Array.isArray(studentScores?.subjects)) {
    const cloned = JSON.parse(JSON.stringify(studentScores));
    cloned.subjects = (cloned.subjects || []).map(sub => {
      if (sub.name !== '탐구') return sub;
      if (sub.converted_std != null) return sub;
      const group = sub.group || sub.type || guessInquiryGroup(sub.subject || '');
      const pct = Number(sub.percentile || 0);
      const conv = mapPercentileToConverted(convMap?.[group], pct);
      if (conv != null) {
        if (typeof logHook === 'function') {
          logHook(`[변환표준] ${group} 백분위 ${pct} → 변표 ${conv.toFixed(2)} (자동보충)`);
        }
        return { ...sub, converted_std: conv, vstd: conv, std: conv };
      }
      return sub;
    });
    studentScores = cloned;
  }

  return calculateScore(formulaDataRaw, studentScores, highestMap);
}

/* ========== 최고표점 로딩 ========== */
async function loadYearHighestMap(db, year, exam) {
  const [rows] = await db.query(
    'SELECT 과목명, 최고점 FROM `정시최고표점` WHERE 학년도=? AND 모형=?',
    [year, exam]
  );
  const map = {};
  rows.forEach(r => { map[r.과목명] = Number(r.최고점); });
  return map;
}

/* ========== 라우터 ========== */
module.exports = function (db, authMiddleware) {
  router.post('/calculate', authMiddleware, async (req, res) => {
    const { U_ID, year, studentScores, basis_exam } = req.body;
    if (!U_ID || !year || !studentScores) {
      return res.status(400).json({ success: false, message: 'U_ID, year, studentScores가 모두 필요합니다.' });
    }
    try {
      const sql = `
        SELECT b.*, r.*
        FROM \`정시기본\` AS b
        JOIN \`정시반영비율\` AS r
          ON b.U_ID = r.U_ID AND b.학년도 = r.학년도
        WHERE b.U_ID = ? AND b.학년도 = ?
      `;
      const [rows] = await db.query(sql, [U_ID, year]);
      if (!rows || rows.length === 0) {
        return res.status(404).json({ success: false, message: '해당 학과/학년도 정보를 찾을 수 없습니다.' });
      }
      const formulaData = rows[0];

      const [convRows] = await db.query(
        `SELECT 계열, 백분위, 변환표준점수 FROM \`정시탐구변환표준\` WHERE U_ID=? AND 학년도=?`,
        [U_ID, year]
      );
      const convMap = { '사탐': {}, '과탐': {} };
      convRows.forEach(r => { convMap[r.계열][String(r.백분위)] = Number(r.변환표준점수); });
      
      const cfg = safeParse(formulaData.score_config, {}) || {};
      // ★ 특수공식이면 무조건 최고표점 로딩
      const mustLoadYearMax =
        cfg?.korean_math?.max_score_method === 'highest_of_year' ||
        cfg?.inquiry?.max_score_method     === 'highest_of_year' ||
        (formulaData.계산유형 === '특수공식');

      let highestMap = null;
      if (mustLoadYearMax) {
        const exam = basis_exam || cfg?.highest_exam || '수능';
        highestMap = await loadYearHighestMap(db, year, exam);
      }
      
      let logBuffer = [];
      const result = calculateScoreWithConv(
        formulaData,
        studentScores,
        convMap,
        (msg) => logBuffer.push(msg),
        highestMap
      );

      if (logBuffer.length && Array.isArray(result.calculationLog)) {
        const idx = result.calculationLog.findIndex(x => String(x).includes('========== 계산 시작 ==========')); // 보통 0
        result.calculationLog.splice((idx >= 0 ? idx + 1 : 1), 0, ...logBuffer);
      }

      return res.json({ success: true, message: `[${year}] U_ID ${U_ID} 점수 계산 성공`, result });
    } catch (err) {
      console.error('❌ 계산 처리 중 오류:', err);
      return res.status(500).json({ success: false, message: '계산 중 서버 오류' });
    }
  });

  router.post('/debug-normalize', authMiddleware, (req, res) => {
    const cfg = safeParse(req.body?.score_config, {});
    const eng = safeParse(req.body?.english_scores, null);
    const maxes = resolveMaxScores(cfg, eng, null, {});
    res.json({ success: true, maxes });
  });

  return router;
};

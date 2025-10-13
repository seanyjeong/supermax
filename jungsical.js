// jungsical.js
const express = require('express');
const router = express.Router();

/* ========== 유틸 ========== */
const safeParse = (v, fb = null) => {
  if (v == null) return fb;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return fb; }
};

// type에 따라 점수 컬럼 선택 (표준/변표 = std, 백분위 = percentile)
const pickByType = (row, type) => {
  if (!row) return 0;
  if (type === '표준점수' || type === '변환표준점수') return Number(row.std || 0);
  return Number(row.percentile || 0);
};

// 과목명 헬퍼
const kmSubjectNameForKorean = (row) => row?.subject || '국어';
const kmSubjectNameForMath   = (row) => row?.subject || '수학';
const inquirySubjectName     = (row) => row?.subject || '탐구';

// ⭐ 총점 확정 도우미: DB 값 우선, 없으면 1000
const resolveTotal = (F) => {
  const t = Number(F?.총점);
  return (Number.isFinite(t) && t > 0) ? t : 1000;
};

// 영어 가산점(가감점/가점/감점) 모드 자동 감지
function detectEnglishAsBonus(F) {
  const kw = ['가산점','가감점','가점','감점'];
  // 1) 명시 필드가 있다면 우선
  if (typeof F?.영어처리 === 'string' && kw.some(k=>F.영어처리.includes(k))) return true;
  if (typeof F?.영어비고 === 'string' && kw.some(k=>F.영어비고.includes(k))) return true;

  // 2) 기타 텍스트 컬럼들에서 키워드 등장 + '영어' 맥락
  for (const [k,v] of Object.entries(F)) {
    if (typeof v !== 'string') continue;
    if (k.includes('영어') || k.includes('비고') || k.includes('설명') || k.includes('기타')) {
      if (v.includes('영어') && kw.some(t=>v.includes(t))) return true;
    }
  }

  // 3) 힌트: 영어 비율이 0이고 english_scores가 있으면 가산점일 확률 높음
  if ((Number(F?.영어 || 0) === 0) && F?.english_scores) return true;

  return false;
}

// ⭐ 규칙에 특정 과목이 "선택 반영 대상"으로 등장하는지 여부
function isSubjectUsedInRules(name, rulesArr) {
  const rules = Array.isArray(rulesArr) ? rulesArr : (rulesArr ? [rulesArr] : []);
  for (const r of rules) {
    if (!r || !Array.isArray(r.from)) continue;
    if (r.from.includes(name)) return true;
  }
  return false;
}

// 탐구 대표값 계산: 1개면 최대값, 2개면 평균(2초과는 상위 N 평균)
// + 선택된 과목들(picked) 반환하여 highest_of_year 정규화에 사용
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

// 과목 만점(정규화 기준) 산출
// 과목 만점(정규화 기준) 산출
// 과목 만점(정규화 기준) 산출
function resolveMaxScores(scoreConfig, englishScores, highestMap, S) {
  const kmType    = scoreConfig?.korean_math?.type || '백분위';
  const inqType   = scoreConfig?.inquiry?.type     || '백분위';
  const kmMethod  = scoreConfig?.korean_math?.max_score_method || '';
  const inqMethod = scoreConfig?.inquiry?.max_score_method     || '';

  // 기본값
  let korMax  = (kmType === '표준점수' || kmMethod === 'fixed_200') ? 200 : 100;
  let mathMax = korMax;
  let inqMax  = (inqType === '표준점수' || inqType === '변환표준점수' || inqMethod === 'fixed_100') ? 100 : 100;

  // highest_of_year → 과목별 최고점 맵 사용 (국어/수학)
  if (kmMethod === 'highest_of_year' && highestMap) {
    const korKey  = kmSubjectNameForKorean(S?.국어);
    const mathKey = kmSubjectNameForMath(S?.수학);
    if (highestMap[korKey]  != null) korMax  = Number(highestMap[korKey]);
    if (highestMap[mathKey] != null) mathMax = Number(highestMap[mathKey]);
  }

  // ⭐ 영어 max
  let engMax = 100;
  // 1) 설정이 fixed_max_score면 무조건 그 값을 사용
  if (scoreConfig?.english?.type === 'fixed_max_score' && Number(scoreConfig?.english?.max_score)) {
    engMax = Number(scoreConfig.english.max_score);
  } else {
    // 2) 아니면 등급 환산표의 최대값 사용
    if (englishScores && typeof englishScores === 'object') {
      const vals = Object.values(englishScores).map(Number).filter(n => !Number.isNaN(n));
      if (vals.length) engMax = Math.max(...vals);
    }
  }

  return { korMax, mathMax, engMax, inqMax };
}



/** 안전한 특수공식 평가기: {변수} 치환 후 숫자/사칙연산만 허용 */
function evaluateSpecialFormula(formulaText, ctx, log) {
  const replaced = String(formulaText || '').replace(/\{([a-z0-9_]+)\}/gi, (_, k) => {
    const v = Number(ctx[k] ?? 0);
    log.push(`[특수공식 변수] ${k} = ${isFinite(v) ? v : 0}`);
    return String(isFinite(v) ? v : 0);
  });

  // 허용 문자만 (숫자, + - * / ( ) . 공백)
  if (!/^[0-9+\-*/().\s]+$/.test(replaced)) {
    throw new Error('특수공식에 허용되지 않은 토큰이 포함되어 있습니다.');
  }

  const val = Function(`"use strict"; return (${replaced});`)();
  return Number(val) || 0;
}

/** 변환표준점수 키 탐지 */
const readConvertedStd = (t) =>
  Number(t?.converted_std ?? t?.vstd ?? t?.conv_std ?? t?.std ?? t?.percentile ?? 0);

/** 특수공식 컨텍스트(플레이스홀더) 대량 생성 */
function buildSpecialContext(F, S) {
  const ctx = {};

  // ⭐ 총점/수능비율 — 총점은 DB값 우선, 없으면 1000
  ctx.total = resolveTotal(F);
  ctx.suneung_ratio = (Number(F.수능) || 0) / 100;

  // 국/수 표준·백분위
  ctx.kor_std  = Number(S.국어?.std || 0);
  ctx.kor_pct  = Number(S.국어?.percentile || 0);
  ctx.math_std = Number(S.수학?.std || 0);
  ctx.math_pct = Number(S.수학?.percentile || 0);

  // 영어(등급표 환산 + 최대값으로 백분위 추정)
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

  // 한국사(등급→가감점)
  ctx.hist_grade_score = 0;
  if (F.history_scores && S.한국사?.grade != null) {
    const hg = String(S.한국사.grade);
    ctx.hist_grade_score = Number(F.history_scores[hg] ?? 0);
  }

  // 탐구: 변환표준/표준/백분위 정렬
  const inqs = (S.탐구 || []);
  const sortedConv = inqs.map((t) => ({ conv: readConvertedStd(t), std: Number(t?.std || 0), pct: Number(t?.percentile || 0) }))
                         .sort((a,b)=>b.conv-a.conv);
  const sortedStd  = inqs.map((t) => ({ std: Number(t?.std || 0), pct: Number(t?.percentile || 0) }))
                         .sort((a,b)=>b.std-a.std);
  const sortedPct  = inqs.map((t) => ({ pct: Number(t?.percentile || 0) }))
                         .sort((a,b)=>b.pct-a.pct);

  // Top1/Top2/Avg2 (변환표준/표준/백분위)
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

  // 상위3 평균(백분위): 국/수/탐1 (영어 포함/제외 둘 다)
  const kor_pct = ctx.kor_pct;
  const math_pct = ctx.math_pct;
  const inq1_pct = ctx.inq1_percentile;
  const eng_pct_est = ctx.eng_pct_est;

  const top3_no_eng = [kor_pct, math_pct, inq1_pct].sort((a,b)=>b-a).slice(0,3);
  ctx.top3_avg_pct_kor_math_inq1 = top3_no_eng.length ? (top3_no_eng.reduce((s,x)=>s+x,0)/top3_no_eng.length) : 0;

  const top3_with_eng = [kor_pct, math_pct, inq1_pct, eng_pct_est].sort((a,b)=>b-a).slice(0,3);
  ctx.top3_avg_pct_kor_eng_math_inq1 = top3_with_eng.length ? (top3_with_eng.reduce((s,x)=>s+x,0)/top3_with_eng.length) : 0;

  ctx.top3_avg_pct = ctx.top3_avg_pct_kor_eng_math_inq1;

  return ctx;
}

/* ========= 변환표준 보조 ========= */
// 백분위→변환표준점수 조회 (정확 일치 우선, 없으면 선형보간)
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

// 과목명으로 사탐/과탐 추정(학생 데이터에 group/type 없을 때 대비)
function guessInquiryGroup(subjectName='') {
  const s = String(subjectName);
  const sci = ['물리','화학','생명','지구'];
  if (sci.some(w => s.includes(w))) return '과탐';
  return '사탐'; // default
}

/* ========== 핵심 계산기(일반) ========== */
function calculateScore(formulaDataRaw, studentScores, highestMap) {
  const log = [];
  log.push('========== 계산 시작 ==========');

  // 0) 컬럼 파싱
  const F = { ...formulaDataRaw };
  F.selection_rules        = safeParse(F.selection_rules, null);
  F.score_config           = safeParse(F.score_config,   {}) || {};
  F.english_scores         = safeParse(F.english_scores, null);
  F.history_scores         = safeParse(F.history_scores, null);
  F.english_bonus_scores   = safeParse(F.english_bonus_scores, null);
  const englishBonusFixed  = Number(F.english_bonus_fixed || 0);

  // 영어 가산점/가감점 자동 감지
  const englishAsBonus = detectEnglishAsBonus(F);

  // 1) 학생 과목 데이터 추출
  const subs = studentScores?.subjects || [];
  const S = {
    국어   : subs.find(s => s.name === '국어')   || {},
    수학   : subs.find(s => s.name === '수학')   || {},
    영어   : subs.find(s => s.name === '영어')   || {},
    한국사 : subs.find(s => s.name === '한국사') || {},
    탐구   : subs.filter(s => s.name === '탐구')
  };

  // === [특수공식 분기] ===
  if (F.계산유형 === '특수공식' && F.특수공식) {
    log.push('<< 특수공식 모드 >>');
    const ctx = buildSpecialContext(F, S); // 내부에서 resolveTotal 사용
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
  // === [특수공식 분기 끝] ===

  const cfg       = F.score_config || {};
  const kmType    = cfg.korean_math?.type || '백분위';
  const inqType   = cfg.inquiry?.type     || '백분위';
  const inqMethod = cfg.inquiry?.max_score_method || '';

  // 탐구 대표값(규칙) + picked (highest_of_year용)
  const inquiryCount = Math.max(1, parseInt(F.탐구수 || '1', 10));
  const { rep: inqRep, picked: inqPicked } = calcInquiryRepresentative(S.탐구, inqType, inquiryCount);

  // 영어 환산 점수 (과목 반영 모드일 때만 원점수로 사용)
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

  // ===== 한국사: 선택 반영이면 과목처럼, 아니면 보너스 처리 =====
  const rulesArray = Array.isArray(F.selection_rules)
    ? F.selection_rules
    : (F.selection_rules ? [F.selection_rules] : []);
  const historyAppearsInRules = isSubjectUsedInRules('한국사', rulesArray);
  const historyRatioPositive  = Number(F['한국사'] || 0) > 0; // 기본비율에 한국사 비율이 있는 경우
  const historyAsSubject = historyAppearsInRules || historyRatioPositive;

  // 과목으로 쓸 때의 한국사 환산 원점수(등급→점수)
  let histConv = 0;
  if (historyAsSubject && F.history_scores && S.한국사?.grade != null) {
    const hg = String(S.한국사.grade);
    histConv = Number(F.history_scores[hg] ?? 0);
  }

  // 원점수(과목당)
  const raw = {
    국어:   pickByType(S.국어, kmType),
    수학:   pickByType(S.수학, kmType),
    영어:   englishAsBonus ? 0 : engConv, // 가산점 모드면 과목반영에서 제외
    한국사: historyAsSubject ? histConv : 0, // 선택반영이면 과목 점수로, 아니면 0
    탐구:   inqRep
  };
  if (englishAsBonus) {
    log.push(`[원점수] 국:${raw.국어} / 수:${raw.수학} / 영(가산점모드-과목반영X):0 / 탐(대표):${raw.탐구}`);
  } else {
    log.push(`[원점수] 국:${raw.국어} / 수:${raw.수학} / 영(환산):${raw.영어} / 탐(대표):${raw.탐구}`);
  }
  if (historyAsSubject) {
    log.push(`[원점수] 한국사(과목반영): ${raw.한국사}`);
  }

  // 정규화 기준(과목 만점)
  const { korMax, mathMax, engMax, inqMax } = resolveMaxScores(cfg, F.english_scores, highestMap, S);

  // 한국사 만점(과목으로 반영할 때 정규화 분모): history_scores의 최대값
  let histMax = 100;
  if (F.history_scores && typeof F.history_scores === 'object') {
    const vals = Object.values(F.history_scores).map(Number).filter(n => !Number.isNaN(n));
    if (vals.length) histMax = Math.max(...vals);
  }

  const getMax = (name) => {
    if (name === '국어') return korMax;
    if (name === '수학') return mathMax;
    if (name === '영어') return engMax;
    if (name === '탐구') return inqMax; // 탐구 highest_of_year는 아래에서 별도 처리
    if (name === '한국사') return histMax;
    return 100;
  };

  // 탐구 highest_of_year면 대표값의 분모를 '선택된 과목 최고점 평균'으로 사용
  let inquiryRepMaxForNorm = inqMax;
  if (inqMethod === 'highest_of_year' && highestMap && inqPicked.length) {
    const ms = inqPicked
      .map(x => Number(highestMap[x.subject] ?? NaN))
      .filter(v => !Number.isNaN(v) && v > 0);
    if (ms.length) {
      inquiryRepMaxForNorm = ms.reduce((s,x)=>s+x,0) / ms.length;
    }
  }

  const normOf = (name) => {
    const sc = Number(raw[name] || 0);
    let mx = getMax(name);
    if (name === '탐구' && inqMethod === 'highest_of_year' && inquiryRepMaxForNorm > 0) {
      mx = inquiryRepMaxForNorm;
    }
    return mx > 0 ? Math.max(0, Math.min(1, sc / mx)) : 0;
  };

  // 2) 학교 총점/수능비율 — ⭐ 총점은 DB값 우선
  const TOTAL        = resolveTotal(F);
  const suneungRatio = (Number(F.수능) || 0) / 100;
  log.push(`[학교] 총점=${TOTAL}, 수능비율=${suneungRatio} (DB총점 반영)`);

  // 3) 규칙 로딩
  const rules = rulesArray;

  // 3-1) select_ranked_weights의 선택가중 합 및 대상 과목 집합
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

  // 3-2) select_n 필터
  const selectNRules = rules.filter(r => r?.type === 'select_n' && Array.isArray(r.from) && r.count);
  const selectedBySelectN = new Set();
  if (selectNRules.length) {
    for (const r of selectNRules) {
      const cand = r.from
        .filter(name => !(englishAsBonus && name === '영어')) // 영어 가산점 모드면 후보에서 제외
        .map(name => ({ name, norm: normOf(name) }))
        .sort((a, b) => b.norm - a.norm);
      const picked = cand.slice(0, Math.min(Number(r.count) || 1, cand.length));
      picked.forEach(p => selectedBySelectN.add(p.name));
      log.push(`[select_n] from=[${r.from.join(', ')}], count=${r.count} -> 선택: ${picked.map(p => p.name).join(', ')}`);
    }
  }

  // 4) 기본비율 계산
  let baseRatioSum = 0;
  let baseNormWeighted = 0;
  const ratioOf = (name) => Number(F[name] || 0);

  // ⭐ 한국사를 기본비율 후보에 포함 (단, 과목반영일 때만)
  const candidatesBase = ['국어', '수학', '영어', '탐구', ...(historyAsSubject ? ['한국사'] : [])];

  for (const name of candidatesBase) {
    if (englishAsBonus && name === '영어') continue; // 가산점 모드면 과목반영에서 제외
    const ratio = ratioOf(name);
    if (ratio <= 0) continue;
    if (selectWeightSubjects.size && selectWeightSubjects.has(name)) continue;
    if (selectNRules.length && !selectedBySelectN.has(name)) continue;

    baseRatioSum += ratio;
    baseNormWeighted += normOf(name) * ratio;
  }

  let suneungBase = 0;
  if (baseRatioSum > 0 && TOTAL_base > 0) {
    const basePortion = (baseNormWeighted / baseRatioSum) * TOTAL_base;
    suneungBase = basePortion * suneungRatio;
    log.push(`[기본비율] 정규화평균=${(baseNormWeighted / baseRatioSum).toFixed(4)} × 남은총점(${TOTAL_base}) × 수능비율(${suneungRatio}) = ${suneungBase.toFixed(3)}`);
  } else {
    log.push(`[기본비율] 반영 과목 없음(또는 남은총점=0)`);
  }

  // 5) 선택가중(select_ranked_weights)
  let suneungSelect = 0;
  const usedForWeights = new Set();

  for (let i = 0; i < rules.length; i++) {
    const r = rules[i];
    if (!(r && r.type === 'select_ranked_weights' && Array.isArray(r.from) && Array.isArray(r.weights) && r.weights.length)) {
      continue;
    }

    const cand = r.from
      .filter(name => !(englishAsBonus && name === '영어')) // 영어 가산점 모드면 제외
      .filter(name => !usedForWeights.has(name))
      .map(name => ({ name, norm: normOf(name), raw: Number(raw[name] || 0) }))
      .sort((a, b) => b.norm - a.norm);

    const N = Math.min(cand.length, r.weights.length);
    const picked = cand.slice(0, N);
    picked.forEach(p => usedForWeights.add(p.name));

    const wSum = picked.reduce((acc, c, idx) => acc + (Number(r.weights[idx] || 0) * c.norm), 0);
    const add  = wSum * TOTAL * suneungRatio; // 기존 로직 유지
    suneungSelect += add;

    log.push(`[규칙${i+1}] select_ranked_weights from=[${r.from.join(', ')}] (weights=${r.weights.join(', ')})`);
    picked.forEach((c, idx) => log.push(
      `  - ${idx + 1}위 ${c.name}: raw=${c.raw}, norm=${c.norm.toFixed(4)}, weight=${r.weights[idx]}`
    ));
    log.push(`  -> 가중합=${wSum.toFixed(4)} × TOTAL(${TOTAL}) × 수능비율(${suneungRatio}) = ${add.toFixed(3)}`);
  }

  const suneungScore = suneungBase + suneungSelect;

  // 6) 한국사 가/감점 — 과목반영 중이면 보너스 제외
  let historyScore = 0;
  if (!historyAsSubject && F.history_scores && S.한국사?.grade != null) {
    const hg = String(S.한국사.grade);
    historyScore = Number(F.history_scores[hg] ?? 0);
    log.push(`[한국사] 등급 ${hg} → ${historyScore}점`);
  }

  // 6-1) 영어 가/감점(자동판단)
  let englishBonus = 0;

  // (A) 테이블에 english_bonus_scores가 있으면 그대로 반영
  if (F.english_bonus_scores && S.영어?.grade != null) {
    const eg = String(S.영어.grade);
    englishBonus += Number(F.english_bonus_scores[eg] ?? 0);
    log.push(`[영어 보정] 등급 ${eg} → ${Number(F.english_bonus_scores[eg] ?? 0)}점`);
  }

  // (B) 영어 가산점 모드 자동 판단 → english_scores(등급→점수)를 보너스로 사용
  if (englishAsBonus && S.영어?.grade != null && F.english_scores) {
    const eg = String(S.영어.grade);
    englishBonus += englishGradeBonus;
    log.push(`[영어 보정] (자동판단-가산점모드) 등급 ${eg} → ${englishGradeBonus}점`);
  }

  // (C) 고정 보정
  if (englishBonusFixed) {
    englishBonus += englishBonusFixed;
    log.push(`[영어 보정] 고정 보정 ${englishBonusFixed}점`);
  }

  // 7) 최종 합산
  const final = suneungScore + historyScore + englishBonus;
  log.push('========== 최종 ==========');
  log.push(`수능점수(기본+선택) = ${suneungScore.toFixed(3)} / 한국사 = ${historyScore} / 영어보정 = ${englishBonus}`);
  log.push(`총점 = ${final.toFixed(3)}`);

  return {
    totalScore: final.toFixed(3),
    breakdown: { base: suneungBase, select: suneungSelect, history: historyScore, english_bonus: englishBonus },
    calculationLog: log
  };
}

/* ========== 변환표준 적용 래퍼 ========== */
function calculateScoreWithConv(formulaDataRaw, studentScores, convMap, logHook, highestMap) {
  const cfg = safeParse(formulaDataRaw.score_config, {}) || {};
  const inqType = cfg?.inquiry?.type || '백분위';

  // 변환표준점수 타입이면, 탐구 각 과목에 converted_std 보충
  if (inqType === '변환표준점수' && Array.isArray(studentScores?.subjects)) {
    const cloned = JSON.parse(JSON.stringify(studentScores));
    cloned.subjects = (cloned.subjects || []).map(sub => {
      if (sub.name !== '탐구') return sub;
      if (sub.converted_std != null) return sub; // 이미 있으면 유지
      const group = sub.group || sub.type || guessInquiryGroup(sub.subject || '');
      const pct = Number(sub.percentile || 0);
      const conv = mapPercentileToConverted(convMap?.[group], pct);
      if (conv != null) {
        if (typeof logHook === 'function') {
          logHook(`[변환표준] ${group} 백분위 ${pct} → 변표 ${conv.toFixed(2)} (자동보충)`);
        }
        // 본 엔진은 표준/변표 공통으로 'std'를 읽어오니, std에도 반영
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
  // 점수 계산
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
      const formulaData = rows[0]; // 총점은 여기 F.총점으로 온다(없으면 계산기에서 1000 처리)

      // 탐구 변환표준 맵 로딩
      const [convRows] = await db.query(
        `SELECT 계열, 백분위, 변환표준점수 FROM \`정시탐구변환표준\` WHERE U_ID=? AND 학년도=?`,
        [U_ID, year]
      );
      const convMap = { '사탐': {}, '과탐': {} };
      convRows.forEach(r => { convMap[r.계열][String(r.백분위)] = Number(r.변환표준점수); });

      // highest_of_year가 필요하면 해당 모형 최고표점 로딩
      const cfg = safeParse(formulaData.score_config, {}) || {};
      const needYearMaxKorMath = (cfg?.korean_math?.max_score_method === 'highest_of_year');
      const needYearMaxInq     = (cfg?.inquiry?.max_score_method     === 'highest_of_year');
      const needYearMax = needYearMaxKorMath || needYearMaxInq;
      const exam = basis_exam || cfg?.highest_exam || '수능';

      let highestMap = null;
      if (needYearMax) {
        highestMap = await loadYearHighestMap(db, year, exam);
      }

      // 변표 로그 버퍼
      let logBuffer = [];
      const result = calculateScoreWithConv(
        formulaData,
        studentScores,
        convMap,
        (msg) => logBuffer.push(msg),
        highestMap
      );

      if (logBuffer.length && Array.isArray(result.calculationLog)) {
        // "계산 시작" 직후에 변표 로그 삽입
        const idx = result.calculationLog.findIndex(x => String(x).includes('========== 계산 시작 ==========')); // 보통 0
        result.calculationLog.splice((idx >= 0 ? idx + 1 : 1), 0, ...logBuffer);
      }

      return res.json({ success: true, message: `[${year}] U_ID ${U_ID} 점수 계산 성공`, result });
    } catch (err) {
      console.error('❌ 계산 처리 중 오류:', err);
      return res.status(500).json({ success: false, message: '계산 중 서버 오류' });
    }
  });

  // 정규화 기준 확인용
  router.post('/debug-normalize', authMiddleware, (req, res) => {
    const cfg = safeParse(req.body?.score_config, {});
    const eng = safeParse(req.body?.english_scores, null);
    // debug-normalize는 highestMap/S 미사용 간단 확인용
    const maxes = resolveMaxScores(cfg, eng, null, {});
    res.json({ success: true, maxes });
  });

  return router;
};

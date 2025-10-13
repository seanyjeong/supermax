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
    ctx.hist_grade_score = Number(F.history_scores[hg] || 0); // NaN 방지
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
  ctx.max_kor_math_std = Math.max(ctx.kor_std, ctx.math_std);
  ctx.max_kor_math_pct = Math.max(ctx.kor_pct, ctx.math_pct);

  return ctx;
}

/* ========= 변환표준 보조 ========= */
function mapPercentileToConverted(mapObj, pct) { /* ... 이전과 동일 ... */ }
function guessInquiryGroup(subjectName='') { /* ... 이전과 동일 ... */ }

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
  // ✅ [추가] 기타 설정 파싱
  const otherSettings      = safeParse(F.기타설정, {}) || {};

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
    const ctx = buildSpecialContext(F, S);
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

  let inquiryRepMaxForNorm = inqMax;
  if (inqMethod === 'highest_of_year' && highestMap && inqPicked.length) { /* ... */ }

  const normOf = (name) => {
    const sc = Number(raw[name] || 0);
    let mx = getMax(name);
    if (name === '탐구' && inqMethod === 'highest_of_year' && inquiryRepMaxForNorm > 0) {
      mx = inquiryRepMaxForNorm;
    }
    return mx > 0 ? Math.max(0, Math.min(1, sc / mx)) : 0;
  };

  const TOTAL        = resolveTotal(F);
  const suneungRatio = (Number(F.수능) || 0) / 100;
  log.push(`[학교] 총점=${TOTAL}, 수능비율=${suneungRatio} (DB총점 반영)`);

  const rules = rulesArray;
  const selectWeightSubjects = new Set();
  const selectWeightSum = rules.reduce((acc, r) => { /* ... */ return acc; }, 0);
  const SW = Math.min(1, Math.max(0, selectWeightSum));
  const TOTAL_select = TOTAL * SW;
  const TOTAL_base   = TOTAL * (1 - SW);

  const selectNRules = rules.filter(r => r?.type === 'select_n' && Array.isArray(r.from) && r.count);
  const selectedBySelectN = new Set();
  if (selectNRules.length) { /* ... */ }

  // ✅ [수정] suneungBase, suneungSelect 계산 로직을 '비율 적용 전'으로 변경
  // --------------------------------------------------------------------------
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

  // ⭐ 수능 비율을 곱하기 전의 '원본' 기본 점수
  const baseBeforeRatio = (baseRatioSum > 0 && TOTAL_base > 0)
    ? (baseNormWeighted / baseRatioSum) * TOTAL_base
    : 0;

  // ⭐ 수능 비율을 곱하기 전의 '원본' 선택 가중 점수
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
    
    // suneungRatio를 곱하지 않고 TOTAL까지만 곱해서 더함
    selectBeforeRatio += wSum * TOTAL; 
  }
  
  const rawSuneungTotal = baseBeforeRatio + selectBeforeRatio;
  log.push(`[수능원본점수] 기본=${baseBeforeRatio.toFixed(3)}, 선택=${selectBeforeRatio.toFixed(3)}, 합계=${rawSuneungTotal.toFixed(3)} (비율적용 전)`);
  // --------------------------------------------------------------------------

  // 6) 한국사 가/감점 — 과목반영 중이면 보너스 제외
  let historyScore = 0;
  if (!historyAsSubject && F.history_scores && S.한국사?.grade != null) {
    const hg = String(S.한국사.grade);
    historyScore = Number(F.history_scores[hg]) || 0; // NaN 방지
    log.push(`[한국사] 등급 ${hg} → ${historyScore}점`);
  }

  // 6-1) 영어 가/감점(자동판단)
  let englishBonus = 0;
  if (F.english_bonus_scores && S.영어?.grade != null) { /* ... */ }
  if (englishAsBonus && S.영어?.grade != null && F.english_scores) { /* ... */ }
  if (englishBonusFixed) { /* ... */ }

  // ✅ [수정] 최종 합산 로직 변경
  // --------------------------------------------------------------------------
  // 7) 최종 합산
  let finalSuneungScore = 0; // 최종 반영될 수능 점수

  // ⭐ 새로운 규칙! otherSettings 객체 (DB의 기타설정 컬럼)에 '한국사우선적용' 키가 있는지 확인
  if (otherSettings.한국사우선적용 === true) {
    // B타입: (수능 원본점수 + 한국사) * 수능비율
    log.push('[계산방식] 한국사 가산점 우선 적용');
    finalSuneungScore = (rawSuneungTotal + historyScore) * suneungRatio;
    historyScore = 0; // 뒤에서 이중으로 더해지지 않도록 0으로 만듦
  } else {
    // A타입(기존): (수능 원본점수 * 수능비율) + 한국사
    finalSuneungScore = rawSuneungTotal * suneungRatio;
  }

  const final = finalSuneungScore + historyScore + englishBonus;
  log.push('========== 최종 ==========');
  log.push(`수능점수(최종) = ${finalSuneungScore.toFixed(3)} / 한국사(후반영) = ${historyScore} / 영어보정 = ${englishBonus}`);
  log.push(`총점 = ${final.toFixed(3)}`);

  return {
    totalScore: final.toFixed(3),
    // breakdown도 비율 적용된 값으로 보여주는게 자연스러움
    breakdown: { base: baseBeforeRatio * suneungRatio, select: selectBeforeRatio * suneungRatio, history: historyScore, english_bonus: englishBonus },
    calculationLog: log
  };
  // --------------------------------------------------------------------------
}

/* ========== 변환표준 적용 래퍼 ========== */
function calculateScoreWithConv(formulaDataRaw, studentScores, convMap, logHook, highestMap) { /* ... 이전과 동일 ... */ }

/* ========== 최고표점 로딩 ========== */
async function loadYearHighestMap(db, year, exam) { /* ... 이전과 동일 ... */ }

/* ========== 라우터 ========== */
module.exports = function (db, authMiddleware) {
  // 점수 계산
  router.post('/calculate', authMiddleware, async (req, res) => {
    const { U_ID, year, studentScores, basis_exam } = req.body;
    if (!U_ID || !year || !studentScores) {
      return res.status(400).json({ success: false, message: 'U_ID, year, studentScores가 모두 필요합니다.' });
    }
    try {
      // ✅ [수정] SQL에 '기타설정' 컬럼이 포함되도록 해야 함 (jungsi.js에서 이미 반영했으므로 여기서는 확인만)
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

      // ... (나머지 로직은 이전과 동일) ...
      const [convRows] = await db.query( /* ... */ );
      const convMap = { '사탐': {}, '과탐': {} };
      convRows.forEach(r => { /* ... */ });
      
      const cfg = safeParse(formulaData.score_config, {}) || {};
      let highestMap = null;
      if (cfg?.korean_math?.max_score_method === 'highest_of_year' || cfg?.inquiry?.max_score_method === 'highest_of_year') {
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
        const idx = result.calculationLog.findIndex(x => String(x).includes('========== 계산 시작 =========='));
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
    const maxes = resolveMaxScores(cfg, eng, null, {});
    res.json({ success: true, maxes });
  });

  return router;
};

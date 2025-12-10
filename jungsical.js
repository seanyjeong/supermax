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

  // 반영비율(%) 그대로 넣고, 공식에서 ×5 하도록 설계
ctx.ratio_kor  = Number(F['국어'] || 0);
ctx.ratio_math = Number(F['수학'] || 0);
ctx.ratio_inq  = Number(F['탐구'] || 0);
//중앙대때매
    ctx.ratio_kor_norm  = ctx.ratio_kor  / 100; // 50 → 0.5
  ctx.ratio_math_norm = ctx.ratio_math / 100;
  ctx.ratio_inq_norm  = ctx.ratio_inq  / 100;
    ctx.ratio5_kor  = ctx.ratio_kor_norm  * 5;
  ctx.ratio5_math = ctx.ratio_math_norm * 5;
  ctx.ratio5_inq  = ctx.ratio_inq_norm  * 5;


  // 국/수 표준·백분위
  ctx.kor_std  = Number(S.국어?.std || 0);
  ctx.kor_pct  = Number(S.국어?.percentile || 0);
  ctx.math_std = Number(S.수학?.std || 0);
  ctx.math_pct = Number(S.수학?.percentile || 0);

  // 영어(등급 환산)
// 영어(등급 환산)
  ctx.eng_grade_score = 0;
  if (F.english_scores && S.영어?.grade != null) {
    const eg = String(S.영어.grade);
    ctx.eng_grade_score = Number(F.english_scores[eg] ?? 0);
    const vals = Object.values(F.english_scores).map(Number).filter(n => !Number.isNaN(n));
    const engMax = vals.length ? Math.max(...vals) : 100;
    
    ctx.eng_max = engMax; // ★★★ 이거 한 줄만 추가!!! ★★★
    
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
// (이하 탐구·top3 등 기존 내용 유지)
  const inqs = (S.탐구 || []);
  const sortedConv = inqs.map((t) => ({ conv: readConvertedStd(t), std: Number(t?.std || 0), pct: Number(t?.percentile || 0) }))
                         .sort((a,b)=>b.conv-a.conv);
  
  // ▼▼▼ [수정] 과목명(subject)을 포함시켜야 최고표점 맵에서 찾을 수 있습니다.
  const sortedStd  = inqs.map((t) => ({ subject: t?.subject || '', std: Number(t?.std || 0), pct: Number(t?.percentile || 0) }))
                         .sort((a,b)=>b.std-a.std);
  
  const sortedPct  = inqs.map((t) => ({ pct: Number(t?.percentile || 0) }))
                         .sort((a,b)=>b.pct-a.pct);
                         
  ctx.inq1_converted_std = sortedConv[0]?.conv || 0;
  ctx.inq2_converted_std = sortedConv[1]?.conv || 0;
  ctx.inq_sum2_converted_std = ctx.inq1_converted_std + ctx.inq2_converted_std;
  ctx.inq_avg2_converted_std = (ctx.inq_sum2_converted_std) / (sortedConv.length >= 2 ? 2 : (sortedConv.length || 1));
  
  ctx.inq1_std = sortedStd[0]?.std || 0;
  ctx.inq2_std = sortedStd[1]?.std || 0;

  
// ▼▼▼ [수정] 탐구 과목별 최고표점 로직 수정
  
  let inq1_max = 0;
  let inq2_max = 0;
  
  // [1순위] highestMap (표준점수) 기준으로 기본 설정
  if (highestMap) {
      const inq1_subject = sortedStd[0]?.subject;
      const inq2_subject = sortedStd[1]?.subject;
      inq1_max = Number(highestMap[inq1_subject] || 0);
      inq2_max = Number(highestMap[inq2_subject] || 0);
  }

// ▼▼▼ [신규 추가] 국(표), 수(표), 영(환), (탐구1표*2) 4개 중 상위 3개 합 ▼▼▼
  const items_std_kme_inq1_doubled = [
    Number(ctx.kor_std || 0),            // 1. 국어 (표점)
    Number(ctx.math_std || 0),          // 2. 수학 (표점)
    Number(ctx.eng_grade_score || 0),   // 3. 영어 (환산점수)
    (Number(ctx.inq1_std || 0) * 2.0)   // 4. 탐구 (상위 1과목 표점) * 2
  ].map(v => Math.max(0, v));
  
  items_std_kme_inq1_doubled.sort((a,b) => b - a); // 4개 점수를 정렬
  
  // 4개 중 상위 3개 합
  ctx.top3_sum_std_kme_inq1_doubled = (items_std_kme_inq1_doubled[0] || 0) + 
                                      (items_std_kme_inq1_doubled[1] || 0) + 
                                      (items_std_kme_inq1_doubled[2] || 0);
// ▲▲▲ [신규 추가] 끝 ▲▲▲

  // [2순위] 만약 '변환표준점수' 테이블(F.탐구변표)이 있다면,
  // '변표'의 최고점을 찾아 덮어쓴다.
  const convTable = F.탐구변표; // 라우터에서 설정해준 convMap
  
  if (convTable && (Object.keys(convTable['사탐']).length > 0 || Object.keys(convTable['과탐']).length > 0)) {
      
      const inq1_subject = sortedStd[0]?.subject;
      const inq2_subject = sortedStd[1]?.subject;
      
      // 학생이 선택한 과목의 계열(사탐/과탐)을 추측
      const inq1_group = guessInquiryGroup(inq1_subject || ''); 
      const inq2_group = guessInquiryGroup(inq2_subject || ''); 

      let maxConv_inq1 = 0;
      let maxConv_inq2 = 0;

      // 해당 계열의 변표 테이블에서 최고점을 찾는다
      if (convTable[inq1_group]) {
          const vals = Object.values(convTable[inq1_group]).map(Number).filter(n => !isNaN(n));
          if (vals.length > 0) maxConv_inq1 = Math.max(...vals);
      }
      
      // 학생이 2과목을 봤다면, 두 번째 과목도 동일하게 처리
      if (inq2_subject && convTable[inq2_group]) {
          const vals = Object.values(convTable[inq2_group]).map(Number).filter(n => !isNaN(n));
          if (vals.length > 0) maxConv_inq2 = Math.max(...vals);
      } else if (inq2_subject) {
          // 2과목을 봤는데 변표 테이블이 없는 경우 (예: 사탐+과탐 혼합 시)
          // 1과목 만점을 그대로 따라가거나, 0으로 둘 수 있음. 1과목 만점을 따라가도록 설정.
          maxConv_inq2 = maxConv_inq1; 
      } else {
          // 1과목만 반영하는 경우, 2번째 만점은 0으로 처리 (공식에서 {inq2_max_std} 안 쓰면 됨)
          maxConv_inq2 = 0; 
      }
      
      // ★ (중요) 학생이 본 과목이 2개인데 둘 다 '사탐'이면
      // maxConv_inq1, maxConv_inq2 둘 다 '사탐 최고변표'로 동일하게 설정됨.
      if (inq1_subject && inq2_subject && inq1_group === inq2_group) {
         maxConv_inq2 = maxConv_inq1;
      }


      // 변표 최고점을 찾았으면 (0보다 크면) 기존 표준점수 만점을 덮어쓴다.
      if (maxConv_inq1 > 0) inq1_max = maxConv_inq1;
      // 2과목 반영 시 (maxConv_inq2가 0보다 클 때만 덮어쓰기)
      if (maxConv_inq2 > 0) inq2_max = maxConv_inq2;
  }
  
  // 컨텍스트에 최종 할당
  ctx.inq1_max_std = inq1_max;
  ctx.inq2_max_std = inq2_max;
  
  // ▲▲▲ [수정 완료]
  
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
  
  // ▼▼▼ [수정] 'F.bonus_rules' (DB)에서 수학 가산점 정보 읽어오기
  const mathSubject = S.수학?.subject || '';
  let mathBonus = 1.0; // 기본값 (가산점 없음)
  
  // F.bonus_rules가 JSON 문자열일 수 있으므로 파싱
  const bonusRules = safeParse(F.bonus_rules, []); 
  
  if (Array.isArray(bonusRules)) {
      for (const rule of bonusRules) {
          // "percent_bonus" 타입이고, "subjects" 배열이 있고, "value"가 있는지 확인
          if (rule && rule.type === 'percent_bonus' && Array.isArray(rule.subjects) && rule.subjects.includes(mathSubject)) {
              
              // 학생이 선택한 과목(mathSubject)이 rule.subjects 배열에 포함되면
              // 가산점 '비율'(value, 예: 0.1)을 가져와서 1을 더함 (배율, 예: 1.1)
              mathBonus = 1.0 + (Number(rule.value) || 0);
              break; // 첫 번째 일치하는 규칙만 적용
          }
      }
  }

// ▼▼▼ [신규 추가] (국*국비율), (수*수비율), (영*영비율) 3개 환산점수 중 상위 2개 합 ▼▼▼
  // '영어' 비율은 DB에서 직접 읽어와야 함 (ctx에 ratio_eng_norm가 없음)
  const ratio_eng_norm_local = (Number(F['영어'] || 0) / 100.0);
  
  // 1. 각 영역별 환산점수 계산
  const scaled_kor = (ctx.kor_pct || 0) * (ctx.ratio_kor_norm || 0); //
  const scaled_math = (ctx.math_pct || 0) * (ctx.ratio_math_norm || 0); //
  // ⭐️⭐️⭐️ {eng_pct_est} 대신 원본 점수인 {eng_grade_score} 사용 ⭐️⭐️⭐️
  const scaled_eng = (ctx.eng_grade_score || 0) * ratio_eng_norm_local; //
  
  // 2. 3개 환산점수를 정렬
  const items_scaled_kme = [ scaled_kor, scaled_math, scaled_eng ];
  items_scaled_kme.sort((a,b) => b - a);
  
  // 3. 상위 2개 합을 새 변수에 저장
  ctx.top2_sum_scaled_kme = (items_scaled_kme[0] || 0) + (items_scaled_kme[1] || 0);
// ▲▲▲ [신규 추가] 끝 ▲▲▲

  // ▼▼▼ [신규 추가] 국, 수, 영(환산백) 3개 중 상위 2개 '평균' ▼▼▼
  const items_pct_kme_for_top2_avg = [
    Number(ctx.kor_pct || 0),            // 1. 국어
    Number(ctx.math_pct || 0),          // 2. 수학
    Number(ctx.eng_pct_est || 0)        // 3. 영어 (추정 백분위)
  ].map(v => Math.max(0, Math.min(100, v)));
  
  items_pct_kme_for_top2_avg.sort((a,b) => b - a); // 3개 점수를 정렬
  
  // 3개 중 상위 2개 '합계'
  const top2_sum = (items_pct_kme_for_top2_avg[0] || 0) + 
                   (items_pct_kme_for_top2_avg[1] || 0);

  // 상위 2개 '평균' (0~100점)
  ctx.top2_avg_pct_kme = top2_sum / 2.0;
// ▲▲▲ [신규 추가] 끝 ▲▲▲

  // ▼▼▼ [신규 추가] 국, 수, 영, 탐(평균) 4개 중 상위 3개 '평균' ▼▼▼
  const items_pct_kme_inqAvg_for_top3_avg = [
    Number(ctx.kor_pct || 0),            // 1. 국어
    Number(ctx.math_pct || 0),          // 2. 수학
    Number(ctx.inq_avg2_percentile || 0), // 3. 탐구 (2과목 평균)
    Number(ctx.eng_pct_est || 0)        // 4. 영어 (추정 백분위)
  ].map(v => Math.max(0, Math.min(100, v)));
  
  items_pct_kme_inqAvg_for_top3_avg.sort((a,b) => b - a); // 4개 점수를 정렬
  
  // 4개 중 상위 3개 합
  const top3_sum = (items_pct_kme_inqAvg_for_top3_avg[0] || 0) + 
                   (items_pct_kme_inqAvg_for_top3_avg[1] || 0) + 
                   (items_pct_kme_inqAvg_for_top3_avg[2] || 0);

  // 상위 3개 '평균' (0~100점)
  ctx.top3_avg_pct_kme_inqAvg = top3_sum / 3.0;
// ▲▲▲ [신규 추가] 끝 ▲▲▲

          // ▼▼▼ [요청 추가] 미적분/기하 선택 시 수학 백분위의 10% 보너스 변수 ▼▼▼
          // (mathSubject 변수는 이 함수 상단 282라인 근처에 이미 정의되어 있음)
          ctx.math_bonus_pct_10 = 0; // 기본값 0
          
          if (/미적분|기하/.test(mathSubject)) {
            ctx.math_bonus_pct_10 = (ctx.math_pct || 0) * 0.1;
          }
        // ▲▲▲ [요청 추가] 끝 ▲▲▲
   // ▼▼▼ [청주대용] 국, 수+미적분/기하가산점, 영, 탐(평균) 4개 중 상위 3개 '평균' ▼▼▼
    const items_pct_kme_inqAvg_with_mathBonus = [
      Number(ctx.kor_pct || 0),                                    // 1. 국어
      Number(ctx.math_pct || 0) + Number(ctx.math_bonus_pct_10 || 0), // 2. 수학 + 미적분/기하
      Number(ctx.inq_avg2_percentile || 0),                        // 3. 탐구 (2과목 평균)
      Number(ctx.eng_grade_score || 0)                             // 4. 영어 (등급 환산점수)
    ];

    items_pct_kme_inqAvg_with_mathBonus.sort((a,b) => b - a);

    const top3_sum_with_mathBonus = (items_pct_kme_inqAvg_with_mathBonus[0] || 0) +
                                    (items_pct_kme_inqAvg_with_mathBonus[1] || 0) +
                                    (items_pct_kme_inqAvg_with_mathBonus[2] || 0);

    ctx.top3_avg_pct_kme_inqAvg_mathBonus = top3_sum_with_mathBonus / 3.0;
    // ▲▲▲ [청주대용] 끝 ▲▲▲
  
  // ▼▼▼ [신규 추가] 수학/영어(환산백분위) 중 상위 1개 (택1) ▼▼▼
  ctx.top1_math_or_eng_pct = Math.max(
    Number(ctx.math_pct || 0),      // 1. 수학 백분위
    Number(ctx.eng_pct_est || 0)    // 2. 영어 환산 백분위 (이미 계산되어 있음)
  );
// ▲▲▲ [신규 추가] 끝 ▲▲▲
  // 1. 표준점수(표점) 가산점 적용
  const math_std_bonused = ctx.math_std * mathBonus;
  ctx.math_std_bonused = math_std_bonused; // (혹시 모르니 변수로 빼둠)
  ctx.max_kor_math_std = Math.max(ctx.kor_std, math_std_bonused);

  // 2. 백분위 가산점 적용
  let math_pct_bonused = ctx.math_pct * mathBonus; 
  
  // (참고) 백분위 100점 상한선(cap)은 score_config에 설정할 수 있음
  // (이건 UI에 없지만, 로직은 넣어두는 게 안전함)
  if (F.score_config?.math_bonus_cap_100 === true) {
       math_pct_bonused = Math.min(100, math_pct_bonused);
  }
// ▼▼▼ [신규 추가] 국, 수, 영, 탐(평균) 4개 중 상위 2개 '각각 60점 환산' 후 합계 (120점 만점) ▼▼▼
  const items_pct_kme_inqAvg_for_120 = [
    Number(ctx.kor_pct || 0),            // 1. 국어
    Number(ctx.math_pct || 0),          // 2. 수학
    Number(ctx.inq_avg2_percentile || 0), // 3. 탐구 (2과목 평균)
    Number(ctx.eng_pct_est || 0)        // 4. 영어 (추정 백분위)
  ].map(v => Math.max(0, Math.min(100, v)));
  
  items_pct_kme_inqAvg_for_120.sort((a,b) => b - a); // 4개 점수를 정렬
  
  // 상위 2개를 '각각 0.6배' (60점 만점) 해서 더함 (총 120점 만점)
  const top1_scaled = (items_pct_kme_inqAvg_for_120[0] || 0) * 0.6;
  const top2_scaled = (items_pct_kme_inqAvg_for_120[1] || 0) * 0.6;
  
  ctx.top2_sum_scaled60_kme_inqAvg = top1_scaled + top2_scaled;
// ▲▲▲ [신규 추가] 끝 ▲▲▲
  ctx.math_pct_bonused = math_pct_bonused; // (혹시 모르니 변수로 빼둠)
  ctx.max_kor_math_pct = Math.max(ctx.kor_pct, math_pct_bonused);
  // ▲▲▲ [수정 완료]

  // ▼▼▼ [신규 추가] 국, 수, 탐(평균) 3개 중 상위 2개 (각 40%) * 6 및 * 7 버전 ▼▼▼
  const items_pct_kmi_for_top2_both = [
    Number(ctx.kor_pct || 0),            // 1. 국어
    Number(ctx.math_pct || 0),          // 2. 수학
    Number(ctx.inq_avg2_percentile || 0)  // 3. 탐구 (2과목 평균)
  ].map(v => Math.max(0, Math.min(100, v)));
  
  items_pct_kmi_for_top2_both.sort((a,b) => b - a); // 3개 점수를 정렬
  
  // 상위 2개를 '각각 40%' (0.4) 해서 더함 (80점 만점)
  const top1_val_40pct = (items_pct_kmi_for_top2_both[0] || 0) * 0.4;
  const top2_val_40pct = (items_pct_kmi_for_top2_both[1] || 0) * 0.4;
  const sum_80pct = top1_val_40pct + top2_val_40pct;

  // 1. 곱하기 6 버전 (만점: 80 * 6 = 480점)
  ctx.top2_kmInq_scaled_80_x_6 = sum_80pct * 6;

  // 2. 곱하기 7 버전 (만점: 80 * 7 = 560점)
  ctx.top2_kmInq_scaled_80_x_7 = sum_80pct * 7;
// ▲▲▲ [신규 추가] 끝 ▲▲▲
// ... (기존 ctx.max_kor_math_pct = ... 계산 끝난 후)



        
   const items_pct = [
    Number(ctx.kor_pct || 0),
    Number(ctx.math_pct || 0),
    Number(ctx.inq1_percentile || 0),
    Number(ctx.inq2_percentile || 0),
  ].map(v => Math.max(0, Math.min(100, v)));

  items_pct.sort((a,b) => b - a);
  // 상위 2개 비율 합 = (p1/100) + (p2/100)
  ctx.top2_sum_norm_pct_kmi2 = ((items_pct[0] || 0) + (items_pct[1] || 0)) / 100;

  // (옵션) 원하면 백분위 “생 점수” 상위2 합(0~200)도 노출
  ctx.top2_sum_raw_pct_kmi2  = (items_pct[0] || 0) + (items_pct[1] || 0);

  
  // 탐구 상위 2개 과목의 '사탐' 여부 판정 → 과목별 5% 가산(=1.05)
(function attachSocialBoost() {
  const inqs = (S.탐구 || []);
  // 과목/그룹 식별 가능한 튜플로 만들고 변환표준점수 기준으로 정렬
  const tuples = inqs.map(t => ({
    subject: t.subject || '',
    group: t.group || t.type || guessInquiryGroup(t.subject || ''),
    conv: readConvertedStd(t)
  })).sort((a,b) => b.conv - a.conv);

  const inq1 = tuples[0];
  const inq2 = tuples[1];

  // 사탐이면 1.05, 아니면 1.0
  ctx.inq1_social_boost = (inq1 && inq1.group === '사탐') ? 1.05 : 1.0;
  ctx.inq2_social_boost = (inq2 && inq2.group === '사탐') ? 1.05 : 1.0;
})();



const kme_scores_for_top2 = [ctx.kor_pct, ctx.math_pct, ctx.eng_grade_score].sort((a, b) => b - a);
ctx.top2_sum_raw_pct_kme = (kme_scores_for_top2[0] || 0) + (kme_scores_for_top2[1] || 0);






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
  //선문대대
  if (F.U_ID === 148 || F.U_ID === 149) {
    log.push(`<< U_ID ${F.U_ID}번 대학 하드코딩 로직 실행 >>`);

    // 1. 등급 -> 점수 변환표 (국/수/영/탐 공통)
    const gradeToScoreMap = {
        1: 100, 2: 93, 3: 86, 4: 79, 5: 72, 6: 65, 7: 58, 8: 51, 9: 44
    };
    const defaultScore = 0; // 등급 없거나 맵에 없으면 0점 처리

    // 2. 각 영역 등급 가져오기 (없으면 9등급)
    const korGrade = S.국어?.grade || 9;
    const mathGrade = S.수학?.grade || 9;
    const engGrade = S.영어?.grade || 9;

    // 3. 탐구 처리: 더 잘 본 1과목 등급 찾기
    let bestInqGrade = 9; // 기본값 9등급
    if (S.탐구 && S.탐구.length > 0) {
        // 등급만 추출해서 오름차순 정렬 (1등급이 가장 좋음)
        const inquiryGrades = S.탐구.map(t => t.grade || 9).sort((a, b) => a - b);
        bestInqGrade = inquiryGrades[0]; // 가장 좋은 등급 (첫 번째 요소)
    }

    // 4. 각 영역 점수로 변환
    const korScore = gradeToScoreMap[korGrade] || defaultScore;
    const mathScore = gradeToScoreMap[mathGrade] || defaultScore;
    const engScore = gradeToScoreMap[engGrade] || defaultScore;
    const inqScore = gradeToScoreMap[bestInqGrade] || defaultScore; // 잘 본 탐구 1과목 점수

    log.push(` -> 국:${korGrade}등급(${korScore}점), 수:${mathGrade}등급(${mathScore}점), 영:${engGrade}등급(${engScore}점), 탐(Best):${bestInqGrade}등급(${inqScore}점)`);

    // 5. 상위 2개 영역 점수 선택 및 합산
    const scoresToSelect = [korScore, mathScore, engScore, inqScore];
    scoresToSelect.sort((a, b) => b - a); // 내림차순 정렬
    const top2Sum = scoresToSelect[0] + scoresToSelect[1]; // 상위 2개 합산
    log.push(` -> 상위 2개 영역 합: ${scoresToSelect[0]} + ${scoresToSelect[1]} = ${top2Sum}점`);

    // 6. 한국사 점수 계산 (DB의 history_scores 사용)
    let histScore = 0;
    const histGrade = S.한국사?.grade;
    if (histGrade && F.history_scores) {
        histScore = Number(F.history_scores[String(histGrade)] || 0);
        log.push(` -> 한국사: ${histGrade}등급 → ${histScore}점 (가산)`);
    } else {
        log.push(` -> 한국사: 등급 정보 없거나 환산표 없음 → 0점`);
    }

    // 7. 최종 점수 계산 (상위 2개 합 + 한국사)
    const finalScore = top2Sum + histScore;
    log.push(` -> 최종 점수(200점 만점 + 한국사): ${top2Sum} + ${histScore} = ${finalScore.toFixed(2)}점`);
    log.push('========== 최종 ==========');

    // 8. 결과 반환
    return {
        totalScore: finalScore.toFixed(2),
        breakdown: { top2: top2Sum, history: histScore }, // 세부 점수
        calculationLog: log
    };
  }

//경동대 스마
  if (F.U_ID === 76) { // ⭐️⭐️⭐️ 이 대학의 실제 U_ID로 바꿔야 함 ⭐️⭐️⭐️
        log.push(`<< U_ID ${F.U_ID}번 대학 (등급 평균) 하드코딩 로직 실행 >>`);

        // 1. 득점표 (Lookup Table)
        const scoreTable = {
            1: 700.0, 2: 692.0, 3: 684.0, 4: 676.0,
            5: 668.0, 6: 660.0, 7: 652.0, 8: 644.0, 9: 630.0
        };

        // 2. 4개 영역 등급 가져오기 (없으면 9등급 처리)
        const korGrade = S.국어?.grade || 9;
        const mathGrade = S.수학?.grade || 9;
        const engGrade = S.영어?.grade || 9;
        
        // 탐구는 상위 1개 등급
        let bestInqGrade = 9;
        if (S.탐구 && S.탐구.length > 0) {
            const inqGrades = S.탐구.map(t => t.grade || 9).sort((a, b) => a - b);
            bestInqGrade = inqGrades[0]; // 1등급이 제일 좋음
        }

        log.push(` -> 등급: 국(${korGrade}) + 수(${mathGrade}) + 영(${engGrade}) + 탐1(${bestInqGrade})`);

        // 3. 등급 합산 및 평균 계산
        const gradeSum = korGrade + mathGrade + engGrade + bestInqGrade;
        const gradeAvg = gradeSum / 4.0;
        log.push(` -> 합계: ${gradeSum} / 평균: ${gradeAvg.toFixed(2)}`);

        // 4. 평균 등급을 '대학 자체 등급'으로 변환 (소수점 버림)
        // (규칙 예시: 1.00~1.99 -> 1등급 / 4.00~4.99 -> 4등급)
        let uniGrade = Math.floor(gradeAvg);
        if (gradeAvg < 1.0) uniGrade = 1; // 1 미만이면 1등급
        if (gradeAvg >= 9.0) uniGrade = 9; // 9 이상이면 9등급 (규칙표에 9등급만 있음)
        
        // 1~9 사이로 보정
        uniGrade = Math.max(1, Math.min(9, uniGrade));

        log.push(` -> 대학 자체 등급으로 변환: ${uniGrade}등급`);

        // 5. 득점표에서 최종 점수 매핑
        const finalScore = scoreTable[uniGrade] || 630.0; // 맵에 없으면 9등급 점수(630)
        log.push(` -> 최종 특점: ${finalScore.toFixed(1)}점`);
        log.push('========== 최종 ==========');

        return {
            totalScore: finalScore.toFixed(1),
            breakdown: { special: finalScore },
            calculationLog: log
        };
    }

  if (F.계산유형 === '특수공식' && F.특수공식) {
    log.push('<< 특수공식 모드 >>');
    const ctx = buildSpecialContext(F, S, highestMap); // 최고표점 맵 전달

    log.push(`[특수공식 원본] ${F.특수공식}`);
    const specialValue = evaluateSpecialFormula(F.특수공식, ctx, log);
    const final = Number(specialValue) || 0;
    log.push('========== 최종 ==========');
    log.push(`특수공식 결과 = ${final.toFixed(2)}`);
    return {
      totalScore: final.toFixed(2),
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
// ★★★ 탐구 highest_of_year 계산 방식 변경: 점수/각 과목 최고점 → 비율 평균
// ★★★ 탐구 highest_of_year 계산 방식 변경 + 한국사 100점 만점 처리 ★★★
const normOf = (name) => {

    // --- ⭐️ [추가] 한국사 과목 반영 시 100점 만점 처리 ⭐️ ---
    if (name === '한국사' && historyAsSubject) {
        const sc = Number(raw[name] || 0); // 학생 한국사 환산 점수 (예: 90)
        log.push(`[정규화 조정] 한국사(과목 반영) 점수 ${sc}를 100점 만점 기준으로 정규화`);
        // 무조건 100으로 나눔
        return 100 > 0 ? Math.max(0, Math.min(1, sc / 100)) : 0;
    }
    // --- ⭐️ [추가] 끝 ⭐️ ---


    // [기존 탐구] 'highest_of_year' (표준/변표)
    if (name === '탐구' && inqMethod === 'highest_of_year') {
        // 1. S.탐구 (모든 탐구 과목)를 가져와 각각 정규화 점수를 계산
        const allInquiryNormalized = S.탐구.map(sub => {
            const subject = sub.subject || '';
            let val = 0; let top = 0; let normalized = 0;
            if (inqType === '변환표준점수') {
                // (A) 변표 로직
                if (!F.탐구변표) return null;
                const group = sub.group || sub.type || guessInquiryGroup(subject);
                const convTableForGroup = F.탐구변표[group];
                if (!convTableForGroup || Object.keys(convTableForGroup).length === 0) return null;
                const maxConvScore = Math.max(...Object.values(convTableForGroup).map(Number).filter(n => !isNaN(n)));
                val = readConvertedStd(sub); top = maxConvScore;
            } else if (inqType === '표준점수') {
                // (B) 표준점수 로직
                if (!highestMap) return null;
                val = Number(sub.std || 0); top = Number(highestMap[subject] ?? NaN);
            } else { return null; } // (C) 백분위 등 highest_of_year 미지원
            if (!Number.isFinite(top) || top <= 0 || !Number.isFinite(val)) return null;
            normalized = Math.max(0, Math.min(1, val / top));
            return { subject, val, top, normalized };
        }).filter(r => r != null);

        // 2. 정규화 점수 기준 정렬
        allInquiryNormalized.sort((a, b) => b.normalized - a.normalized);
        // 3. 상위 N개 선택
        const n = Math.max(1, inquiryCount || 1);
        const pickedNormalized = allInquiryNormalized.slice(0, Math.min(n, allInquiryNormalized.length));
        // 4. 평균 계산 및 반환
        if (pickedNormalized.length) {
            const avg = pickedNormalized.reduce((s, r) => s + r.normalized, 0) / pickedNormalized.length;
            log.push(`[탐구정규화-정렬] highest_of_year (Top${n}): ${pickedNormalized.map(p => `${p.subject}:${p.normalized.toFixed(4)} [${p.val}/${p.top}]`).join(', ')} → 평균비율=${avg.toFixed(4)}`);
            return avg;
        }
        log.push(`[탐구정규화-정렬] FAILED.`); return 0; // 계산 실패
    }

    // [나머지 모든 경우] (한국사 가/감점 포함, 탐구 highest_of_year 아닐 때 등)
    // 원래 정의된 만점(mx) 기준으로 정규화
    const sc = Number(raw[name] || 0);
    const mx = getMax(name); // getMax 함수는 그대로 사용
    return mx > 0 ? Math.max(0, Math.min(1, sc / mx)) : 0;
};
// ★★★ 수정 끝 ★★★

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
  log.push(`[수능원본점수] 기본=${baseBeforeRatio.toFixed(2)}, 선택=${selectBeforeRatio.toFixed(2)}, 합계=${rawSuneungTotal.toFixed(2)} (비율적용 전)`);

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
  log.push(`수능점수(최종) = ${finalSuneungScore.toFixed(2)} / 한국사(후반영) = ${historyScore} / 영어보정 = ${englishBonus}`);
  log.push(`총점 = ${final.toFixed(2)}`);

  return {
    totalScore: final.toFixed(2),
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
// -----------------------------------------------------------------
  // ⭐️ [신규 API 1] 대학/학과 목록 (calculator.html용) - v2 (군 정보 추가)
  // -----------------------------------------------------------------
  router.get('/university-list', authMiddleware, async (req, res) => {
    const { year } = req.query;
    if (!year) {
      return res.status(400).json({ success: false, message: 'year가 필요합니다.' });
    }
    try {
      // ⭐️ (수정) '군' 컬럼 추가
      const [rows] = await db.query(
        'SELECT U_ID, 대학명, 학과명, 군 FROM `정시기본` WHERE 학년도 = ? ORDER BY 군, 대학명, 학과명',
        [year]
      );
      
      // ⭐️ (수정) 프론트엔드로 'gun' 정보 전달
      const list = rows.map(r => ({
          U_ID: r.U_ID,
          university: r.대학명, 
          department: r.학과명,
          gun: r.군 // ⭐️ '군' 정보 추가 (예: "가군", "나군")
      }));
      
      res.json({ success: true, list: list });

    } catch (err) {
      console.error('❌ 대학 목록 로딩 중 오류:', err);
      return res.status(500).json({ success: false, message: '대학 목록 로딩 중 서버 오류' });
    }
  });
  // -----------------------------------------------------------------
  // ⭐️ [신규 API 2] 학과 상세 요강 (calculator.html용)
  // -----------------------------------------------------------------
 router.get('/formula-details', authMiddleware, async (req, res) => {
    const { U_ID, year } = req.query;
    if (!U_ID || !year) {
        return res.status(400).json({ success: false, message: 'U_ID, year가 모두 필요합니다.' });
    }
    try {
        // 1. 수능/내신 반영 비율 + 기본 정보 (⭐️ SELECT 목록 수정)
        const sql = `
            SELECT
                b.U_ID, b.학년도, b.군, b.형태, b.광역, b.시구, b.입학처, b.대학명, b.학과명,
                b.\`모집정원\`,  -- ⭐️⭐️⭐️ 명시적으로 선택 (백틱 사용 주의!) ⭐️⭐️⭐️
                b.교직, b.단계별,
                r.* -- 반영비율 테이블의 모든 컬럼
            FROM \`정시기본\` AS b
            JOIN \`정시반영비율\` AS r
            ON b.U_ID = r.U_ID AND b.학년도 = r.학년도
            WHERE b.U_ID = ? AND b.학년도 = ?
        `;
        const [formulaRows] = await db.query(sql, [U_ID, year]);
        if (!formulaRows || formulaRows.length === 0) {
            return res.status(404).json({ success: false, message: '해당 학과/학년도 기본 정보를 찾을 수 없습니다.' });
        }
        const formulaData = formulaRows[0];

        // 2. 실기 배점표 (선택)
        try {
            const [silgiRows] = await db.query(
                'SELECT * FROM `정시실기배점` WHERE U_ID = ? AND 학년도 = ?',
                [U_ID, year]
            );
            formulaData.실기배점 = silgiRows || [];
        } catch (silgiErr) {
            if (silgiErr.code === 'ER_NO_SUCH_TABLE') {
                console.warn(`[경고] '정시실기배점' 테이블이 DB에 없습니다.`);
                formulaData.실기배점 = [];
            } else { throw silgiErr; }
        }

        // 3. 내신 배점표 (선택)
        try {
            const [naeshinRows] = await db.query(
                'SELECT * FROM `정시내신배점` WHERE U_ID = ? AND 학년도 = ?',
                [U_ID, year]
            );
            formulaData.내신배점 = naeshinRows || [];
        } catch (naeshinErr) {
            if (naeshinErr.code === 'ER_NO_SUCH_TABLE') {
                console.warn(`[경고] '정시내신배점' 테이블이 DB에 없습니다.`);
                formulaData.내신배점 = [];
            } else { throw naeshinErr; }
        }

        // *** 로그 추가 (백엔드) ***: 보내기 직전 데이터 확인
        console.log(`[API /formula-details] Sending formula data for U_ID ${U_ID} (Year ${year}):`, formulaData);

        return res.json({ success: true, formula: formulaData });

    } catch (err) {
        console.error('❌ 학과 상세 요강 로딩 중 치명적 오류:', err);
        return res.status(500).json({ success: false, message: `학과 요강 로딩 중 서버 오류: ${err.message}` });
    }
});
  
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

      formulaData.탐구변표 = convMap; // 이 한 줄을 추가!
      
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

module.exports.helpers = {
  calculateScoreWithConv, // 핵심 계산 함수
  calculateScore,         // calculateScoreWithConv가 내부적으로 사용
  safeParse,              // 유틸리티 함수
  // loadYearHighestMap,     // jungsi.js 에서만 필요하므로 여기서 빼도 됨 (선택)
  // guessInquiryGroup,      // jungsi.js 에서만 필요하므로 여기서 빼도 됨 (선택)
  buildSpecialContext,      // 특수 공식 계산 시 필요
  // calculateScoreWithConv가 의존하는 jungsical.js 내부 함수들 추가
  pickByType,
  kmSubjectNameForKorean,
  kmSubjectNameForMath,
  inquirySubjectName,
  resolveTotal,
  detectEnglishAsBonus,
  isSubjectUsedInRules,
  calcInquiryRepresentative,
  resolveMaxScores,
  evaluateSpecialFormula,
  readConvertedStd,
  mapPercentileToConverted,
  guessInquiryGroup, // calculateScore 내부에서도 쓰일 수 있으니 포함
};

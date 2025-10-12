function calculateScore(formulaDataRaw, studentScores) {
  const log = [];
  const safeParse = (v, fb=null) => (v==null||typeof v==='object') ? (v||fb) : (()=>{try{return JSON.parse(v);}catch{return fb;}})();

  // 0) JSON 컬럼 파싱
  const formulaData = { ...formulaDataRaw };
  formulaData.selection_rules = safeParse(formulaDataRaw.selection_rules, null);
  formulaData.score_config    = safeParse(formulaDataRaw.score_config,   {}) || {};
  formulaData.english_scores  = safeParse(formulaDataRaw.english_scores, null);
  formulaData.history_scores  = safeParse(formulaDataRaw.history_scores, null);

  // 1) 학생 점수 수집
  const subjects = studentScores.subjects || [];
  const S = {
    국어   : subjects.find(s=>s.name==='국어')   || {},
    수학   : subjects.find(s=>s.name==='수학')   || {},
    영어   : subjects.find(s=>s.name==='영어')   || {},
    한국사 : subjects.find(s=>s.name==='한국사') || {},
    탐구   : subjects.filter(s=>s.name==='탐구')
  };

  const cfg = formulaData.score_config || {};
  const kmType  = cfg.korean_math?.type || '백분위';
  const inqType = cfg.inquiry?.type     || '백분위';

  // 1-1) 과목별 '원점수' (영어는 환산표, 탐구는 대표값 규칙)
  const pickByType = (obj, type) => (type==='표준점수'||type==='변환표준점수') ? (obj.std||0) : (obj.percentile||0);

  // 탐구 개별 점수 배열 (정렬용)
  const inqKey = (inqType==='표준점수'||inqType==='변환표준점수') ? 'std' : 'percentile';
  const inqArr = (S.탐구||[]).map((t,i)=>({idx:i, val: Number(t[inqKey]||0)})).sort((a,b)=>b.val-a.val);

  // 탐구수 규칙 적용: 대표점수
  const inqCount = Math.max(1, parseInt(formulaData.탐구수||'1',10));
  let inqRep = 0;
  if (inqArr.length>0) {
    if (inqCount===1) {
      inqRep = inqArr[0].val;                       // 맥스
    } else {
      const sel = inqArr.slice(0, Math.min(inqCount, inqArr.length));
      inqRep = sel.reduce((s,x)=>s+x.val,0) / sel.length; // 평균
    }
  }

  // 영어 환산
  let engConv = 0, engMax = 0;
  if (formulaData.english_scores && S.영어?.grade != null) {
    const g = String(S.영어.grade);
    engConv = Number(formulaData.english_scores[g] ?? 0);
    engMax  = Math.max(...Object.values(formulaData.english_scores).map(Number).filter(n=>!isNaN(n)), 0);
  }

  const raw = {
    국어:  pickByType(S.국어, kmType),
    수학:  pickByType(S.수학, kmType),
    영어:  engConv,
    한국사: S.한국사?.grade ?? 9,
    탐구:  inqRep
  };

  log.push(`[원점수] 국:${raw.국어} 수:${raw.수학} 영(환산):${raw.영어} 탐(대표):${raw.탐구}`);

  // 1-2) 과목별 만점(정규화 기준)
  const kmMax = (cfg.korean_math?.max_score_method === 'fixed_200') ? 200 : 200; // 기본 200
  const inqMax = (cfg.inquiry?.max_score_method === 'fixed_100') ? 100 : 100;   // 기본 100
  const korMax = kmMax;
  const mathMax = kmMax;
  const engMaxSafe = engMax || 100; // 없으면 100 가정

  const getMax = (name) => {
    if (name==='국어') return korMax;
    if (name==='수학') return mathMax;
    if (name==='영어') return engMaxSafe;
    if (name==='탐구') return inqMax;
    return 100;
  };

  // 2) 총점/수능비율
  const TOTAL = Number(formulaData.총점 || 1000);
  const suneungRatio = (Number(formulaData.수능) || 0) / 100;
  log.push(`[학교] 총점:${TOTAL}, 수능비율:${suneungRatio}`);

  // 3) 선택 규칙 준비
  const rules = (Array.isArray(formulaData.selection_rules) ? formulaData.selection_rules : (formulaData.selection_rules ? [formulaData.selection_rules] : []));
  const ruledSubjectSet = new Set(); // select_ranked_weights에 등장한 과목들(중복 계산 방지)

  // 3-1) 기본 비율(명시된 과목만) 계산 — 단, 선택 규칙 후보 과목은 제외
  let baseSum = 0, baseRatioSum = 0;
  const baseCandidates = ['국어','수학','영어','탐구'];
  // 선택 규칙에 등장한 과목 수집
  for (const r of rules) {
    if (r?.type === 'select_ranked_weights' && Array.isArray(r.from)) {
      r.from.forEach(n => ruledSubjectSet.add(n));
    }
  }
  for (const name of baseCandidates) {
    const ratio = Number(formulaData[name] || 0);
    if (ratio > 0 && !ruledSubjectSet.has(name)) {
      baseSum += Number(raw[name]||0) * (ratio/100);
      baseRatioSum += ratio;
    }
  }
  let suneungBase = 0;
  if (baseRatioSum > 0) {
    suneungBase = (baseSum * (TOTAL / baseRatioSum)) * suneungRatio;
    log.push(`[기본비율] 합:${baseSum.toFixed(3)} × (${TOTAL}/${baseRatioSum}) × ${suneungRatio} = ${suneungBase.toFixed(3)}`);
  }

  // 3-2) select_ranked_weights 처리 (가중치는 총점에 대한 비율)
  let suneungSelect = 0;
  for (const [i, r] of rules.entries()) {
    if (!r || r.type!=='select_ranked_weights' || !Array.isArray(r.from) || !Array.isArray(r.weights) || r.weights.length===0) continue;

    // 후보 점수 구성: 탐구는 '대표점수', 영어는 환산, 나머지는 타입별
    const cand = r.from.map(name => {
      const sc = Number(raw[name] || 0);
      const mx = getMax(name);
      const norm = mx>0 ? Math.max(0, Math.min(1, sc / mx)) : 0; // 0~1
      return { name, score: sc, max: mx, norm };
    }).sort((a,b)=>b.score - a.score);

    // 상위 N개(N = weights 길이) 선발 후 가중치*정규화 합
    const N = Math.min(r.weights.length, cand.length);
    const picked = cand.slice(0, N);
    const wSum = picked.reduce((acc, c, idx) => acc + (Number(r.weights[idx]||0) * c.norm), 0);
    const add = wSum * TOTAL * suneungRatio;

    // 로그
    log.push(`[규칙${i+1}] select_ranked_weights from=[${r.from.join(',')}]`);
    picked.forEach((c, idx)=>log.push(`  - ${idx+1}위 ${c.name}: raw=${c.score}, max=${c.max}, norm=${c.norm.toFixed(4)}, weight=${r.weights[idx]}`));
    log.push(`  -> 가중합=${wSum.toFixed(4)} × TOTAL(${TOTAL}) × 수능비율(${suneungRatio}) = ${add.toFixed(3)}`);

    suneungSelect += add;
  }

  const suneungScore = suneungBase + suneungSelect;

  // 4) 한국사 가/감점
  let hist = 0;
  if (formulaData.history_scores && S.한국사?.grade != null) {
    const g = String(S.한국사.grade);
    hist = Number(formulaData.history_scores[g] ?? 0);
    log.push(`[한국사] 등급 ${g} → ${hist}점`);
  }

  // 5) 최종
  const final = suneungScore + hist;
  log.push(`===== 최종 =====`);
  log.push(`수능점수(기본+선택) = ${suneungScore.toFixed(3)}  /  한국사 = ${hist}`);
  log.push(`총점 = ${final.toFixed(3)}`);

  return {
    totalScore: final.toFixed(3),
    breakdown: { base: suneungBase, select: suneungSelect, history: hist },
    calculationLog: log
  };
}

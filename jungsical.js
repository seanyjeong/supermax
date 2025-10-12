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

// 탐구 대표값 계산: 1개면 최대값, 2개면 평균(2초과는 상위 N 평균)
function calcInquiryRepresentative(inquiryRows, type, inquiryCount) {
  const key = (type === '표준점수' || type === '변환표준점수') ? 'std' : 'percentile';
  const arr = (inquiryRows || [])
    .map((t, i) => ({ idx: i, val: Number(t?.[key] || 0) }))
    .sort((a, b) => b.val - a.val);

  if (arr.length === 0) return { rep: 0, sorted: arr };
  const n = Math.max(1, inquiryCount || 1);
  if (n === 1) return { rep: arr[0].val, sorted: arr };

  const sel = arr.slice(0, Math.min(n, arr.length));
  const avg = sel.reduce((s, x) => s + x.val, 0) / sel.length;
  return { rep: avg, sorted: arr };
}

// 과목 만점(정규화 기준) 산출
function resolveMaxScores(scoreConfig, englishScores) {
  const kmType  = scoreConfig?.korean_math?.type || '백분위';
  const inqType = scoreConfig?.inquiry?.type     || '백분위';
  const kmMethod = scoreConfig?.korean_math?.max_score_method || '';
  const inqMethod = scoreConfig?.inquiry?.max_score_method     || '';

  // 국어·수학: 표준점수면 200, 백분위면 100
  const korMax  = (kmType === '표준점수' || kmMethod === 'fixed_200') ? 200 : 100;
  const mathMax = korMax;

  // 탐구: 표준/변환표준이면 100, 백분위면 100 (일반적으로 동일)
  const inqMax  = (inqType === '표준점수' || inqType === '변환표준점수') ? 100 : 100;

  // 영어: 영어환산표 중 최댓값
  let engMax = 100;
  if (englishScores && typeof englishScores === 'object') {
    const vals = Object.values(englishScores).map(Number).filter(n => !Number.isNaN(n));
    if (vals.length) engMax = Math.max(...vals);
  }
  return { korMax, mathMax, engMax, inqMax };
}


/* ========== 핵심 계산기 ========== */
function calculateScore(formulaDataRaw, studentScores) {
  const log = [];
  log.push('========== 계산 시작 ==========');

  // 0) 컬럼 파싱
  const F = { ...formulaDataRaw };
  F.selection_rules        = safeParse(F.selection_rules, null);
  F.score_config           = safeParse(F.score_config,   {}) || {};
  F.english_scores         = safeParse(F.english_scores, null);
  F.history_scores         = safeParse(F.history_scores, null);
  F.english_bonus_scores   = safeParse(F.english_bonus_scores, null); // (옵션) 영어 등급별 가/감점
  const englishBonusFixed  = Number(F.english_bonus_fixed || 0);      // (옵션) 영어 고정 가/감점

  // 1) 학생 과목 데이터 추출
  const subs = studentScores?.subjects || [];
  const S = {
    국어   : subs.find(s => s.name === '국어')   || {},
    수학   : subs.find(s => s.name === '수학')   || {},
    영어   : subs.find(s => s.name === '영어')   || {},
    한국사 : subs.find(s => s.name === '한국사') || {},
    탐구   : subs.filter(s => s.name === '탐구')
  };

  const cfg     = F.score_config || {};
  const kmType  = cfg.korean_math?.type || '백분위';
  const inqType = cfg.inquiry?.type     || '백분위';

  // 탐구 대표값
  const inquiryCount = Math.max(1, parseInt(F.탐구수 || '1', 10));
  const { rep: inqRep } = calcInquiryRepresentative(S.탐구, inqType, inquiryCount);

  // 영어 환산
  let engConv = 0;
  if (F.english_scores && S.영어?.grade != null) {
    const g = String(S.영어.grade);
    engConv = Number(F.english_scores[g] ?? 0);
  }

  // 원점수(과목당)
  const raw = {
    국어:   pickByType(S.국어, kmType),
    수학:   pickByType(S.수학, kmType),
    영어:   engConv,
    한국사: Number(S.한국사?.grade ?? 9),
    탐구:   inqRep
  };
  log.push(`[원점수] 국:${raw.국어} / 수:${raw.수학} / 영(환산):${raw.영어} / 탐(대표):${raw.탐구}`);

  // 정규화 기준(과목 만점)
  const { korMax, mathMax, engMax, inqMax } = resolveMaxScores(cfg, F.english_scores);
  const getMax = (name) => {
    if (name === '국어') return korMax;
    if (name === '수학') return mathMax;
    if (name === '영어') return engMax;
    if (name === '탐구') return inqMax;
    return 100;
  };
  const normOf = (name) => {
    const sc = Number(raw[name] || 0);
    const mx = getMax(name);
    return mx > 0 ? Math.max(0, Math.min(1, sc / mx)) : 0;
  };

  // 2) 학교 총점/수능비율
  const TOTAL        = Number(F.총점 || 1000);
  const suneungRatio = (Number(F.수능) || 0) / 100;
  log.push(`[학교] 총점=${TOTAL}, 수능비율=${suneungRatio}`);

  // 3) 규칙 로딩
  const rules = Array.isArray(F.selection_rules)
    ? F.selection_rules
    : (F.selection_rules ? [F.selection_rules] : []);

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
  const TOTAL_select = TOTAL * SW;         // 선택가중 몫(정보용)
  const TOTAL_base   = TOTAL * (1 - SW);   // 기본비율 몫

  // 3-2) select_n 필터: 기본비율에 포함될 과목 결정(정규화 상위 count)
  const selectNRules = rules.filter(r => r?.type === 'select_n' && Array.isArray(r.from) && r.count);
  const selectedBySelectN = new Set();
  if (selectNRules.length) {
    for (const r of selectNRules) {
      const cand = r.from
        .map(name => ({ name, norm: normOf(name) }))
        .sort((a, b) => b.norm - a.norm);
      const picked = cand.slice(0, Math.min(Number(r.count) || 1, cand.length));
      picked.forEach(p => selectedBySelectN.add(p.name));
      log.push(`[select_n] from=[${r.from.join(', ')}], count=${r.count} -> 선택: ${picked.map(p => p.name).join(', ')}`);
    }
  }

  // 4) 기본비율 계산 (남은 총점 사용)
  // - 비율(%)가 명시된 과목만
  // - select_ranked_weights.from에 포함된 과목은 기본비율에서 제외(중복 의미 방지)
  // - select_n이 있으면: selectedBySelectN ∩ (비율>0)만 반영
  let baseRatioSum = 0;
  let baseNormWeighted = 0;
  const ratioOf = (name) => Number(F[name] || 0);
  const candidatesBase = ['국어', '수학', '영어', '탐구'];

  for (const name of candidatesBase) {
    const ratio = ratioOf(name);
    if (ratio <= 0) continue;

    // 선택가중에 포함된 과목이면 기본비율에서 제외
    if (selectWeightSubjects.size && selectWeightSubjects.has(name)) continue;

    // select_n 필터가 존재하면 그에 선정된 과목만 허용
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

  // 5) 선택가중(select_ranked_weights) 계산 (규칙 간 중복방지)
  let suneungSelect = 0;
  const usedForWeights = new Set(); // 규칙 간 중복 방지

  for (let i = 0; i < rules.length; i++) {
    const r = rules[i];
    if (!(r && r.type === 'select_ranked_weights' && Array.isArray(r.from) && Array.isArray(r.weights) && r.weights.length)) {
      continue;
    }

    // 후보 정렬(정규화 내림차순) + 이미 쓴 과목 제외
    const cand = r.from
      .filter(name => !usedForWeights.has(name))
      .map(name => ({ name, norm: normOf(name), raw: Number(raw[name] || 0), max: getMax(name) }))
      .sort((a, b) => b.norm - a.norm);

    const N = Math.min(cand.length, r.weights.length);
    const picked = cand.slice(0, N);

    // 이번 규칙에서 사용한 과목들 마킹(교차 중복 금지)
    picked.forEach(p => usedForWeights.add(p.name));

    const wSum = picked.reduce((acc, c, idx) => acc + (Number(r.weights[idx] || 0) * c.norm), 0);
    const add  = wSum * TOTAL * suneungRatio;
    suneungSelect += add;

    log.push(`[규칙${i+1}] select_ranked_weights from=[${r.from.join(', ')}] (weights=${r.weights.join(', ')})`);
    picked.forEach((c, idx) => log.push(
      `  - ${idx + 1}위 ${c.name}: raw=${c.raw}, max=${c.max}, norm=${c.norm.toFixed(4)}, weight=${r.weights[idx]}`
    ));
    log.push(`  -> 가중합=${wSum.toFixed(4)} × TOTAL(${TOTAL}) × 수능비율(${suneungRatio}) = ${add.toFixed(3)}`);
  }

  const suneungScore = suneungBase + suneungSelect;

  // 6) 한국사 가/감점
  let historyScore = 0;
  if (F.history_scores && S.한국사?.grade != null) {
    const hg = String(S.한국사.grade);
    historyScore = Number(F.history_scores[hg] ?? 0);
    log.push(`[한국사] 등급 ${hg} → ${historyScore}점`);
  }

  // 6-1) 영어 가/감점 (등급 매핑 + 고정 보정)
  let englishBonus = 0;
  if (F.english_bonus_scores && S.영어?.grade != null) {
    const eg = String(S.영어.grade);
    englishBonus += Number(F.english_bonus_scores[eg] ?? 0);
    log.push(`[영어 보정] 등급 ${eg} → ${Number(F.english_bonus_scores[eg] ?? 0)}점`);
  }
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

/* ========== 라우터 ========== */
module.exports = function (db, authMiddleware) {
  // 점수 계산
  router.post('/calculate', authMiddleware, async (req, res) => {
    const { U_ID, year, studentScores } = req.body;
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
      const result = calculateScore(formulaData, studentScores);
      return res.json({ success: true, message: `[${year}] U_ID ${U_ID} 점수 계산 성공`, result });
    } catch (err) {
      console.error('❌ 계산 처리 중 오류:', err);
      return res.status(500).json({ success: false, message: '계산 중 서버 오류' });
    }
  });

  // (옵션) 정규화 기준 확인용
  router.post('/debug-normalize', authMiddleware, (req, res) => {
    const cfg = safeParse(req.body?.score_config, {});
    const eng = safeParse(req.body?.english_scores, null);
    const maxes = resolveMaxScores(cfg, eng);
    res.json({ success: true, maxes });
  });

  return router;
};

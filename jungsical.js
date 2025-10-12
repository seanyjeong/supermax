// jungsical.js
const express = require('express');
const router = express.Router();

/**
 * 안전 JSON 파서
 */
function safeParse(v, fb = null) {
  if (v == null) return fb;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return fb; }
}

/**
 * 과목별 점수에서 type에 맞는 값을 선택
 * - 표준점수/변환표준점수 -> std
 * - 백분위 -> percentile
 */
function pickByType(row, type) {
  if (!row) return 0;
  if (type === '표준점수' || type === '변환표준점수') return Number(row.std || 0);
  return Number(row.percentile || 0);
}

/**
 * 탐구 대표값 계산
 * - 탐구수 = 1 -> 두 과목 중 최대값
 * - 탐구수 = 2 -> 두 과목 평균
 * - 2 초과 -> 상위 N 평균
 */
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

/**
 * 과목별 만점(정규화 기준) 추출
 * - korean_math.max_score_method: fixed_200 (기본 200)
 * - inquiry.max_score_method: fixed_100 (기본 100)
 * - 영어: english_scores의 최댓값
 */
function resolveMaxScores(scoreConfig, englishScores) {
  const kmMethod = scoreConfig?.korean_math?.max_score_method || 'fixed_200';
  const inqMethod = scoreConfig?.inquiry?.max_score_method || 'fixed_100';

  const korMax  = kmMethod === 'fixed_200' ? 200 : 200;
  const mathMax = korMax;
  const inqMax  = inqMethod === 'fixed_100' ? 100 : 100;

  let engMax = 100;
  if (englishScores && typeof englishScores === 'object') {
    const vals = Object.values(englishScores).map(Number).filter(n => !Number.isNaN(n));
    if (vals.length) engMax = Math.max(...vals);
  }

  return { korMax, mathMax, engMax, inqMax };
}

/**
 * 핵심 계산기
 */
function calculateScore(formulaDataRaw, studentScores) {
  const log = [];
  log.push('========== 계산 시작 ==========');

  // 0) DB JSON 컬럼 파싱
  const formula = { ...formulaDataRaw };
  formula.selection_rules = safeParse(formulaDataRaw.selection_rules, null);
  formula.score_config    = safeParse(formulaDataRaw.score_config,   {}) || {};
  formula.english_scores  = safeParse(formulaDataRaw.english_scores, null);
  formula.history_scores  = safeParse(formulaDataRaw.history_scores, null);

  // 1) 학생 점수 재구성
  const subjects = studentScores?.subjects || [];
  const S = {
    국어   : subjects.find(s => s.name === '국어')   || {},
    수학   : subjects.find(s => s.name === '수학')   || {},
    영어   : subjects.find(s => s.name === '영어')   || {},
    한국사 : subjects.find(s => s.name === '한국사') || {},
    탐구   : subjects.filter(s => s.name === '탐구')
  };

  const cfg     = formula.score_config || {};
  const kmType  = cfg.korean_math?.type || '백분위';
  const inqType = cfg.inquiry?.type     || '백분위';

  // 탐구 대표값(탐구수 규칙 적용)
  const inquiryCount = Math.max(1, parseInt(formula.탐구수 || '1', 10));
  const { rep: inqRep, sorted: inqSorted } = calcInquiryRepresentative(S.탐구, inqType, inquiryCount);

  // 영어 환산
  let engConv = 0;
  if (formula.english_scores && S.영어?.grade != null) {
    const g = String(S.영어.grade);
    engConv = Number(formula.english_scores[g] ?? 0);
  }

  // 원점수(기본/선택 규칙의 비교 기준)
  const raw = {
    국어:   pickByType(S.국어, kmType),
    수학:   pickByType(S.수학, kmType),
    영어:   engConv,
    한국사: Number(S.한국사?.grade ?? 9),
    탐구:   inqRep
  };

  log.push(`[원점수] 국:${raw.국어} / 수:${raw.수학} / 영(환산):${raw.영어} / 탐(대표):${raw.탐구}`);

  // 만점(정규화 기준)
  const { korMax, mathMax, engMax, inqMax } = resolveMaxScores(cfg, formula.english_scores);
  const getMax = (name) => {
    if (name === '국어') return korMax;
    if (name === '수학') return mathMax;
    if (name === '영어') return engMax;
    if (name === '탐구') return inqMax;
    return 100;
  };

  // 2) 총점·수능비율
  const TOTAL         = Number(formula.총점 || 1000);
  const suneungRatio  = (Number(formula.수능) || 0) / 100;
  log.push(`[학교] 총점=${TOTAL}, 수능비율=${suneungRatio}`);

  // 3) 선택 규칙 준비
  const rules = Array.isArray(formula.selection_rules)
    ? formula.selection_rules
    : (formula.selection_rules ? [formula.selection_rules] : []);

  // select_* 규칙에 등장한 과목은 기본비율에서 제외(중복 계산 방지)
  const ruledSubjects = new Set();
  for (const r of rules) {
    if (r?.from && Array.isArray(r.from)) r.from.forEach(n => ruledSubjects.add(n));
  }

  // 4) 기본 비율 계산 (명시된 과목만 반영, ruled 제외)
  let baseSum = 0;
  let baseRatioSum = 0;
  ['국어','수학','영어','탐구'].forEach(name => {
    const ratio = Number(formula[name] || 0);
    if (ratio > 0 && !ruledSubjects.has(name)) {
      baseSum += Number(raw[name] || 0) * (ratio / 100);
      baseRatioSum += ratio;
    }
  });

  let suneungBase = 0;
  if (baseRatioSum > 0) {
    suneungBase = (baseSum * (TOTAL / baseRatioSum)) * suneungRatio;
    log.push(`[기본비율] 합=${baseSum.toFixed(3)} × (${TOTAL}/${baseRatioSum}) × ${suneungRatio} = ${suneungBase.toFixed(3)}`);
  } else {
    log.push(`[기본비율] 반영 과목 없음(또는 모두 선택규칙에 포함)`);
  }

  // 5) 선택 규칙 처리
  let suneungSelect = 0;

  for (let i = 0; i < rules.length; i++) {
    const r = rules[i];
    if (!r || !Array.isArray(r.from) || !r.type) continue;

    // 후보 점수 구성
    // - 탐구는 "대표점수"(위에서 계산한 inqRep)를 사용 (수/탐 택1 요구사항 충족)
    // - 영어는 환산 점수
    const candidates = r.from.map(name => {
      const sc = Number(raw[name] || 0);
      const mx = getMax(name);
      const norm = mx > 0 ? Math.max(0, Math.min(1, sc / mx)) : 0;
      return { name, score: sc, max: mx, norm };
    }).sort((a, b) => b.score - a.score);

    if (r.type === 'select_n') {
      // 상위 count개를 뽑아 "그 과목의 기본비율"로 가중
      const count = Math.max(1, Number(r.count || 1));
      const picked = candidates.slice(0, Math.min(count, candidates.length));
      let partSum = 0;
      let partRatio = 0;

      picked.forEach(p => {
        const ratio = Number(formula[p.name] || 0);
        if (ratio > 0) {
          partSum   += p.score * (ratio / 100);
          partRatio += ratio;
        }
      });

      if (partRatio > 0) {
        const add = (partSum * (TOTAL / partRatio)) * suneungRatio;
        suneungSelect += add;
        log.push(`[규칙${i+1}] select_n from=[${r.from.join(', ')}], count=${count} -> 추가=${add.toFixed(3)} (합=${partSum.toFixed(3)}, 비율합=${partRatio})`);
      } else {
        log.push(`[규칙${i+1}] select_n: 선택된 과목에 기본비율(%)이 없어 기여=0`);
      }
    }

    if (r.type === 'select_ranked_weights') {
      // weights: 총점 대비 비율(0.3=총점 30%)
      const weights = Array.isArray(r.weights) ? r.weights.map(Number) : [];
      if (!weights.length) { log.push(`[규칙${i+1}] select_ranked_weights: weights 없음`); continue; }

      const N = Math.min(weights.length, candidates.length);
      const picked = candidates.slice(0, N);

      const wSum = picked.reduce((acc, c, idx) => {
        const w = weights[idx] || 0;
        return acc + (w * c.norm);
      }, 0);

      const add = wSum * TOTAL * suneungRatio;
      suneungSelect += add;

      log.push(`[규칙${i+1}] select_ranked_weights from=[${r.from.join(', ')}]`);
      picked.forEach((c, idx) => {
        log.push(`  - ${idx+1}위 ${c.name}: raw=${c.score}, max=${c.max}, norm=${c.norm.toFixed(4)}, weight=${weights[idx]}`);
      });
      log.push(`  -> 가중합=${wSum.toFixed(4)} × TOTAL(${TOTAL}) × 비율(${suneungRatio}) = ${add.toFixed(3)}`);
    }
  }

  const suneungScore = suneungBase + suneungSelect;

  // 6) 한국사 가/감점
  let historyScore = 0;
  if (formula.history_scores && S.한국사?.grade != null) {
    const g = String(S.한국사.grade);
    historyScore = Number(formula.history_scores[g] ?? 0);
    log.push(`[한국사] 등급 ${g} → ${historyScore}점`);
  }

  // 7) 최종 합산
  const final = suneungScore + historyScore;
  log.push('========== 최종 ==========');
  log.push(`수능점수(기본+선택) = ${suneungScore.toFixed(3)} / 한국사 = ${historyScore}`);
  log.push(`총점 = ${final.toFixed(3)}`);

  return {
    totalScore: final.toFixed(3),
    breakdown: {
      base: suneungBase,
      select: suneungSelect,
      history: historyScore
    },
    calculationLog: log
  };
}

module.exports = function (db, authMiddleware) {
  /**
   * 점수 계산 엔드포인트
   * body: { U_ID, year, studentScores }
   * studentScores.subjects: [{ name:'국어'|'수학'|'영어'|'한국사'|'탐구', std, percentile, grade }]
   */
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
      return res.json({
        success: true,
        message: `[${year}] U_ID ${U_ID} 점수 계산 성공`,
        result
      });
    } catch (err) {
      console.error('❌ 계산 처리 중 오류:', err);
      return res.status(500).json({ success: false, message: '계산 중 서버 오류' });
    }
  });

  // (옵션) 계산 규칙/최대점 디버그 확인용 엔드포인트
  router.post('/debug-normalize', authMiddleware, (req, res) => {
    const { score_config, english_scores } = req.body || {};
    const cfg = safeParse(score_config, {});
    const eng = safeParse(english_scores, null);
    const maxes = resolveMaxScores(cfg, eng);
    res.json({ success: true, maxes });
  });

  return router;
};

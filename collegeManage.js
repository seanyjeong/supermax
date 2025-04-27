const express = require('express');
const router = express.Router();
const { db } = require('./college'); 

function dbQuery(sql, params) {
    return new Promise((resolve, reject) => {
      db.query(sql, params, (err, results) => {
        if (err) reject(err);
        else resolve(results);
      });
    });
  }
  


router.post('/school', (req, res) => {
    const { 군명, 대학명, 학과명, 수능비율, 내신비율, 실기비율, 기타비율 , 총점기준} = req.body;
  
    if (!군명 || !대학명 || !학과명) {
      return res.status(400).json({ message: '군명, 대학명, 학과명 모두 입력하세요.' });
    }
  
    const sql = `
      INSERT INTO 학교 (군명, 대학명, 학과명, 수능비율, 내신비율, 실기비율, 기타비율, 총점기준)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;
  
    db.query(sql, [군명, 대학명, 학과명, 수능비율, 내신비율, 실기비율, 기타비율, 총점기준], (err, result) => {
      if (err) {
        console.error('❌ 학교 등록 실패:', err);
        return res.status(500).json({ message: '학교 등록 실패' });
      }
      res.json({ message: '✅ 학교 등록 완료', 대학학과ID: result.insertId });
    });
  });
  
  
  // 학교 리스트 불러오기 API
 router.get('/schools', (req, res) => {
    const sql = 'SELECT 대학학과ID, 군명, 대학명, 학과명 FROM 학교 ORDER BY 대학명, 학과명';
  
    db.query(sql, (err, results) => {
      if (err) {
        console.error('❌ 학교 리스트 불러오기 실패:', err);
        return res.status(500).json({ message: 'DB 조회 실패' });
      }
      res.json({ success: true, schools: results });
    });
  });
  
router.post('/school-detail', (req, res) => {
    const {
      대학학과ID, 탐구과목반영수, 한국사반영, 한국사가산처리,
      국수영반영지표, 탐구반영지표, 표준점수반영기준, 영어표준점수만점,
      과목, 반영과목수, 반영규칙, 반영비율,
      그룹1_과목, 그룹1_선택개수, 그룹1_반영비율,
      그룹2_과목, 그룹2_선택개수, 그룹2_반영비율,
      그룹3_과목, 그룹3_선택개수, 그룹3_반영비율,
      수학가산점, 과탐가산점
    } = req.body;
  
    if (!대학학과ID) {
      return res.status(400).json({ message: '학교를 선택하세요' });
    }
  
    const sql1 = `
      INSERT INTO 탐구한국사 (대학학과ID, 탐구과목반영수, 한국사반영, 한국사가산처리)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        탐구과목반영수 = VALUES(탐구과목반영수),
        한국사반영 = VALUES(한국사반영),
        한국사가산처리 = VALUES(한국사가산처리)
    `;
  
    const sql2 = `
      INSERT INTO 반영비율규칙 (
        대학학과ID, 국수영반영지표, 탐구반영지표, 표준점수반영기준, 영어표준점수만점,
        과목, 반영과목수, 반영규칙, 반영비율,
        그룹1_과목, 그룹1_선택개수, 그룹1_반영비율,
        그룹2_과목, 그룹2_선택개수, 그룹2_반영비율,
        그룹3_과목, 그룹3_선택개수, 그룹3_반영비율,
        수학가산점, 과탐가산점
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        국수영반영지표 = VALUES(국수영반영지표),
        탐구반영지표 = VALUES(탐구반영지표),
        표준점수반영기준 = VALUES(표준점수반영기준),
        영어표준점수만점 = VALUES(영어표준점수만점),
        과목 = VALUES(과목),
        반영과목수 = VALUES(반영과목수),
        반영규칙 = VALUES(반영규칙),
        반영비율 = VALUES(반영비율),
        그룹1_과목 = VALUES(그룹1_과목),
        그룹1_선택개수 = VALUES(그룹1_선택개수),
        그룹1_반영비율 = VALUES(그룹1_반영비율),
        그룹2_과목 = VALUES(그룹2_과목),
        그룹2_선택개수 = VALUES(그룹2_선택개수),
        그룹2_반영비율 = VALUES(그룹2_반영비율),
        그룹3_과목 = VALUES(그룹3_과목),
        그룹3_선택개수 = VALUES(그룹3_선택개수),
        그룹3_반영비율 = VALUES(그룹3_반영비율),
        수학가산점 = VALUES(수학가산점),
        과탐가산점 = VALUES(과탐가산점)
    `;
  
    db.beginTransaction(err => {
      if (err) throw err;
  
      db.query(sql1, [대학학과ID, 탐구과목반영수, 한국사반영, 한국사가산처리], (err) => {
        if (err) {
          return db.rollback(() => {
            res.status(500).json({ message: '탐구한국사 저장 실패' });
          });
        }
  
        db.query(sql2, [
          대학학과ID,
          국수영반영지표,
          탐구반영지표,
          표준점수반영기준,
          영어표준점수만점,
          safeJson(과목),
          반영과목수,
          반영규칙,
          safeJson(반영비율),
          safeJson(그룹1_과목),
          그룹1_선택개수 || null,
          safeJson(그룹1_반영비율),
          safeJson(그룹2_과목),
          그룹2_선택개수 || null,
          safeJson(그룹2_반영비율),
          safeJson(그룹3_과목),
          그룹3_선택개수 || null,
          safeJson(그룹3_반영비율),
          수학가산점 || 0,
          과탐가산점 || 0
        ], (err) => {
          if (err) {
            return db.rollback(() => {
              res.status(500).json({ message: '반영비율 저장 실패' });
            });
          }
  
          db.commit(err => {
            if (err) {
              return db.rollback(() => {
                res.status(500).json({ message: '커밋 실패' });
              });
            }
            res.json({ message: '✅ 세부정보 저장 완료 (업데이트 포함)' });
          });
        });
      });
    });
  });
  
  // 안전하게 JSON 파싱하는 함수
  function safeJson(input) {
    if (!input || input.trim() === "") return null;
    try {
      return JSON.stringify(JSON.parse(input));
    } catch (e) {
      return null;
    }
  }
  
  
  // ✨ 1. 백자표 학교 리스트 뽑기
router.get('/tanguback-create-list', async (req, res) => {
    try {
      const results = await dbQuery(`
        SELECT DISTINCT 학교.대학학과ID, 학교.대학명, 학교.학과명
        FROM 학교
        INNER JOIN 반영비율규칙 ON 학교.대학학과ID = 반영비율규칙.대학학과ID
        WHERE 반영비율규칙.탐구반영지표 = '백자표'
        ORDER BY 학교.대학명, 학교.학과명
      `);
      res.json({ success: true, schools: results });
    } catch (err) {
      console.error('❌ 백자표 학교리스트 에러:', err);
      res.status(500).json({ message: '서버 에러' });
    }
  });
  
  // ✨ 2. 백자표 변환점수 저장
 router.post('/tanguback-save', async (req, res) => {
    const { 대학학과ID, 구분, 변환표 } = req.body;
    
    if (!대학학과ID || !구분 || !변환표 || !Array.isArray(변환표)) {
      return res.status(400).json({ message: '필수 데이터 부족' });
    }
  
    try {
      // 기존 데이터 삭제
      await dbQuery('DELETE FROM 탐구백자표변환점수 WHERE 대학학과ID = ? AND 구분 = ?', [대학학과ID, 구분]);
  
      // 새 데이터 삽입
      for (const item of 변환표) {
        const { 백분위, 변환점수 } = item;
        await dbQuery('INSERT INTO 탐구백자표변환점수 (대학학과ID, 구분, 백분위, 변환점수) VALUES (?, ?, ?, ?)', 
          [대학학과ID, 구분, 백분위, 변환점수]);
      }
  
      res.json({ success: true, message: '✅ 변환표 저장 완료' });
    } catch (err) {
      console.error('❌ 변환표 저장 에러:', err);
      res.status(500).json({ message: '서버 에러' });
    }
  });
  
  // ✨ 3. 백자표 변환점수 불러오기
 router.get('/tanguback-get/:대학학과ID/:구분', async (req, res) => {
    const { 대학학과ID, 구분 } = req.params;
  
    try {
      const results = await dbQuery(
        'SELECT 백분위, 변환점수 FROM 탐구백자표변환점수 WHERE 대학학과ID = ? AND 구분 = ? ORDER BY 백분위 DESC',
        [대학학과ID, 구분]
      );
      res.json({ success: true, 변환표: results });
    } catch (err) {
      console.error('❌ 변환표 조회 에러:', err);
      res.status(500).json({ message: '서버 에러' });
    }
  });
  
  
  
 router.post('/korean-history-score', async (req, res) => {
    const { 대학학과ID, 등급, 점수 } = req.body;
  
    if (!대학학과ID || !등급 || !점수) {
      return res.status(400).json({ message: '필수 데이터 누락' });
    }
  
    try {
      const [exist] = await dbQuery(`
        SELECT id FROM 한국사등급별점수 WHERE 대학학과ID = ?
      `, [대학학과ID]);
  
      if (exist) {
        // 있으면 업데이트
        await dbQuery(`
          UPDATE 한국사등급별점수 SET 등급 = ?, 점수 = ? WHERE 대학학과ID = ?
        `, [JSON.stringify(등급), JSON.stringify(점수), 대학학과ID]);
      } else {
        // 없으면 인서트
        await dbQuery(`
          INSERT INTO 한국사등급별점수 (대학학과ID, 등급, 점수)
          VALUES (?, ?, ?)
        `, [대학학과ID, JSON.stringify(등급), JSON.stringify(점수)]);
      }
  
      res.json({ success: true, message: '✅ 한국사 점수 저장 완료' });
    } catch (error) {
      console.error('❌ 한국사 점수 저장 에러:', error);
      res.status(500).json({ success: false, message: '저장 실패' });
    }
  });
  
  
  
router.post('/english-score', async (req, res) => {
    const { 대학학과ID, 등급, 점수 } = req.body;
  
    if (!대학학과ID || !등급 || !점수) {
      return res.status(400).json({ message: '필수 데이터 누락' });
    }
  
    try {
      const [exist] = await dbQuery(`
        SELECT id FROM 영어등급별점수 WHERE 대학학과ID = ?
      `, [대학학과ID]);
  
      if (exist) {
        await dbQuery(`
          UPDATE 영어등급별점수 SET 등급 = ?, 점수 = ? WHERE 대학학과ID = ?
        `, [JSON.stringify(등급), JSON.stringify(점수), 대학학과ID]);
      } else {
        await dbQuery(`
          INSERT INTO 영어등급별점수 (대학학과ID, 등급, 점수)
          VALUES (?, ?, ?)
        `, [대학학과ID, JSON.stringify(등급), JSON.stringify(점수)]);
      }
  
      res.json({ success: true, message: '✅ 영어 점수 저장 완료' });
    } catch (error) {
      console.error('❌ 영어 점수 저장 에러:', error);
      res.status(500).json({ success: false, message: '저장 실패' });
    }
  });
  
  
  
 router.get('/korean-history-score/:id', (req, res) => {
    const 대학학과ID = req.params.id;
  
    const sql = `
      SELECT 등급, 점수
      FROM 한국사등급별점수
      WHERE 대학학과ID = ?
    `;
  
    db.query(sql, [대학학과ID], (err, results) => {
      if (err) {
        console.error('❌ 한국사 점수 조회 실패:', err);
        return res.status(500).json({ message: 'DB 조회 실패' });
      }
      if (results.length === 0) {
        return res.status(404).json({ message: '해당 데이터 없음' });
      }
      res.json({
        success: true,
        등급: JSON.parse(results[0].등급),
        점수: JSON.parse(results[0].점수)
      });
    });
  });
  
  
  
 router.get('/english-score/:id', (req, res) => {
    const 대학학과ID = req.params.id;
  
    const sql = `
      SELECT 등급, 점수
      FROM 영어등급별점수
      WHERE 대학학과ID = ?
    `;
  
    db.query(sql, [대학학과ID], (err, results) => {
      if (err) {
        console.error('❌ 영어 점수 조회 실패:', err);
        return res.status(500).json({ message: 'DB 조회 실패' });
      }
      if (results.length === 0) {
        return res.status(404).json({ message: '해당 데이터 없음' });
      }
      res.json({
        success: true,
        등급: JSON.parse(results[0].등급),
        점수: JSON.parse(results[0].점수)
      });
    });
  });

module.exports = router;

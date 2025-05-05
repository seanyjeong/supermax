// ✅ scoreTable.js
const express = require('express');
const router = express.Router();
const mysql = require('mysql');

const db = mysql.createConnection({
  host: '211.37.174.218',
  user: 'maxilsan',
  password: 'q141171616!',
  database: '정시엔진',
  charset: 'utf8mb4'
});

function dbQuery(sql, params) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, results) => {
      if (err) reject(err);
      else resolve(results);
    });
  });
}

const scoreTable = {
  "제자리멀리뛰기": {
    남: [300, 298, 296, 294, 292, 290, 288, 286, 284, 282, 280, 278, 276, 274, 272, 270, 268, 266, 264, 262, 260, 258, 256, 254, 252, 250, 248, 246, 244, 242, 240, 238, 236, 234, 232, 230, 228, 226, 225],
    여: [250, 248, 246, 244, 242, 240, 238, 236, 234, 232, 230, 228, 226, 224, 222, 220, 218, 216, 214, 212, 210, 208, 206, 204, 202, 200, 198, 196, 194, 192, 190, 188, 186, 184, 182, 180, 178, 176, 175]
  },
  "20m왕복달리기": {
    남: [13.4, 13.5, 13.6, 13.7, 13.8, 13.9, 14.0, 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8, 14.9, 15.0, 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7, 15.8, 15.9, 16.0, 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.7, 16.8, 16.9, 17.0, 17.1, 17.2],
    여: [15.5, 15.6, 15.7, 15.8, 15.9, 16.0, 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.7, 16.8, 16.9, 17.0, 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 17.7, 17.8, 17.9, 18.0, 18.1, 18.2, 18.3, 18.4, 18.5, 18.6, 18.7, 18.8, 18.9, 19.0, 19.1, 19.2, 19.3],
    reverse: true
  },
  "좌전굴": {
    남: [30.0, 29.5, 29.0, 28.5, 28.0, 27.5, 27.0, 26.5, 26.0, 25.5, 25.0, 24.5, 24.0, 23.5, 23.0, 22.5, 22.0, 21.5, 21.0, 20.5, 20.0, 19.5, 19.0, 18.5, 18.0, 17.5, 17.0, 16.5, 16.0, 15.5, 15.0, 14.5, 14.0, 13.5, 13.0, 12.5, 12.0, 11.5, 11.4],
    여: [32.0, 31.5, 31.0, 30.5, 30.0, 29.5, 29.0, 28.5, 28.0, 27.5, 27.0, 26.5, 26.0, 25.5, 25.0, 24.5, 24.0, 23.5, 23.0, 22.5, 22.0, 21.5, 21.0, 20.5, 20.0, 19.5, 19.0, 18.5, 18.0, 17.5, 17.0, 16.5, 16.0, 15.5, 15.0, 14.5, 14.0, 13.5, 13.4]
  },
  "윗몸일으키기": {
    남: [75, 74, 73, 72, 71, 70, 69, 68, 67, 66, 65, 64, 63, 62, 61, 60, 59, 58, 57, 56, 55, 54, 53, 52, 51, 50, 49, 48, 47, 46, 45, 44, 43, 42, 41, 40, 39, 38, 37],
    여: [70, 69, 68, 67, 66, 65, 64, 63, 62, 61, 60, 59, 58, 57, 56, 55, 54, 53, 52, 51, 50, 49, 48, 47, 46, 45, 44, 43, 42, 41, 40, 39, 38, 37, 36, 35, 34, 33, 32]
  },
  "배근력": {
    남: [220, 218, 216, 214, 212, 210, 208, 206, 204, 202, 200, 198, 196, 194, 192, 190, 188, 186, 184, 182, 180, 178, 176, 174, 172, 170, 168, 166, 164, 162, 160, 158, 156, 154, 152, 150, 148, 146, 145.9],
    여: [150, 148, 146, 144, 142, 140, 138, 136, 134, 132, 130, 128, 126, 124, 122, 120, 118, 116, 114, 112, 110, 108, 106, 104, 102, 100, 98, 96, 94, 92, 90, 88, 86, 84, 82, 80, 78, 76, 75.9]
  },
  "메디신볼던지기": {
    남: [12.0, 11.8, 11.6, 11.4, 11.2, 11.0, 10.8, 10.6, 10.4, 10.2, 10.0, 9.8, 9.6, 9.4, 9.2, 9.0, 8.8, 8.6, 8.4, 8.2, 8.0, 7.8, 7.6, 7.4, 7.2, 7.0, 6.8, 6.6, 6.4, 6.2, 6.0, 5.8, 5.6, 5.4, 5.2, 5.0, 4.8, 4.6, 4.5],
    여: [9.0, 8.8, 8.6, 8.4, 8.2, 8.0, 7.8, 7.6, 7.4, 7.2, 7.0, 6.8, 6.6, 6.4, 6.2, 6.0, 5.8, 5.6, 5.4, 5.2, 5.0, 4.8, 4.6, 4.4, 4.2, 4.0, 3.8, 3.6, 3.4, 3.2, 3.0, 2.8, 2.6, 2.4, 2.2, 2.0, 1.8, 1.6, 1.5]
  },
  "10m왕복달리기": {
    남: [8.0, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 9.0, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 10.0, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8, 10.9, 11.0, 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8],
    여: [9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 10.0, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8, 10.9, 11.0, 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8, 11.9, 12.0, 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8, 12.9, 13.0],
    reverse: true
  },
    "좌전굴": {
      남: [30.0, 29.5, 29.0, 28.5, 28.0, 27.5, 27.0, 26.5, 26.0, 25.5, 25.0, 24.5, 24.0, 23.5, 23.0, 22.5, 22.0, 21.5, 21.0, 20.5, 20.0, 19.5, 19.0, 18.5, 18.0, 17.5, 17.0, 16.5, 16.0, 15.5, 15.0, 14.5, 14.0, 13.5, 13.0, 12.5, 12.0, 11.5, 11.4],
      여: [32.0, 31.5, 31.0, 30.5, 30.0, 29.5, 29.0, 28.5, 28.0, 27.5, 27.0, 26.5, 26.0, 25.5, 25.0, 24.5, 24.0, 23.5, 23.0, 22.5, 22.0, 21.5, 21.0, 20.5, 20.0, 19.5, 19.0, 18.5, 18.0, 17.5, 17.0, 16.5, 16.0, 15.5, 15.0, 14.5, 14.0, 13.5, 13.4]
    }
};

function getScore(event, gender, value) {
  const genderKey = gender === '남자' ? '남' : gender === '여자' ? '여' : gender;
  const list = scoreTable[event]?.[genderKey];
  if (!list) {
    console.log('❌ 점수 리스트 없음:', event, genderKey);
    return 24;
  }

  const numericValue = parseFloat(value);
  console.log('💬 getScore 호출:', event, genderKey, '입력값:', value, '→ 숫자:', numericValue);
  console.log('🎯 점수 리스트:', list);

  const isReverse = scoreTable[event]?.reverse || false;

  for (let i = 0; i < list.length; i++) {
    const score = 100 - i * 2;
    const standard = list[i];
    if (isReverse) {
      if (numericValue <= standard) {
        console.log(`✅ 리턴점수 (reverse): ${score} (기준: ${standard})`);
        return score;
      }
    } else {
      if (numericValue >= standard) {
        console.log(`✅ 리턴점수: ${score} (기준: ${standard})`);
        return score;
      }
    }
  }

  console.log('⚠️ 조건 만족하는 값 없음 → 24점 리턴');
  return 24;
}



// ✅ 명단 선등록 또는 업데이트
router.post('/test-students', async (req, res) => {
  const { name, school, grade, gender, test_month } = req.body;
  try {
    const [existing] = await dbQuery(
      'SELECT exam_number FROM 실기기록_테스트 WHERE name = ? AND school = ? AND grade = ? AND gender = ? AND test_month = ?',
      [name, school, grade, gender, test_month]
    );

    let exam_number;

    if (existing) {
      // 이미 있는 경우: 정보만 업데이트
      exam_number = existing.exam_number;
      await dbQuery(
        'UPDATE 실기기록_테스트 SET school = ?, grade = ?, gender = ? WHERE exam_number = ? AND test_month = ?',
        [school, grade, gender, exam_number, test_month]
      );
    } else {
      // 새로 등록
      const [max] = await dbQuery('SELECT MAX(CAST(SUBSTRING(exam_number, 7) AS UNSIGNED)) AS maxNum FROM 실기기록_테스트 WHERE test_month = ?', [test_month]);
      const nextNumber = (max.maxNum || 0) + 1;
      exam_number = `${test_month.replace('-', '')}${String(nextNumber).padStart(2, '0')}`;
      await dbQuery('INSERT INTO 실기기록_테스트 (exam_number, name, grade, gender, school, test_month) VALUES (?, ?, ?, ?, ?, ?)',
        [exam_number, name, grade, gender, school, test_month]);
    }

    res.json({ success: true, exam_number });
  } catch (err) {
    console.error('❌ 명단 저장 오류:', err);
    res.json({ success: false, error: err });
  }
});

// ✅ 종목별 개별 기록 저장
router.patch('/test-record', async (req, res) => {
  const { exam_number, test_month, event, value } = req.body;
  const columnMap = {
    '제자리멀리뛰기': ['jump_cm', 'jump_score'],
    '20m왕복달리기': ['run20m_sec', 'run20m_score'],
    '좌전굴': ['sit_reach_cm', 'sit_score'],
    '윗몸일으키기': ['situp_count', 'situp_score'],
    '배근력': ['back_strength', 'back_score'],
    '메디신볼던지기': ['medball_m', 'medball_score'],
    '10m왕복달리기': ['run10m_sec', 'run10m_score']
  };

  try {
    const [student] = await dbQuery('SELECT gender FROM 실기기록_테스트 WHERE exam_number = ? AND test_month = ?', [exam_number, test_month]);
    if (!student) return res.json({ success: false, error: '학생 없음' });

    const gender = student.gender;
    const score = getScore(event, gender, value);
    const [valCol, scoreCol] = columnMap[event];

    await dbQuery(`UPDATE 실기기록_테스트 SET ${valCol} = ?, ${scoreCol} = ? WHERE exam_number = ? AND test_month = ?`,
      [value, score, exam_number, test_month]);

    // 총점 다시 계산
    const [updated] = await dbQuery('SELECT * FROM 실기기록_테스트 WHERE exam_number = ? AND test_month = ?', [exam_number, test_month]);
    const sum = [updated.jump_score, updated.run20m_score, updated.sit_score, updated.situp_score, updated.back_score, updated.medball_score, updated.run10m_score]
      .filter(v => typeof v === 'number')
      .reduce((a, b) => a + b, 0);
    await dbQuery('UPDATE 실기기록_테스트 SET total_score = ? WHERE exam_number = ? AND test_month = ?', [sum, exam_number, test_month]);

    res.json({ success: true, score, total_score: sum });
  } catch (err) {
    console.error('❌ 기록 저장 오류:', err);
    res.json({ success: false, error: err });
  }
});

// ✅ 해당 월 전체 명단 + 기록 조회
router.get('/test-records', async (req, res) => {
  const { test_month } = req.query;
  try {
    const rows = await dbQuery('SELECT * FROM 실기기록_테스트 WHERE test_month = ? ORDER BY exam_number', [test_month]);
    res.json({ success: true, records: rows });
  } catch (err) {
    console.error('❌ 명단 조회 오류:', err);
    res.json({ success: false, error: err });
  }
});

// ✅ 전체 월별 명단만 불러오기 (기록 제외)
router.get('/students-by-month', async (req, res) => {
  const { month } = req.query;
  try {
    const rows = await dbQuery(
      'SELECT exam_number AS id, name, school, grade, gender FROM 실기기록_테스트 WHERE test_month = ? ORDER BY exam_number',
      [month]
    );
    res.json({ success: true, students: rows });
  } catch (err) {
    console.error('❌ 월별 명단 조회 오류:', err);
    res.json({ success: false, error: err });
  }
});

// ✅ 개별 기록 저장 API (기록 + 점수 자동 계산)
router.post('/save-test-records', async (req, res) => {
  const { records } = req.body;
  let updated = 0;
  try {
for (const r of records) {
  const { user_id, event, record, test_month } = r;
  if (!record || isNaN(parseFloat(record))) continue; // ✅ 기록 없으면 무시

      const [student] = await dbQuery('SELECT gender FROM 실기기록_테스트 WHERE exam_number = ? AND test_month = ?', [user_id, test_month]);
      if (!student) continue;

      const gender = student.gender;
      const score = getScore(event, gender, parseFloat(record));
      const columnMap = {
        '제자리멀리뛰기': ['jump_cm', 'jump_score'],
        '20m왕복달리기': ['run20m_sec', 'run20m_score'],
        '좌전굴': ['sit_reach_cm', 'sit_score'],
        '윗몸일으키기': ['situp_count', 'situp_score'],
        '배근력': ['back_strength', 'back_score'],
        '메디신볼던지기': ['medball_m', 'medball_score'],
        '10m왕복달리기': ['run10m_sec', 'run10m_score']
      };
      const [valCol, scoreCol] = columnMap[event];

      await dbQuery(`UPDATE 실기기록_테스트 SET ${valCol} = ?, ${scoreCol} = ? WHERE exam_number = ? AND test_month = ?`,
        [record, score, user_id, test_month]);

      // 총점 업데이트
      const [updatedRow] = await dbQuery('SELECT * FROM 실기기록_테스트 WHERE exam_number = ? AND test_month = ?', [user_id, test_month]);
  console.log('📦 updatedRow:', updatedRow);

const total = [
  updatedRow.jump_score,
  updatedRow.run20m_score,
  updatedRow.sit_score,
  updatedRow.situp_score,
  updatedRow.back_score,
  updatedRow.medball_score,
  updatedRow.run10m_score
].map(v => {
  const num = Number(v);
  return isNaN(num) ? 0 : num;
}).reduce((a, b) => a + b, 0);

console.log(`🧮 총점 계산:`, {
  exam_number: user_id,
  test_month,
  scores: {
    jump: updatedRow.jump_score,
    run20m: updatedRow.run20m_score,
    sit: updatedRow.sit_score,
    situp: updatedRow.situp_score,
    back: updatedRow.back_score,
    medball: updatedRow.medball_score,
    run10m: updatedRow.run10m_score
  },
  total
});



      await dbQuery('UPDATE 실기기록_테스트 SET total_score = ? WHERE exam_number = ? AND test_month = ?', [total, user_id, test_month]);
      updated++;
    }

    res.json({ success: true, updated });
  } catch (err) {
    console.error('❌ 기록 저장 오류:', err);
    res.json({ success: false, error: err });
  }
});

module.exports = router;

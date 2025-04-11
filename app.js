const http = require('http');
const fs = require('fs');
const mysql = require('mysql');
const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const requestIp = require('request-ip');
const axios = require('axios');
const app = express();
const jwtSecret = 'your_jwt_secret'; // JWT 비밀키 설정
const SESSION_TIMEOUT = 3600; // 세션 타임아웃을 1시간(3600초)으로 설정
// 데이터베이스 연결을 설정합니다.
const db_config = {
  host: '211.37.174.218',
  user: 'maxilsan',
  password: 'q141171616!',
  database: 'supermax',
  charset: 'utf8mb4'
};
let connection;
function handleDisconnect() {
  connection = mysql.createConnection(db_config);
  connection.connect(function (err) {
    if (err) {
      console.log('error when connecting to db:', err);
      setTimeout(handleDisconnect, 2000);
    }
  });
  connection.on('error', function (err) {
    console.log('db error', err);
    if (err.code === 'PROTOCOL_CONNECTION_LOST') {
      handleDisconnect();
    } else {
      throw err;
    }
  });
}
handleDisconnect();
// 세션 설정
app.use(session({
  secret: 'your_secret_key',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false, sameSite: 'None', maxAge: SESSION_TIMEOUT * 1000 } // 쿠키 설정 조정
}));
// CORS 설정
app.use(cors({
  origin: ['https://supermax.co.kr','https://seanyjeong.github.io','https://chejump.com','https://score.ilsanmax.com','https://roll.ilsanmax.com','http://localhost:3000','https://aymax.co.kr'],
  methods: ['GET', 'POST','PUT','DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(requestIp.mw({ attributeName: 'clientIp' }));
// HTTP 서버를 생성합니다.
const server = http.createServer(app);


// 기준표 정의
const 기준표 = {
  '제멀': {
    남: [300, 297, 294, 291, 288, 285, 282, 279, 276, 273, 270, 267, 264, 261, 258, 255, 252, 249, 246, 243, 240, 230, 220, 210, -Infinity],
    여: [250, 247, 244, 241, 238, 235, 232, 229, 226, 223, 220, 217, 214, 211, 208, 205, 202, 199, 196, 193, 190, 170, 160, 150, -Infinity]
  },
  '10m': {
    남: [8.0, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 9.0, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 10.0, 10.2, 10.4, 10.6, Infinity],
    여: [9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 10.0, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8, 10.9, 11.0, 11.1, 11.2, 11.4, 11.6, 11.8, Infinity]
  },
  '좌전굴': {
    남: [32, 31, 30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 10, 8, 6, -Infinity],
    여: [34, 33, 32, 31, 30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 19, 18, 17, 16, 15, 14, 12, 10, 8, -Infinity]
  },
  '배근력': {
    남: [220, 216, 212, 208, 204, 200, 196, 192, 188, 184, 180, 176, 172, 168, 164, 160, 156, 152, 148, 144, 140, 130, 120, 110, -Infinity],
    여: [150, 146, 142, 138, 134, 130, 126, 122, 118, 114, 110, 106, 102, 98, 94, 90, 86, 82, 78, 74, 70, 60, 50, 40, -Infinity]
  },
  '메디신볼': {
    남: [12.5, 12.2, 11.9, 11.6, 11.3, 11.0, 10.7, 10.4, 10.1, 9.8, 9.5, 9.2, 8.9, 8.6, 8.3, 8.0, 7.7, 7.4, 7.1, 6.8, 6.5, 6.0, 5.5, 5.0, -Infinity],
    여: [9.5, 9.2, 8.9, 8.6, 8.3, 8.0, 7.7, 7.4, 7.1, 6.8, 6.5, 6.2, 5.9, 5.6, 5.3, 5.0, 4.7, 4.4, 4.1, 3.8, 3.5, 3.0, 2.5, 2.0, -Infinity]
  }
};

function calculateScore(event, gender, record) {
  const 기준 = 기준표[event]?.[gender];
  if (!기준) return 0;

  let index = 기준.findIndex((value, i) => {
    if (event === '10m') return record <= value;
    else return record >= value;
  });

  if (index === -1) index = 기준.length - 1;
  return Math.max(100 - index * 2, 52);
}

function getField(event, type) {
  const map = {
    '제멀': 'jump',
    '10m': 'shuttle',
    '좌전굴': 'sit_reach',
    '배근력': 'back_strength',
    '메디신볼': 'medicineball'
  };
  return `${map[event]}_${type}`;
}

app.post('/submit-record', (req, res) => {
  const { branch, exam_number, event, record, gender } = req.body;
  const score = calculateScore(event, gender, record);
  const field_record = getField(event, 'record');
  const field_score = getField(event, 'score');

  const selectQuery = 'SELECT * FROM 실기기록 WHERE branch = ? AND exam_number = ?';
  db.query(selectQuery, [branch, exam_number], (err, result) => {
    if (err) return res.status(500).json({ error: 'DB 조회 실패' });

    if (result.length > 0) {
      const updateQuery = `UPDATE 실기기록 SET ${field_record} = ?, ${field_score} = ? WHERE branch = ? AND exam_number = ?`;
      db.query(updateQuery, [record, score, branch, exam_number], err => {
        if (err) return res.status(500).json({ error: 'DB 업데이트 실패' });
        res.json({ success: true, score });
      });
    } else {
      const insertQuery = `INSERT INTO 실기기록 (branch, exam_number, gender, ${field_record}, ${field_score}) VALUES (?, ?, ?, ?, ?)`;
      db.query(insertQuery, [branch, exam_number, gender, record, score], err => {
        if (err) return res.status(500).json({ error: 'DB 삽입 실패' });
        res.json({ success: true, score });
      });
    }
  });
});

// 로그인 엔드포인트
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const query = 'SELECT * FROM users WHERE username = ? AND password = ?';
  connection.query(query, [username, password], async (err, results) => {
    if (err) {
      console.error('Database query failed:', err);
      res.status(500).json({ message: 'Database query failed', error: err });
      return;
    }
    if (results.length > 0) {
      const user = results[0];
      const token = jwt.sign({ username: user.username, legion: user.legion }, jwtSecret, { expiresIn: '1h' });
      // IP 주소 및 로그인 지역 정보를 가져와서 세션에 저장
      const ip = req.clientIp;
      let location = 'Unknown';
      try {
        const response = await axios.get(`http://ip-api.com/json/${ip}`);
        const data = response.data;
        location = `${data.city}, ${data.regionName}, ${data.country}`;
      } catch (error) {
        console.error('Error fetching IP location:', error);
      }
      req.session.ip = ip;
      req.session.location = location;
      req.session.username = user.username;
      req.session.legion = user.legion;
      // 세션 정보를 데이터베이스에 저장
      const insertSessionQuery = `
        INSERT INTO user_sessions (username, legion, ip, location)
        VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE login_time = CURRENT_TIMESTAMP
      `;
      connection.query(insertSessionQuery, [user.username, user.legion, ip, location], (err, results) => {
        if (err) {
          console.error('Failed to insert session data:', err);
        }
      });
      res.status(200).json({ message: 'Login successful', token, username: user.username, legion: user.legion });
    } else {
      res.status(401).json({ message: 'Invalid credentials' });
    }
  });
});
// JWT 인증 미들웨어
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (token == null) return res.status(401).json({ message: 'No token provided' });
  jwt.verify(token, jwtSecret, (err, user) => {
    if (err) return res.status(403).json({ message: 'Invalid token' });
    req.user = user;
    next();
  });
}
// 현재 로그인한 사용자 정보를 가져오는 엔드포인트
app.get('/admin', authenticateToken, (req, res) => {
  const username = req.user.username;
  if (username === 'sean8320') {
    const query = `
      SELECT username, legion, ip, location, login_time
      FROM user_sessions
      WHERE login_time > DATE_SUB(NOW(), INTERVAL ${SESSION_TIMEOUT} SECOND)
    `;
    connection.query(query, (err, results) => {
      if (err) {
        console.error('Failed to retrieve session data:', err);
        res.status(500).json({ message: 'Failed to retrieve session data', error: err });
        return;
      }
      res.status(200).json(results);
    });
  } else {
    res.status(403).json({ message: 'Access denied' });
  }
});
// 로그아웃 엔드포인트
app.post('/logout', authenticateToken, (req, res) => {
  const username = req.user.username;
  const query = 'DELETE FROM user_sessions WHERE username = ?';
  connection.query(query, [username], (err, results) => {
    if (err) {
      console.error('Failed to delete session data:', err);
      res.status(500).json({ message: 'Failed to delete session data', error: err });
      return;
    }
    res.status(200).json({ message: 'Logout successful' });
  });
});


// '25정시' 데이터를 가져오는 엔드포인트
app.get('/25jeongsi', authenticateToken, (req, res) => {
  const query = 'SELECT * FROM 25정시';
  connection.query(query, (err, rows) => {
    if (err) {
      console.error('Database query failed:', err);
      res.status(500).json({ message: 'Database query failed', error: err });
      return;
    }
    res.status(200).json(rows);
  });
});
// '25수시' 데이터를 가져오는 엔드포인트
app.get('/25susi', authenticateToken, (req, res) => {
  const query = `
    SELECT s.*, i.image_data
    FROM 25수시 s
    LEFT JOIN images i ON s.id = i.id
  `;
  connection.query(query, (err, rows) => {
    if (err) {
      console.error('Database query failed:', err);
      res.status(500).json({ message: 'Database query failed', error: err });
      return;
    }
    rows.forEach(row => {
      if (row.image_data) {
        row.image_data = row.image_data.toString('base64');
      }
    });
    res.status(200).json(rows);
  });
});
// 이미지 데이터를 Base64로 인코딩하여 클라이언트에 제공
app.get('/image/:id', authenticateToken, (req, res) => {
  const imageId = req.params.id;
  const query = 'SELECT image_data FROM images WHERE id = ?';
  connection.query(query, [imageId], (err, rows) => {
    if (err) {
      console.error('Database query failed:', err);
      res.status(500).json({ message: 'Database query failed', error: err });
      return;
    }
    if (rows.length > 0) {
      const imageData = rows[0].image_data.toString('base64');
      res.status(200).json({ image_data: imageData });
    } else {
      res.status(404).json({ message: 'Image not found' });
    }
  });
});
// 비밀번호 변경 엔드포인트
app.post('/change-password', authenticateToken, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const username = req.user.username;
  const query = 'SELECT * FROM users WHERE username = ? AND password = ?';
  connection.query(query, [username, currentPassword], (err, results) => {
    if (err) {
      console.error('Database query failed:', err);
      res.status(500).json({ message: 'Database query failed', error: err });
      return;
    }
    if (results.length > 0) {
      const updateQuery = 'UPDATE users SET password = ? WHERE username = ?';
      connection.query(updateQuery, [newPassword, username], (err, results) => {
        if (err) {
          console.error('Database query failed:', err);
          res.status(500).json({ message: 'Database query failed', error: err });
          return;
        }
        res.status(200).json({ message: 'Password has been changed' });
      });
    } else {
      res.status(401).json({ message: 'Current password is incorrect' });
    }
  });
});
// 새로운 엔드포인트 추가: 점수 저장
app.post('/save-duniv', (req, res) => {
  const {
    name, academy, formType, gender,
    standingJump, weightedRun, backStrength, sitAndReach,
    academicScore, practicalTotal, totalScore // 실기총점 추가
  } = req.body;
  const query = `
    INSERT INTO dscores (name, academy, formType, gender, standingJump, weightedRun, backStrength, sitAndReach, academicScore, practicalTotal, totalScore)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  const values = [name, academy, formType, gender, standingJump, weightedRun, backStrength, sitAndReach, academicScore, practicalTotal, totalScore];
  connection.query(query, values, (err, results) => {
    if (err) {
      console.error('Failed to insert data:', err);
      res.status(500).json({ message: 'Failed to insert data', error: err });
      return;
    }
    res.status(200).json({ message: 'Data inserted successfully' });
  });
});
// 수시 데이터 가져오기 엔드포인트에리
app.get('/get-susi-data', (req, res) => {
    const query = "SELECT * FROM dscores WHERE formType='susi' ORDER BY totalScore DESC";
    connection.query(query, (err, results) => {
        if (err) throw err;
        res.json(results);
    });
});
// 정시 데이터 가져오기 엔드포인트
app.get('/get-jeongsi-data', (req, res) => {
    const query = "SELECT * FROM dscores WHERE formType='jeongsi' ORDER BY totalScore DESC";
    connection.query(query, (err, results) => {
        if (err) throw err;
        res.json(results);
    });
});
// 수시 데이터 저장 엔드포인트
app.post('/save-ERICA-susi', (req, res) => {
    const {
        name, academy, formType, gender,
        standingJump, medicineBall, tenMeterRun,
        twentyFiveMeterRun, practicalScore, totalScore
    } = req.body;
    const query = `
        INSERT INTO huniv (name, academy, formType, gender, standingJump, medicineBall, tenMeterRun, twentyFiveMeterRun, practicalScore, totalScore)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    connection.query(query, [name, academy, formType, gender, standingJump, medicineBall, tenMeterRun, twentyFiveMeterRun, practicalScore, totalScore], (error, results) => {
        if (error) {
            console.error('Error saving data:', error);
            res.status(500).json({ message: 'Internal Server Error' });
        } else {
            res.status(200).json({ message: 'Data saved successfully' });
        }
    });
});
// 정시 데이터 저장 엔드포인트
app.post('/save-ERICA-jeongsi', (req, res) => {
    const {
        name, academy, formType, gender,
        standingJump, medicineBall, tenMeterRun,
        twentyFiveMeterRun, practicalScore, totalScore, suengScore
    } = req.body;
    const query = `
        INSERT INTO huniv (name, academy, formType, gender, standingJump, medicineBall, tenMeterRun, twentyFiveMeterRun, practicalScore, totalScore, suengScore)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    connection.query(query, [name, academy, formType, gender, standingJump, medicineBall, tenMeterRun, twentyFiveMeterRun, practicalScore, totalScore, suengScore], (error, results) => {
        if (error) {
            console.error('Error saving data:', error);
            res.status(500).json({ message: 'Internal Server Error' });
        } else {
            res.status(200).json({ message: 'Data saved successfully' });
        }
    });
});
//가천대 데이터 저장 엔드포잉트
app.post('/ga-save', (req, res) => {
  const { name, academy, formType, gender, schoolScore, strength, medicineBall, standingJump, tenMeterRun, practicalScore, totalScore } = req.body;
  const query = 'INSERT INTO gachon_scores (name, academy, formType, gender, schoolScore, strength, medicineBall, standingJump, tenMeterRun, practicalScore, totalScore) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
  connection.query(query, [name, academy, formType, gender, schoolScore, strength, medicineBall, standingJump, tenMeterRun, practicalScore, totalScore], (err, result) => {
    if (err) {
      console.error('Error saving data:', err);
      return res.status(500).json({ success: false, message: 'Database error' });
    }
    res.status(200).json({ success: true, message: 'Data saved successfully' });
  });
});
// 데이터베이스의 각 테이블의 행 개수를 가져오는 엔드포인트
app.get('/get-row-counts', (req, res) => {
  const queries = [
    'SELECT COUNT(*) AS count FROM dscores',
    'SELECT COUNT(*) AS count FROM gachon_scores',
    'SELECT COUNT(*) AS count FROM huniv'
  ];

  Promise.all(queries.map(query => {
    return new Promise((resolve, reject) => {
      connection.query(query, (err, results) => {
        if (err) {
          reject(err);
        } else {
          resolve(results[0].count);
        }
      });
    });
  }))
  .then(counts => {
    res.status(200).json({
      dscores_count: counts[0],
      gachon_scores_count: counts[1],
      huniv_count: counts[2]
    });
  })
  .catch(err => {
    console.error('Failed to retrieve row counts:', err);
    res.status(500).json({ message: 'Failed to retrieve row counts', error: err });
  });
});
// 기존 코드 생략...

// updateScores 함수 정의
async function updateScores() {
  console.log('updateScores function started');
  try {
    const response = await axios.get('https://script.google.com/macros/s/AKfycbwIhwAWuAXQ04XjMdUem7PllWsS-lj1jenbwTWEuIQO6-7AWtdqnVDmDKIG8rjN4V0Gcg/exec');
    console.log('Data fetched from Google Apps Script');
    const data = response.data;

    // 변수 이름을 query로 수정
    const query = `
      INSERT INTO participants (
        exam_number, location, name, gender, grade, 
        longjump_record, longjump_score, shuttle_record, shuttle_score,
        medicine_ball_record, medicine_ball_score, back_strength_record,
        back_strength_score, total_score
      ) VALUES ? 
      ON DUPLICATE KEY UPDATE 
        location = VALUES(location),
        name = VALUES(name),
        gender = VALUES(gender),
        grade = VALUES(grade),
        longjump_record = VALUES(longjump_record),
        longjump_score = VALUES(longjump_score),
        shuttle_record = VALUES(shuttle_record),
        shuttle_score = VALUES(shuttle_score),
        medicine_ball_record = VALUES(medicine_ball_record),
        medicine_ball_score = VALUES(medicine_ball_score),
        back_strength_record = VALUES(back_strength_record),
        back_strength_score = VALUES(back_strength_score),
        total_score = VALUES(total_score)
    `;

    const values = data.map(row => [
      row.exam_number,
      row.location,
      row.name,
      row.gender === '남' || row.gender === '여' ? row.gender : '남', // 잘못된 gender 값을 처리
      row.grade,
      row.longjump_record === '결시' ? null : parseFloat(row.longjump_record) || 0,
      row.longjump_score === '' ? 0 : parseFloat(row.longjump_score) || 0,
      row.shuttle_record === '결시' ? null : parseFloat(row.shuttle_record) || 0,
      row.shuttle_score === '' ? 0 : parseFloat(row.shuttle_score) || 0,
      row.medicine_ball_record === '결시' ? null : parseFloat(row.medicine_ball_record) || 0,
      row.medicine_ball_score === '' ? 0 : parseFloat(row.medicine_ball_score) || 0,
      row.back_strength_record === '결시' ? null : parseFloat(row.back_strength_record) || 0,
      row.back_strength_score === '' ? 0 : parseFloat(row.back_strength_score) || 0,
      row.total_score === '' ? 0 : parseFloat(row.total_score) || 0
    ]);

connection.query(query, [values], (err, results) => {
  if (err) {
    console.error('Error updating scores:', err);
  } else {
    console.log('Scores updated successfully');
  }
});


    connection.query(query, [values], (err, results) => {
      if (err) {
        console.error('Error updating scores:', err);
      } else {
        console.log('Scores updated successfully');
      }
    });
  } catch (error) {
    console.error('Error fetching data from Google Sheets:', error);
  }
}

// 서버 시작 시 updateScores 즉시 실행
updateScores();

// 서버 시작 시 1분마다 updateScores 함수 실행
setInterval(updateScores, 60 * 1000);



// TOP 50 데이터를 가져오는 엔드포인트
app.get('/top50', (req, res) => {
  const query = `
    SELECT exam_number, location, name, gender, grade, total_score, longjump_record, medicine_ball_record, shuttle_record, back_strength_record
    FROM participants 
    WHERE total_score > 0
    ORDER BY total_score DESC, longjump_record DESC, medicine_ball_record DESC, shuttle_record ASC, back_strength_record DESC
    LIMIT 50;
  `;

  connection.query(query, (err, results) => {
    if (err) {
      console.error('데이터 가져오기 오류:', err);
      res.status(500).json({ message: '데이터 가져오기 오류', error: err });
      return;
    }
    res.status(200).json(results);
  });
});

// 예비반 상위 50명 데이터를 가져오는 엔드포인트
app.get('/preparatoryTop50', (req, res) => {
  const query = `
    SELECT exam_number, location, name, gender, grade, total_score, longjump_record, medicine_ball_record, shuttle_record, back_strength_record
    FROM participants 
    WHERE grade IN ('1', '2') AND total_score > 0
     ORDER BY total_score DESC, 
             longjump_record DESC,  
             shuttle_record ASC,  -- 빠른 기록이 더 좋으므로 오름차순으로 정렬
             back_strength_record DESC,
             medicine_ball_record DESC
    LIMIT 50;
  `;

  connection.query(query, (err, results) => {
    if (err) {
      console.error('데이터 가져오기 오류:', err);
      res.status(500).json({ message: '데이터 가져오기 오류', error: err });
      return;
    }
    res.status(200).json(results);
  });
});

// 제멀 남여 사우이 50명 데이터 가져오는 엔드포인트
app.get('/longjump/maleTop50', (req, res) => {
  const query = `
    SELECT exam_number, location, name, grade, longjump_record 
    FROM participants 
    WHERE gender = '남' AND longjump_record > 0
    ORDER BY longjump_record DESC 
    LIMIT 50;
  `;

  connection.query(query, (err, results) => {
    if (err) {
      console.error('데이터 가져오기 오류 (남자):', err);
      res.status(500).json({ message: '데이터 가져오기 오류 (남자)', error: err });
      return;
    }
    res.status(200).json(results);
  });
});

app.get('/longjump/femaleTop50', (req, res) => {
  const query = `
    SELECT exam_number, location, name, grade, longjump_record 
    FROM participants 
    WHERE gender = '여' AND longjump_record > 0
    ORDER BY longjump_record DESC 
    LIMIT 50;
  `;

  connection.query(query, (err, results) => {
    if (err) {
      console.error('데이터 가져오기 오류 (여자):', err);
      res.status(500).json({ message: '데이터 가져오기 오류 (여자)', error: err });
      return;
    }
    res.status(200).json(results);
  });
});
//10미
app.get('/tenMeterShuttle/maleTop50', (req, res) => {
  const query = `
    SELECT exam_number, location, name, grade, shuttle_record 
    FROM participants 
    WHERE gender = '남' AND shuttle_record > 0
    ORDER BY shuttle_record ASC 
    LIMIT 50;
  `;

  connection.query(query, (err, results) => {
    if (err) {
      console.error('데이터 가져오기 오류 (남자):', err);
      res.status(500).json({ message: '데이터 가져오기 오류 (남자)', error: err });
      return;
    }
    res.status(200).json(results);
  });
});

app.get('/tenMeterShuttle/femaleTop50', (req, res) => {
  const query = `
    SELECT exam_number, location, name, grade, shuttle_record 
    FROM participants 
    WHERE gender = '여' AND shuttle_record > 0
    ORDER BY shuttle_record ASC 
    LIMIT 50;
  `;

  connection.query(query, (err, results) => {
    if (err) {
      console.error('데이터 가져오기 오류 (여자):', err);
      res.status(500).json({ message: '데이터 가져오기 오류 (여자)', error: err });
      return;
    }
    res.status(200).json(results);
  });
});

//메디신
app.get('/medicineBall/maleTop50', (req, res) => {
  const query = `
    SELECT exam_number, location, name, grade, medicine_ball_record 
    FROM participants 
    WHERE gender = '남' AND medicine_ball_record > 0
    ORDER BY medicine_ball_record DESC 
    LIMIT 50;
  `;

  connection.query(query, (err, results) => {
    if (err) {
      console.error('데이터 가져오기 오류 (남자):', err);
      res.status(500).json({ message: '데이터 가져오기 오류 (남자)', error: err });
      return;
    }
    res.status(200).json(results);
  });
});
app.get('/medicineBall/femaleTop50', (req, res) => {
  const query = `
    SELECT exam_number, location, name, grade, medicine_ball_record 
    FROM participants 
    WHERE gender = '여' AND medicine_ball_record > 0
    ORDER BY medicine_ball_record DESC 
    LIMIT 50;
  `;

  connection.query(query, (err, results) => {
    if (err) {
      console.error('데이터 가져오기 오류 (여자):', err);
      res.status(500).json({ message: '데이터 가져오기 오류 (여자)', error: err });
      return;
    }
    res.status(200).json(results);
  });
});

//배근력
app.get('/backStrength/maleTop50', (req, res) => {
  const query = `
    SELECT exam_number, location, name, grade, back_strength_record 
    FROM participants 
    WHERE gender = '남' AND back_strength_record > 0
    ORDER BY back_strength_record DESC 
    LIMIT 50;
  `;

  connection.query(query, (err, results) => {
    if (err) {
      console.error('데이터 가져오기 오류 (남자):', err);
      res.status(500).json({ message: '데이터 가져오기 오류 (남자)', error: err });
      return;
    }
    res.status(200).json(results);
  });
});
app.get('/backStrength/femaleTop50', (req, res) => {
  const query = `
    SELECT exam_number, location, name, grade, back_strength_record 
    FROM participants 
    WHERE gender = '여' AND back_strength_record > 0
    ORDER BY back_strength_record DESC 
    LIMIT 50;
  `;

  connection.query(query, (err, results) => {
    if (err) {
      console.error('데이터 가져오기 오류 (여자):', err);
      res.status(500).json({ message: '데이터 가져오기 오류 (여자)', error: err });
      return;
    }
    res.status(200).json(results);
  });
});

// 남여총점순위
app.get('/overallTop50/male', (req, res) => {
  const query = `
    SELECT exam_number, location, name, grade, total_score 
    FROM participants 
    WHERE gender = '남' AND total_score > 0
    ORDER BY total_score DESC 
    LIMIT 50;
  `;

  connection.query(query, (err, results) => {
    if (err) {
      console.error('데이터 가져오기 오류 (남자):', err);
      res.status(500).json({ message: '데이터 가져오기 오류 (남자)', error: err });
      return;
    }
    res.status(200).json(results);
  });
});
app.get('/overallTop50/female', (req, res) => {
  const query = `
    SELECT exam_number, location, name, grade, total_score 
    FROM participants 
    WHERE gender = '여' AND total_score > 0
    ORDER BY total_score DESC 
    LIMIT 50;
  `;

  connection.query(query, (err, results) => {
    if (err) {
      console.error('데이터 가져오기 오류 (여자):', err);
      res.status(500).json({ message: '데이터 가져오기 오류 (여자)', error: err });
      return;
    }
    res.status(200).json(results);
  });
});

//입시반TOP50

app.get('/admissionsTop50', (req, res) => {
  const query = `
    SELECT exam_number, location, name, gender, grade, total_score, 
           longjump_record, medicine_ball_record, shuttle_record, back_strength_record 
    FROM participants 
    WHERE (grade = '3' OR grade = 'N') AND total_score > 0
    ORDER BY total_score DESC, 
             longjump_record DESC,  
             shuttle_record ASC,  -- 빠른 기록이 더 좋으므로 오름차순으로 정렬
             back_strength_record DESC,
             medicine_ball_record DESC
    LIMIT 50;
  `;

  connection.query(query, (err, results) => {
    if (err) {
      console.error('데이터 가져오기 오류:', err);
      res.status(500).json({ message: '데이터 가져오기 오류', error: err });
      return;
    }
    res.status(200).json(results);
  });
});


// '26susi' 데이터를 가져오는 엔드포인트
app.get('/26susi', authenticateToken, (req, res) => {
  const query = 'SELECT * FROM 26susi';
  connection.query(query, (err, rows) => {
    if (err) {
      console.error('Database query failed:', err);
      res.status(500).json({ message: 'Database query failed', error: err });
      return;
    }
    res.status(200).json(rows);
  });
});

async function updateSusiData() {
  try {
    const response = await axios.get('https://script.google.com/macros/s/AKfycby3O3Dvzv-ZnPsgHjfITB7JV8kPL1K5fybnlwwlPKEkCPj2WabmzP0ZQylip6MHQKNPSA/exec');
    const data = response.data;

    // MySQL에 있는 현재 데이터 가져오기
    const existingRows = await new Promise((resolve, reject) => {
      connection.query('SELECT 이름, 학교, 성별, 학년, 대학명, 학과명, 전형명 FROM 25susiresult', (err, results) => {
        if (err) return reject(err);
        resolve(results);
      });
    });

    // 구글 시트에 존재하는 항목들만 필터링
    const existingKeys = data.map(row => `${row.name}_${row.school}_${row.gender}_${row.grade}_${row.university}_${row.major}_${row.admission_type}`);

    // MySQL에 있는 데이터 중 구글 시트에 없는 항목들 삭제
    const rowsToDelete = existingRows.filter(row => {
      const key = `${row.이름}_${row.학교}_${row.성별}_${row.학년}_${row.대학명}_${row.학과명}_${row.전형명}`;
      return !existingKeys.includes(key);
    });

    if (rowsToDelete.length > 0) {
      const deleteQuery = `DELETE FROM 25susiresult WHERE (이름, 학교, 성별, 학년, 대학명, 학과명, 전형명) IN (?)`;
      const deleteValues = rowsToDelete.map(row => [
        row.이름, row.학교, row.성별, row.학년, row.대학명, row.학과명, row.전형명
      ]);

      connection.query(deleteQuery, [deleteValues], (err, results) => {
        if (err) {
          console.error('Error deleting rows from 25susiresult:', err);
        } else {
          console.log(`${results.affectedRows} rows deleted from 25susiresult`);
        }
      });
    }

    // INSERT 또는 UPDATE 동작
    const query = 
      `INSERT INTO 25susiresult (
        교육원, 이름, 학교, 성별, 학년, 대학명, 학과명, 전형명, 환산내신, 등급, 기타, 실기점수, 총점, 최초합격여부, 최종합격여부,
        실기1종목, 실기1기록, 실기1점수, 실기2종목, 실기2기록, 실기2점수, 실기3종목, 실기3기록, 실기3점수, 실기4종목, 실기4기록, 실기4점수, 실기5종목, 실기5기록, 실기5점수, 실기6종목, 실기6기록, 실기6점수
      ) VALUES ? ON DUPLICATE KEY UPDATE 
        교육원 = VALUES(교육원), 이름 = VALUES(이름), 학교 = VALUES(학교), 성별 = VALUES(성별), 학년 = VALUES(학년), 대학명 = VALUES(대학명), 학과명 = VALUES(학과명), 전형명 = VALUES(전형명), 
        환산내신 = VALUES(환산내신), 등급 = VALUES(등급), 기타 = VALUES(기타), 실기점수 = VALUES(실기점수), 총점 = VALUES(총점), 최초합격여부 = VALUES(최초합격여부), 최종합격여부 = VALUES(최종합격여부),
        실기1종목 = VALUES(실기1종목), 실기1기록 = VALUES(실기1기록), 실기1점수 = VALUES(실기1점수), 실기2종목 = VALUES(실기2종목), 실기2기록 = VALUES(실기2기록), 실기2점수 = VALUES(실기2점수), 
        실기3종목 = VALUES(실기3종목), 실기3기록 = VALUES(실기3기록), 실기3점수 = VALUES(실기3점수), 실기4종목 = VALUES(실기4종목), 실기4기록 = VALUES(실기4기록), 실기4점수 = VALUES(실기4점수),
        실기5종목 = VALUES(실기5종목), 실기5기록 = VALUES(실기5기록), 실기5점수 = VALUES(실기5점수), 실기6종목 = VALUES(실기6종목), 실기6기록 = VALUES(실기6기록), 실기6점수 = VALUES(실기6점수)
      `;

    const values = data.map(row => [
      row.education_center || '', row.name || '', row.school || '', row.gender || '', row.grade || '', row.university || null,
      row.major || '', row.admission_type || '', row.score_converted || null, row.grade_level || null, row.other_info || null,
      row.practical_score || null, row.total_score || null, row.initial_pass || null, row.final_pass || null,
      row.practical1_name || null, row.practical1_record || null, row.practical1_score || null,
      row.practical2_name || null, row.practical2_record || null, row.practical2_score || null,
      row.practical3_name || null, row.practical3_record || null, row.practical3_score || null,
      row.practical4_name || null, row.practical4_record || null, row.practical4_score || null,
      row.practical5_name || null, row.practical5_record || null, row.practical5_score || null,
      row.practical6_name || null, row.practical6_record || null, row.practical6_score || null
    ]);

    connection.query(query, [values], (err, results) => {
      if (err) {
        console.error('Error updating 25susiresult:', err);
      } else {
        console.log('25susiresult updated successfully');
      }
    });
  } catch (error) {
    console.error('Error fetching data:', error);
  }
}
// 서버 시작 시 25susiupdate 즉시 실행
updateSusiData();

// 서버 시작 시 1분마다 updateSusiData 함수 실행
setInterval(updateSusiData, 60 * 1000);








// 대학명, 학과명, 전형명 드롭다운 데이터를 가져오는 엔드포인트
app.get('/25susi-dropdowns', (req, res) => {
  const query = 'SELECT DISTINCT 대학명 FROM 25susiresult ORDER BY 대학명 ASC';
  connection.query(query, (err, results) => {
    if (err) {
      return res.status(500).json({ message: 'Error fetching universities', error: err });
    }
    const universities = results.map(row => row.대학명);
    res.status(200).json({ universities });
  });
});

// 학과명 드롭다운 데이터를 가져오는 엔드포인트
app.get('/25susi-majors', (req, res) => {
  const university = req.query.university;
  const query = 'SELECT DISTINCT 학과명 FROM 25susiresult WHERE 대학명 = ? ORDER BY 학과명 ASC';
  connection.query(query, [university], (err, results) => {
    if (err) {
      return res.status(500).json({ message: 'Error fetching majors', error: err });
    }
    const majors = results.map(row => row.학과명);
    res.status(200).json({ majors });
  });
});

// 전형명 드롭다운 데이터를 가져오는 엔드포인트
app.get('/25susi-admissionTypes', (req, res) => {
  const { university, major } = req.query;
  const query = 'SELECT DISTINCT 전형명 FROM 25susiresult WHERE 대학명 = ? AND 학과명 = ? ORDER BY 전형명 ASC';
  connection.query(query, [university, major], (err, results) => {
    if (err) {
      return res.status(500).json({ message: 'Error fetching admission types', error: err });
    }
    const admissionTypes = results.map(row => row.전형명);
    res.status(200).json({ admissionTypes });
  });
});

// 필터 조건에 맞는 데이터를 가져오는 엔드포인트
// JWT 인증을 적용한 필터 데이터 엔드포인트
app.get('/25susi-filter', (req, res) => {
  const { university, major, admissionType } = req.query;
  
  const query = `
    SELECT 교육원, 이름, 학교, 성별, 학년, 환산내신, 등급, 실기점수, 총점, 최초합격여부, 최종합격여부,
           실기1종목, 실기1기록, 실기1점수, 실기2종목, 실기2기록, 실기2점수, 실기3종목, 실기3기록, 실기3점수,
           실기4종목, 실기4기록, 실기4점수, 실기5종목, 실기5기록, 실기5점수, 실기6종목, 실기6기록, 실기6점수
    FROM 25susiresult 
    WHERE 대학명 = ? AND 학과명 = ? AND 전형명 = ?
  `;

  connection.query(query, [university, major, admissionType], (err, results) => {
    if (err) {
      return res.status(500).json({ message: 'Error fetching filtered data', error: err });
    }
    res.status(200).json(results);
  });
});

// 새로운 엔드포인트 추가: /25susi-list
app.get('/25susi-list', (req, res) => {
  const { university, major } = req.query;

  const query = `
    SELECT other.대학명, other.학과명, COUNT(DISTINCT other.이름, other.학교) AS 지원자수
    FROM 25susiresult AS base
    JOIN 25susiresult AS other ON base.이름 = other.이름 
                                AND base.학교 = other.학교
    WHERE base.대학명 = ? AND base.학과명 = ?
      AND (other.대학명 != ? OR other.학과명 != ?)
    GROUP BY other.대학명, other.학과명
    ORDER BY 지원자수 DESC
    LIMIT 5;
  `;

  connection.query(query, [university, major, university, major], (err, results) => {
    if (err) {
      console.error('Error fetching top 5 university rankings:', err);
      return res.status(500).json({ message: 'Error fetching top 5 university rankings', error: err });
    }
    res.status(200).json(results);
  });
});







// 군, 대학명, 학과명 드롭다운 데이터를 가져오는 엔드포인트
app.get('/getSelectionData', (req, res) => {
  const query = 'SELECT DISTINCT 군, 대학명, 학과명 FROM `25정시정보`';
  
  connection.query(query, (error, results) => {
    if (error) {
      return res.status(500).send(error);
    }
    res.json(results);
  });
});

// 군, 대학명, 학과명에 대한 세부 정보 (모집인원, 일정 등)를 가져오는 엔드포인트
app.get('/getSchoolDetails', (req, res) => {
  const { 군, 대학명, 학과명 } = req.query;

  const query = `
    SELECT 모집인원, 24모집인원, 24지원인원, 24경쟁률, 1단계및면접일정, 실기일정, 합격자발표일정, 국어, 수학, 영어, 탐구, 탐구수, 한국사, 한국사1, 한국사2, 한국사3, 한국사4, 한국사5, 한국사6, 한국사7, 한국사8, 한국사9, 반영지표, 영어1, 영어2, 영어3, 영어4, 영어5, 영어6, 영어7, 영어8, 영어9
    FROM \`25정시정보\`
    WHERE 군 = ? AND 대학명 = ? AND 학과명 = ?`;

  connection.query(query, [군, 대학명, 학과명], (error, results) => {
    if (error) {
      return res.status(500).send(error);
    }
    res.json(results[0] || {}); // 데이터가 없을 경우 빈 객체 반환
  });
});

// 선택한 군, 대학명, 학과명에 따른 결과 데이터를 25정시결과 테이블에서 가져오는 엔드포인트
app.get('/getSchoolResult', (req, res) => {
  const { 군, 대학명, 학과명 } = req.query;

  const query = `
    SELECT 지점, 학교, 학년, 성별, 이름, 국어과목, 국어원점수, 국어표점, 국어백분위, 국어등급,
           수학과목, 수학원점수, 수학표점, 수학백분위, 수학등급, 영어원점수, 영어등급,
           탐1과목, 탐1원점수, 탐1표점, 탐1백분위, 탐1등급, 탐2과목, 탐2원점수, 탐2표점,
           탐2백분위, 탐2등급, 한국사원점수, 한국사등급, 내신,
           ${군}_군, ${군}_대학명, ${군}_학과명, ${군}_수능, ${군}_내신, ${군}_실기,
           ${군}_총점, ${군}_최초결과, ${군}_최종결과,
           ${군}_실기종목1, ${군}1_기록, ${군}1_점수,
           ${군}_실기종목2, ${군}2_기록, ${군}2_점수,
           ${군}_실기종목3, ${군}3_기록, ${군}3_점수,
           ${군}_실기종목4, ${군}4_기록, ${군}4_점수,
           ${군}_실기종목5, ${군}5_기록, ${군}5_점수,
           ${군}_실기종목6, ${군}6_기록, ${군}6_점수
    FROM \`25정시결과\`
    WHERE ${군}_군 = ? AND ${군}_대학명 = ? AND ${군}_학과명 = ?`;

  connection.query(query, [군, 대학명, 학과명], (error, results) => {
    if (error) {
      return res.status(500).send(error);
    }
    res.json(results);
  });
});

const fetchAndUpdateData = async () => {
  console.log('fetchAndUpdateData function started');
  try {
    // Google Apps Script URL에서 데이터 가져오기
    const response = await axios.get(
      'https://script.google.com/macros/s/AKfycbzlaEJ3_8ewfYD30gGLeACnKMh2SFXLbXPMf4z94ioYRZG1fF1JYbMc7XTBo_Ked9u3/exec'
    );
    const data = response.data;

    if (Array.isArray(data)) {
      console.log('Data fetched from Google Apps Script');

      // MySQL INSERT 쿼리
      const query = `
        INSERT INTO 성적및대학 (
          이름, 성별, 군, 대학명, 학과명, 수능점수, 내신점수, 
          실기종목1, 실기종목2, 실기종목3, 실기종목4, 실기종목5, 실기종목6
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          대학명 = VALUES(대학명),
          학과명 = VALUES(학과명),
          수능점수 = VALUES(수능점수),
          내신점수 = VALUES(내신점수),
          실기종목1 = VALUES(실기종목1),
          실기종목2 = VALUES(실기종목2),
          실기종목3 = VALUES(실기종목3),
          실기종목4 = VALUES(실기종목4),
          실기종목5 = VALUES(실기종목5),
          실기종목6 = VALUES(실기종목6)
      `;

      const promises = [];

      // 데이터를 순회하여 가군, 나군, 다군 처리
      data.forEach((row) => {
        ['가군', '나군', '다군'].forEach((군) => {
          const 군데이터 = row[군];
          if (군데이터 && 군데이터.대학명) {
            // 데이터가 존재하고 대학명이 있을 경우에만 삽입
            const values = [
              row.이름,
              row.성별,
              군데이터.군,
              군데이터.대학명,
              군데이터.학과명,
              군데이터.수능점수 || 0,
              군데이터.내신점수 || 0,
              군데이터.실기종목1 || '',
              군데이터.실기종목2 || '',
              군데이터.실기종목3 || '',
              군데이터.실기종목4 || '',
              군데이터.실기종목5 || '',
              군데이터.실기종목6 || '',
            ];

            // MySQL 쿼리를 Promise로 처리
            promises.push(
              new Promise((resolve, reject) => {
                connection.query(query, values, (err, result) => {
                  if (err) {
                    console.error(`Error inserting/updating data for ${군}:`, err);
                    reject(err);
                  } else {
                    resolve(result);
                  }
                });
              })
            );
          }
        });
      });

      // 모든 삽입 및 업데이트 완료 대기
      await Promise.all(promises);
      console.log('Scores updated successfully');
    }
  } catch (error) {
    console.error('Error fetching or updating data:', error);
    throw error;
  }
};


// 서버 시작 시 데이터 가져오기
fetchAndUpdateData();

// 1분마다 데이터 업데이트
setInterval(fetchAndUpdateData, 60000);

///////////////////일산맥스점수25

app.post('/25login', (req, res) => {
    const { name, code } = req.body;

    // 입력값 검증
    if (!name || !code) {
        return res.status(400).json({ success: false, message: '이름과 코드가 필요합니다.' });
    }

    // MySQL 쿼리
    const query = `
        SELECT 이름 FROM 식별코드 WHERE 이름 = ? AND 코드 = ?
    `;
    connection.query(query, [name, code], (err, results) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ success: false, message: 'Database error.' });
        }

        if (results.length === 0) {
            // 이름과 코드가 일치하지 않는 경우
            return res.status(401).json({ success: false, message: '이름 또는 코드가 올바르지 않습니다.' });
        }

        // 로그인 성공
        return res.status(200).json({ success: true, name: results[0].이름 });
    });
});



app.post('/25getStudentScores', async (req, res) => {
    const { name } = req.body;

    const query = `
        SELECT 성별, 군, 대학명, 학과명, 수능점수, 내신점수, 
               실기종목1, 실기종목2, 실기종목3, 실기종목4, 실기종목5, 실기종목6
        FROM 성적및대학
        WHERE 이름 = ?
    `;

    connection.query(query, [name], (err, results) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ success: false, message: 'Database error' });
        }

        if (results.length === 0) {
            return res.status(404).json({ success: false, message: 'Student not found' });
        }

        // 성별과 점수 데이터를 포함하여 반환
        const gender = results[0].성별; // 첫 번째 결과의 성별
        return res.status(200).json({ success: true, gender, data: results });
    });
});

////계산로직
app.post('/25calculatePracticalScores', async (req, res) => {
    const { universityName, majorName, gender, records } = req.body;

    if (!universityName || !majorName || !gender || !Array.isArray(records) || records.length === 0) {
        return res.status(400).json({ success: false, message: 'Invalid input data' });
    }

    try {
        // Step 1: 학교번호 찾기
        const schoolNumberQuery = `
            SELECT 학교번호 
            FROM 학교번호
            WHERE 대학명 = ? AND 학과명 = ?
        `;
        const schoolNumber = await new Promise((resolve, reject) => {
            connection.query(schoolNumberQuery, [universityName, majorName], (err, results) => {
                if (err) {
                    console.error('SQL Query Error (학교번호):', err);
                    return reject(err);
                }
                if (results.length === 0) {
                    console.error(`학교번호를 찾을 수 없습니다: 대학명=${universityName}, 학과명=${majorName}`);
                    return reject('학교번호를 찾을 수 없습니다.');
                }
                resolve(results[0].학교번호);
            });
        });

        // Step 2: 25실기배점 데이터 가져오기
        const practicalPointsQuery = `
            SELECT \`배점\`, ${Array.from({ length: 36 }, (_, i) => `\`배점_[${i}]\``).join(', ')}
            FROM 25실기배점
            WHERE 학교번호 = ?
        `;
        const practicalPoints = await new Promise((resolve, reject) => {
            connection.query(practicalPointsQuery, [schoolNumber], (err, results) => {
                if (err) {
                    console.error('SQL Query Error (실기 배점):', err);
                    return reject(err);
                }
                if (results.length === 0) {
                    console.error(`실기 배점을 찾을 수 없습니다: 학교번호=${schoolNumber}`);
                    return reject('실기 배점을 찾을 수 없습니다.');
                }
                resolve(results);
            });
        });

        // Step 3: 점수 계산
const scores = records.map((record, recordIndex) => {
    const startIndex = recordIndex * 3; // 각 record별로 3개의 행(남자기록, 배점, 여자기록)을 차지

    const 남자기록 = practicalPoints[startIndex] ? extractRange(practicalPoints[startIndex], '배점') : [];
    const 배점 = practicalPoints[startIndex + 1] ? extractRange(practicalPoints[startIndex + 1], '배점') : [];
    const 여자기록 = practicalPoints[startIndex + 2] ? extractRange(practicalPoints[startIndex + 2], '배점') : [];

    if (gender === '남') {
        return 남자기록.length && 배점.length ? lookup(record, 남자기록, 배점) : 0;
    } else if (gender === '여') {
        return 여자기록.length && 배점.length ? lookup(record, 여자기록, 배점) : 0;
    }
    return 0; // 잘못된 성별일 경우 기본값 반환
});




        // Step 4: 디버깅용 데이터 추가 반환
        return res.status(200).json({ 
            success: true, 
            scores,
            practicalPoints, // 기록 및 배점 데이터 반환
            schoolNumber // 학교번호 반환
        });
    } catch (error) {
        console.error('점수 계산 오류:', error);
        return res.status(500).json({ success: false, message: '점수 계산에 실패했습니다.', error });
    }
});

// Lookup 함수
function lookup(value, range, resultRange) {
    value = parseFloat(value);

    if (isNaN(value)) return 0; // 입력값이 유효하지 않으면 0점 반환

    for (let i = range.length - 1; i >= 0; i--) {
        if (value >= range[i]) {
            return resultRange[i] || 0; // 범위 내 점수 반환
        }
    }
    return 0; // 범위에 미달하면 0점
}

// 필요한 배점 데이터만 추출
function extractRange(row, prefix) {
    const keys = Object.keys(row).filter(key => key.startsWith(prefix)); // 배점 키 추출
    return keys
        .map(key => parseFloat(row[key]))
        .filter(value => !isNaN(value)); // 숫자만 반환
}
////////////25.21.11 추가분

// ✅ 학생 정보 추가
app.post('/adminstudent', (req, res) => { 
    console.log("🔹 받은 데이터:", req.body);  // 요청 데이터 확인

    const { 이름, 학교, 학년, 성별, 연락처 } = req.body;
    const 출석_월 = req.body.출석_월 ? 1 : 0;
    const 출석_화 = req.body.출석_화 ? 1 : 0;
    const 출석_수 = req.body.출석_수 ? 1 : 0;
    const 출석_목 = req.body.출석_목 ? 1 : 0;
    const 출석_금 = req.body.출석_금 ? 1 : 0;
    const 출석_토 = req.body.출석_토 ? 1 : 0;
    const 출석_일 = req.body.출석_일 ? 1 : 0;

    if (!이름 || !성별) {
        return res.status(400).json({ message: '이름과 성별은 필수 입력 값입니다.' });
    }

    const query = `INSERT INTO 25학생관리 (이름, 학교, 학년, 성별, 연락처, 출석_월, 출석_화, 출석_수, 출석_목, 출석_금, 출석_토, 출석_일) 
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    const values = [이름, 학교, 학년, 성별, 연락처, 출석_월, 출석_화, 출석_수, 출석_목, 출석_금, 출석_토, 출석_일];

    connection.query(query, values, (err, result) => {
        if (err) {
            console.error('❌ 학생 추가 오류:', err);  // 서버 로그에 에러 출력
            return res.status(500).json({ message: '학생 추가 실패', error: err.sqlMessage });
        }
        res.status(201).json({ message: '학생 추가 성공', studentId: result.insertId });
    });
});


// ✅ 학생 정보 수정
app.put('/adminstudent/:id', (req, res) => {
    const { 이름, 학교, 학년, 성별, 연락처, 출석_월, 출석_화, 출석_수, 출석_목, 출석_금, 출석_토, 출석_일 } = req.body;
    const studentId = req.params.id;

    const query = `UPDATE 25학생관리 SET 이름 = ?, 학교 = ?, 학년 = ?, 성별 = ?, 연락처 = ?, 출석_월 = ?, 출석_화 = ?, 출석_수 = ?, 출석_목 = ?, 출석_금 = ?, 출석_토 = ?, 출석_일 = ? WHERE id = ?`;

    connection.query(query, [이름, 학교, 학년, 성별, 연락처, 출석_월, 출석_화, 출석_수, 출석_목, 출석_금, 출석_토, 출석_일, studentId], (err, result) => {
        if (err) {
            console.error('학생 수정 오류:', err);
            return res.status(500).json({ message: '학생 수정 실패', error: err });
        }
        res.status(200).json({ message: '학생 수정 성공' });
    });
});

// ✅ 학생 정보 삭제
app.delete('/adminstudent/:id', (req, res) => {
    const studentId = req.params.id;

    const query = `DELETE FROM 25학생관리 WHERE id = ?`;
    connection.query(query, [studentId], (err, result) => {
        if (err) {
            console.error('학생 삭제 오류:', err);
            return res.status(500).json({ message: '학생 삭제 실패', error: err });
        }
        res.status(200).json({ message: '학생 삭제 성공' });
    });
});

// ✅ 모든 학생 정보 조회
app.get('/adminstudents', (req, res) => {
    const query = `SELECT * FROM 25학생관리`;
    connection.query(query, (err, results) => {
        if (err) {
            console.error('학생 목록 조회 오류:', err);
            return res.status(500).json({ message: '학생 목록 조회 실패', error: err });
        }
        res.status(200).json(results);
    });
});

// ✅ 오늘 출석해야 할 학생 조회
app.get('/attendancetoday', (req, res) => {
    const query = `
        SELECT s.id, s.이름, s.학교, s.학년, s.성별, a.출석상태, a.사유
        FROM 25학생관리 s
        LEFT JOIN 25출석기록 a 
        ON s.id = a.학생_id AND a.출석일 = CURDATE()
        WHERE 
            (CASE 
                WHEN DAYOFWEEK(CURDATE()) = 2 THEN s.출석_월
                WHEN DAYOFWEEK(CURDATE()) = 3 THEN s.출석_화
                WHEN DAYOFWEEK(CURDATE()) = 4 THEN s.출석_수
                WHEN DAYOFWEEK(CURDATE()) = 5 THEN s.출석_목
                WHEN DAYOFWEEK(CURDATE()) = 6 THEN s.출석_금
                WHEN DAYOFWEEK(CURDATE()) = 7 THEN s.출석_토
                WHEN DAYOFWEEK(CURDATE()) = 1 THEN s.출석_일
            END) = TRUE;
    `;

    connection.query(query, (err, results) => {
        if (err) {
            console.error('출석 목록 조회 오류:', err);
            return res.status(500).json({ message: '출석 목록 조회 실패', error: err });
        }
        res.status(200).json(results);
    });
});

// ✅ 출석 체크 저장 엔드포인트
app.post('/attendancerecord', (req, res) => {
    const attendanceData = req.body;

    if (!Array.isArray(attendanceData) || attendanceData.length === 0) {
        return res.status(400).json({ message: "출석 데이터가 비어있습니다." });
    }

    console.log("📌 서버에서 받은 출석 데이터:", attendanceData);

    let successCount = 0;
    let errorCount = 0;

    attendanceData.forEach(record => {
        const { 학생_id, 출석일, 출석상태, 사유 } = record;

        if (!학생_id || !출석일 || !출석상태) {
            console.error(`❌ 데이터 오류: 학생 ID=${학생_id}, 출석일=${출석일}`);
            errorCount++;
            return;
        }

        // 기존 출석 데이터가 있는지 확인
        connection.query(
            `SELECT * FROM 25출석기록 WHERE 학생_id = ? AND 출석일 = ?`,
            [학생_id, 출석일],
            (err, existing) => {
                if (err) {
                    console.error(`❌ SQL SELECT 오류 (학생 ID: ${학생_id}):`, err);
                    errorCount++;
                    return;
                }

                if (existing.length > 0) {
                    console.log(`🔄 기존 출석 기록 존재 → UPDATE 실행: 학생 ID=${학생_id}`);

                    // ✅ 기존 데이터가 있으면 UPDATE
                    connection.query(
                        `UPDATE 25출석기록 SET 출석상태 = ?, 사유 = ? WHERE 학생_id = ? AND 출석일 = ?`,
                        [출석상태, 사유 || null, 학생_id, 출석일],
                        (updateErr) => {
                            if (updateErr) {
                                console.error(`❌ SQL UPDATE 오류 (학생 ID: ${학생_id}):`, updateErr);
                                errorCount++;
                            } else {
                                successCount++;
                            }
                        }
                    );
                } else {
                    console.log(`🆕 출석 기록 없음 → INSERT 실행: 학생 ID=${학생_id}`);

                    // ✅ 기존 출석 기록이 없으면 INSERT
                    connection.query(
                        `INSERT INTO 25출석기록 (학생_id, 출석일, 출석상태, 사유) VALUES (?, ?, ?, ?)`,
                        [학생_id, 출석일, 출석상태, 사유 || null],
                        (insertErr) => {
                            if (insertErr) {
                                console.error(`❌ SQL INSERT 오류 (학생 ID: ${학생_id}):`, insertErr);
                                errorCount++;
                            } else {
                                successCount++;
                            }
                        }
                    );
                }
            }
        );
    });

    // 응답을 비동기로 처리해야 하므로 setTimeout으로 약간의 딜레이 후 응답
    setTimeout(() => {
        res.status(200).json({ message: `${successCount}명의 출석 체크 완료, 오류 ${errorCount}건` });
    }, 500);
});

// ✅ 특정 월의 출석 통계 조회 (예: /attendancemonth?year=2025&month=02)
app.get('/attendancemonth', (req, res) => {
    const { year, month } = req.query;

    if (!year || !month) {
        return res.status(400).json({ message: "연도와 월을 입력하세요 (예: ?year=2025&month=02)" });
    }

    const yearMonth = `${year}-${month.padStart(2, '0')}`;

    const query = `
        SELECT DATE_FORMAT(출석일, '%Y-%m-%d') AS 출석일, 
               SUM(CASE WHEN 출석상태 = '출석' THEN 1 ELSE 0 END) AS 출석,
               SUM(CASE WHEN 출석상태 = '지각' THEN 1 ELSE 0 END) AS 지각,
               SUM(CASE WHEN 출석상태 = '결석' THEN 1 ELSE 0 END) AS 결석
        FROM 25출석기록
        WHERE 출석일 LIKE ?
        GROUP BY 출석일
        ORDER BY 출석일 ASC;
    `;

    connection.query(query, [`${yearMonth}%`], (err, results) => {
        if (err) {
            console.error('❌ 월별 출석 통계 조회 오류:', err);
            return res.status(500).json({ message: '월별 출석 데이터 조회 실패', error: err });
        }
        res.status(200).json(results);
    });
});

// ✅ 특정 날짜의 출석 상세 조회 (예: /attendanceday?date=2025-02-12)
// ✅ 특정 날짜의 출석 상세 조회 (해당 요일 출석 대상 포함)
app.get('/attendanceday', (req, res) => {
    const { date } = req.query;

    if (!date) {
        return res.status(400).json({ message: "날짜를 입력하세요 (예: ?date=2025-02-12)" });
    }

    const query = `
        SELECT s.id, s.이름, s.학교, s.학년, s.성별, 
               s.출석_월, s.출석_화, s.출석_수, s.출석_목, s.출석_금, s.출석_토, s.출석_일, 
               a.출석상태, a.사유,
               DATE_FORMAT(a.출석일, '%Y-%m-%d') AS 출석일
        FROM 25학생관리 s
        LEFT JOIN 25출석기록 a 
        ON s.id = a.학생_id AND a.출석일 = ?
        ORDER BY s.이름 ASC;
    `;

    connection.query(query, [date], (err, results) => {
        if (err) {
            console.error('❌ 특정 날짜 출석 조회 오류:', err);
            return res.status(500).json({ message: '출석 데이터 조회 실패', error: err });
        }
        res.status(200).json(results);
    });
});

//학생별 월 출석 통계
app.get('/attendancemonthstudent', (req, res) => {
    const { year, month, studentId } = req.query;

    if (!year || !month || !studentId) {
        return res.status(400).json({ message: '연도, 월, 학생 ID를 입력해주세요.' });
    }

    const query = `
        SELECT DATE_FORMAT(출석일, '%Y-%m-%d') AS 출석일, 출석상태, 사유
        FROM 25출석기록
        WHERE 학생_id = ? AND YEAR(출석일) = ? AND MONTH(출석일) = ?
        ORDER BY 출석일;
    `;

    connection.query(query, [studentId, year, month], (err, results) => {
        if (err) {
            console.error('학생 월별 출결 조회 오류:', err);
            return res.status(500).json({ message: '학생 월별 출결 조회 실패', error: err });
        }
        res.status(200).json(results);
    });
});

////20250219 일산

// ✅ 강사 등록
app.post('/teacher', (req, res) => {
    const { 이름, 직급, 전화번호, 주민번호, 은행명, 계좌번호 } = req.body;

    if (!이름 || !주민번호 || !은행명 || !계좌번호) {
        return res.status(400).json({ message: "이름, 주민번호, 은행명, 계좌번호는 필수 입력값입니다." });
    }

    const query = `
        INSERT INTO \`25강사관리\` (이름, 직급, 전화번호, 주민번호, 은행명, 계좌번호) 
        VALUES (?, ?, ?, ?, ?, ?)
    `;

    connection.query(query, [이름, 직급, 전화번호, 주민번호, 은행명, 계좌번호], (err, result) => {
        if (err) {
            console.error("❌ 강사 등록 실패:", err);
            return res.status(500).json({ message: "강사 등록 실패", error: err });
        }
        res.status(201).json({ message: "강사 등록 성공", id: result.insertId });
    });
});

// 특정 강사 정보 조회
app.get('/teachers/:id', (req, res) => {
    const teacherId = req.params.id;
    connection.query('SELECT * FROM `25강사관리` WHERE id = ?', [teacherId], (err, results) => {
        if (err) {
            console.error('강사 정보 조회 실패:', err);
            return res.status(500).json({ message: '강사 정보 조회 실패', error: err });
        }
        if (results.length === 0) {
            return res.status(404).json({ message: '강사를 찾을 수 없습니다.' });
        }
        res.status(200).json(results[0]);
    });
});

// 강사 정보 수정
app.put('/teacher/:id', (req, res) => {
    const teacherId = req.params.id;
    const { 이름, 직급, 전화번호, 주민번호, 은행명, 계좌번호 } = req.body;

    if (!이름 || !주민번호 || !은행명 || !계좌번호) {
        return res.status(400).json({ message: "이름, 주민번호, 은행명, 계좌번호는 필수 입력값입니다." });
    }

    const query = `
        UPDATE \`25강사관리\` 
        SET 이름 = ?, 직급 = ?, 전화번호 = ?, 주민번호 = ?, 은행명 = ?, 계좌번호 = ?
        WHERE id = ?
    `;

    connection.query(query, [이름, 직급, 전화번호, 주민번호, 은행명, 계좌번호, teacherId], (err, result) => {
        if (err) {
            console.error("강사 정보 수정 실패:", err);
            return res.status(500).json({ message: "강사 정보 수정 실패", error: err });
        }
        res.status(200).json({ message: "강사 정보 수정 성공" });
    });
});

// 강사 삭제
app.delete('/teacher/:id', (req, res) => {
    const teacherId = req.params.id;
    connection.query('DELETE FROM `25강사관리` WHERE id = ?', [teacherId], (err, result) => {
        if (err) {
            console.error('강사 삭제 실패:', err);
            return res.status(500).json({ message: '강사 삭제 실패', error: err });
        }
        res.status(200).json({ message: '강사 삭제 성공' });
    });
});

// ✅ 강사 목록 조회
app.get('/teachers', (req, res) => {
    connection.query(`SELECT * FROM \`25강사관리\``, (err, results) => {
        if (err) {
            console.error('강사 목록 조회 실패:', err);
            return res.status(500).json({ message: '강사 목록 조회 실패', error: err });
        }
        res.status(200).json(results);
    });
});

// ✅ 특정 강사의 출근부 조회
app.get('/attendanceteacher', (req, res) => {
    const { id, year, month } = req.query;
    
    const lastDay = new Date(year, month, 0).getDate();
    const startDate = `${year}-${month}-01`;
    const endDate = `${year}-${month}-${lastDay}`;

    const query = `
        SELECT 강사_id, DATE_FORMAT(출근일, '%Y-%m-%d') AS 출근일, 
               월요일, 화요일, 수요일, 목요일, 금요일, 토요일, 일요일, 출근, 지각, 휴무, 근무시간
        FROM \`25출근기록\`
        WHERE 강사_id = ? AND 출근일 BETWEEN ? AND ?
        ORDER BY 출근일
    `;

    connection.query(query, [id, startDate, endDate], (err, results) => {
        if (err) {
            console.error('❌ 출근부 조회 실패:', err);
            return res.status(500).json({ message: '출근부 조회 실패', error: err });
        }

        res.status(200).json(results);
    });
});

// ✅ 출근 체크 등록 및 수정
app.post('/attendancecheck', async (req, res) => {
    const attendanceData = req.body;

    if (!Array.isArray(attendanceData) || attendanceData.length === 0) {
        return res.status(400).json({ message: '출근 데이터가 비어있습니다.' });
    }

    try {
        const queries = attendanceData.map(({ 강사_id, 출근일, 상태, 근무시간 }) => {
            const query = `
                INSERT INTO 25출근기록 (강사_id, 출근일, 출근, 지각, 휴무, 근무시간) 
                VALUES (?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE 
                    출근 = VALUES(출근),
                    지각 = VALUES(지각),
                    휴무 = VALUES(휴무),
                    근무시간 = VALUES(근무시간)
            `;

            return new Promise((resolve, reject) => {
                connection.query(query, [강사_id, 출근일, 상태 === '출근' ? 1 : 0, 상태 === '지각' ? 1 : 0, 상태 === '휴무' ? 1 : 0, 근무시간], (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
        });

        await Promise.all(queries); // 병렬 실행하여 성능 향상

        res.status(200).json({ message: `✅ 출근 기록 저장 완료` });

    } catch (error) {
        res.status(500).json({ message: "❌ 출근 기록 저장 중 오류 발생", error });
    }
});


// ✅ 특정 날짜 출근 기록 조회
app.get('/attendancehistory', (req, res) => {
    const { date } = req.query;

    if (!date) {
        return res.status(400).json({ message: "날짜 파라미터가 필요합니다." });
    }

    const query = `
        SELECT 강사_id, 출근일, 출근, 지각, 휴무, COALESCE(근무시간, 0.00) AS 근무시간
        FROM \`25출근기록\`
        WHERE 출근일 = ?
    `;

    connection.query(query, [date], (err, results) => {
        if (err) {
            console.error('❌ 출근 기록 조회 실패:', err);
            return res.status(500).json({ message: '출근 기록 조회 실패', error: err });
        }

        console.log("✅ 조회된 출근 기록:", results); // 디버깅용 로그 추가
        res.status(200).json(results);
    });
});


// ✅ 특정 월의 출근 기록 조회
app.get('/attendancehistory_monthly', (req, res) => {
    const { year, month } = req.query;
    
    if (!year || !month) {
        return res.status(400).json({ message: "연도(year)와 월(month) 파라미터가 필요합니다." });
    }

    const query = `
        SELECT 출근일, 강사_id, 출근, 지각, 휴무, 근무시간
        FROM \`25출근기록\`
        WHERE 출근일 LIKE ?
    `;

    const monthPattern = `${year}-${month.padStart(2, '0')}%`;

    connection.query(query, [monthPattern], (err, results) => {
        if (err) {
            console.error('❌ 월간 출근 기록 조회 실패:', err);
            return res.status(500).json({ message: '월간 출근 기록 조회 실패', error: err });
        }

        res.status(200).json(results);
    });
});



// ✅ 급여 목록 조회 (총급여, 세금금액, 실지급액 포함)
app.get('/getSalaryList', (req, res) => {
    const { year, month } = req.query;

    const query = `
        SELECT 강사이름, 총급여, 세금금액, 실지급액, 인센티브1, 인센티브2
        FROM 급여내역
        WHERE 년도 = ? AND 월 = ?
    `;

    connection.query(query, [year, month], (err, results) => {
        if (err) {
            return res.status(500).json({ message: "급여 조회 실패", error: err });
        }
        res.status(200).json(results);
    });
});

// ✅ 급여 확정 (인센티브 추가)
app.post('/confirmSalary', async (req, res) => {
    let { 
        year, month, teacherId, teacherName, totalSalary, taxAmount, salaryAmount,
        salaryType, totalHours, totalDays, hourlyWage, dailyWage, monthlyWage, applyTax,
        incentive1, incentive2 // ✅ 인센티브 추가
    } = req.body;

    console.log("📥 서버에서 받은 데이터:", req.body); // ✅ 디버깅용 로그

    if (!year || !month || !teacherId || !salaryAmount || !totalSalary || !salaryType || !teacherName) {
        return res.status(400).json({ message: '필수 정보가 부족합니다.' });
    }

    // ✅ null 값 방어 처리
    totalHours = totalHours || 0;
    totalDays = totalDays || 0;
    hourlyWage = hourlyWage || 0;
    dailyWage = dailyWage || 0;
    monthlyWage = monthlyWage || 0;
    totalSalary = totalSalary || 0;
    taxAmount = taxAmount || 0;
    applyTax = applyTax ? 1 : 0; // ✅ MySQL BOOLEAN 값 변환 (1: true, 0: false)
    incentive1 = incentive1 || 0;
    incentive2 = incentive2 || 0;

    const query = `
        INSERT INTO 급여내역 (년도, 월, 강사_id, 강사이름, 총급여, 세금금액, 실지급액, 급여방식, 총근무시간, 총출근일수, 시급, 일급, 월급, applyTax, 인센티브1, 인센티브2)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
        총급여 = VALUES(총급여),
        세금금액 = VALUES(세금금액),
        실지급액 = VALUES(실지급액),
        급여방식 = VALUES(급여방식),
        총근무시간 = VALUES(총근무시간),
        총출근일수 = VALUES(총출근일수),
        시급 = VALUES(시급),
        일급 = VALUES(일급),
        월급 = VALUES(월급),
        applyTax = VALUES(applyTax),
        인센티브1 = VALUES(인센티브1),
        인센티브2 = VALUES(인센티브2);
    `;

    connection.query(query, [
        year, month, teacherId, teacherName, totalSalary, taxAmount, salaryAmount,
        salaryType, totalHours, totalDays, hourlyWage, dailyWage, monthlyWage, applyTax, incentive1, incentive2
    ], (err) => {
        if (err) {
            console.error('❌ 급여 저장 오류:', err);
            return res.status(500).json({ message: '급여 저장 실패', error: err });
        }
        res.status(200).json({ message: '✅ 급여 정보 저장 완료!' });
    });
});

// ✅ 급여 조회 (인센티브 포함)
app.get('/getSalary', async (req, res) => {
    const { year, month, teacherId } = req.query;

    if (!year || !month || !teacherId) {
        return res.status(400).json({ message: '필수 정보가 부족합니다.' });
    }

    const query = `
        SELECT 실지급액, 급여방식, 총근무시간, 총출근일수, 시급, 일급, 월급, applyTax, 인센티브1, 인센티브2
        FROM 급여내역
        WHERE 년도 = ? AND 월 = ? AND 강사_id = ?
    `;

    connection.query(query, [year, month, teacherId], (err, results) => {
        if (err) {
            console.error('❌ 급여 조회 오류:', err);
            return res.status(500).json({ message: '급여 조회 실패', error: err });
        }
        if (results.length === 0) {
            return res.status(404).json({ message: '급여 정보 없음' });
        }

        res.status(200).json(results[0]);
    });
});


//안양 출근부 25.02.25
// ✅ 강사 등록
app.post('/anteacher', (req, res) => {
    const { 이름, 직급, 전화번호, 주민번호, 은행명, 계좌번호 } = req.body;

    if (!이름 || !주민번호 || !은행명 || !계좌번호) {
        return res.status(400).json({ message: "이름, 주민번호, 은행명, 계좌번호는 필수 입력값입니다." });
    }

    const query = `
        INSERT INTO \`an강사관리\` (이름, 직급, 전화번호, 주민번호, 은행명, 계좌번호) 
        VALUES (?, ?, ?, ?, ?, ?)
    `;

    connection.query(query, [이름, 직급, 전화번호, 주민번호, 은행명, 계좌번호], (err, result) => {
        if (err) {
            console.error("❌ 강사 등록 실패:", err);
            return res.status(500).json({ message: "강사 등록 실패", error: err });
        }
        res.status(201).json({ message: "강사 등록 성공", id: result.insertId });
    });
});

// 특정 강사 정보 조회
app.get('/anteachers/:id', (req, res) => {
    const teacherId = req.params.id;
    connection.query('SELECT * FROM `an강사관리` WHERE id = ?', [teacherId], (err, results) => {
        if (err) {
            console.error('강사 정보 조회 실패:', err);
            return res.status(500).json({ message: '강사 정보 조회 실패', error: err });
        }
        if (results.length === 0) {
            return res.status(404).json({ message: '강사를 찾을 수 없습니다.' });
        }
        res.status(200).json(results[0]);
    });
});

// 강사 정보 수정
app.put('/anteacher/:id', (req, res) => {
    const teacherId = req.params.id;
    const { 이름, 직급, 전화번호, 주민번호, 은행명, 계좌번호 } = req.body;

    if (!이름 || !주민번호 || !은행명 || !계좌번호) {
        return res.status(400).json({ message: "이름, 주민번호, 은행명, 계좌번호는 필수 입력값입니다." });
    }

    const query = `
        UPDATE \`an강사관리\` 
        SET 이름 = ?, 직급 = ?, 전화번호 = ?, 주민번호 = ?, 은행명 = ?, 계좌번호 = ?
        WHERE id = ?
    `;

    connection.query(query, [이름, 직급, 전화번호, 주민번호, 은행명, 계좌번호, teacherId], (err, result) => {
        if (err) {
            console.error("강사 정보 수정 실패:", err);
            return res.status(500).json({ message: "강사 정보 수정 실패", error: err });
        }
        res.status(200).json({ message: "강사 정보 수정 성공" });
    });
});

// 강사 삭제
app.delete('/anteacher/:id', (req, res) => {
    const teacherId = req.params.id;
    connection.query('DELETE FROM `an강사관리` WHERE id = ?', [teacherId], (err, result) => {
        if (err) {
            console.error('강사 삭제 실패:', err);
            return res.status(500).json({ message: '강사 삭제 실패', error: err });
        }
        res.status(200).json({ message: '강사 삭제 성공' });
    });
});

// ✅ 강사 목록 조회
app.get('/anteachers', (req, res) => {
    connection.query(`SELECT * FROM \`an강사관리\``, (err, results) => {
        if (err) {
            console.error('강사 목록 조회 실패:', err);
            return res.status(500).json({ message: '강사 목록 조회 실패', error: err });
        }
        res.status(200).json(results);
    });
});

// ✅ 특정 강사의 출근부 조회
app.get('/anattendanceteacher', (req, res) => {
    const { id, year, month } = req.query;
    
    const lastDay = new Date(year, month, 0).getDate();
    const startDate = `${year}-${month}-01`;
    const endDate = `${year}-${month}-${lastDay}`;

    const query = `
        SELECT 강사_id, DATE_FORMAT(출근일, '%Y-%m-%d') AS 출근일, 
               월요일, 화요일, 수요일, 목요일, 금요일, 토요일, 일요일, 출근, 지각, 휴무, 근무시간
        FROM \`an출근기록\`
        WHERE 강사_id = ? AND 출근일 BETWEEN ? AND ?
        ORDER BY 출근일
    `;

    connection.query(query, [id, startDate, endDate], (err, results) => {
        if (err) {
            console.error('❌ 출근부 조회 실패:', err);
            return res.status(500).json({ message: '출근부 조회 실패', error: err });
        }

        res.status(200).json(results);
    });
});

// ✅ 출근 체크 등록 및 수정
app.post('/anattendancecheck', async (req, res) => {
    const attendanceData = req.body;

    if (!Array.isArray(attendanceData) || attendanceData.length === 0) {
        return res.status(400).json({ message: '출근 데이터가 비어있습니다.' });
    }

    try {
        const queries = attendanceData.map(({ 강사_id, 출근일, 상태, 근무시간 }) => {
            const query = `
                INSERT INTO an출근기록 (강사_id, 출근일, 출근, 지각, 휴무, 근무시간) 
                VALUES (?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE 
                    출근 = VALUES(출근),
                    지각 = VALUES(지각),
                    휴무 = VALUES(휴무),
                    근무시간 = VALUES(근무시간)
            `;

            return new Promise((resolve, reject) => {
                connection.query(query, [강사_id, 출근일, 상태 === '출근' ? 1 : 0, 상태 === '지각' ? 1 : 0, 상태 === '휴무' ? 1 : 0, 근무시간], (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
        });

        await Promise.all(queries); // 병렬 실행하여 성능 향상

        res.status(200).json({ message: `✅ 출근 기록 저장 완료` });

    } catch (error) {
        res.status(500).json({ message: "❌ 출근 기록 저장 중 오류 발생", error });
    }
});


// ✅ 특정 날짜 출근 기록 조회
app.get('/anattendancehistory', (req, res) => {
    const { date } = req.query;

    if (!date) {
        return res.status(400).json({ message: "날짜 파라미터가 필요합니다." });
    }

    const query = `
        SELECT 강사_id, 출근일, 출근, 지각, 휴무, COALESCE(근무시간, 0.00) AS 근무시간
        FROM \`an출근기록\`
        WHERE 출근일 = ?
    `;

    connection.query(query, [date], (err, results) => {
        if (err) {
            console.error('❌ 출근 기록 조회 실패:', err);
            return res.status(500).json({ message: '출근 기록 조회 실패', error: err });
        }

        console.log("✅ 조회된 출근 기록:", results); // 디버깅용 로그 추가
        res.status(200).json(results);
    });
});


// ✅ 특정 월의 출근 기록 조회
app.get('/anattendancehistory_monthly', (req, res) => {
    const { year, month } = req.query;
    
    if (!year || !month) {
        return res.status(400).json({ message: "연도(year)와 월(month) 파라미터가 필요합니다." });
    }

    const query = `
        SELECT 출근일, 강사_id, 출근, 지각, 휴무, 근무시간
        FROM \`an출근기록\`
        WHERE 출근일 LIKE ?
    `;

    const monthPattern = `${year}-${month.padStart(2, '0')}%`;

    connection.query(query, [monthPattern], (err, results) => {
        if (err) {
            console.error('❌ 월간 출근 기록 조회 실패:', err);
            return res.status(500).json({ message: '월간 출근 기록 조회 실패', error: err });
        }

        res.status(200).json(results);
    });
});

// ✅ 급여 지급
// ✅ 급여 확정 저장
app.post('/anconfirmSalary', async (req, res) => {
    let { 
        year, month, teacherId, teacherName, totalSalary, taxAmount, salaryAmount,
        salaryType, totalHours, totalDays, hourlyWage, dailyWage, monthlyWage, applyTax 
    } = req.body;

    console.log("📥 서버에서 받은 데이터:", req.body); // ✅ 디버깅용 로그

    if (!year || !month || !teacherId || !salaryAmount || !totalSalary || !salaryType || !teacherName) {
        return res.status(400).json({ message: '필수 정보가 부족합니다.' });
    }

    // ✅ null 값 방어 처리
    totalHours = totalHours || 0;
    totalDays = totalDays || 0;
    hourlyWage = hourlyWage || 0;
    dailyWage = dailyWage || 0;
    monthlyWage = monthlyWage || 0;
    totalSalary = totalSalary || 0;
    taxAmount = taxAmount || 0;
    applyTax = applyTax ? 1 : 0; // ✅ MySQL BOOLEAN 값 변환 (1: true, 0: false)

    const query = `
        INSERT INTO an급여내역 (년도, 월, 강사_id, 강사이름, 총급여, 세금금액, 실지급액, 급여방식, 총근무시간, 총출근일수, 시급, 일급, 월급, applyTax)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
        총급여 = VALUES(총급여),
        세금금액 = VALUES(세금금액),
        실지급액 = VALUES(실지급액),
        급여방식 = VALUES(급여방식),
        총근무시간 = VALUES(총근무시간),
        총출근일수 = VALUES(총출근일수),
        시급 = VALUES(시급),
        일급 = VALUES(일급),
        월급 = VALUES(월급),
        applyTax = VALUES(applyTax);
    `;

    connection.query(query, [
        year, month, teacherId, teacherName, totalSalary, taxAmount, salaryAmount,
        salaryType, totalHours, totalDays, hourlyWage, dailyWage, monthlyWage, applyTax
    ], (err) => {
        if (err) {
            console.error('❌ 급여 저장 오류:', err);
            return res.status(500).json({ message: '급여 저장 실패', error: err });
        }
        res.status(200).json({ message: '✅ 급여 정보 저장 완료!' });
    });
});







// ✅ 급여 목록 조회 (총급여, 세금금액, 실지급액 포함)
app.get('/angetSalaryList', (req, res) => {
    const { year, month } = req.query;

    const query = `
        SELECT 강사이름, 총급여, 세금금액, 실지급액
        FROM an급여내역
        WHERE 년도 = ? AND 월 = ?
    `;

    connection.query(query, [year, month], (err, results) => {
        if (err) {
            return res.status(500).json({ message: "급여 조회 실패", error: err });
        }
        res.status(200).json(results);
    });
});

// ✅ 급여 내역 조회
app.get('/angetSalary', async (req, res) => {
    const { year, month, teacherId } = req.query;

    if (!year || !month || !teacherId) {
        return res.status(400).json({ message: '필수 정보가 부족합니다.' });
    }

    const query = `
        SELECT 실지급액, 급여방식, 총근무시간, 총출근일수, 시급, 일급, 월급, applyTax
        FROM an급여내역
        WHERE 년도 = ? AND 월 = ? AND 강사_id = ?
    `;

    connection.query(query, [year, month, teacherId], (err, results) => {
        if (err) {
            console.error('❌ 급여 조회 오류:', err);
            return res.status(500).json({ message: '급여 조회 실패', error: err });
        }
        if (results.length === 0) {
            return res.status(404).json({ message: '급여 정보 없음' });
        }

        res.status(200).json(results[0]);
    });
});














// 서버 시작

    
          
            
    

          
      
    
    
  
server.listen(3000, '0.0.0.0', () => {
  console.log('Server running at http://0.0.0.0:3000/');
});

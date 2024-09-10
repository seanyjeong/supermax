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
  origin: ['https://supermax.co.kr','https://seanyjeong.github.io','https://chejump.com','https://score.ilsanmax.com'],
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(requestIp.mw({ attributeName: 'clientIp' }));
// HTTP 서버를 생성합니다.
const server = http.createServer(app);
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

    const query = `
      INSERT INTO 25susiresult (
        교육원, 이름, 학교, 성별, 학년, 대학명, 학과명, 전형명, 환산내신, 등급, 기타, 실기점수, 총점, 최초합격여부, 최종합격여부,
        실기1종목, 실기1기록, 실기1점수, 실기2종목, 실기2기록, 실기2점수, 실기3종목, 실기3기록, 실기3점수, 실기4종목, 실기4기록, 실기4점수, 실기5종목, 실기5기록, 실기5점수, 실기6종목, 실기6기록, 실기6점수
      ) VALUES ?
      ON DUPLICATE KEY UPDATE 
        교육원 = VALUES(교육원),
        이름 = VALUES(이름),
        학교 = VALUES(학교),
        성별 = VALUES(성별),
        학년 = VALUES(학년),
        대학명 = VALUES(대학명),
        학과명 = VALUES(학과명),
        전형명 = VALUES(전형명),
        환산내신 = VALUES(환산내신),
        등급 = VALUES(등급),
        기타 = VALUES(기타),
        실기점수 = VALUES(실기점수),
        총점 = VALUES(총점),
        최초합격여부 = VALUES(최초합격여부),
        최종합격여부 = VALUES(최종합격여부),
        실기1종목 = VALUES(실기1종목),
        실기1기록 = VALUES(실기1기록),
        실기1점수 = VALUES(실기1점수),
        실기2종목 = VALUES(실기2종목),
        실기2기록 = VALUES(실기2기록),
        실기2점수 = VALUES(실기2점수),
        실기3종목 = VALUES(실기3종목),
        실기3기록 = VALUES(실기3기록),
        실기3점수 = VALUES(실기3점수),
        실기4종목 = VALUES(실기4종목),
        실기4기록 = VALUES(실기4기록),
        실기4점수 = VALUES(실기4점수),
        실기5종목 = VALUES(실기5종목),
        실기5기록 = VALUES(실기5기록),
        실기5점수 = VALUES(실기5점수),
        실기6종목 = VALUES(실기6종목),
        실기6기록 = VALUES(실기6기록),
        실기6점수 = VALUES(실기6점수)
    `;

    const values = data.map(row => [
      row.education_center || null, 
      row.name || null,
      row.school || null,
      row.gender || null,
      row.grade || null,
      row.university || null,
      row.major || null,
      row.admission_type || null,
      row.score_converted || null,
      row.grade_level || null,
      row.other_info || null,
      row.practical_score || null,
      row.total_score || null,
      row.initial_pass || null,
      row.final_pass || null,
      row.practical1_name || null,
      row.practical1_record || null,
      row.practical1_score || null,
      row.practical2_name || null,
      row.practical2_record || null,
      row.practical2_score || null,
      row.practical3_name || null,
      row.practical3_record || null,
      row.practical3_score || null,
      row.practical4_name || null,
      row.practical4_record || null,
      row.practical4_score || null,
      row.practical5_name || null,
      row.practical5_record || null,
      row.practical5_score || null,
      row.practical6_name || null,
      row.practical6_record || null,
      row.practical6_score || null
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

// '25susiupdate' 데이터를 업데이트하는 엔드포인트
app.get('/25susiupdate', async (req, res) => {
  try {
    await updateSusiData();
    res.status(200).json({ message: '25susiresult updated successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Update failed', error });
  }
});

// 서버 시작 시 25susiupdate 즉시 실행
updateSusiData();

// 서버 시작 시 1분마다 updateSusiData 함수 실행
setInterval(updateSusiData, 60 * 1000);

















// 서버 시작

    
          
            
    

          
      
    
    
  
server.listen(3000, '0.0.0.0', () => {
  console.log('Server running at http://0.0.0.0:3000/');
});

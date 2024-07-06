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
  origin: ['https://supermax.co.kr','https://seanyjeong.github.io'],
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

// 데이터 저장 엔드포인트 추가
app.post('/save-scores', (req, res) => {
  const { name, academy, formType, gender, standingJump, weightedRun, backStrength, sitAndReach, academicScore, totalScore } = req.body;

  // 로그 추가
  console.log('Received data:', req.body);

  const query = `
    INSERT INTO scores (name, academy, formType, gender, standingJump, weightedRun, backStrength, sitAndReach, academicScore, totalScore)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  const values = [name, academy, formType, gender, standingJump, weightedRun, backStrength, sitAndReach, academicScore, totalScore];

  connection.query(query, values, (error, results) => {
    if (error) {
      console.error('Error saving scores to MySQL:', error);
      res.status(500).json({ success: false, message: 'Error saving scores to MySQL', error: error.message });
    } else {
      res.status(200).json({ success: true, message: 'Scores saved successfully' });
    }
  });
});


// 데이터 저장 엔드포인트
app.post('/save-data', (req, res) => {
  const { legion, name, school, gender, grade, collegeData, skillData } = req.body;

  let query = `
    INSERT INTO \`25수시수합\` 
    (legion, name, school, gender, grade, college_name, college_department, college_admission_type, college_gpa, college_grade, 
    skill1_name, skill1_record, skill1_score, skill2_name, skill2_record, skill2_score, skill3_name, skill3_record, skill3_score, 
    skill4_name, skill4_record, skill4_score, skill5_name, skill5_record, skill5_score, skill6_name, skill6_record, skill6_score) 
    VALUES ?
  `;

  let values = [];

  for (let i = 0; i < collegeData.length; i++) {
    if (collegeData[i][0] !== "") { // collegeData의 첫 번째 컬럼이 빈 값이 아닌 경우에만 추가
      values.push([
        legion, name, school, gender, grade,
        collegeData[i][0], collegeData[i][1], collegeData[i][2], collegeData[i][3], collegeData[i][4],
        skillData[i][0], skillData[i][1], skillData[i][2], skillData[i][3], skillData[i][4], skillData[i][5],
        skillData[i][6], skillData[i][7], skillData[i][8], skillData[i][9], skillData[i][10], skillData[i][11],
        skillData[i][12], skillData[i][13], skillData[i][14], skillData[i][15], skillData[i][16], skillData[i][17]
      ]);
    }
  }

  if (values.length > 0) {
    connection.query(query, [values], (error, results) => {
      if (error) {
        res.status(500).send(error);
      } else {
        res.status(200).send('Data inserted successfully');
      }
    });
  } else {
    res.status(400).send('No valid data to insert');
  }
});

// 데이터 업데이트 엔드포인트
app.post('/update-data', (req, res) => {
  const { legion, name, school, gender, skill1_record, skill1_score, skill2_record, skill2_score, skill3_record, skill3_score, skill4_record, skill4_score, skill5_record, skill5_score, skill6_record, skill6_score } = req.body;

  let query = `
    UPDATE \`25수시수합\` 
    SET skill1_record = ?, skill1_score = ?, skill2_record = ?, skill2_score = ?, skill3_record = ?, skill3_score = ?, skill4_record = ?, skill4_score = ?, skill5_record = ?, skill5_score = ?, skill6_record = ?, skill6_score = ?
    WHERE legion = ? AND name = ? AND school = ? AND gender = ?
  `;

  let values = [skill1_record, skill1_score, skill2_record, skill2_score, skill3_record, skill3_score, skill4_record, skill4_score, skill5_record, skill5_score, skill6_record, skill6_score, legion, name, school, gender];

  connection.query(query, values, (error, results) => {
    if (error) {
      res.status(500).send(error);
    } else {
      res.status(200).send('Data updated successfully');
    }
  });
});

// 서버 시작
server.listen(3000, '0.0.0.0', () => {
  console.log('Server running at http://0.0.0.0:3000/');
});

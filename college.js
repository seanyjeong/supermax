const express = require('express');
const mysql = require('mysql');
const cors = require('cors');
const app = express();
const port = 9000;

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.json());

const db = mysql.createConnection({
  host: '211.37.174.218',
  user: 'maxilsan',
  password: 'q141171616!',
  database: '정시엔진',
  charset: 'utf8mb4'
});

// 새 DB (학원관리)
const dbAcademy = mysql.createConnection({
  host: '211.37.174.218',
  user: 'maxilsan',
  password: 'q141171616!',
  database: '학원관리',
  charset: 'utf8mb4'
});

// 연결
db.connect(err => {
  if (err) console.error('❌ 정시엔진 DB 연결 실패:', err);
  else console.log('✅ 정시엔진 DB 연결 성공');
});

dbAcademy.connect(err => {
  if (err) console.error('❌ 학원관리 DB 연결 실패:', err);
  else console.log('✅ 학원관리 DB 연결 성공');
});

// 외부로 내보내기
module.exports = { db, dbAcademy };


const collegeManage = require('./collegeManage');
app.use('/college', collegeManage);

const collegeDebug = require('./collegedebug');
app.use('/college', collegeDebug);


const calculator = require('./collegeCalculator');


const collegeCalculate = require('./collegeCalculate');
app.use('/college', collegeCalculate);

const scoreTable = require('./scoreTable');
app.use('/college', scoreTable);

const ilsanmaxsys = require('./ilsanmaxsys'); 
app.use('/college', ilsanmaxsys);             









app.listen(port, () => {
  console.log(`🚀 대학 추천 서버 ${port}번 포트에서 실행 중`);
});

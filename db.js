const mysql = require('mysql');

// 데이터베이스 연결을 설정합니다.
const db_config = {
  host: 'my8003.gabiadb.com',
  user: 'maxilsan',
  password: 'q141171616!',
  database: 'supermax',
  charset: 'utf8mb4'
};

let connection;

function handleDisconnect() {
  connection = mysql.createConnection(db_config); // 재연결을 위해 새 연결을 생성합니다.

  connection.connect((err) => {
    if (err) {
      console.log('error when connecting to db:', err);
      setTimeout(handleDisconnect, 2000); // 2초 후에 다시 연결을 시도합니다.
    }
  });

  connection.on('error', (err) => {
    console.log('db error', err);
    if (err.code === 'PROTOCOL_CONNECTION_LOST') {
      handleDisconnect(); // 연결이 끊어지면 다시 연결을 시도합니다.
    } else {
      throw err;
    }
  });
}

handleDisconnect();

module.exports = connection;

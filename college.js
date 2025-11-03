const express = require('express');
const mysql = require('mysql'); // ⬅️ 'mysql' 라이브러리 (Pool)
const cors = require('cors');
const axios = require('axios'); 
const crypto = require('crypto'); 
const path = require('path');
const multer = require('multer');
const fs = require('fs'); // ⬅️ [신규] 파일 시스템(삭제) 모듈
const app = express();
const port = 9000;

app.use(cors());
app.use(express.json());

// ===============================================
// DB 연결 (Pool 방식)
// ===============================================
const db = mysql.createPool({
  host: '211.37.174.218',
  user: 'maxilsan',
  password: 'q141171616!',
  database: '정시엔진',
  charset: 'utf8mb4',
  multipleStatements: true,
  connectionLimit: 10
});

const dbAcademy = mysql.createPool({
  host: '211.37.174.218',
  user: 'maxilsan',
  password: 'q141171616!',
  database: '학원관리',
  charset: 'utf8mb4',
  multipleStatements: true,
  connectionLimit: 10
});

const db_drsports = mysql.createPool({
  host: '211.37.174.218',
  user: 'maxilsan',
  password: 'q141171616!',
  database: 'drsports',
  charset: 'utf8mb4',
  multipleStatements: true,
  connectionLimit: 10
});

// ===============================================
// 🖼️ 사진 업로드 (Multer) 설정 (파일명 안 깨지게)
// ===============================================
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => {
    // 파일명: 날짜(밀리초) + 6자리 랜덤숫자 + 확장자
    const ext = path.extname(file.originalname); // ".jpeg"
    const randomSuffix = Math.round(Math.random() * 1E6); // 0~999999
    cb(null, Date.now() + '-' + randomSuffix + ext); // 예: "1762145062889-123456.jpeg"
  }
});
const upload = multer({ storage: storage });
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ===============================================
// 🛒 의류샵 API
// ===============================================

// 1. 상품 목록 불러오기
app.get('/college/shop/products', (req, res) => {
  const query = `
    SELECT 
        p.product_id, p.product_name, p.price, p.category, p.image_url, p.extra_image_url,
        JSON_ARRAYAGG(i.size) AS sizes
    FROM 
        shop_products p
    LEFT JOIN 
        shop_inventory i ON p.product_id = i.product_id
    WHERE 
        p.is_active = TRUE
    GROUP BY
        p.product_id;
  `;
  
  dbAcademy.query(query, (err, results) => {
    if (err) {
      console.error('상품 목록 조회 실패:', err);
      return res.status(500).send({ message: '서버 오류' });
    }
    
    const products = results.map(p => ({
      ...p,
      customSizes: JSON.parse(p.sizes)[0] === null ? [] : JSON.parse(p.sizes)
    }));
    const clothingProducts = products.filter(p => p.category === 'clothing');
    const shoesProducts = products.filter(p => p.category === 'shoes');
    res.json({ clothingProducts, shoesProducts });
  });
});

// 2. 주문 접수하기 (Pool + 트랜잭션)
app.post('/college/shop/order', (req, res) => {
  const { customerName, phoneNumber, orders, totalAmount } = req.body;

  if (!customerName || !phoneNumber || !orders || orders.length === 0) {
    return res.status(400).send({ message: '필수 정보 누락' });
  }

  dbAcademy.getConnection((err, connection) => {
    if (err) {
      console.error('DB 커넥션 가져오기 실패:', err);
      return res.status(500).send({ message: 'DB 연결 실패' });
    }

    connection.beginTransaction(err => {
      if (err) {
        console.error('트랜잭션 시작 실패:', err);
        connection.release(); 
        return res.status(500).send({ message: '트랜잭션 시작 실패' });
      }

      let isErrorHandled = false;
      const rollback = (errorMsg, error) => {
        if (isErrorHandled) return;
        isErrorHandled = true;
        console.error(errorMsg, error);
        connection.rollback(() => {
          connection.release(); 
          res.status(500).send({ message: errorMsg });
        });
      };

      connection.query(
        `INSERT INTO shop_orders (customer_name, phone_number, total_amount) VALUES (?, ?, ?)`,
        [customerName, phoneNumber, totalAmount],
        (err, orderResult) => {
          if (err) return rollback('주문서 생성 실패', err);
          
          const orderId = orderResult.insertId;
          let itemsProcessed = 0;

          orders.forEach(item => {
            connection.query(
              `SELECT product_id FROM shop_products WHERE product_name = ?`,
              [item.name],
              (err, product) => {
                if (err) return rollback('상품 ID 조회 실패', err);
                if (isErrorHandled) return;
                if (!product || product.length === 0) {
                    return rollback('존재하지 않는 상품입니다: ' + item.name, null);
                }
                const productId = product[0].product_id;
                
                connection.query(
                  `SELECT inventory_id, stock_quantity 
                   FROM shop_inventory 
                   WHERE product_id = ? AND size = ? FOR UPDATE`, 
                  [productId, item.size],
                  (err, inventory) => {
                    if (err) return rollback('재고 확인 실패', err);
                    if (isErrorHandled) return;

                    let itemStatus = 'NEEDS_ORDER';
                    const insertOrderItem = () => {
                      connection.query(
                        `INSERT INTO shop_order_items (order_id, product_id, product_name, size, quantity, price_per_item, item_status) 
                         VALUES (?, ?, ?, ?, 1, ?, ?)`,
                        [orderId, productId, item.name, item.size, item.price, itemStatus],
                        (err, insertResult) => {
                          if (err) return rollback('주문 항목 추가 실패', err);
                          if (isErrorHandled) return;

                          itemsProcessed++;
                          if (itemsProcessed === orders.length) {
                            connection.commit(err => {
                              if (err) return rollback('최종 커밋 실패', err);
                              connection.release(); 
                              console.log(`[주문 접수] ${customerName} (${orderId}번)`);
                              sendSmsLogic(customerName, phoneNumber, orders, totalAmount);
                              res.status(201).send({ message: '주문이 성공적으로 접수되었습니다.' });
                            });
                          }
                        }
                      );
                    };

                    if (inventory.length > 0 && inventory[0].stock_quantity > 0) {
                      itemStatus = 'IN_STOCK';
                      connection.query(
                        `UPDATE shop_inventory SET stock_quantity = stock_quantity - 1 WHERE inventory_id = ?`, 
                        [inventory[0].inventory_id],
                        (err, updateResult) => {
                          if (err) return rollback('재고 차감 실패', err);
                          if (isErrorHandled) return;
                          insertOrderItem();
                        }
                      );
                    } else {
                      insertOrderItem();
                    }
                  }
                );
              }
            );
          });
        }
      );
    });
  });
});

// 문자 발송 로직 분리
async function sendSmsLogic(customerName, phoneNumber, orders, totalAmount) {
  const adminContent = `${customerName}님의 맥스의류 주문이 들어왔습니다.`;
  try {
    await sendSms('01071511941', adminContent, 'SMS'); // 관리자1
    await sendSms('01021446765', adminContent, 'SMS'); // 관리자2
  } catch (smsError) {
    console.error('관리자 SMS 발송 중 에러 (주문은 완료됨)', smsError);
  }

  const orderSummary = orders.length > 1 
      ? `${orders[0].name} 외 ${orders.length - 1}개 상품`
      : orders[0].name;

  const customerContent = `${customerName}님 ${orderSummary}의 주문이 완료되었습니다.
${totalAmount.toLocaleString()}원 입금 부탁드립니다.
3333288746920 카카오뱅크 -박성준
http://aq.gy/f/3BCyv
링크 클릭시 계좌번호 복사`;

  try {
     await sendSms(phoneNumber, customerContent, 'LMS');
  } catch (smsError) {
    console.error('고객 LMS 발송 중 에러 (주문은 완료됨)', smsError);
  }
}

// ---------------------------------
// B. 관리자용 API (admin-*.html)
// ---------------------------------

// 1. 신규 상품 등록 (Pool + 트랜잭션)
app.post('/college/admin/products', upload.fields([
  { name: 'image_url', maxCount: 1 },
  { name: 'extra_image_url', maxCount: 1 }
]), (req, res) => {
  
  const { product_name, price, category, sizes } = req.body;
  const files = req.files;
  const image_url = files['image_url'] ? '/' + files['image_url'][0].path.replace(/\\/g, '/') : null;
  const extra_image_url = files['extra_image_url'] ? '/' + files['extra_image_url'][0].path.replace(/\\/g, '/') : null;

  dbAcademy.getConnection((err, connection) => {
    if (err) {
      console.error('DB 커넥션 가져오기 실패:', err);
      return res.status(500).send({ message: 'DB 연결 실패' });
    }

    connection.beginTransaction(err => {
      if (err) {
        console.error('트랜잭션 시작 실패:', err);
        connection.release();
        return res.status(500).send({ message: '트랜잭션 시작 실패' });
      }

      const rollback = (errorMsg, error) => {
        console.error(errorMsg, error);
        connection.rollback(() => {
          connection.release();
          res.status(500).send({ message: errorMsg });
        });
      };

      connection.query(
        `INSERT INTO shop_products (product_name, price, category, image_url, extra_image_url, is_active) 
         VALUES (?, ?, ?, ?, ?, TRUE)`,
        [product_name, price, category, image_url, extra_image_url],
        (err, productResult) => {
          if (err) return rollback('상품 추가 실패', err);
          
          const newProductId = productResult.insertId;
          const sizeArray = sizes.split(',').map(s => s.trim()).filter(s => s);
          
          if (sizeArray.length > 0) {
            const inventoryValues = sizeArray.map(size => [newProductId, size, 0]);
            connection.query(
              `INSERT INTO shop_inventory (product_id, size, stock_quantity) VALUES ?`,
              [inventoryValues],
              (err, inventoryResult) => {
                if (err) return rollback('재고 항목 추가 실패', err);
                connection.commit(err => {
                  if (err) return rollback('최종 커밋 실패', err);
                  connection.release();
                  res.status(201).send({ message: '신규 상품이 등록되었습니다.' });
                });
              }
            );
          } else {
            connection.commit(err => {
              if (err) return rollback('최종 커밋 실패', err);
              connection.release();
              res.status(201).send({ message: '신규 상품이 등록되었습니다.' });
            });
          }
        }
      );
    });
  });
});

app.get('/college/admin/inventory', (req, res) => {
  const query = `
    SELECT p.product_name, p.product_id, p.is_active, p.category, i.inventory_id, i.size, i.stock_quantity
    FROM shop_inventory i
    JOIN shop_products p ON i.product_id = p.product_id
    /* WHERE p.is_active = TRUE  <-- 관리자는 모든 상품을 봐야 하므로 이 라인 삭제 또는 주석 처리 */
    ORDER BY p.product_name, i.inventory_id;
  `;
  
  // ⬇️⬇️⬇️ 이 부분이 통째로 빠져있었어! ⬇️⬇️⬇️
  dbAcademy.query(query, (err, results) => {
    if (err) {
      console.error('재고 현황 조회 실패:', err);
      return res.status(500).send({ message: '재고 조회 실패' });
    }
    res.json(results);
  });
  // ⬆️⬆️⬆️ 여기까지 ⬆️⬆️⬆️
}); // ⬅️ 이것도 빠졌었어
  


// 3. [신규] 상품 삭제 API (DB + 파일)
app.delete('/college/admin/products/:id', (req, res) => {
  const productId = req.params.id;

  dbAcademy.getConnection((err, connection) => {
    if (err) {
      console.error('DB 커넥션 가져오기 실패:', err);
      return res.status(500).send({ message: 'DB 연결 실패' });
    }

    let filePaths = []; 

    // 1. 삭제하기 전에 파일 경로 먼저 조회
    connection.query(
      'SELECT image_url, extra_image_url FROM shop_products WHERE product_id = ?',
      [productId],
      (err, results) => {
        if (err) {
          console.error('파일 경로 조회 실패:', err);
          connection.release();
          return res.status(500).send({ message: '파일 경로 조회 실패' });
        }

        if (results.length > 0) {
          if (results[0].image_url) filePaths.push(results[0].image_url);
          if (results[0].extra_image_url) filePaths.push(results[0].extra_image_url);
        }

        // 2. DB에서 상품 삭제 (FOREIGN KEY + ON DELETE CASCADE 설정으로 inventory 자동 삭제됨)
        connection.query(
          'DELETE FROM shop_products WHERE product_id = ?',
          [productId],
          (err, deleteResult) => {
            connection.release(); // DB 작업 끝났으니 커넥션 반납

            if (err) {
              console.error('DB 상품 삭제 실패:', err);
              // 'ON DELETE CASCADE'가 없으면 여기서 FK 제약조건 에러가 날 수 있음
              return res.status(500).send({ message: 'DB 상품 삭제 실패. 주문 내역이 있는 상품일 수 있습니다.' });
            }

            if (deleteResult.affectedRows === 0) {
              return res.status(404).send({ message: '삭제할 상품을 찾지 못했습니다.' });
            }

            // 3. (DB 삭제 성공 시) 실제 파일 삭제
            filePaths.forEach(urlPath => {
              // urlPath 예: '/uploads/123.jpg'
              // __dirname 예: '/root/supermax'
              const serverPath = path.join(__dirname, urlPath); 
              
              fs.unlink(serverPath, (unlinkErr) => {
                if (unlinkErr && unlinkErr.code !== 'ENOENT') { // '파일 없음' 에러는 무시
                  console.error('파일 삭제 실패:', serverPath, unlinkErr);
                } else {
                  console.log('파일 삭제 성공:', serverPath);
                }
              });
            });

            res.send({ message: '상품이 성공적으로 삭제되었습니다.' });
          }
        );
      }
    );
  });
});

// 4. [상품관리] 재고 수량 수정
app.patch('/college/admin/inventory/:id', (req, res) => {
  const { id } = req.params;
  const { newStock } = req.body; 

  dbAcademy.query(
    'UPDATE shop_inventory SET stock_quantity = ? WHERE inventory_id = ?',
    [newStock, id],
    (err, result) => {
      if (err) {
        console.error('재고 수정 실패:', err);
        return res.status(500).send({ message: '재고 수정 실패' });
      }
      res.send({ message: '재고가 업데이트되었습니다.' });
    }
  );
});

  // ⬇️⬇️⬇️ [신규] 4-1. 상품 게시(active) 상태 변경 API ⬇️⬇️⬇️
app.patch('/college/admin/products/:id/status', (req, res) => {
  const { id } = req.params;
  const { isActive } = req.body; // { isActive: true } 또는 { isActive: false }

  if (typeof isActive !== 'boolean') {
    return res.status(400).send({ message: '잘못된 요청입니다.' });
  }

  dbAcademy.query(
    'UPDATE shop_products SET is_active = ? WHERE product_id = ?',
    [isActive, id],
    (err, result) => {
      if (err) {
        console.error('상품 게시 상태 변경 실패:', err);
        return res.status(500).send({ message: '상태 변경 실패' });
      }
      res.send({ message: '상품 게시 상태가 변경되었습니다.' });
    }
  );
});

// 5. [주문관리] 전체 주문 상세 내역 조회
app.get('/college/admin/orders-detail', (req, res) => {
  const query = `
    SELECT 
        o.order_id, o.customer_name, o.phone_number, o.order_date,
        o.payment_status, o.fulfillment_status,
        oi.item_id, oi.product_name, oi.size, oi.price_per_item, oi.item_status
    FROM 
        shop_orders o
    JOIN 
        shop_order_items oi ON o.order_id = oi.order_id
    ORDER BY 
        o.order_date DESC, oi.item_id ASC;
  `;
  
  dbAcademy.query(query, (err, results) => {
    if (err) {
        console.error('주문 상세 내역 조회 실패:', err);
        return res.status(500).send({ message: '주문 상세 내역 조회 실패' });
    }
    res.json(results);
  });
});

// 6. [주문관리] 주문 입금/분출 상태 변경
app.patch('/college/admin/orders/:id/status', (req, res) => {
  const { id } = req.params;
  const { paymentStatus, fulfillmentStatus } = req.body;

  let query = 'UPDATE shop_orders SET ';
  const params = [];
  
  if (paymentStatus) {
    query += 'payment_status = ? ';
    params.push(paymentStatus);
  }
  if (fulfillmentStatus) {
    if(params.length > 0) query += ', ';
    query += 'fulfillment_status = ? ';
    params.push(fulfillmentStatus);
  }
  query += 'WHERE order_id = ?';
  params.push(id);

  dbAcademy.query(query, params, (err, result) => {
      if (err) {
        console.error('주문 상태 변경 실패:', err);
        return res.status(500).send({ message: '주문 상태 변경 실패' });
      }
      res.send({ message: '주문 상태가 변경되었습니다.' });
    }
  );
});

// 7. [주문관리] 개별 아이템 발주 상태 변경
app.patch('/college/admin/order-item/:id/status', (req, res) => {
  const { id } = req.params; // item_id
  const { status } = req.body; // "ORDERED"

  dbAcademy.query(
    'UPDATE shop_order_items SET item_status = ? WHERE item_id = ?',
    [status, id],
    (err, result) => {
      if (err) {
        console.error('발주 상태 변경 실패:', err);
        return res.status(500).send({ message: '발주 상태 변경 실패' });
      }
      res.send({ message: '발주 상태가 변경되었습니다.' });
    }
  );
});




// ===============================================
// ✉️ NCP SENS 문자 발송 함수
// ===============================================
const SENS_SERVICE_ID = 'ncp:sms:kr:284240549231:sean';
const SENS_ACCESS_KEY = 'A8zINaiL6JjWUNbT1uDB';
const SENS_SECRET_KEY = 'eA958IeOvpxWQI1vYYA9GcXSeVFQYMEv4gCtEorW';
const SENS_CALLER = '01021446765'; // 발신번호

async function sendSms(recipient, content, type = "SMS") {
  const serviceId = SENS_SERVICE_ID;
  const accessKey = SENS_ACCESS_KEY;
  const secretKey = SENS_SECRET_KEY;
  const from = SENS_CALLER;

  const url = `https://sens.apigw.ntruss.com/sms/v2/services/${serviceId}/messages`;
  const uri = `/sms/v2/services/${serviceId}/messages`;
  const timestamp = Date.now().toString();
  const method = 'POST';

  const space = ' ';
  const newLine = '\n';
  const hmacMessage = `${method}${space}${uri}${newLine}${timestamp}${newLine}${accessKey}`;
  const signature = crypto.createHmac('sha256', secretKey).update(hmacMessage).digest('base64');

  const body = {
    type: type,
    contentType: 'COMM',
    countryCode: '82',
    from: from,
    content: content, 
    messages: [ { to: recipient } ],
  };

  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'x-ncp-apigw-timestamp': timestamp,
    'x-ncp-iam-access-key': accessKey,
    'x-ncp-apigw-signature-v2': signature,
  };

  try {
    const response = await axios.post(url, body, { headers });
    console.log(`✅ [SMS 발송 성공] 받는사람: ${recipient}, 상태: ${response.status}`);
    return response.data;
  } catch (error) {
    console.error(`❌ [SMS 발송 실패] 받는사람: ${recipient}`);
    if (error.response) console.error('에러 데이터:', error.response.data);
    else console.error('에러 메시지:', error.message);
  }
}

// ===============================================
// 🏫 기존 학원 라우터 (Pool을 공유)
// ===============================================
module.exports = { db, dbAcademy, db_drsports };

const collegeManage = require('./collegeManage');
app.use('/college', collegeManage);

const collegeDebug = require('./collegedebug');
app.use('/college', collegeDebug);

// [수정] 502 에러 원인이었던 calculator 라우터 주석 처리
const calculator = require('./collegeCalculator');
// app.use('/college', calculator); // ⬅️ 이 줄이 서버를 죽였었음

const collegeCalculate = require('./collegeCalculate');
app.use('/college', collegeCalculate);

const scoreTable = require('./scoreTable');
app.use('/college', scoreTable);

const ilsanmaxsys = require('./ilsanmaxsys'); 
app.use('/college', ilsanmaxsys); 

const drsports = require('./drsports');
app.use('/college', drsports);

// ===============================================
// 🚀 서버 실행
// ===============================================
app.listen(port, () => {
  console.log(`🚀 대학 추천 서버 ${port}번 포트에서 실행 중`);
});

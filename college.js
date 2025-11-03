const express = require('express');
const mysql = require('mysql');
const cors = require('cors');
const axios = require('axios'); 
const crypto = require('crypto'); 
const path = require('path');
const multer = require('multer');
const app = express();
const port = 9000;

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PATCH, PUT, DELETE'); 
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

const dbAcademy = mysql.createConnection({
  host: '211.37.174.218',
  user: 'maxilsan',
  password: 'q141171616!',
  database: '학원관리',
  charset: 'utf8mb4'
});

// ✅ 닥터스포츠 DB 연결 추가
const db_drsports = mysql.createConnection({
  host: '211.37.174.218',
  user: 'maxilsan',
  password: 'q141171616!',
  database: 'drsports',
  charset: 'utf8mb4'
});

// ===============================================
// 🖼️ 사진 업로드 (Multer) 설정
// ===============================================
// 'uploads' 폴더에 파일을 저장
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/'); // 'uploads' 폴더에 저장
  },
  filename: function (req, file, cb) {
    // 파일명 중복 방지: 날짜 + 원본 파일명
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({ storage: storage });

// 'uploads' 폴더를 외부에서 접근 가능하게 함 (예: /uploads/image.png)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ===============================================
// 🛒 의류샵 API (신규/수정)
// ===============================================

// ---------------------------------
// A. 고객용 API (indexshop.html)
// ---------------------------------

// 1. 상품 목록 불러오기 (재고와 상관없이 모든 상품/사이즈)
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
      // JSON 문자열로 반환된 sizes를 배열로 파싱
      // p.sizes가 [null]일 경우(등록된 사이즈가 없을 경우) 빈 배열로 처리
      customSizes: JSON.parse(p.sizes)[0] === null ? [] : JSON.parse(p.sizes)
    }));

    const clothingProducts = products.filter(p => p.category === 'clothing');
    const shoesProducts = products.filter(p => p.category === 'shoes');

    res.json({ clothingProducts, shoesProducts });
  });
});

// 2. 주문 접수하기 (재고/발주 자동 분리 로직)
app.post('/college/shop/order', (req, res) => {
  const { customerName, phoneNumber, orders, totalAmount } = req.body;

  if (!customerName || !phoneNumber || !orders || orders.length === 0) {
    return res.status(400).send({ message: '필수 정보 누락' });
  }

  // 1. DB 트랜잭션 시작
  dbAcademy.beginTransaction(async (err) => {
    if (err) return res.status(500).send({ message: '트랜잭션 시작 실패' });

    try {
      // 2. 주문서(orders) 생성
      const [orderResult] = await dbAcademy.promise().query(
        `INSERT INTO shop_orders (customer_name, phone_number, total_amount) VALUES (?, ?, ?)`,
        [customerName, phoneNumber, totalAmount]
      );
      const orderId = orderResult.insertId;

      // 3. 주문 항목(order_items) 생성 및 재고 처리
      for (const item of orders) {
        // 3-1. product_id 찾기
        const [product] = await dbAcademy.promise().query(
            `SELECT product_id FROM shop_products WHERE product_name = ?`, [item.name]
        );
        const productId = product[0].product_id;

        // 3-2. 현재 재고 확인 (FOR UPDATE로 동시 주문 방지)
        const [inventory] = await dbAcademy.promise().query(
           `SELECT inventory_id, stock_quantity 
            FROM shop_inventory 
            WHERE product_id = ? AND size = ? FOR UPDATE`,
           [productId, item.size]
        );
        
        let itemStatus = 'NEEDS_ORDER'; // 기본값 '발주필요'

        if (inventory.length > 0 && inventory[0].stock_quantity > 0) {
          // 3-3. (재고 있음) 재고 차감
          await dbAcademy.promise().query(
            `UPDATE shop_inventory SET stock_quantity = stock_quantity - 1 WHERE inventory_id = ?`,
            [inventory[0].inventory_id]
          );
          itemStatus = 'IN_STOCK'; // '재고있음'으로 변경
        }
        
        // 3-4. (재고 없거나 있어도) 주문 항목 추가
        await dbAcademy.promise().query(
          `INSERT INTO shop_order_items (order_id, product_id, product_name, size, quantity, price_per_item, item_status) 
           VALUES (?, ?, ?, ?, 1, ?, ?)`,
          [orderId, productId, item.name, item.size, item.price, itemStatus]
        );
      }

      // 4. 모든 작업 성공 -> 커밋
      await dbAcademy.promise().commit();
      
      console.log(`[주문 접수] ${customerName} (${orderId}번)`);

      // =======================================================
      // 🚀 5. NCP SENS 문자 발송 (네가 준 코드와 동일)
      // =======================================================
      
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
      
      // 6. 프론트엔드에 최종 성공 응답
      res.status(201).send({ message: '주문이 성공적으로 접수되었습니다.' });

    } catch (error) {
      // 7. 실패 -> 롤백
      await dbAcademy.promise().rollback();
      console.error('주문 처리 중 오류:', error);
      res.status(500).send({ message: '주문 처리 중 서버 오류 발생' });
    }
  });
});


// ---------------------------------
// B. 관리자용 API (admin-*.html)
// ---------------------------------

// 1. [상품관리] 신규 상품 등록 (사진 업로드 포함)
app.post('/college/admin/products', upload.fields([
  { name: 'image_url', maxCount: 1 },
  { name: 'extra_image_url', maxCount: 1 }
]), async (req, res) => {
  
  const { product_name, price, category, sizes } = req.body;
  const files = req.files;

  // req.files['image_url'][0].path => 'uploads/12345-image.png'
  // DB에 저장할 경로: /uploads/12345-image.png
  const image_url = files['image_url'] ? '/' + files['image_url'][0].path.replace(/\\/g, '/') : null;
  const extra_image_url = files['extra_image_url'] ? '/' + files['extra_image_url'][0].path.replace(/\\/g, '/') : null;

  // 1. DB 트랜잭션 시작
  dbAcademy.beginTransaction(async (err) => {
    if (err) return res.status(500).send({ message: '트랜잭션 시작 실패' });

    try {
      // 2. shop_products 테이블에 상품 추가
      const [productResult] = await dbAcademy.promise().query(
        `INSERT INTO shop_products (product_name, price, category, image_url, extra_image_url, is_active) 
         VALUES (?, ?, ?, ?, ?, TRUE)`,
        [product_name, price, category, image_url, extra_image_url]
      );
      const newProductId = productResult.insertId;

      // 3. shop_inventory 테이블에 사이즈별 재고(0개) 추가
      const sizeArray = sizes.split(',').map(s => s.trim()).filter(s => s);
      if (sizeArray.length > 0) {
        const inventoryValues = sizeArray.map(size => [newProductId, size, 0]);
        await dbAcademy.promise().query(
          `INSERT INTO shop_inventory (product_id, size, stock_quantity) VALUES ?`,
          [inventoryValues]
        );
      }
      
      // 4. 커밋
      await dbAcademy.promise().commit();
      res.status(201).send({ message: '신규 상품이 등록되었습니다.' });

    } catch (error) {
      await dbAcademy.promise().rollback();
      console.error('상품 등록 중 오류:', error);
      res.status(500).send({ message: '상품 등록 중 서버 오류 발생' });
    }
  });
});

// 2. [상품관리] 전체 재고 현황 조회
app.get('/college/admin/inventory', (req, res) => {
  const query = `
    SELECT p.product_name, i.inventory_id, i.size, i.stock_quantity
    FROM shop_inventory i
    JOIN shop_products p ON i.product_id = p.product_id
    WHERE p.is_active = TRUE
    ORDER BY p.product_name, i.inventory_id;
  `;
  dbAcademy.query(query, (err, results) => {
    if (err) return res.status(500).send(err);
    res.json(results);
  });
});

// 3. [상품관리] 재고 수량 수정 (입고 처리)
app.patch('/college/admin/inventory/:id', (req, res) => {
  const { id } = req.params;
  const { newStock } = req.body; 

  dbAcademy.query(
    'UPDATE shop_inventory SET stock_quantity = ? WHERE inventory_id = ?',
    [newStock, id],
    (err, result) => {
      if (err) return res.status(500).send(err);
      res.send({ message: '재고가 업데이트되었습니다.' });
    }
  );
});

// 4. [주문관리] 전체 주문 상세 내역 조회
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
    if (err) return res.status(500).send(err);
    res.json(results);
  });
});

// 5. [주문관리] 주문 입금/분출 상태 변경 (전체 주문 대상)
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
      if (err) return res.status(500).send(err);
      res.send({ message: '주문 상태가 변경되었습니다.' });
    }
  );
});

// 6. [주문관리] 개별 아이템 발주 상태 변경
app.patch('/college/admin/order-item/:id/status', (req, res) => {
  const { id } = req.params; // item_id
  const { status } = req.body; // "ORDERED"

  dbAcademy.query(
    'UPDATE shop_order_items SET item_status = ? WHERE item_id = ?',
    [status, id],
    (err, result) => {
      if (err) return res.status(500).send(err);
      res.send({ message: '발주 상태가 변경되었습니다.' });
    }
  );
});


// ===============================================
// ✉️ NCP SENS 문자 발송 함수 (네가 준 코드)
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

// 연결 로그
db.connect(err => {
  if (err) console.error('❌ 정시엔진 DB 연결 실패:', err);
  else console.log('✅ 정시엔진 DB 연결 성공');
});

dbAcademy.connect(err => {
  if (err) console.error('❌ 학원관리 DB 연결 실패:', err);
  else console.log('✅ 학원관리 DB 연결 성공');
});

db_drsports.connect(err => {
  if (err) console.error('❌ 닥터스포츠 DB 연결 실패:', err);
  else console.log('✅ 닥터스포츠 DB 연결 성공');
});

// ✅ 외부로 모두 내보내기
module.exports = { db, dbAcademy, db_drsports };



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

const drsports = require('./drsports');
app.use('/college', drsports);










app.listen(port, () => {
  console.log(`🚀 대학 추천 서버 ${port}번 포트에서 실행 중`);
});

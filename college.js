const express = require('express');
const mysql = require('mysql');
const cors = require('cors');
const axios = require('axios'); 
const crypto = require('crypto'); 
const path = require('path');
const multer = require('multer');
const fs = require('fs');
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
  connectionLimit: 10,
  flags: ['-FOUND_ROWS', '-BIG_NUMBERS_STRING']
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
// 🖼️ 사진 업로드 (Multer) 설정
// ===============================================
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const randomSuffix = Math.round(Math.random() * 1E6);
    cb(null, Date.now() + '-' + randomSuffix + ext);
  }
});
const uploadNew = multer({ storage: storage }).array('images', 6);
const uploadEdit = multer({ storage: storage }).array('new_images', 6);

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ===============================================
// 🛒 의류샵 API
// ===============================================

// 1. 상품 목록 불러오기 (JSON 파싱 오류 수정)
app.get('/college/shop/products', (req, res) => {
  const query = `
    SELECT 
        p.product_id, p.product_name, p.price, p.category, 
        p.image_urls,
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
    
    let products;
    try {
        products = results.map(p => ({
          ...p,
          // [수정] try-catch로 안전하게 파싱
          images: JSON.parse(p.image_urls || '[]'),
          customSizes: JSON.parse(p.sizes)[0] === null ? [] : JSON.parse(p.sizes)
        }));
    } catch (parseError) {
        console.error('JSON 파싱 오류:', parseError, 'Data:', p.image_urls);
        return res.status(500).send({ message: '데이터 파싱 중 오류가 발생했습니다. DB의 image_urls 컬럼을 확인하세요.' });
    }
    
    const clothingProducts = products.filter(p => p.category === 'clothing');
    const shoesProducts = products.filter(p => p.category === 'shoes');
    res.json({ clothingProducts, shoesProducts });
  });
});

// 2. 주문 접수하기 (동일)
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

// 1. 신규 상품 등록 (동일)
app.post('/college/admin/products', uploadNew, (req, res) => {
  const { product_name, price, category, sizes } = req.body;
  const files = req.files; 
  
  const image_paths = files ? files.map(f => '/' + f.path.replace(/\\/g, '/')) : [];
  const image_urls_json = JSON.stringify(image_paths);

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
        `INSERT INTO shop_products (product_name, price, category, image_urls, is_active) 
         VALUES (?, ?, ?, ?, TRUE)`,
        [product_name, price, category, image_urls_json],
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

// 2. [상품관리] 전체 재고 현황 조회 (LEFT JOIN + JSON 파싱 오류 수정)
app.get('/college/admin/inventory', (req, res) => {
  // [수정] LEFT JOIN으로 변경 (사이즈 없는 상품도 보이게)
  const query = `
    SELECT 
        p.product_name, p.product_id, p.is_active, p.category,
        p.price, p.image_urls,
        i.inventory_id, i.size, i.stock_quantity
    FROM 
        shop_products p
    LEFT JOIN 
        shop_inventory i ON p.product_id = i.product_id
    ORDER BY 
        p.product_name, i.inventory_id;
  `;
  
  dbAcademy.query(query, (err, results) => {
    if (err) {
      console.error('재고 현황 조회 실패:', err);
      return res.status(500).send({ message: '재고 조회 실패' });
    }
    
    let finalResults;
    try {
        finalResults = results.map(item => ({
            ...item,
            // [수정] try-catch로 안전하게 파싱
            image_urls: JSON.parse(item.image_urls || '[]') 
        }));
    } catch (parseError) {
        console.error('JSON 파싱 오류:', parseError);
        return res.status(500).send({ message: '데이터 파싱 중 오류가 발생했습니다. DB의 image_urls 컬럼을 확인하세요.' });
    }
    
    res.json(finalResults);
  });
});


// 3. 상품 삭제 API (동일)
app.delete('/college/admin/products/:id', (req, res) => {
  const productId = req.params.id;

  dbAcademy.getConnection((err, connection) => {
    if (err) {
      console.error('DB 커넥션 가져오기 실패:', err);
      return res.status(500).send({ message: 'DB 연결 실패' });
    }

    let filePaths = []; 

    connection.query(
      'SELECT image_urls FROM shop_products WHERE product_id = ?',
      [productId],
      (err, results) => {
        if (err) {
          console.error('파일 경로 조회 실패:', err);
          connection.release();
          return res.status(500).send({ message: '파일 경로 조회 실패' });
        }

        if (results.length > 0 && results[0].image_urls) {
          try {
            const urls = JSON.parse(results[0].image_urls);
            if (Array.isArray(urls)) {
              filePaths = urls;
            }
          } catch(e) {
             console.error('삭제 시 JSON 파싱 실패 (무시):', e);
          }
        }

        connection.query(
          'DELETE FROM shop_products WHERE product_id = ?',
          [productId],
          (err, deleteResult) => {
            connection.release(); 

            if (err) {
              console.error('DB 상품 삭제 실패:', err);
              return res.status(500).send({ message: 'DB 상품 삭제 실패. 주문 내역이 있는 상품일 수 있습니다.' });
            }

            if (deleteResult.affectedRows === 0) {
              return res.status(404).send({ message: '삭제할 상품을 찾지 못했습니다.' });
            }

            filePaths.forEach(urlPath => {
              const serverPath = path.join(__dirname, urlPath); 
              fs.unlink(serverPath, (unlinkErr) => {
                if (unlinkErr && unlinkErr.code !== 'ENOENT') {
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

// 4. 재고 수량 수정 (동일)
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

 // 4-1. 상품 게시(active) 상태 변경 API (동일)
app.patch('/college/admin/products/:id/status', (req, res) => {
  const { id } = req.params;
  const { isActive } = req.body; 

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

// 4-2. 상품 정보 수정 API (동일)
app.patch('/college/admin/products/:id', uploadEdit, (req, res) => {
    
    const { id: productId } = req.params;
    const { edit_product_name, edit_price, edit_sizes, existing_images_to_keep } = req.body;
    const new_files = req.files;

    let oldFilePathsToDelete = []; 

    dbAcademy.getConnection((err, connection) => {
        if (err) {
            console.error('DB 커넥션 가져오기 실패:', err);
            return res.status(500).send({ message: 'DB 연결 실패' });
        }

        const queryAsync = (sql, params) => {
            return new Promise((resolve, reject) => {
                connection.query(sql, params, (err, results) => {
                    if (err) return reject(err);
                    resolve(results);
                });
            });
        };

        connection.beginTransaction(async (err) => {
            if (err) {
                console.error('트랜잭션 시작 실패:', err);
                connection.release();
                return res.status(500).send({ message: '트랜잭션 시작 실패' });
            }

            try {
                const [currentProduct] = await queryAsync(
                    'SELECT image_urls FROM shop_products WHERE product_id = ?', 
                    [productId]
                );
                
                let old_image_urls = [];
                try {
                   old_image_urls = JSON.parse(currentProduct.image_urls || '[]');
                } catch(e) { console.error("기존 이미지 파싱 실패 (무시):", e)}

                
                let kept_image_urls = [];
                try {
                    kept_image_urls = JSON.parse(existing_images_to_keep || '[]');
                } catch(e) { console.error("유지할 이미지 파싱 실패 (무시):", e)}

                const new_image_paths = new_files ? new_files.map(f => '/' + f.path.replace(/\\/g, '/')) : [];
                const final_image_urls = [...kept_image_urls, ...new_image_paths];
                const final_image_urls_json = JSON.stringify(final_image_urls);

                oldFilePathsToDelete = old_image_urls.filter(url => !kept_image_urls.includes(url));

                await queryAsync(
                    'UPDATE shop_products SET product_name = ?, price = ?, image_urls = ? WHERE product_id = ?',
                    [edit_product_name, edit_price, final_image_urls_json, productId]
                );

                const newSizeArray = edit_sizes.split(',').map(s => s.trim()).filter(s => s);
                
                const currentInventory = await queryAsync(
                    'SELECT size FROM shop_inventory WHERE product_id = ?', 
                    [productId]
                );
                const currentSizeArray = currentInventory.map(inv => inv.size);
                
                const sizesToAdd = newSizeArray.filter(s => !currentSizeArray.includes(s));
                if (sizesToAdd.length > 0) {
                    const valuesToAdd = sizesToAdd.map(size => [productId, size, 0]);
                    await queryAsync(
                        'INSERT INTO shop_inventory (product_id, size, stock_quantity) VALUES ?', 
                        [valuesToAdd]
                    );
                }

                const sizesToRemove = currentSizeArray.filter(s => !newSizeArray.includes(s));
                if (sizesToRemove.length > 0) {
                    await queryAsync(
                        'DELETE FROM shop_inventory WHERE product_id = ? AND size IN (?)', 
                        [productId, sizesToRemove]
                    );
                }

                await connection.commit();
                
                oldFilePathsToDelete.forEach(urlPath => {
                    const serverPath = path.join(__dirname, urlPath); 
                    fs.unlink(serverPath, (unlinkErr) => {
                        if (unlinkErr && unlinkErr.code !== 'ENOENT') {
                            console.error('파일 삭제 실패:', serverPath, unlinkErr);
                        } else {
                            console.log('기존 파일 삭제 성공:', serverPath);
                        }
                    });
                });
                
                res.send({ message: '상품 정보가 성공적으로 수정되었습니다.' });

            } catch (error) {
                console.error('상품 수정 중 오류 발생:', error);
                await connection.rollback();
                const new_image_paths = new_files ? new_files.map(f => '/' + f.path.replace(/\\/g, '/')) : [];
                new_image_paths.forEach(urlPath => {
                    const serverPath = path.join(__dirname, urlPath); 
                    fs.unlink(serverPath, () => {}); 
                });

                res.status(500).send({ message: '상품 수정 실패: ' + error.message });
            } finally {
                connection.release();
            }
        });
    });
});


// 5. 주문관리 - 상세 내역 조회 (동일)
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

// 6. 주문관리 - 상태 변경 (동일)
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

// 7. 주문관리 - 아이템 상태 변경 (동일)
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
app.delete('/college/admin/order-item/:id', (req, res) => {
  const { id: itemId } = req.params; // item_id

  dbAcademy.getConnection((err, connection) => {
    if (err) {
      console.error('DB 커넥션 가져오기 실패:', err);
      return res.status(500).send({ message: 'DB 연결 실패' });
    }

    connection.beginTransaction(async (err) => {
      if (err) {
        console.error('트랜잭션 시작 실패:', err);
        connection.release();
        return res.status(500).send({ message: '트랜잭션 시작 실패' });
      }

      // 쿼리 함수를 Promise로 래핑 (async/await용)
      const queryAsync = (sql, params) => {
        return new Promise((resolve, reject) => {
          connection.query(sql, params, (err, results) => {
            if (err) return reject(err);
            resolve(results);
          });
        });
      };

      try {
        // 1. 삭제할 아이템 정보 조회 (재고 복원용)
        const [itemToDelete] = await queryAsync(
          'SELECT product_id, size, item_status FROM shop_order_items WHERE item_id = ?',
          [itemId]
        );

        if (!itemToDelete) {
          throw new Error('삭제할 주문 항목을 찾을 수 없습니다.');
        }

        // 2. 주문 아이템 삭제
        const deleteResult = await queryAsync(
          'DELETE FROM shop_order_items WHERE item_id = ?',
          [itemId]
        );

        if (deleteResult.affectedRows === 0) {
          throw new Error('주문 항목 삭제에 실패했습니다.');
        }

        // 3. 만약 '재고 분출' 항목이었다면, 재고 수량 1 복원
        if (itemToDelete.item_status === 'IN_STOCK') {
          await queryAsync(
            'UPDATE shop_inventory SET stock_quantity = stock_quantity + 1 WHERE product_id = ? AND size = ?',
            [itemToDelete.product_id, itemToDelete.size]
          );
        }

        // 4. 성공 시 커밋
        await connection.commit();
        res.send({ message: '주문 항목이 삭제되었습니다. (필요시 재고가 복원되었습니다)' });

      } catch (error) {
        // 5. 실패 시 롤백
        await connection.rollback();
        console.error('주문 항목 삭제 실패:', error);
        res.status(500).send({ message: '주문 항목 삭제 실패: ' + error.message });
      } finally {
        // 6. 커넥션 반납
        connection.release();
      }
    });
  });
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

const calculator = require('./collegeCalculator');
// app.use('/college', calculator); 

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

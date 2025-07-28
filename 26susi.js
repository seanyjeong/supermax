const express = require('express');
const cors = require('cors');
const mysql = require('mysql2');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const app = express();
const port = 8080;
const JWT_SECRET = 'super-secret-key!!';

// 1. CORS 옵션 설정
const corsOptions = {
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders: 'Content-Type,Authorization'
};

// 2. 미들웨어 적용 (순서 중요)
app.use(cors(corsOptions));
app.use(express.json());

// =================================================================
// 🚦 [디버깅 로그 1] 모든 요청을 가장 먼저 확인하는 '문지기'
// =================================================================
app.use((req, res, next) => {
    console.log(`\n\n<<<<< [${new Date().toLocaleString('ko-KR')}] 새로운 요청 감지! >>>>>`);
    console.log(`[요청 메소드] ${req.method}`);
    console.log(`[요청 경로] ${req.path}`);
    console.log(`[요청 발신지(Origin)] ${req.headers.origin}`);
    console.log('----------------------------------------------------');
    next();
});

// =================================================================
// 👮 [디버깅 로그 2] JWT 인증 미들웨어 실행 확인
// =================================================================
function authJWT(req, res, next) {
    console.log(`[인증 검사 시작] ${req.path} 경로의 토큰을 확인합니다.`);
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
        console.log("    -> [인증 실패] ❌ 토큰이 없습니다.");
        return res.status(401).json({ success: false, message: 'No token' });
    }
    try {
        req.user = jwt.verify(token, JWT_SECRET);
        console.log("    -> [인증 성공] ✅ 토큰이 유효합니다. 다음으로 진행합니다.");
        next();
    } catch {
        console.log("    -> [인증 실패] ❌ 토큰이 유효하지 않습니다.");
        return res.status(401).json({ success: false, message: 'Invalid token' });
    }
}

const db = mysql.createPool({
  host: '211.37.174.218',
  user: 'maxilsan',
  password: 'q141171616!',
  database: '26susi',
  charset: 'utf8mb4',
  waitForConnections: true, // 연결이 없을 때 대기
  connectionLimit: 10,      // 최대 10개의 커넥션을 만듦
  queueLimit: 0             // 대기열 제한 없음
});

// 관리자 권한 체크 함수
function isAdmin(user) {
  return user && user.userid === 'admin';
}
function safe(v) {
  return v === undefined ? null : v;
}


// (GET) 원장회원 리스트 조회
app.get('/26susi_admin_members', authJWT, async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ success: false, message: "권한없음" });
  const [rows] = await db.promise().query("SELECT 원장ID, 아이디, 이름, 지점명, 전화번호, 승인여부 FROM 원장회원");
  res.json({ success: true, members: rows });
});

// (POST) 회원 승인
app.post('/26susi_admin_approve', authJWT, async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ success: false, message: "권한없음" });
  const { userid } = req.body;
  if (!userid) return res.json({ success: false, message: "아이디 필요" });
  await db.promise().query("UPDATE 원장회원 SET 승인여부='O' WHERE 아이디=?", [userid]);
  res.json({ success: true });
});

// (POST) 회원 삭제
app.post('/26susi_admin_delete', authJWT, async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ success: false, message: "권한없음" });
  const { userid } = req.body;
  if (!userid) return res.json({ success: false, message: "아이디 필요" });
  await db.promise().query("DELETE FROM 원장회원 WHERE 아이디=?", [userid]);
  res.json({ success: true });
});

// ✅ 원장회원 회원가입
app.post('/26susi/register', async (req, res) => {
  try {
    const { userid, password, name, branch, phone } = req.body;
    if (![userid, password, name, branch, phone].every(Boolean))
      return res.json({ success: false, message: "모든 값 입력" });

    // 중복 확인
    const [dup] = await db.promise().query(
      "SELECT 원장ID FROM 원장회원 WHERE 아이디 = ?",
      [userid]
    );
    if (dup.length > 0) return res.json({ success: false, message: "이미 사용중인 아이디" });

    // 비번 해시
    const hash = await bcrypt.hash(password, 10);
    // 가입 승인은 기본 '대기'
    await db.promise().query(
      "INSERT INTO 원장회원 (아이디, 비밀번호, 이름, 지점명, 전화번호) VALUES (?, ?, ?, ?, ?)",
      [userid, hash, name, branch, phone]
    );

    res.json({ success: true });
  } catch (err) {
    console.error('회원가입 오류:', err);
    res.json({ success: false, message: "서버 오류" });
  }
});

// ✅ 원장회원 로그인 + JWT 발급
app.post('/26susi/login', async (req, res) => {
  try {
    const { userid, password } = req.body;
    if (!userid || !password)
      return res.json({ success: false, message: "아이디/비번 입력" });

    const [rows] = await db.promise().query(
      "SELECT * FROM 원장회원 WHERE 아이디 = ?",
      [userid]
    );
    if (!rows.length) return res.json({ success: false, message: "아이디 없음" });

    const user = rows[0];
    if (user.승인여부 !== 'O')
      return res.json({ success: false, message: "아직 승인 안 됨" });

    const isMatch = await bcrypt.compare(password, user.비밀번호);
    if (!isMatch) return res.json({ success: false, message: "비번 오류" });

    // JWT 발급
    const token = jwt.sign(
      { id: user.원장ID, userid: user.아이디, name: user.이름, branch: user.지점명 },
      JWT_SECRET,
      { expiresIn: '3d' }
    );
    res.json({ success: true, token });
  } catch (err) {
    console.error('로그인 오류:', err);
    res.json({ success: false, message: "서버 오류" });
  }
});

// ✅ JWT 인증 미들웨어 (이후 모든 API에 붙여서 인증체크)
function authJWT(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, message: 'No token' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }
}

// 예시: 인증필요한 API
app.get('/26susi/profile', authJWT, async (req, res) => {
  // req.user에 원장정보 들어있음!
  res.json({ success: true, user: req.user });
});

app.listen(port, () => {
  console.log('원장회원 가입/로그인 서버 실행!');
});
//실기배점


app.get('/26susi_get_practical_colleges', async (req, res) => {
  const sql = `
    SELECT 대학ID, 실기ID, 대학명, 학과명, 전형명
    FROM 대학정보
    WHERE 실기ID IS NOT NULL
    ORDER BY 대학명
  `;
  try {
    const [rows] = await db.promise().query(sql);
    res.json(rows);
  } catch (err) {
    console.error('실기 대학 조회 실패:', err);
    res.status(500).json({ error: '실기 대학 조회 실패' });
  }
});

// ✅ (신규) 실기ID 기준 배점표 전체 수정/저장 API
app.post('/26susi_update_score_table', authJWT, async (req, res) => {
    // authJWT를 넣어서 로그인한 관리자만 이 기능을 사용하도록 제한해야 해.
    if (!isAdmin(req.user)) {
        return res.status(403).json({ success: false, message: "관리자 권한이 필요합니다." });
    }

    const { 실기ID, data } = req.body;

    if (!실기ID || !Array.isArray(data) || data.length === 0) {
        return res.status(400).json({ success: false, message: "실기ID와 배점표 데이터가 필요합니다." });
    }

    const connection = await db.promise().getConnection(); // 트랜잭션을 위해 커넥션 가져오기

    try {
        await connection.beginTransaction(); // 트랜잭션 시작

        // 1. 기존 데이터를 모두 삭제
        console.log(`[수정 시작] 실기ID(${실기ID})의 기존 배점표를 삭제합니다.`);
        await connection.query("DELETE FROM `26수시실기배점` WHERE 실기ID = ?", [실기ID]);

        // 2. 프론트에서 받은 새 데이터로 다시 INSERT
        console.log(`[수정 진행] 실기ID(${실기ID})의 새로운 배점표 ${data.length}개를 추가합니다.`);
        
        // 여러 데이터를 한번에 넣기 위해 배열 형태로 가공
        const values = data.map(item => [
            실기ID,
            item.종목명,
            item.성별,
            item.기록,
            item.배점
        ]);

        const sql = "INSERT INTO `26수시실기배점` (실기ID, 종목명, 성별, 기록, 배점) VALUES ?";
        await connection.query(sql, [values]); // Bulk Insert 실행

        await connection.commit(); // 모든 작업이 성공했으면 최종 반영 (커밋)
        
        console.log(`[수정 완료] 실기ID(${실기ID}) 배점표 업데이트 성공!`);
        res.json({ success: true, message: '배점표가 성공적으로 업데이트되었습니다.' });

    } catch (err) {
        await connection.rollback(); // 오류 발생 시 모든 작업을 취소 (롤백)
        console.error('❌ 배점표 업데이트 중 오류 발생:', err);
        res.status(500).json({ success: false, message: '서버 오류로 업데이트에 실패했습니다.' });
    } finally {
        connection.release(); // 커넥션 반환
    }
});


app.post('/26susi_save_practical_total_config', async (req, res) => {
  const {
    대학ID,
    실기반영총점,
    기준총점,
    환산방식,
    특수식설명
  } = req.body;

  if (!대학ID || !실기반영총점) {
    return res.status(400).json({ error: '필수값 누락' });
  }

  const sql = `
    INSERT INTO 26수시실기총점반영 
    (대학ID, 실기반영총점, 기준총점, 환산방식, 특수식설명)
    VALUES (?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE 
      실기반영총점 = VALUES(실기반영총점),
      기준총점 = VALUES(기준총점),
      환산방식 = VALUES(환산방식),
      특수식설명 = VALUES(특수식설명)
  `;
  try {
    await db.promise().query(sql, [
      대학ID,
      실기반영총점,
      기준총점 || 400,
      환산방식 || '비율환산',
      특수식설명 || ''
    ]);
    res.json({ success: true });
  } catch (err) {
    console.error('총점 설정 저장 실패:', err);
    res.status(500).json({ error: '총점 설정 저장 실패' });
  }
});

// ✅ (새로 추가할 API) 대학 목록 + 실기 만점 합계 조회
// ✅ (새로 추가할 API) 대학 목록 + 실기 만점 합계 조회 -> (수정) 저장된 설정값도 함께 조회
app.get('/26susi_get_practical_colleges_with_scores', async (req, res) => {
  // 기존 쿼리에 `26수시실기총점반영` 테이블을 LEFT JOIN 하여 저장된 값을 함께 가져오도록 수정
  const sql = `
    SELECT 
      d.대학ID, d.실기ID, d.대학명, d.학과명, d.전형명,
      COALESCE(s.total_max_score, 0) AS 기본만점총합,
      t.실기반영총점, t.기준총점, t.환산방식, t.특수식설명
    FROM 
      대학정보 d
    LEFT JOIN (
      SELECT 
        실기ID, SUM(max_score) as total_max_score
      FROM (
        SELECT 
          실기ID, 종목명, MAX(CAST(배점 AS SIGNED)) as max_score 
        FROM \`26수시실기배점\`
        WHERE 실기ID IS NOT NULL
        GROUP BY 실기ID, 종목명
      ) as subquery
      GROUP BY 실기ID
    ) s ON d.실기ID = s.실기ID
    LEFT JOIN \`26수시실기총점반영\` t ON d.대학ID = t.대학ID
    WHERE 
      d.실기ID IS NOT NULL
    ORDER BY 
      d.대학명;
  `;

  try {
    const [rows] = await db.promise().query(sql);
    res.json(rows);
  } catch (err) {
    console.error('실기 만점 합계 및 설정값 조회 실패:', err);
    res.status(500).json({ error: '데이터 조회 실패' });
  }
});
// ✅ 실기ID 기준 배점표 + 종목명 조회
// ✅ 실기ID 기준 전체 원시 배점표 반환 (렌더링은 프론트에서)
// ✅ (수정) 실기ID 기준 전체 배점표 반환 (종목별로 그룹화)
app.get('/26susi_get_score_table', async (req, res) => {
  const { 실기ID } = req.query;
  if (!실기ID) return res.status(400).json({ error: '실기ID가 누락되었습니다.' });

  try {
    // 실기ID에 해당하는 모든 종목 데이터를 배점 순으로 가져옵니다.
    const [rows] = await db.promise().query(
      `SELECT 종목명, 성별, 기록, 배점 FROM \`26수시실기배점\` WHERE 실기ID = ? ORDER BY 종목명, CAST(배점 AS SIGNED) DESC`,
      [실기ID]
    );

    if (!rows || rows.length === 0) {
      return res.status(404).json({ success: false, error: '해당 실기ID에 대한 배점표가 없습니다.' });
    }

    // 종목명(예: "높이뛰기")을 기준으로 데이터를 그룹화합니다.
    const events = rows.reduce((acc, row) => {
      const { 종목명, 성별, 기록, 배점 } = row;
      // acc 객체에 해당 종목명이 없으면, 새로운 객체를 생성합니다.
      if (!acc[종목명]) {
        acc[종목명] = { 남: [], 여: [] };
      }
      // 성별에 따라 배점과 기록을 추가합니다.
      const entry = { 배점, 기록 };
      if (성별 === '남') {
        acc[종목명].남.push(entry);
      } else if (성별 === '여') {
        acc[종목명].여.push(entry);
      }
      return acc;
    }, {});

    res.json({ success: true, events });
  } catch (err) {
    console.error('❌ 배점표 조회 중 오류:', err);
    res.status(500).json({ success: false, error: '서버 오류로 배점표 조회에 실패했습니다.' });
  }
});



// 🟩 추가할 새 API 코드

// ✅ 아래 코드를 통째로 복사해서 추가하세요.

// (신규) 학생별 상담메모 불러오기
app.get('/26susi_counsel_memo_load', authJWT, async (req, res) => {
  const { student_id } = req.query;
  if (!student_id) return res.status(400).json({ success: false, message: "학생ID 누락" });
  try {
    const [rows] = await db.promise().query("SELECT 상담메모 FROM 상담_로그 WHERE 학생ID = ?", [student_id]);
    const memo = rows.length > 0 ? rows[0].상담메모 : '';
    res.json({ success: true, memo });
  } catch(err) {
    console.error('상담메모 로드 오류:', err);
    res.status(500).json({ success: false, message: 'DB 오류' });
  }
});

// (신규) 학생별 상담메모 저장/수정
app.post('/26susi_counsel_memo_save', authJWT, async (req, res) => {
  const { student_id, memo } = req.body;
  if (student_id === undefined || memo === undefined) 
    return res.status(400).json({ success: false, message: "필수값 누락" });

  try {
    await db.promise().query(`
      INSERT INTO 상담_로그 (학생ID, 상담메모) VALUES (?, ?)
      ON DUPLICATE KEY UPDATE 상담메모 = VALUES(상담메모)
    `, [student_id, memo]);
    res.json({ success: true });
  } catch(err) {
    console.error('상담메모 저장 오류:', err);
    res.status(500).json({ success: false, message: 'DB 오류' });
  }
});

// (신규) 학생별 상담메모 삭제 (필요 시 사용)
app.post('/26susi_counsel_memo_delete', authJWT, async (req, res) => {
    const { student_id } = req.body;
    if (!student_id) return res.status(400).json({ success: false, message: "학생ID 누락" });

    try {
        await db.promise().query("DELETE FROM 상담_로그 WHERE 학생ID = ?", [student_id]);
        res.json({ success: true });
    } catch(err) {
        console.error('상담메모 삭제 오류:', err);
        res.status(500).json({ success: false, message: 'DB 오류' });
    }
});


//학생관리(정보수정및등록)
// 1. 학생 명단 다중등록 (엑셀 복붙/파싱된 배열)
app.post('/26susi_student_bulk_insert', authJWT, async (req, res) => {
  try {
    const branch = req.body.branch;
    const students = req.body.students;
    if (!branch || !Array.isArray(students) || students.length === 0)
      return res.json({ success: false, message: "지점/명단 입력 필요" });

    // (원장별 branch 일치 여부 검증하고 싶으면 여기서 체크!)
    // if (req.user.branch !== branch) return res.json({success:false, message:"권한없음"});

    let inserted = 0;
    for (let s of students) {
      if (!s.name) continue; // 최소값
      await db.promise().query(
        `INSERT INTO 학생기초정보 (이름, 학교명, 학년, 성별, 전화번호, 지점명)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [s.name, s.school || '', s.grade || '', s.gender || '', s.phone || '', branch]
      );
      inserted++;
    }
    res.json({ success: true, inserted });
  } catch (e) {
    console.error(e);
    res.json({ success: false, message: "등록 오류" });
  }
});

// 2. 학생 리스트 조회 (지점별)
app.get('/26susi_student_list', authJWT, async (req, res) => {
  try {
    const branch = req.query.branch || req.user.branch;
    // (여기도 branch 권한 체크해주면 더 안전!)
    // if (req.user.branch !== branch) return res.json({success:false, message:"권한없음"});

    const [rows] = await db.promise().query(
      "SELECT * FROM 학생기초정보 WHERE 지점명 = ? ORDER BY 학생ID DESC",
      [branch]
    );
    res.json({ success: true, students: rows });
  } catch (e) {
    console.error(e);
    res.json({ success: false, message: "조회 오류" });
  }
});

// 3. 학생 삭제
app.post('/26susi_student_delete', authJWT, async (req, res) => {
  try {
    const student_id = req.body.student_id;
    if (!student_id) return res.json({ success: false, message: "student_id 필요" });
    await db.promise().query("DELETE FROM 학생기초정보 WHERE 학생ID = ?", [student_id]);
    res.json({ success: true });
  } catch (e) {
    res.json({ success: false, message: "삭제 오류" });
  }
});

// 4. 학생 수정
app.post('/26susi_student_update', authJWT, async (req, res) => {
  try {
    const { student_id, name, school, grade, gender, phone } = req.body;
    if (!student_id) return res.json({ success: false, message: "student_id 필요" });

    await db.promise().query(
      `UPDATE 학생기초정보 SET
        이름=?, 학교명=?, 학년=?, 성별=?, 전화번호=?
        WHERE 학생ID=?`,
      [name, school, grade, gender, phone, student_id]
    );
    res.json({ success: true });
  } catch (e) {
    res.json({ success: false, message: "수정 오류" });
  }
});
// 내신입력및조회
// 1. 대학리스트 (전형명 포함!)


// 2. 학생리스트 (지점별)
app.get('/26susi_student_list', authJWT, async (req, res) => {
  const branch = req.query.branch || req.user.branch;
  const [rows] = await db.promise().query(
    "SELECT 학생ID, 이름 FROM 학생기초정보 WHERE 지점명 = ? ORDER BY 학생ID",
    [branch]
  );
  res.json({ success: true, students: rows });
});
// $개별조회
// GET /26susi_student_grade?student_id=123
app.get('/26susi_student_grade', authJWT, async (req, res) => {
  const student_id = req.query.student_id;
  if (!student_id) return res.json({ success: false, message: "student_id 필요" });
  const [rows] = await db.promise().query(
    "SELECT 대학ID, 등급, 내신점수 FROM 학생_내신정보 WHERE 학생ID = ?",
    [student_id]
  );
  res.json({ success: true, grades: rows });
});

//  상담페이지 대학선택 등급내신
// { student_id, college_id, 등급, 내신점수 }
app.post('/26susi_student_grade_update', authJWT, async (req, res) => {
  const { student_id, college_id, 등급, 내신점수 } = req.body;
  if (!student_id || !college_id)
    return res.json({ success: false, message: "필수값 누락" });
  await db.promise().query(`
    INSERT INTO 학생_내신정보 (학생ID, 대학ID, 등급, 내신점수)
    VALUES (?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE 등급=VALUES(등급), 내신점수=VALUES(내신점수)
  `, [student_id, college_id, 등급, 내신점수]);
  res.json({ success: true });
});

// GET /26susi_college_list 대학리스트 (수정)
app.get('/26susi_college_list', authJWT, async (req, res) => {
  // 26수시실기총점반영 테이블과 LEFT JOIN하여 환산 정보를 함께 가져옵니다.
  const sql = `
    SELECT 
      d.대학ID, d.대학명, d.학과명, d.전형명, d.실기ID,
      t.실기반영총점, t.기준총점, t.환산방식,
      d.26맥스예상컷, d.26지점예상컷  -- 이 부분을 추가
    FROM 대학정보 d
    LEFT JOIN \`26수시실기총점반영\` t ON d.대학ID = t.대학ID
  `;
  const [rows] = await db.promise().query(sql);
  res.json({ success: true, colleges: rows });
});

// [새로 추가할 코드]

// (신규) 대학별 예상컷 저장/수정
app.post('/26susi_college_cut_update', authJWT, async (req, res) => {
    // 관리자만 이 기능을 사용하도록 제한
    if (!isAdmin(req.user)) {
        return res.status(403).json({ success: false, message: "관리자 권한이 필요합니다." });
    }

    const { 대학ID, 맥스예상컷, 지점예상컷 } = req.body;
    if (!대학ID) {
        return res.status(400).json({ success: false, message: "대학ID가 필요합니다." });
    }

    try {
        await db.promise().query(
            `UPDATE 대학정보 SET
                \`26맥스예상컷\` = ?,
                \`26지점예상컷\` = ?
             WHERE 대학ID = ?`,
            [맥스예상컷, 지점예상컷, 대학ID]
        );
        res.json({ success: true, message: '예상컷이 저장되었습니다.' });
    } catch (err) {
        console.error('예상컷 저장 오류:', err);
        res.status(500).json({ success: false, message: 'DB 저장 중 오류가 발생했습니다.' });
    }
});

// 상담 시 여러 대학 한 번에 저장 (colleges: [{...}, {...}])
// ✅ 수정 후 코드 (이 코드로 교체하세요)
// 상담 시 여러 대학 한 번에 저장 (colleges: [{...}, {...}])
// ✅ [수정] 삭제 로직이 포함된 최종 코드로 교체하세요.
app.post('/26susi_counsel_college_save_multi', authJWT, async (req, res) => {
  const { student_id, colleges } = req.body;
  if (student_id === undefined || !Array.isArray(colleges)) {
    return res.status(400).json({ success: false, message: "필수값 누락" });
  }

  // 데이터베이스 작업을 묶어서 처리하는 '트랜잭션' 시작
  const connection = await db.promise().getConnection();
  await connection.beginTransaction();

  try {
    // 1단계: 해당 학생의 기존 상담 대학 정보를 전부 삭제합니다.
    await connection.query("DELETE FROM 상담대학정보 WHERE 학생ID = ?", [student_id]);

    // 2단계: 화면에 남아있던 새로운 대학 정보 목록을 다시 INSERT 합니다.
    // (만약 colleges 배열이 비어있다면, 아무것도 추가하지 않고 '전체 삭제'만 된 효과)
    for (const col of colleges) {
      await connection.query(
        `INSERT INTO 상담대학정보 (
          학생ID, 대학ID, 실기ID, 내신등급, 내신점수,
          기록1, 점수1, 기록2, 점수2, 기록3, 점수3, 기록4, 점수4,
          기록5, 점수5, 기록6, 점수6, 기록7, 점수7,
          실기총점, 합산점수
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          student_id, safe(col.대학ID), safe(col.실기ID), safe(col.내신등급),
          safe(col.내신점수), safe(col.기록1), safe(col.점수1), safe(col.기록2),
          safe(col.점수2), safe(col.기록3), safe(col.점수3), safe(col.기록4),
          safe(col.점수4), safe(col.기록5), safe(col.점수5), safe(col.기록6),
          safe(col.점수6), safe(col.기록7), safe(col.점수7), safe(col.실기총점),
          safe(col.합산점수)
        ]
      );
    }

    // 3단계: 모든 작업이 성공하면 최종적으로 서버에 반영합니다.
    await connection.commit();
    res.json({ success: true });

  } catch (err) {
    // 중간에 에러가 발생하면 모든 작업을 취소하고 원래대로 되돌립니다.
    await connection.rollback();
    console.error('상담 대학 정보 저장 트랜잭션 오류:', err);
    res.status(500).json({ success: false, message: 'DB 처리 중 오류 발생' });

  } finally {
    // 작업이 끝나면 연결을 반납합니다.
    connection.release();
  }
});

app.get('/26susi_events_by_practical_id', authJWT, async (req, res) => {
  const { practical_id, gender } = req.query;
  if (!practical_id || !gender)
    return res.json({ success: false, message: "practical_id, gender 필요" });

  const [rows] = await db.promise().query(
    "SELECT DISTINCT 종목명 FROM 26수시실기배점 WHERE 실기ID = ? AND 성별 = ? ORDER BY 종목명",
    [practical_id, gender]
  );
  res.json({ success: true, events: rows });
});

app.get('/26susi_counsel_college_load', async (req, res) => {
  const student_id = req.query.student_id;
  if (!student_id) return res.json({ success: false, message: '학생ID 누락' });

  try {
    const [rows] = await db.promise().query(`
      SELECT 대학ID,
             기록1, 점수1, 기록2, 점수2, 기록3, 점수3,
             기록4, 점수4, 기록5, 점수5, 기록6, 점수6, 기록7, 점수7,
             합산점수, 상담메모
      FROM 상담대학정보
      WHERE 학생ID = ?
    `, [student_id]);

    res.json({ success: true, colleges: rows });
  } catch (err) {
    console.error('❌ 상담대학정보 불러오기 오류:', err);
    res.json({ success: false, message: 'DB 오류' });
  }
});



app.get('/26susi_counsel_college_list', authJWT, async (req, res) => {
  const student_id = req.query.student_id;
  if (!student_id)
    return res.json({ success: false, message: "학생ID 필요" });

  const [rows] = await db.promise().query(
    "SELECT * FROM 상담대학정보 WHERE 학생ID = ? ORDER BY 기록ID DESC", [student_id]
  );
  res.json({ success: true, list: rows });
});


// POST /26susi_counsel_college_save
// { student_id, college_id, 실기_id, 상담메모 }
app.post('/26susi_counsel_college_save', authJWT, async (req, res) => {
  const { student_id, college_id, 실기_id, 상담메모 } = req.body;
  if (!student_id || !college_id)
    return res.json({ success: false, message: "필수값 누락" });

  await db.promise().query(`
    INSERT INTO 상담대학정보 (학생ID, 대학ID, 실기ID, 상담메모)
    VALUES (?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE 상담메모=VALUES(상담메모)
  `, [student_id, college_id, 실기_id || null, 상담메모 || null]);

  res.json({ success: true });
});





// 3. 학생-대학 내신입력 데이터 전체조회 (branch별) - 전형명 포함!
app.get('/26susi_student_grade_map', authJWT, async (req, res) => {
  const branch = req.query.branch || req.user.branch;

  // 대학/학생/기존 입력값 모두 조회 (전형명 포함)
  const [colleges] = await db.promise().query("SELECT 대학ID, 대학명, 학과명, 전형명 FROM 대학정보");
const [students] = await db.promise().query(
  "SELECT 학생ID, 이름 FROM 학생기초정보 WHERE 지점명 = ? ORDER BY 학생ID", [branch]
);
const studentIds = students.map(s => s.학생ID);
let grades = [];
if (studentIds.length > 0) {
  [grades] = await db.promise().query(
    "SELECT 학생ID, 대학ID, 등급, 내신점수 FROM 학생_내신정보 WHERE 학생ID IN (?)",
    [studentIds]
  );
}
const grade_map = {};
(grades || []).forEach(g => {
  grade_map[`${g.학생ID}-${g.대학ID}`] = { 등급: g.등급, 내신점수: g.내신점수 };
});
res.json({ success: true, colleges, students, grade_map });
});

// 4. 학생-대학 등급/내신 입력/수정 (Upsert)
app.post('/26susi_student_grade_update', authJWT, async (req, res) => {
  const { student_id, college_id, 등급, 내신점수 } = req.body;
  if (!student_id || !college_id)
    return res.json({ success: false, message: "필수값 누락" });
  // Upsert (없으면 insert, 있으면 update)
  await db.promise().query(`
    INSERT INTO 학생_내신정보 (학생ID, 대학ID, 등급, 내신점수)
    VALUES (?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE 등급=VALUES(등급), 내신점수=VALUES(내신점수)
  `, [student_id, college_id, 등급, 내신점수]);
  res.json({ success: true });
});



// ✅ isReverse 판별 함수
const isReverseEvent = (eventName) => {
  const lower = eventName.toLowerCase();
  return ['10', '20', 'run', '100', 'z', '달리기','벽치기'].some(keyword => lower.includes(keyword));
};

// ✅ 1. 대학/학과 선택용 실기ID 목록
app.get('/26susi/practical-ids', (req, res) => {
const sql = `
  SELECT 실기ID, 대학명, 학과명, 전형명, 성별
  FROM \`26수시실기배점\`
  WHERE 실기ID IS NOT NULL
  GROUP BY 실기ID, 대학명, 학과명, 전형명, 성별
  ORDER BY 대학명
`;


  db.query(sql, (err, results) => {
    if (err) {
      console.error('❌ [실기ID 목록 조회 오류]', err);
      return res.status(500).json({ message: 'DB 오류' });
    }

    console.log('\n📌 [실기ID 목록 응답]');
    results.forEach(r => {
      console.log(`▶ 실기ID: ${r.실기ID} | ${r.대학명} / ${r.학과명} / ${r.전형명} / ${r.성별}`);
    });

    res.json(results);
  });
});



// ✅ 2. 종목명 + 성별 리스트
app.get('/26susi/events/:id', (req, res) => {
  const 실기ID = req.params.id;

  const sql = `
    SELECT DISTINCT 종목명, 성별
    FROM \`26수시실기배점\`
    WHERE 실기ID = ?
  `;
  db.query(sql, [실기ID], (err, results) => {
    if (err) {
      console.error('❌ [종목 조회 오류]', err);
      return res.status(500).json({ message: 'DB 오류' });
    }

    console.log(`\n📌 [실기ID ${실기ID} 종목 조회 결과]`);
    if (results.length === 0) {
      console.warn('⚠️ 종목 없음');
    } else {
      results.forEach(r => {
        console.log(`▶ 종목: ${r.종목명}, 성별: ${r.성별}`);
      });
    }

    res.json(results);
  });
});


// ✅ 3. 배점 계산 API
app.post('/26susi/calculate-score', (req, res) => {
  const { 실기ID, gender, inputs } = req.body;

  console.log('📥 요청 도착');
  console.log('실기ID:', 실기ID);
  console.log('성별:', gender);
  console.log('입력 기록:', inputs);

  const tasks = inputs.map((input) => {
    return new Promise((resolve, reject) => {
      const reverse = isReverseEvent(input.종목명);
      const operator = reverse ? '<=' : '<=';
      const order = reverse ? 'DESC' : 'DESC';

      

const sql = `
  SELECT 배점
  FROM \`26수시실기배점\`
  WHERE 실기ID = ? AND 종목명 = ? AND 성별 = ? AND CAST(기록 AS DECIMAL(10,2)) ${operator} ?
  ORDER BY CAST(기록 AS DECIMAL(10,2)) ${order}
  LIMIT 1
`;

db.query(sql, [실기ID, input.종목명, gender, input.기록], (err, rows) => {
  if (err) {
    console.error('배점 쿼리 오류:', err);
    return reject(err);
  }

  // ✅ 달리기류에서 너무 좋은 기록 → fallback 만점 처리
  if (rows.length === 0 && reverse) {
    const fallbackSql = `
      SELECT MAX(CAST(배점 AS SIGNED)) AS 배점
      FROM \`26수시실기배점\`
      WHERE 실기ID = ? AND 종목명 = ? AND 성별 = ?
    `;
    return db.query(fallbackSql, [실기ID, input.종목명, gender], (err2, maxRow) => {
      if (err2) {
        console.error('만점 보정 쿼리 오류:', err2);
        return reject(err2);
      }
      const 점수 = maxRow[0]?.배점 ?? 0;
      console.log(`💯 ${input.종목명} → 입력기록 ${input.기록}이 너무 좋아서 만점(${점수}) 처리됨`);
      return resolve({ 종목명: input.종목명, 기록: input.기록, 배점: 점수 });
    });
  }

  // ✅ 일반적인 경우
  const 점수 = rows.length > 0 ? Number(rows[0].배점) : 0;
  console.log(`▶ ${input.종목명} (${reverse ? '작을수록 높음' : '클수록 높음'}) → 기록: ${input.기록} → 배점: ${점수}`);
  resolve({ 종목명: input.종목명, 기록: input.기록, 배점: 점수 });
});

    });
  });

  Promise.all(tasks)
    .then(results => {
      const 총점 = results.reduce((sum, row) => sum + row.배점, 0);
      console.log('✅ 총점:', 총점);
      res.json({ 종목별결과: results, 총점 });
    })
    .catch(err => {
      console.error('배점 계산 실패:', err);
      res.status(500).json({ message: '계산 오류', error: err });
    });
});

// ✅ 서버 실행
app.listen(port, () => {
  console.log(`🔥 26수시 실기배점 서버 실행 중: http://localhost:${port}`);
});

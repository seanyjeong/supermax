<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>맥스실기테스트 기록 시스템</title>
  <link href="https://cdn.jsdelivr.net/npm/water.css@2/out/water.min.css" rel="stylesheet" />
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --primary: #e2376a;
      --primary-hover: #c92a5c;
      --secondary: #2563eb;
      --success: #10b981;
      --light-gray: #f5f5f5;
      --border-radius: 8px;
    }
    
    body {
      max-width: 800px;
      margin: auto;
      padding: 1em;
      font-family: 'Noto Sans KR', sans-serif;
      background-color: #fafafa;
    }
    
    h2 {
      color: var(--primary);
      margin-bottom: 1.5rem;
      text-align: center;
      font-weight: 700;
    }
    
    .card {
      background: white;
      border-radius: var(--border-radius);
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      padding: 1.5rem;
      margin-bottom: 1.5rem;
    }
    
    .form-controls {
      display: flex;
      justify-content: center;
      flex-wrap: wrap;
      gap: 1.5rem;
      margin: 1.5rem 0;
    }
    
    .form-controls label {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      font-weight: 500;
      min-width: 180px;
    }
    
    .form-controls select {
      width: 100%;
      padding: 0.75rem;
      border: 1px solid #ddd;
      border-radius: var(--border-radius);
      font-size: 1rem;
      appearance: none;
      -webkit-appearance: none;
      -moz-appearance: none;
    }
    
    .exam-btn {
      padding: 0.75rem 1rem;
      font-size: 1rem;
      background: var(--light-gray);
      border: none;
      border-radius: var(--border-radius);
      cursor: pointer;
      transition: all 0.2s ease;
      margin: 0.3rem;
      min-width: 60px;
    }

.exam-btn.absent {
  background-color: #ffe5e5 !important;
  color: #c62828 !important;
  font-weight: bold !important;
  border: 1px solid #c62828 !important;
}


    
    .exam-btn.saved {
      background: #d1fae5;
      color: #065f46;
      font-weight: 500;
    }
    
    .exam-btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    
    .exam-btn.saved:hover {
      background: #a7f3d0;
    }
    
    .student-info {
      background: white;
      border-radius: var(--border-radius);
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      padding: 1.5rem;
      margin: 1.5rem 0;
    }
    
    .info-title {
      font-weight: 700;
      color: var(--primary);
      margin-bottom: 1rem;
      font-size: 1.2rem;
    }
    
    .info-table {
      width: 100%;
      border-collapse: collapse;
    }
    
    .info-table tr:not(:last-child) {
      border-bottom: 1px solid #eee;
    }
    
    .info-table th {
      text-align: left;
      padding: 0.75rem 0.5rem;
      width: 30%;
      font-weight: 500;
    }
    
    .info-table td {
      padding: 0.75rem 0.5rem;
      font-weight: 400;
    }
    
    .record-form {
      background: white;
      border-radius: var(--border-radius);
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      padding: 1.5rem;
      margin: 1.5rem 0;
    }
    
    .foul-check {
      display: flex;
      align-items: center;
      margin-bottom: 1rem;
    }
    
    .foul-check input {
      margin-right: 0.5rem;
      width: 18px;
      height: 18px;
    }
    
    .foul-check label {
      font-weight: 500;
    }
    
    .record-row {
      display: flex;
      align-items: center;
      gap: 1rem;
      margin-top: 1rem;
    }
    
    #recordInput {
      padding: 0.75rem;
      font-size: 1rem;
      border: 1px solid #ddd;
      border-radius: var(--border-radius);
      width: 150px;
      text-align: center;
      font-weight: 500;
      -moz-appearance: textfield;
    }
    
    /* 숫자 입력 화살표 제거 */
    #recordInput::-webkit-outer-spin-button,
    #recordInput::-webkit-inner-spin-button {
      -webkit-appearance: none;
      margin: 0;
    }
    
    .submit-btn {
      padding: 0.75rem 1.5rem;
      font-size: 1rem;
      background-color: var(--primary);
      color: white;
      border: none;
      border-radius: var(--border-radius);
      cursor: pointer;
      transition: background-color 0.2s ease;
      font-weight: 500;
    }
    
    .submit-btn:hover {
      background-color: var(--primary-hover);
    }
    
    .result-message {
      padding: 1rem;
      border-radius: var(--border-radius);
      margin: 1rem 0;
      text-align: center;
      font-weight: 500;
    }
    
    .success {
      background-color: #d1fae5;
      color: #065f46;
    }
    
    .error {
      background-color: #fee2e2;
      color: #b91c1c;
    }
    
    .pagination {
      display: flex;
      justify-content: center;
      margin: 1.5rem 0;
      flex-wrap: wrap;
    }
    
    .pagination button {
      margin: 0 0.3rem;
      padding: 0.5rem 0.8rem;
      font-size: 1rem;
      background: var(--light-gray);
      border: none;
      border-radius: var(--border-radius);
      cursor: pointer;
    }
    
    .pagination button.active {
      background: var(--primary);
      color: white;
    }
    
    /* 모달 스타일 */
    .modal-overlay {
      position: fixed;
      top: 0; left: 0;
      width: 100%; height: 100%;
      background-color: rgba(0, 0, 0, 0.7);
      display: flex;
      justify-content: center;
      align-items: center;
      z-index: 1000;
    }
    
    .modal-content {
      background: white;
      padding: 2rem;
      border-radius: var(--border-radius);
      max-width: 400px;
      width: 90%;
      animation: fadeIn 0.3s ease-out;
    }
    
    .modal-content h3 {
      color: var(--primary);
      margin-bottom: 1rem;
      text-align: center;
    }
    
    .modal-content p {
      margin-bottom: 1.5rem;
      text-align: center;
    }
    
    .modal-content form {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }
    
    .modal-content input[type="password"] {
      padding: 0.75rem;
      font-size: 1rem;
      border: 1px solid #ddd;
      border-radius: var(--border-radius);
      margin-bottom: 0.5rem;
    }
    
    .modal-content button {
      padding: 0.75rem;
      font-size: 1rem;
      background: var(--primary);
      color: white;
      border: none;
      border-radius: var(--border-radius);
      cursor: pointer;
      font-weight: 500;
    }
    
    .modal-content button:hover {
      background: var(--primary-hover);
    }
    
    #password-error {
      color: #b91c1c;
      text-align: center;
      margin-top: 1rem;
      display: none;
    }
    
    @keyframes fadeIn {
      from { opacity: 0; transform: scale(0.95); }
      to { opacity: 1; transform: scale(1); }
    }
    
    /* 반응형 디자인 */
    @media (max-width: 600px) {
      .form-controls {
        flex-direction: column;
        gap: 1rem;
      }
      
      .form-controls label {
        width: 100%;
      }
      
      .record-row {
        flex-direction: column;
        align-items: stretch;
      }
      
      #recordInput {
        width: 100%;
      }
      
      .submit-btn {
        width: 100%;
      }
    }
    
    /* 키보드 단축키 안내 */
    .shortcut-hint {
      font-size: 0.85rem;
      color: #666;
      text-align: center;
      margin-top: 1rem;
    }
    
    /* 종목별 색상 구분 */
    .event-jump { color: #e2376a; }
    .event-shuttle { color: #2563eb; }
    .event-sit_reach { color: #10b981; }
    .event-back_strength { color: #7c3aed; }
    .event-medicineball { color: #f59e0b; }
  </style>
</head>
<body>
<!-- 비밀번호 모달 -->
<div id="password-modal" class="modal-overlay">
  <div class="modal-content">
    <h3>기록 시스템 접근</h3>
    <p>종목별 비밀번호를 입력해주세요</p>
    <form id="password-form">
      <input type="password" id="password-input" placeholder="비밀번호" required autofocus>
      <button type="submit">접속하기</button>
    </form>
    <p id="password-error" class="error" style="display: none;">비밀번호가 올바르지 않습니다. 다시 시도해주세요.</p>
    <div style="margin-top: 1rem; font-size: 0.9rem; color: #666;">

   
    </div>
  </div>
</div>

<!-- 메인 콘텐츠 -->
<div id="main-content" style="display: none;">
  <div class="card">
    <h2 id="event-title">맥스실기테스트 기록 시스템</h2>
    
    <div class="form-controls">
      <label>
        조 선택
        <select id="groupSelect"></select>
      </label>
      <label>
        측정 종목
        <select id="eventSelect">
          <!-- 동적으로 생성 -->
        </select>
      </label>
    </div>
  </div>

  <div class="card">
    <div id="examList" class="row"></div>
    <div class="pagination" id="pagination"></div>
    <p class="shortcut-hint">빨간색 박스는 결시자</p>
  </div>
  
  <div id="studentInfo" class="student-info" style="display: none;">
    <div class="info-title">학생 정보</div>
    <table class="info-table" id="studentTable"></table>
  </div>
  
  <div id="recordForm" class="record-form" style="display: none;">
    <div class="foul-check">
      <input type="checkbox" id="foulCheck">
      <label for="foulCheck">파울 (F) 처리</label>
    </div>
    <div class="record-row">
      <input type="number" step="any" name="record" id="recordInput" placeholder="기록 입력" required autocomplete="off" />
      <button type="submit" class="submit-btn" id="submitRecord">기록 저장</button>
    </div>
    <div id="result" class="result-message" style="display: none;"></div>
  </div>
</div>

<script>
// 비밀번호와 종목 매핑
const PASSWORD_MAP = {
  '2025max': 'all', // 전체 접근
  'maxj2025': '제멀', // 제자리멀리뛰기
  'maxr2025': '10m', // 10m 왕복달리기
  'maxs2025': '좌전굴', // 좌전굴
  'maxb2025': '배근력', // 배근력
  'maxm2025': '메디신볼' // 메디신볼던지기
};

// 종목 목록
const EVENTS = [
  { value: '제멀', name: '제자리멀리뛰기', class: 'event-jump' },
  { value: '10m', name: '10m 왕복달리기', class: 'event-shuttle' },
  { value: '좌전굴', name: '좌전굴', class: 'event-sit_reach' },
  { value: '배근력', name: '배근력', class: 'event-back_strength' },
  { value: '메디신볼', name: '메디신볼던지기', class: 'event-medicineball' }
];

// 현재 허용된 종목 (비밀번호에 따라 결정)
let allowedEvents = [...EVENTS];
let currentEventType = 'all';

// 비밀번호 처리
document.getElementById('password-form').addEventListener('submit', function(e) {
  e.preventDefault();
  const password = document.getElementById('password-input').value;
  
  if (PASSWORD_MAP[password]) {
  currentEventType = PASSWORD_MAP[password];

  const eventSelect = document.getElementById('eventSelect');
  eventSelect.innerHTML = '';

  if (currentEventType === 'all') {
    allowedEvents = [...EVENTS];
    allowedEvents.forEach(event => {
      const opt = document.createElement('option');
      opt.value = event.value;
      opt.textContent = event.name;
      opt.className = event.class;
      eventSelect.appendChild(opt);
    });
    currentEvent = allowedEvents[0].value; // ✅ 추가
  } else {
    allowedEvents = EVENTS.filter(event => event.value === currentEventType);
    const opt = document.createElement('option');
    const selectedEvent = EVENTS.find(event => event.value === currentEventType);
    opt.value = selectedEvent.value;
    opt.textContent = selectedEvent.name;
    opt.className = selectedEvent.class;
    eventSelect.appendChild(opt);
    eventSelect.disabled = true;
    currentEvent = selectedEvent.value; // ✅ 이 줄 추가!
  }

  document.getElementById('password-modal').style.display = 'none';
  document.getElementById('main-content').style.display = 'block';
  document.getElementById('event-title').textContent = `${allowedEvents[0].name} 기록 시스템`;
  loadGroupList();
  document.getElementById('recordInput').focus();
}

});

// 필드 매핑 함수
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

// DOM 요소
const groupSelect = document.getElementById('groupSelect');
const eventSelect = document.getElementById('eventSelect');
const examList = document.getElementById('examList');
const pagination = document.getElementById('pagination');
const studentInfo = document.getElementById('studentInfo');
const studentTable = document.getElementById('studentTable');
const form = document.getElementById('recordForm');
const result = document.getElementById('result');
const foulCheck = document.getElementById('foulCheck');
const recordInput = document.getElementById('recordInput');
const submitBtn = document.getElementById('submitRecord');

// 전역 변수
let selectedExam = '';
let currentBranch = '';
let currentGender = '';
let currentGroup = '';
let currentEvent = allowedEvents[0]?.value || '제멀';
let studentList = [];
const pageSize = 30;
let currentPage = 1;
let searchInput = '';
let searchTimeout = null;

// 파울 체크박스 이벤트
foulCheck.addEventListener('change', () => {
  recordInput.disabled = foulCheck.checked;
  if (foulCheck.checked) {
    recordInput.value = '';
    submitRecord(); // 파울 체크 시 자동 저장
  } else {
    recordInput.focus();
  }
});

// 조 선택 변경 이벤트
groupSelect.addEventListener('change', async () => {
  currentGroup = groupSelect.value;
  if (!currentGroup) return;
  await loadExams();
});

// 종목 선택 변경 이벤트
eventSelect.addEventListener('change', async () => {
  currentEvent = eventSelect.value;

  const selected = EVENTS.find(e => e.value === currentEvent);
  document.getElementById('event-title').textContent = `${selected.name} 기록 시스템`;

  if (currentGroup) {
    await loadExams();
  }
  if (selectedExam) {
    loadStudent(selectedExam);
  }
});


// 키보드 이벤트 핸들러 (검색 기능)
document.addEventListener('keydown', (e) => {
  // 숫자 입력으로 검색 (0-9)
  if (e.key >= '0' && e.key <= '9') {
    if (searchTimeout) clearTimeout(searchTimeout);
    
    searchInput += e.key;
    searchTimeout = setTimeout(() => {
      searchInput = '';
    }, 1000);
    
    const foundStudent = studentList.find(s => s.exam_number.startsWith(searchInput));
    if (foundStudent) {
      loadStudent(foundStudent.exam_number);
      recordInput.focus();
    }
  }
  
  // Enter 키로 기록 저장
  if (e.key === 'Enter' && recordInput.value && !foulCheck.checked) {
    submitRecord();
  }
});

// 조 목록 로드
async function loadGroupList() {
  try {
    const res = await fetch('https://supermax.kr/feed/group-summary');
    const groups = await res.json();
    groupSelect.innerHTML = '<option value="">조를 선택하세요</option>';
groups.forEach(({ group_no }) => {
  const opt = document.createElement('option');
  opt.value = group_no;
  const groupChar = String.fromCharCode(64 + group_no); // A~J
  opt.textContent = `${groupChar}조`; // "A조", "B조" ...
  groupSelect.appendChild(opt);
});

  } catch (error) {
    console.error('조 목록 로드 실패:', error);
  }
}

// 학생 목록 로드
async function loadExams() {
  try {
    const res = await fetch(`https://supermax.kr/feed/group/${currentGroup}`);
    studentList = await res.json();
    studentList.sort((a, b) => {
  const [aGroup, aNum] = a.exam_number.split('-');
  const [bGroup, bNum] = b.exam_number.split('-');
  if (aGroup === bGroup) {
    return parseInt(aNum) - parseInt(bNum);
  }
  return aGroup.localeCompare(bGroup);
});

    console.log('학생 리스트 로드 완료:', studentList);
    currentPage = 1;
    renderExamList();
  } catch (error) {
    console.error('학생 목록 로드 실패:', error);
  }
}

// 학생 목록 렌더링
function renderExamList() {
  examList.innerHTML = '';
  pagination.innerHTML = '';
  const start = (currentPage - 1) * pageSize;
  const paginated = studentList.slice(start, start + pageSize);
  const recordField = getField(currentEvent, 'record');

paginated.forEach(student => {
  const btn = document.createElement('button');
  btn.classList.add('exam-btn'); // 기본 클래스 먼저

  const val = student[getField(currentEvent, 'record')];
  if (val !== null && val !== undefined && val !== '' && val !== 'null') {
    btn.classList.add('saved'); // 저장된 경우
  }

  if (student.attended === 0) {
    btn.classList.add('absent'); // 결시자 표시
    console.log('❗ 결시자 표시됨:', student.exam_number); // 확인용
  }

  if (student.exam_number == selectedExam) {
    btn.style.border = '2px solid var(--primary)';
  }

  btn.textContent = student.exam_number;
  btn.title = `${student.name} (${student.school})`;
  btn.onclick = () => {
    selectedExam = student.exam_number;
    loadStudent(student.exam_number);
    renderExamList(); // 다시 렌더링
  };

  examList.appendChild(btn);
});


  // 페이지네이션 생성
  const totalPages = Math.ceil(studentList.length / pageSize);
  if (totalPages > 1) {
    for (let i = 1; i <= totalPages; i++) {
      const pBtn = document.createElement('button');
      pBtn.textContent = i;
      if (i === currentPage) pBtn.classList.add('active');
      pBtn.onclick = () => {
        currentPage = i;
        renderExamList();
      };
      pagination.appendChild(pBtn);
    }
  }
}

// 학생 정보 로드
async function loadStudent(exam_number) {
  try {
    const res = await fetch(`https://supermax.kr/feed/get-student?exam_number=${exam_number}`);
    const json = await res.json();

    if (json.success) {
      const { name, school, grade, branch, gender } = json.student;
      selectedExam = String(exam_number);
      currentBranch = branch;
      currentGender = gender;

      const student = studentList.find(s => s.exam_number == selectedExam);
      const recordField = getField(currentEvent, 'record');
      const prevRecord = student ? student[recordField] : null;

      // 학생 정보 표시 (테이블 행을 개별적으로 생성)
      studentTable.innerHTML = '';
      
      const addRow = (label, value) => {
        const row = document.createElement('tr');
        const th = document.createElement('th');
        th.textContent = label;
        const td = document.createElement('td');
        td.textContent = value;
        row.appendChild(th);
        row.appendChild(td);
        studentTable.appendChild(row);
      };
      
      addRow('수험번호', exam_number);
      addRow('이름', name);
      addRow('학교', school);
      addRow('학년', grade);
      addRow('성별', gender);
      addRow('지점', branch);

      // 기록 입력 필드 설정
      if (prevRecord === 'F') {
        foulCheck.checked = true;
        recordInput.value = '';
        recordInput.disabled = true;
      } else {
        foulCheck.checked = false;
        recordInput.disabled = false;
        recordInput.value = (prevRecord !== null && prevRecord !== undefined && prevRecord !== '' && prevRecord !== 'null') ? prevRecord : '';
      }

      studentInfo.style.display = 'block';
      form.style.display = 'block';
      result.style.display = 'none';
      recordInput.focus();
    }
  } catch (error) {
    console.error('학생 정보 로드 실패:', error);
  }
}

// 기록 저장 함수
async function submitRecord() {
  if (!selectedExam) return;
  
  const record = foulCheck.checked ? 'F' : parseFloat(recordInput.value);
  if (!foulCheck.checked && (isNaN(record) || record === '')) {
    result.textContent = '올바른 기록을 입력해주세요';
    result.className = 'error';
    result.style.display = 'block';
    return;
  }

  const data = {
    exam_number: selectedExam,
    branch: currentBranch,
    gender: currentGender,
    event: currentEvent,
    record
  };

  try {
    const res = await fetch('https://supermax.kr/feed/submit-record', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    const json = await res.json();
    if (json.success) {
      result.innerHTML = `<strong>저장 완료</strong><br>${currentEvent}: ${record} → ${json.score}점`;
      result.className = 'success';
      
      // 학생 목록 업데이트
      const recordField = getField(currentEvent, 'record');
      const student = studentList.find(s => s.exam_number == selectedExam);
      if (student) student[recordField] = record;
      await loadExams();  
      renderExamList();
    } else {
      result.textContent = '저장에 실패했습니다. 다시 시도해주세요.';
      result.className = 'error';
    }
    result.style.display = 'block';
  } catch (error) {
    console.error('기록 저장 실패:', error);
    result.textContent = '네트워크 오류가 발생했습니다.';
    result.className = 'error';
    result.style.display = 'block';
  }
}

// 폼 제출 이벤트
form.addEventListener('submit', (e) => {
  e.preventDefault();
  submitRecord();
});
submitBtn.addEventListener('click', (e) => {
  e.preventDefault();
  submitRecord();
});

// 초기 포커스 설정
document.getElementById('password-input').focus();
</script>
</body>
</html>

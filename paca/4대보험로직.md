# i-max 프로젝트 4대보험 계산 로직 분석

**참고:** `c:/projects/i-max/backend/utils/calculator.js`

## 1. 개요

i-max 프로젝트의 4대보험 계산 로직을 분석하여 P-ACA 프로젝트에 적용합니다.

## 2. 4대보험 종류 및 요율

### 2.1 국민연금 (National Pension)
- **전체 요율**: 9%
- **근로자 부담**: 4.5%
- **사업주 부담**: 4.5%
- **계산식**: `Math.floor(salary * 0.045)`

### 2.2 건강보험 (Health Insurance)
- **전체 요율**: 7.09%
- **근로자 부담**: 50% (3.545%)
- **사업주 부담**: 50% (3.545%)
- **계산식**:
  ```javascript
  const totalHealthInsurance = salary * 0.0709;
  const employee = Math.floor(totalHealthInsurance * 0.5);
  const employer = Math.floor(totalHealthInsurance * 0.5);
  ```

### 2.3 장기요양보험 (Long-term Care Insurance)
- **요율**: 건강보험료의 12.95% (2025년 기준)
- **근로자 부담**: 50%
- **사업주 부담**: 50%
- **계산식**:
  ```javascript
  const longTermCareTotal = Math.floor(totalHealthInsurance * (0.009182 / 0.0709) / 10) * 10;
  const employee = Math.floor(longTermCareTotal * 0.5);
  ```
- **특징**: 원 단위 절삭

### 2.4 고용보험 (Employment Insurance)
**실업급여:**
- **근로자 부담**: 0.9%
- **사업주 부담**: 0.9%
- **계산식**: `Math.floor(salary * 0.009)`

**고용안정/직업능력개발:**
- **사업주 부담**: 0.25%
- **계산식**: `Math.floor(salary * 0.0025)`

### 2.5 산재보험 (Industrial Accident Insurance)
- **요율**: 0.66% (업종별 상이, 학원업 기준)
- **사업주 부담**: 100%
- **계산식**: `Math.floor(salary * 6.6 / 1000)`

## 3. 계산 예시

### 월급 3,000,000원 기준

```javascript
// 1. 국민연금
근로자: 3,000,000 × 0.045 = 135,000원
사업주: 3,000,000 × 0.045 = 135,000원

// 2. 건강보험
전체: 3,000,000 × 0.0709 = 212,700원
근로자: 212,700 × 0.5 = 106,350원
사업주: 212,700 × 0.5 = 106,350원

// 3. 장기요양보험
전체: 212,700 × (0.009182 / 0.0709) = 27,540원 (원단위 절삭)
근로자: 27,540 × 0.5 = 13,770원
사업주: 27,540 × 0.5 = 13,770원

// 4. 고용보험 (실업급여)
근로자: 3,000,000 × 0.009 = 27,000원
사업주: 3,000,000 × 0.009 = 27,000원

// 5. 고용보험 (고용안정/직업능력)
사업주: 3,000,000 × 0.0025 = 7,500원

// 6. 산재보험
사업주: 3,000,000 × 0.0066 = 19,800원

// 총계
근로자 공제액: 135,000 + 106,350 + 13,770 + 27,000 = 282,120원
사업주 부담액: 135,000 + 106,350 + 13,770 + 27,000 + 7,500 + 19,800 = 309,420원
실수령액: 3,000,000 - 282,120 = 2,717,880원
```

## 4. 3.3% 세금 계산 (프리랜서)

프리랜서 또는 계약직의 경우 4대보험 대신 3.3% 원천징수를 적용합니다.

```javascript
function calculate33Deduction(salary) {
    const deduction = Math.round(salary * 0.033);
    const netSalary = salary - deduction;

    return {
        deduction,
        netSalary
    };
}
```

**예시:** 급여 3,000,000원
- 공제액: 99,000원
- 실수령액: 2,901,000원

## 5. P-ACA 적용 방안

### 5.1 강사 급여 형태
1. **시급제 (hourly)**: 시간당 × 근무시간
2. **타임제 (per_class)**: 수업당 × 수업횟수
3. **고정급 (monthly)**: 월 고정 금액

### 5.2 세금 형태
1. **tax_3_3**: 3.3% 원천징수 (프리랜서)
2. **insurance**: 4대보험 (정규직)
3. **none**: 세금 없음

### 5.3 데이터베이스 스키마

```sql
CREATE TABLE salary_records (
    id INT PRIMARY KEY AUTO_INCREMENT,
    instructor_id INT NOT NULL,
    year_month VARCHAR(7) NOT NULL,
    base_amount DECIMAL(10,2) NOT NULL,
    bonus DECIMAL(10,2) DEFAULT 0,
    deduction DECIMAL(10,2) DEFAULT 0,
    tax_type VARCHAR(20) NOT NULL,
    tax_amount DECIMAL(10,2) DEFAULT 0,
    insurance_amount DECIMAL(10,2) DEFAULT 0,
    insurance_details JSON,
    net_amount DECIMAL(10,2) NOT NULL,
    payment_date DATE,
    payment_status VARCHAR(20) DEFAULT 'pending'
);
```

## 6. 구현 파일

- **계산 유틸리티**: `backend/utils/salaryCalculator.js`
- **급여 API**: `backend/routes/salaries.js`

## 7. 주의사항

1. **소수점 처리**: 모든 계산에서 `Math.floor()` 사용하여 원 단위 절사
2. **장기요양보험**: 건강보험료 기준으로 계산, 원 단위 절삭 주의
3. **업종별 산재보험**: 학원업은 0.66%, 다른 업종은 다를 수 있음
4. **요율 변동**: 매년 정부 고시에 따라 요율이 변동되므로 설정에서 관리 필요

## 8. 참고 자료

- 국민연금공단: https://www.nps.or.kr
- 건강보험공단: https://www.nhis.or.kr
- 고용노동부: https://www.moel.go.kr
- 근로복지공단: https://www.kcomwel.or.kr

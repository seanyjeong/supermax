/**
 * 급여 계산 유틸리티
 *
 * 참고: c:/projects/i-max 4대보험 계산 로직
 *
 * 급여 형태:
 * - hourly: 시급 (시간당)
 * - per_class: 타임 (수업당)
 * - monthly: 고정급 (월급)
 *
 * 세금 형태:
 * - 3.3%: 3.3% 세금 (프리랜서)
 * - insurance: 4대보험 (정규직)
 * - none: 세금 없음
 */

/**
 * 4대보험 요율 (2025년 기준)
 */
const INSURANCE_RATES = {
    // 국민연금: 4.5% (본인 부담)
    nationalPension: {
        employee: 0.045,
        employer: 0.045,
        total: 0.09
    },

    // 건강보험: 7.09% (본인 부담: 3.545%)
    healthInsurance: {
        employee: 0.03545,
        employer: 0.03545,
        total: 0.0709
    },

    // 장기요양보험: 건강보험료의 12.95% (2025년 기준)
    // 계산식: 건강보험료 * (0.009182 / 0.0709), 원단위 절삭
    longTermCare: {
        rate: 0.009182 / 0.0709  // 건강보험료에 곱함
    },

    // 고용보험: 0.9% (본인 부담)
    employmentInsurance: {
        employee: 0.009,
        employer: 0.009,
        total: 0.018
    },

    // 산재보험: 업종별 상이 (학원업 평균 0.7%, 사업주 전액 부담)
    industrialAccident: {
        employer: 0.007
    }
};

/**
 * 3.3% 세금 계산 (프리랜서)
 * @param {number} grossAmount - 총 지급액
 * @returns {object} { tax, netAmount }
 */
function calculateTax33(grossAmount) {
    const tax = Math.floor(grossAmount * 0.033);
    const netAmount = grossAmount - tax;

    return {
        tax,
        netAmount
    };
}

/**
 * 4대보험 계산 (i-max 로직 정확히 적용)
 * @param {number} grossAmount - 총 지급액 (세전)
 * @returns {object} 4대보험 상세 내역
 */
function calculate4Insurance(grossAmount) {
    // 1. 국민연금 (본인 부담 4.5%)
    const nationalPension = Math.floor(grossAmount * INSURANCE_RATES.nationalPension.employee);

    // 2. 건강보험 (전체 7.09%, 본인 50%)
    const totalHealthInsurance = grossAmount * INSURANCE_RATES.healthInsurance.total;
    const healthInsurance = Math.floor(totalHealthInsurance * 0.5);

    // 3. 장기요양보험 (건강보험료 기준, 원단위 절삭)
    const longTermCareTotal = Math.floor(totalHealthInsurance * INSURANCE_RATES.longTermCare.rate / 10) * 10;
    const longTermCare = Math.floor(longTermCareTotal * 0.5);

    // 4. 고용보험 - 실업급여 (본인 부담 0.9%)
    const employmentInsurance = Math.floor(grossAmount * INSURANCE_RATES.employmentInsurance.employee);

    // 총 공제액 (근로자 부담)
    const totalDeduction = nationalPension + healthInsurance + longTermCare + employmentInsurance;

    // 실수령액
    const netAmount = grossAmount - totalDeduction;

    // 사업주 부담액 계산 (참고용)
    const employerBurden = {
        nationalPension: Math.floor(grossAmount * INSURANCE_RATES.nationalPension.employer),
        healthInsurance: Math.floor(totalHealthInsurance * 0.5),
        longTermCare: Math.floor(longTermCareTotal * 0.5),
        employmentInsurance: Math.floor(grossAmount * INSURANCE_RATES.employmentInsurance.employer),
        stability: Math.floor(grossAmount * 0.0025), // 고용안정/직업능력개발 0.25%
        industrialAccident: Math.floor(grossAmount * INSURANCE_RATES.industrialAccident.employer)
    };

    const totalEmployerBurden =
        employerBurden.nationalPension +
        employerBurden.healthInsurance +
        employerBurden.longTermCare +
        employerBurden.employmentInsurance +
        employerBurden.stability +
        employerBurden.industrialAccident;

    return {
        nationalPension,
        healthInsurance,
        longTermCare,
        employmentInsurance,
        totalDeduction,
        netAmount,
        employerBurden,
        totalEmployerBurden,
        details: {
            nationalPensionRate: INSURANCE_RATES.nationalPension.employee,
            healthInsuranceRate: INSURANCE_RATES.healthInsurance.employee,
            longTermCareRate: INSURANCE_RATES.longTermCare.rate,
            employmentInsuranceRate: INSURANCE_RATES.employmentInsurance.employee
        }
    };
}

/**
 * 시급제 급여 계산
 * @param {number} hourlyRate - 시급
 * @param {number} totalHours - 총 근무 시간
 * @param {string} taxType - 세금 형태 (3.3%, insurance, none)
 * @param {number} bonus - 상여금 (선택)
 * @param {number} deduction - 공제액 (선택)
 * @returns {object} 급여 상세 내역
 */
function calculateHourlySalary(hourlyRate, totalHours, taxType, bonus = 0, deduction = 0) {
    const baseAmount = hourlyRate * totalHours;
    const grossAmount = baseAmount + bonus - deduction;

    let taxAmount = 0;
    let insuranceAmount = 0;
    let netAmount = grossAmount;
    let insuranceDetails = null;

    if (taxType === '3.3%') {
        const result = calculateTax33(grossAmount);
        taxAmount = result.tax;
        netAmount = result.netAmount;
    } else if (taxType === 'insurance') {
        const result = calculate4Insurance(grossAmount);
        insuranceAmount = result.totalDeduction;
        netAmount = result.netAmount;
        insuranceDetails = result;
    }

    return {
        baseAmount,
        bonus,
        deduction,
        grossAmount,
        taxType,
        taxAmount,
        insuranceAmount,
        netAmount,
        insuranceDetails,
        calculation: {
            hourlyRate,
            totalHours,
            formula: `${hourlyRate} × ${totalHours} + ${bonus} - ${deduction}`
        }
    };
}

/**
 * 타임제 급여 계산 (수업당)
 * @param {number} perClassRate - 수업당 금액
 * @param {number} totalClasses - 총 수업 횟수
 * @param {string} taxType - 세금 형태
 * @param {number} bonus - 상여금 (선택)
 * @param {number} deduction - 공제액 (선택)
 * @returns {object} 급여 상세 내역
 */
function calculatePerClassSalary(perClassRate, totalClasses, taxType, bonus = 0, deduction = 0) {
    const baseAmount = perClassRate * totalClasses;
    const grossAmount = baseAmount + bonus - deduction;

    let taxAmount = 0;
    let insuranceAmount = 0;
    let netAmount = grossAmount;
    let insuranceDetails = null;

    if (taxType === '3.3%') {
        const result = calculateTax33(grossAmount);
        taxAmount = result.tax;
        netAmount = result.netAmount;
    } else if (taxType === 'insurance') {
        const result = calculate4Insurance(grossAmount);
        insuranceAmount = result.totalDeduction;
        netAmount = result.netAmount;
        insuranceDetails = result;
    }

    return {
        baseAmount,
        bonus,
        deduction,
        grossAmount,
        taxType,
        taxAmount,
        insuranceAmount,
        netAmount,
        insuranceDetails,
        calculation: {
            perClassRate,
            totalClasses,
            formula: `${perClassRate} × ${totalClasses} + ${bonus} - ${deduction}`
        }
    };
}

/**
 * 월급제 급여 계산
 * @param {number} monthlySalary - 월 급여
 * @param {string} taxType - 세금 형태
 * @param {number} bonus - 상여금 (선택)
 * @param {number} deduction - 공제액 (선택)
 * @returns {object} 급여 상세 내역
 */
function calculateMonthlySalary(monthlySalary, taxType, bonus = 0, deduction = 0) {
    const baseAmount = monthlySalary;
    const grossAmount = baseAmount + bonus - deduction;

    let taxAmount = 0;
    let insuranceAmount = 0;
    let netAmount = grossAmount;
    let insuranceDetails = null;

    if (taxType === '3.3%') {
        const result = calculateTax33(grossAmount);
        taxAmount = result.tax;
        netAmount = result.netAmount;
    } else if (taxType === 'insurance') {
        const result = calculate4Insurance(grossAmount);
        insuranceAmount = result.totalDeduction;
        netAmount = result.netAmount;
        insuranceDetails = result;
    }

    return {
        baseAmount,
        bonus,
        deduction,
        grossAmount,
        taxType,
        taxAmount,
        insuranceAmount,
        netAmount,
        insuranceDetails,
        calculation: {
            monthlySalary,
            formula: `${monthlySalary} + ${bonus} - ${deduction}`
        }
    };
}

/**
 * 강사 급여 자동 계산
 * @param {object} instructor - 강사 정보
 * @param {number} workData - 근무 데이터 (시간/수업 횟수)
 * @param {number} bonus - 상여금 (선택)
 * @param {number} deduction - 공제액 (선택)
 * @returns {object} 급여 상세 내역
 */
function calculateInstructorSalary(instructor, workData, bonus = 0, deduction = 0) {
    const { salary_type, hourly_rate, base_salary, tax_type } = instructor;

    switch (salary_type) {
        case 'hourly':
            return calculateHourlySalary(
                hourly_rate || 0,
                workData.totalHours || 0,
                tax_type,
                bonus,
                deduction
            );

        case 'per_class':
            return calculatePerClassSalary(
                hourly_rate || 0,  // per_class도 hourly_rate 필드 사용
                workData.totalClasses || 0,
                tax_type,
                bonus,
                deduction
            );

        case 'monthly':
            return calculateMonthlySalary(
                base_salary || 0,
                tax_type,
                bonus,
                deduction
            );

        default:
            throw new Error(`Unknown salary type: ${salary_type}`);
    }
}

module.exports = {
    INSURANCE_RATES,
    calculateTax33,
    calculate4Insurance,
    calculateHourlySalary,
    calculatePerClassSalary,
    calculateMonthlySalary,
    calculateInstructorSalary
};

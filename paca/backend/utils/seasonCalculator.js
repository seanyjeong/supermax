/**
 * 시즌 전환 로직 및 일할 계산 유틸리티
 *
 * 참고: docs/시즌전환로직분석.md
 *
 * 핵심 기능:
 * 1. 일할 계산 (비시즌 종강일까지의 월회비 계산)
 * 2. 시즌 중도 해지 환불 계산
 */

/**
 * 금액을 천원 단위로 절삭 (백원 단위 버림)
 * @param {number} amount - 금액
 * @returns {number} 천원 단위로 절삭된 금액
 */
function truncateToThousands(amount) {
    return Math.floor(amount / 1000) * 1000;
}

/**
 * 시즌 중간 합류 시 시즌비 일할계산
 * @param {object} params - 계산 파라미터
 * @param {number} params.seasonFee - 기본 시즌비
 * @param {Date} params.seasonStartDate - 시즌 시작일
 * @param {Date} params.seasonEndDate - 시즌 종료일
 * @param {Date} params.joinDate - 합류일 (등록일)
 * @param {Array<number>} params.weeklyDays - 수업 요일
 * @returns {object} 일할 계산 결과
 */
function calculateMidSeasonFee(params) {
    const { seasonFee, seasonStartDate, seasonEndDate, joinDate, weeklyDays } = params;

    // 합류일이 시즌 시작일보다 이전이면 전액
    if (joinDate <= seasonStartDate) {
        return {
            originalFee: seasonFee,
            proRatedFee: seasonFee,
            discount: 0,
            totalDays: 0,
            remainingDays: 0,
            isProRated: false,
            details: '시즌 시작 전 등록 - 일할계산 없음'
        };
    }

    // 합류일이 시즌 종료일 이후면 0
    if (joinDate > seasonEndDate) {
        return {
            originalFee: seasonFee,
            proRatedFee: 0,
            discount: seasonFee,
            totalDays: 0,
            remainingDays: 0,
            isProRated: true,
            details: '시즌 종료 후 등록 - 시즌비 없음'
        };
    }

    // 전체 시즌 수업일수 계산
    const totalClassDays = countClassDays(seasonStartDate, seasonEndDate, weeklyDays);

    // 합류일부터 시즌 종료일까지 남은 수업일수 계산
    const remainingClassDays = countClassDays(joinDate, seasonEndDate, weeklyDays);

    if (totalClassDays === 0) {
        return {
            originalFee: seasonFee,
            proRatedFee: seasonFee,
            discount: 0,
            totalDays: 0,
            remainingDays: 0,
            isProRated: false,
            details: '수업일이 없음'
        };
    }

    // 일할계산: 시즌비 × (남은 수업일 / 전체 수업일), 천원 단위 절삭
    const proRatedFee = truncateToThousands(seasonFee * (remainingClassDays / totalClassDays));
    const discount = seasonFee - proRatedFee;

    return {
        originalFee: seasonFee,
        proRatedFee,
        discount,
        totalDays: totalClassDays,
        remainingDays: remainingClassDays,
        isProRated: true,
        details: `${seasonFee.toLocaleString()}원 × (${remainingClassDays}/${totalClassDays}일) = ${proRatedFee.toLocaleString()}원`
    };
}

/**
 * 특정 기간 동안의 수업 횟수 계산
 * @param {Date} startDate - 시작일
 * @param {Date} endDate - 종료일
 * @param {Array<number>} weeklyDays - 수업 요일 (0=일요일, 1=월요일, ..., 6=토요일)
 * @returns {number} 수업 횟수
 */
function countClassDays(startDate, endDate, weeklyDays) {
    let count = 0;
    const current = new Date(startDate);

    while (current <= endDate) {
        const dayOfWeek = current.getDay();
        if (weeklyDays.includes(dayOfWeek)) {
            count++;
        }
        current.setDate(current.getDate() + 1);
    }

    return count;
}

/**
 * 일할 계산 (비시즌 종강일까지의 월회비 계산)
 * @param {object} params - 계산 파라미터
 * @param {number} params.monthlyFee - 월회비
 * @param {Array<number>} params.weeklyDays - 수업 요일 배열 [1,3,5] = 월,수,금
 * @param {Date} params.nonSeasonEndDate - 비시즌 종강일
 * @param {number} params.discountRate - 할인율 (0-100)
 * @returns {object} 일할 계산 결과
 */
function calculateProRatedFee(params) {
    const {
        monthlyFee,
        weeklyDays,
        nonSeasonEndDate,
        discountRate = 0
    } = params;

    // Step 1: 비시즌 종강일이 속한 달의 1일
    const year = nonSeasonEndDate.getFullYear();
    const month = nonSeasonEndDate.getMonth();
    const startDate = new Date(year, month, 1);

    // Step 2: 해당 월의 마지막 날
    const lastDayOfMonth = new Date(year, month + 1, 0);

    // Step 3: 비시즌 종강일까지 수업 횟수 계산
    const classCountUntilEnd = countClassDays(startDate, nonSeasonEndDate, weeklyDays);

    // Step 4: 해당 월 전체 수업 횟수 계산
    const totalMonthlyClasses = countClassDays(startDate, lastDayOfMonth, weeklyDays);

    // Step 5: 회당 단가 계산
    const perClassFee = monthlyFee / totalMonthlyClasses;

    // Step 6: 일할 계산
    let proRatedFee = Math.floor(perClassFee * classCountUntilEnd);

    // Step 7: 할인 적용
    const discountAmount = Math.floor(proRatedFee * (discountRate / 100));
    const finalAmount = truncateToThousands(proRatedFee - discountAmount);

    return {
        proRatedFee: finalAmount,
        baseAmount: proRatedFee,
        discountAmount,
        classCountUntilEnd,
        totalMonthlyClasses,
        perClassFee: Math.floor(perClassFee),
        periodStart: startDate.toISOString().split('T')[0],
        periodEnd: nonSeasonEndDate.toISOString().split('T')[0],
        calculationDetails: {
            formula: `${monthlyFee.toLocaleString()}원 ÷ ${totalMonthlyClasses}회 × ${classCountUntilEnd}회 = ${proRatedFee.toLocaleString()}원`,
            description: `${startDate.getMonth() + 1}월 1일 ~ ${nonSeasonEndDate.getDate()}일까지 ${classCountUntilEnd}회 수업`
        }
    };
}

/**
 * 시즌 중도 해지 환불 계산
 * @param {object} params - 계산 파라미터
 * @param {number} params.seasonFee - 시즌비
 * @param {Date} params.seasonStartDate - 시즌 시작일
 * @param {Date} params.seasonEndDate - 시즌 종료일
 * @param {Date} params.cancellationDate - 해지 요청일
 * @param {Array<number>} params.weeklyDays - 수업 요일
 * @param {string} params.refundPolicy - 환불 정책 ('legal' | 'prorated')
 * @returns {object} 환불 계산 결과
 */
function calculateSeasonRefund(params) {
    const {
        seasonFee,
        seasonStartDate,
        seasonEndDate,
        cancellationDate,
        weeklyDays,
        refundPolicy = 'legal' // 기본값: 학원법 준수
    } = params;

    // Step 1: 시즌 전체 수업일 계산
    const totalClassDays = countClassDays(seasonStartDate, seasonEndDate, weeklyDays);

    // Step 2: 실제 수업 받은 일수 계산
    const attendedDays = countClassDays(seasonStartDate, cancellationDate, weeklyDays);

    // Step 3: 진행률 계산
    const progressRate = attendedDays / totalClassDays;

    // Step 4: 환불 정책 적용
    let refundRate = 0;
    let refundReason = '';

    if (refundPolicy === 'legal') {
        // 학원법 기준
        if (progressRate < 1/3) {
            refundRate = 2/3;
            refundReason = '총 학습시간 1/3 경과 전: 2/3 환불';
        } else if (progressRate < 1/2) {
            refundRate = 1/2;
            refundReason = '총 학습시간 1/2 경과 전: 1/2 환불';
        } else {
            refundRate = 0;
            refundReason = '총 학습시간 1/2 경과 후: 환불 불가';
        }
    } else if (refundPolicy === 'prorated') {
        // 일할 환불
        refundRate = (totalClassDays - attendedDays) / totalClassDays;
        refundReason = '일할 환불 정책';
    }

    const refundAmount = truncateToThousands(seasonFee * refundRate);
    const usedAmount = seasonFee - refundAmount;

    return {
        refundAmount,
        usedAmount,
        totalClassDays,
        attendedDays,
        remainingDays: totalClassDays - attendedDays,
        progressRate: (progressRate * 100).toFixed(2) + '%',
        refundRate: (refundRate * 100).toFixed(2) + '%',
        refundReason,
        calculationDetails: {
            seasonFee: seasonFee.toLocaleString() + '원',
            perClassFee: Math.floor(seasonFee / totalClassDays).toLocaleString() + '원',
            formula: `${seasonFee.toLocaleString()}원 × ${(refundRate * 100).toFixed(0)}% = ${refundAmount.toLocaleString()}원`
        }
    };
}

/**
 * 요일 문자열을 숫자 배열로 변환
 * @param {string} weeklyDaysString - 쉼표로 구분된 요일 문자열 ("0,2,4" 또는 "월,수,금")
 * @returns {Array<number>} 요일 숫자 배열 [1,3,5]
 */
function parseWeeklyDays(weeklyDaysString) {
    if (!weeklyDaysString) return [];

    // 이미 숫자 배열이면 그대로 반환
    if (Array.isArray(weeklyDaysString)) {
        return weeklyDaysString.map(d => parseInt(d));
    }

    // JSON 문자열인 경우
    if (weeklyDaysString.startsWith('[')) {
        return JSON.parse(weeklyDaysString);
    }

    // 쉼표로 구분된 숫자 문자열
    if (/^\d+(,\d+)*$/.test(weeklyDaysString)) {
        return weeklyDaysString.split(',').map(d => parseInt(d.trim()));
    }

    // 한글 요일 매핑
    const dayMap = {
        '일': 0, '월': 1, '화': 2, '수': 3,
        '목': 4, '금': 5, '토': 6
    };

    return weeklyDaysString.split(',').map(day => dayMap[day.trim()]).filter(d => d !== undefined);
}

/**
 * 숫자 배열을 한글 요일 문자열로 변환
 * @param {Array<number>} weeklyDays - 요일 숫자 배열 [1,3,5]
 * @returns {string} "월, 수, 금"
 */
function formatWeeklyDays(weeklyDays) {
    const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
    return weeklyDays.map(d => dayNames[d]).join(', ');
}

/**
 * 다음 달 청구 금액 미리보기
 * @param {object} student - 학생 정보
 * @param {object} season - 시즌 정보
 * @returns {object} 미리보기 결과
 */
function previewSeasonTransition(student, season) {
    const {
        name,
        monthly_tuition,
        discount_rate,
        weekly_schedule
    } = student;

    const {
        non_season_end_date,
        season_start_date,
        season_end_date
    } = season;

    const weeklyDays = parseWeeklyDays(weekly_schedule);
    const nonSeasonEnd = new Date(non_season_end_date);
    const seasonStart = new Date(season_start_date);

    // 일할 계산
    const proRated = calculateProRatedFee({
        monthlyFee: monthly_tuition,
        weeklyDays,
        nonSeasonEndDate: nonSeasonEnd,
        discountRate: discount_rate || 0
    });

    // 공백기 계산
    const gapStart = new Date(nonSeasonEnd);
    gapStart.setDate(gapStart.getDate() + 1);
    const gapEnd = new Date(seasonStart);
    gapEnd.setDate(gapEnd.getDate() - 1);

    const hasGap = gapStart <= gapEnd;

    return {
        studentName: name,
        monthlyFee: monthly_tuition,
        weeklySchedule: formatWeeklyDays(weeklyDays),
        nonSeasonEndDate: non_season_end_date,
        seasonStartDate: season_start_date,

        // 일할 계산 결과
        proRatedAmount: proRated.proRatedFee,
        proRatedDetails: proRated,

        // 공백기
        hasGap,
        gapPeriod: hasGap ? {
            start: gapStart.toISOString().split('T')[0],
            end: gapEnd.toISOString().split('T')[0],
            days: Math.ceil((gapEnd - gapStart) / (1000 * 60 * 60 * 24)) + 1
        } : null,

        // 요약
        summary: {
            nextMonthCharge: proRated.proRatedFee,
            chargeReason: `비시즌 종강일(${proRated.periodEnd})까지 일할 계산`,
            afterSeasonStart: '시즌비 적용 (월회비 청구 중단)'
        }
    };
}

module.exports = {
    truncateToThousands,
    calculateMidSeasonFee,
    calculateProRatedFee,
    calculateSeasonRefund,
    countClassDays,
    parseWeeklyDays,
    formatWeeklyDays,
    previewSeasonTransition
};

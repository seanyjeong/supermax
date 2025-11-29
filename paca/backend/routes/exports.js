/**
 * 엑셀 내보내기 API
 * 수입, 지출, 재무 리포트를 Excel 파일로 다운로드
 */

const express = require('express');
const router = express.Router();
const ExcelJS = require('exceljs');
const db = require('../config/database');
const { verifyToken, requireRole } = require('../middleware/auth');

// 카테고리 라벨 (한글)
const EXPENSE_CATEGORY_LABELS = {
    salary: '급여',
    utilities: '공과금',
    rent: '임대료',
    supplies: '소모품',
    marketing: '마케팅',
    refund: '환불',
    other: '기타'
};

const INCOME_CATEGORY_LABELS = {
    clothing: '의류',
    shoes: '신발',
    equipment: '운동장비',
    beverage: '음료',
    snack: '간식',
    other: '기타'
};

const PAYMENT_METHOD_LABELS = {
    cash: '현금',
    card: '카드',
    account: '계좌이체',
    other: '기타'
};

/**
 * 공통 스타일 설정
 */
function applyHeaderStyle(row) {
    row.eachCell((cell) => {
        cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF4472C4' }
        };
        cell.font = {
            bold: true,
            color: { argb: 'FFFFFFFF' },
            size: 11
        };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' }
        };
    });
    row.height = 25;
}

function applyCellStyle(cell, isAmount = false) {
    cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
    };
    cell.alignment = {
        horizontal: isAmount ? 'right' : 'center',
        vertical: 'middle'
    };
}

function applyTotalRowStyle(row) {
    row.eachCell((cell) => {
        cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFF2F2F2' }
        };
        cell.font = { bold: true, size: 11 };
        cell.border = {
            top: { style: 'medium' },
            left: { style: 'thin' },
            bottom: { style: 'medium' },
            right: { style: 'thin' }
        };
    });
    row.height = 25;
}

/**
 * GET /paca/exports/revenue
 * 수입 내역 엑셀 다운로드
 */
router.get('/revenue', verifyToken, requireRole('owner', 'admin'), async (req, res) => {
    try {
        const { start_date, end_date, year, month } = req.query;

        let dateFilter = '';
        const params = [req.user.academyId];

        if (start_date && end_date) {
            dateFilter = 'AND (sp.paid_date BETWEEN ? AND ? OR oi.income_date BETWEEN ? AND ?)';
            params.push(start_date, end_date, start_date, end_date);
        } else if (year && month) {
            const startOfMonth = `${year}-${month.toString().padStart(2, '0')}-01`;
            const endOfMonth = new Date(year, month, 0).toISOString().split('T')[0];
            dateFilter = 'AND (sp.paid_date BETWEEN ? AND ? OR oi.income_date BETWEEN ? AND ?)';
            params.push(startOfMonth, endOfMonth, startOfMonth, endOfMonth);
        }

        // 학원비 수입 (student_payments)
        const [tuitionPayments] = await db.query(`
            SELECT
                sp.paid_date as date,
                '학원비' as category,
                s.name as student_name,
                sp.payment_type,
                sp.paid_amount as amount,
                sp.payment_method,
                sp.description,
                sp.notes
            FROM student_payments sp
            JOIN students s ON sp.student_id = s.id
            WHERE sp.academy_id = ?
            AND sp.payment_status = 'paid'
            AND sp.paid_date IS NOT NULL
            ${dateFilter ? dateFilter.replace(/oi\.income_date/g, 'sp.paid_date').replace('OR sp.paid_date BETWEEN ? AND ?', '') : ''}
            ORDER BY sp.paid_date DESC
        `, params.slice(0, start_date && end_date ? 3 : (year && month ? 3 : 1)));

        // 기타 수입 (other_incomes)
        const incomeParams = [req.user.academyId];
        if (start_date && end_date) {
            incomeParams.push(start_date, end_date);
        } else if (year && month) {
            const startOfMonth = `${year}-${month.toString().padStart(2, '0')}-01`;
            const endOfMonth = new Date(year, month, 0).toISOString().split('T')[0];
            incomeParams.push(startOfMonth, endOfMonth);
        }

        const [otherIncomes] = await db.query(`
            SELECT
                oi.income_date as date,
                oi.category,
                COALESCE(s.name, '-') as student_name,
                'other' as payment_type,
                oi.amount,
                oi.payment_method,
                oi.description,
                oi.notes
            FROM other_incomes oi
            LEFT JOIN students s ON oi.student_id = s.id
            WHERE oi.academy_id = ?
            ${start_date && end_date ? 'AND oi.income_date BETWEEN ? AND ?' : ''}
            ${year && month && !start_date ? 'AND oi.income_date BETWEEN ? AND ?' : ''}
            ORDER BY oi.income_date DESC
        `, incomeParams);

        // Excel 생성
        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'P-ACA';
        workbook.created = new Date();

        // 학원비 수입 시트
        const tuitionSheet = workbook.addWorksheet('학원비 수입');
        tuitionSheet.columns = [
            { header: '날짜', key: 'date', width: 12 },
            { header: '학생명', key: 'student_name', width: 15 },
            { header: '구분', key: 'payment_type', width: 12 },
            { header: '금액', key: 'amount', width: 15 },
            { header: '결제방법', key: 'payment_method', width: 12 },
            { header: '설명', key: 'description', width: 25 },
            { header: '메모', key: 'notes', width: 20 }
        ];

        applyHeaderStyle(tuitionSheet.getRow(1));

        let tuitionTotal = 0;
        tuitionPayments.forEach((payment, index) => {
            const amount = parseFloat(payment.amount) || 0;
            tuitionTotal += amount;

            const row = tuitionSheet.addRow({
                date: payment.date ? new Date(payment.date).toLocaleDateString('ko-KR') : '-',
                student_name: payment.student_name,
                payment_type: payment.payment_type === 'monthly' ? '월회비' :
                             payment.payment_type === 'season' ? '시즌비' : payment.payment_type,
                amount: amount,
                payment_method: PAYMENT_METHOD_LABELS[payment.payment_method] || payment.payment_method || '-',
                description: payment.description || '-',
                notes: payment.notes || '-'
            });

            row.eachCell((cell, colNumber) => {
                applyCellStyle(cell, colNumber === 4);
            });
        });

        // 합계 행
        const tuitionTotalRow = tuitionSheet.addRow({
            date: '합계',
            student_name: '',
            payment_type: '',
            amount: tuitionTotal,
            payment_method: '',
            description: '',
            notes: ''
        });
        applyTotalRowStyle(tuitionTotalRow);
        tuitionSheet.getCell(`D${tuitionSheet.rowCount}`).numFmt = '#,##0"원"';

        // 금액 형식
        tuitionSheet.getColumn('amount').numFmt = '#,##0"원"';

        // 기타 수입 시트
        const otherSheet = workbook.addWorksheet('기타 수입');
        otherSheet.columns = [
            { header: '날짜', key: 'date', width: 12 },
            { header: '카테고리', key: 'category', width: 12 },
            { header: '학생명', key: 'student_name', width: 15 },
            { header: '금액', key: 'amount', width: 15 },
            { header: '결제방법', key: 'payment_method', width: 12 },
            { header: '설명', key: 'description', width: 25 },
            { header: '메모', key: 'notes', width: 20 }
        ];

        applyHeaderStyle(otherSheet.getRow(1));

        let otherTotal = 0;
        otherIncomes.forEach((income) => {
            const amount = parseFloat(income.amount) || 0;
            otherTotal += amount;

            const row = otherSheet.addRow({
                date: income.date ? new Date(income.date).toLocaleDateString('ko-KR') : '-',
                category: INCOME_CATEGORY_LABELS[income.category] || income.category,
                student_name: income.student_name,
                amount: amount,
                payment_method: PAYMENT_METHOD_LABELS[income.payment_method] || income.payment_method || '-',
                description: income.description || '-',
                notes: income.notes || '-'
            });

            row.eachCell((cell, colNumber) => {
                applyCellStyle(cell, colNumber === 4);
            });
        });

        const otherTotalRow = otherSheet.addRow({
            date: '합계',
            category: '',
            student_name: '',
            amount: otherTotal,
            payment_method: '',
            description: '',
            notes: ''
        });
        applyTotalRowStyle(otherTotalRow);
        otherSheet.getColumn('amount').numFmt = '#,##0"원"';

        // 요약 시트
        const summarySheet = workbook.addWorksheet('수입 요약');
        summarySheet.columns = [
            { header: '구분', key: 'category', width: 20 },
            { header: '금액', key: 'amount', width: 18 }
        ];

        applyHeaderStyle(summarySheet.getRow(1));

        const summaryData = [
            { category: '학원비 수입', amount: tuitionTotal },
            { category: '기타 수입', amount: otherTotal },
            { category: '총 수입', amount: tuitionTotal + otherTotal }
        ];

        summaryData.forEach((item, index) => {
            const row = summarySheet.addRow(item);
            if (index === summaryData.length - 1) {
                applyTotalRowStyle(row);
            } else {
                row.eachCell((cell, colNumber) => {
                    applyCellStyle(cell, colNumber === 2);
                });
            }
        });
        summarySheet.getColumn('amount').numFmt = '#,##0"원"';

        // 파일명 생성
        const dateStr = start_date && end_date
            ? `${start_date}_${end_date}`
            : year && month
                ? `${year}년${month}월`
                : new Date().toISOString().split('T')[0];
        const filename = `수입내역_${dateStr}.xlsx`;

        // 응답 헤더 설정
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);

        await workbook.xlsx.write(res);
        res.end();

    } catch (error) {
        console.error('Error exporting revenue:', error);
        res.status(500).json({
            error: 'Server Error',
            message: error.message || 'Failed to export revenue data'
        });
    }
});

/**
 * GET /paca/exports/expenses
 * 지출 내역 엑셀 다운로드
 */
router.get('/expenses', verifyToken, requireRole('owner', 'admin'), async (req, res) => {
    try {
        const { start_date, end_date, year, month } = req.query;

        let dateFilter = '';
        const params = [req.user.academyId];

        if (start_date && end_date) {
            dateFilter = 'AND e.expense_date BETWEEN ? AND ?';
            params.push(start_date, end_date);
        } else if (year && month) {
            const startOfMonth = `${year}-${month.toString().padStart(2, '0')}-01`;
            const endOfMonth = new Date(year, month, 0).toISOString().split('T')[0];
            dateFilter = 'AND e.expense_date BETWEEN ? AND ?';
            params.push(startOfMonth, endOfMonth);
        }

        const [expenses] = await db.query(`
            SELECT
                e.expense_date,
                e.category,
                e.amount,
                e.description,
                e.payment_method,
                e.notes,
                i.name as instructor_name
            FROM expenses e
            LEFT JOIN instructors i ON e.instructor_id = i.id
            WHERE e.academy_id = ?
            ${dateFilter}
            ORDER BY e.expense_date DESC
        `, params);

        // Excel 생성
        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'P-ACA';
        workbook.created = new Date();

        // 지출 내역 시트
        const expenseSheet = workbook.addWorksheet('지출 내역');
        expenseSheet.columns = [
            { header: '날짜', key: 'date', width: 12 },
            { header: '카테고리', key: 'category', width: 12 },
            { header: '금액', key: 'amount', width: 15 },
            { header: '설명', key: 'description', width: 30 },
            { header: '결제방법', key: 'payment_method', width: 12 },
            { header: '관련 강사', key: 'instructor_name', width: 15 },
            { header: '메모', key: 'notes', width: 20 }
        ];

        applyHeaderStyle(expenseSheet.getRow(1));

        // 카테고리별 합계 계산용
        const categoryTotals = {};
        let grandTotal = 0;

        expenses.forEach((expense) => {
            const amount = parseFloat(expense.amount) || 0;
            grandTotal += amount;

            const category = expense.category;
            categoryTotals[category] = (categoryTotals[category] || 0) + amount;

            const row = expenseSheet.addRow({
                date: expense.expense_date ? new Date(expense.expense_date).toLocaleDateString('ko-KR') : '-',
                category: EXPENSE_CATEGORY_LABELS[expense.category] || expense.category,
                amount: amount,
                description: expense.description || '-',
                payment_method: PAYMENT_METHOD_LABELS[expense.payment_method] || expense.payment_method || '-',
                instructor_name: expense.instructor_name || '-',
                notes: expense.notes || '-'
            });

            row.eachCell((cell, colNumber) => {
                applyCellStyle(cell, colNumber === 3);
            });
        });

        // 합계 행
        const totalRow = expenseSheet.addRow({
            date: '합계',
            category: '',
            amount: grandTotal,
            description: '',
            payment_method: '',
            instructor_name: '',
            notes: ''
        });
        applyTotalRowStyle(totalRow);
        expenseSheet.getColumn('amount').numFmt = '#,##0"원"';

        // 카테고리별 요약 시트
        const summarySheet = workbook.addWorksheet('카테고리별 요약');
        summarySheet.columns = [
            { header: '카테고리', key: 'category', width: 15 },
            { header: '금액', key: 'amount', width: 18 },
            { header: '비율', key: 'ratio', width: 12 }
        ];

        applyHeaderStyle(summarySheet.getRow(1));

        Object.entries(categoryTotals)
            .sort((a, b) => b[1] - a[1])
            .forEach(([category, amount]) => {
                const row = summarySheet.addRow({
                    category: EXPENSE_CATEGORY_LABELS[category] || category,
                    amount: amount,
                    ratio: grandTotal > 0 ? (amount / grandTotal * 100).toFixed(1) + '%' : '0%'
                });
                row.eachCell((cell, colNumber) => {
                    applyCellStyle(cell, colNumber === 2);
                });
            });

        const summaryTotalRow = summarySheet.addRow({
            category: '합계',
            amount: grandTotal,
            ratio: '100%'
        });
        applyTotalRowStyle(summaryTotalRow);
        summarySheet.getColumn('amount').numFmt = '#,##0"원"';

        // 파일명 생성
        const dateStr = start_date && end_date
            ? `${start_date}_${end_date}`
            : year && month
                ? `${year}년${month}월`
                : new Date().toISOString().split('T')[0];
        const filename = `지출내역_${dateStr}.xlsx`;

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);

        await workbook.xlsx.write(res);
        res.end();

    } catch (error) {
        console.error('Error exporting expenses:', error);
        res.status(500).json({
            error: 'Server Error',
            message: error.message || 'Failed to export expense data'
        });
    }
});

/**
 * GET /paca/exports/financial
 * 월별 재무 리포트 엑셀 다운로드
 */
router.get('/financial', verifyToken, requireRole('owner', 'admin'), async (req, res) => {
    try {
        const { year } = req.query;
        const targetYear = year || new Date().getFullYear();

        // 월별 수입 데이터
        const [monthlyRevenue] = await db.query(`
            SELECT
                MONTH(paid_date) as month,
                SUM(CASE WHEN payment_type = 'monthly' THEN paid_amount ELSE 0 END) as tuition,
                SUM(CASE WHEN payment_type = 'season' THEN paid_amount ELSE 0 END) as season_fee,
                SUM(paid_amount) as total
            FROM student_payments
            WHERE academy_id = ?
            AND YEAR(paid_date) = ?
            AND payment_status = 'paid'
            GROUP BY MONTH(paid_date)
        `, [req.user.academyId, targetYear]);

        // 월별 기타 수입
        const [monthlyOtherIncome] = await db.query(`
            SELECT
                MONTH(income_date) as month,
                SUM(amount) as total
            FROM other_incomes
            WHERE academy_id = ?
            AND YEAR(income_date) = ?
            GROUP BY MONTH(income_date)
        `, [req.user.academyId, targetYear]);

        // 월별 지출 데이터
        const [monthlyExpenses] = await db.query(`
            SELECT
                MONTH(expense_date) as month,
                SUM(CASE WHEN category = 'salary' THEN amount ELSE 0 END) as salary,
                SUM(CASE WHEN category = 'rent' THEN amount ELSE 0 END) as rent,
                SUM(CASE WHEN category = 'utilities' THEN amount ELSE 0 END) as utilities,
                SUM(CASE WHEN category NOT IN ('salary', 'rent', 'utilities') THEN amount ELSE 0 END) as other,
                SUM(amount) as total
            FROM expenses
            WHERE academy_id = ?
            AND YEAR(expense_date) = ?
            GROUP BY MONTH(expense_date)
        `, [req.user.academyId, targetYear]);

        // 데이터를 월별로 정리
        const revenueByMonth = {};
        monthlyRevenue.forEach(r => { revenueByMonth[r.month] = r; });

        const otherIncomeByMonth = {};
        monthlyOtherIncome.forEach(r => { otherIncomeByMonth[r.month] = r; });

        const expensesByMonth = {};
        monthlyExpenses.forEach(e => { expensesByMonth[e.month] = e; });

        // Excel 생성
        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'P-ACA';
        workbook.created = new Date();

        // 월별 재무 요약 시트
        const financialSheet = workbook.addWorksheet('월별 재무 현황');
        financialSheet.columns = [
            { header: '월', key: 'month', width: 8 },
            { header: '학원비', key: 'tuition', width: 15 },
            { header: '시즌비', key: 'season_fee', width: 15 },
            { header: '기타수입', key: 'other_income', width: 15 },
            { header: '총 수입', key: 'total_revenue', width: 15 },
            { header: '급여', key: 'salary', width: 15 },
            { header: '임대료', key: 'rent', width: 12 },
            { header: '공과금', key: 'utilities', width: 12 },
            { header: '기타지출', key: 'other_expense', width: 12 },
            { header: '총 지출', key: 'total_expense', width: 15 },
            { header: '순이익', key: 'net_income', width: 15 }
        ];

        applyHeaderStyle(financialSheet.getRow(1));

        let yearlyTotals = {
            tuition: 0, season_fee: 0, other_income: 0, total_revenue: 0,
            salary: 0, rent: 0, utilities: 0, other_expense: 0, total_expense: 0, net_income: 0
        };

        for (let month = 1; month <= 12; month++) {
            const rev = revenueByMonth[month] || { tuition: 0, season_fee: 0, total: 0 };
            const other = otherIncomeByMonth[month] || { total: 0 };
            const exp = expensesByMonth[month] || { salary: 0, rent: 0, utilities: 0, other: 0, total: 0 };

            const tuition = parseFloat(rev.tuition) || 0;
            const seasonFee = parseFloat(rev.season_fee) || 0;
            const otherIncome = parseFloat(other.total) || 0;
            const totalRevenue = tuition + seasonFee + otherIncome;

            const salary = parseFloat(exp.salary) || 0;
            const rent = parseFloat(exp.rent) || 0;
            const utilities = parseFloat(exp.utilities) || 0;
            const otherExpense = parseFloat(exp.other) || 0;
            const totalExpense = salary + rent + utilities + otherExpense;

            const netIncome = totalRevenue - totalExpense;

            // 연간 합계 누적
            yearlyTotals.tuition += tuition;
            yearlyTotals.season_fee += seasonFee;
            yearlyTotals.other_income += otherIncome;
            yearlyTotals.total_revenue += totalRevenue;
            yearlyTotals.salary += salary;
            yearlyTotals.rent += rent;
            yearlyTotals.utilities += utilities;
            yearlyTotals.other_expense += otherExpense;
            yearlyTotals.total_expense += totalExpense;
            yearlyTotals.net_income += netIncome;

            const row = financialSheet.addRow({
                month: `${month}월`,
                tuition,
                season_fee: seasonFee,
                other_income: otherIncome,
                total_revenue: totalRevenue,
                salary,
                rent,
                utilities,
                other_expense: otherExpense,
                total_expense: totalExpense,
                net_income: netIncome
            });

            row.eachCell((cell, colNumber) => {
                applyCellStyle(cell, colNumber > 1);
                // 순이익이 음수면 빨간색
                if (colNumber === 11 && netIncome < 0) {
                    cell.font = { color: { argb: 'FFFF0000' } };
                }
            });
        }

        // 연간 합계 행
        const totalRow = financialSheet.addRow({
            month: '합계',
            tuition: yearlyTotals.tuition,
            season_fee: yearlyTotals.season_fee,
            other_income: yearlyTotals.other_income,
            total_revenue: yearlyTotals.total_revenue,
            salary: yearlyTotals.salary,
            rent: yearlyTotals.rent,
            utilities: yearlyTotals.utilities,
            other_expense: yearlyTotals.other_expense,
            total_expense: yearlyTotals.total_expense,
            net_income: yearlyTotals.net_income
        });
        applyTotalRowStyle(totalRow);

        // 숫자 형식 지정
        ['tuition', 'season_fee', 'other_income', 'total_revenue', 'salary', 'rent', 'utilities', 'other_expense', 'total_expense', 'net_income'].forEach(col => {
            financialSheet.getColumn(col).numFmt = '#,##0"원"';
        });

        // 연간 요약 시트
        const summarySheet = workbook.addWorksheet('연간 요약');
        summarySheet.columns = [
            { header: '구분', key: 'category', width: 20 },
            { header: '금액', key: 'amount', width: 18 }
        ];

        applyHeaderStyle(summarySheet.getRow(1));

        const summaryData = [
            { category: '【수입】', amount: null },
            { category: '  학원비', amount: yearlyTotals.tuition },
            { category: '  시즌비', amount: yearlyTotals.season_fee },
            { category: '  기타수입', amount: yearlyTotals.other_income },
            { category: '  수입 소계', amount: yearlyTotals.total_revenue },
            { category: '', amount: null },
            { category: '【지출】', amount: null },
            { category: '  급여', amount: yearlyTotals.salary },
            { category: '  임대료', amount: yearlyTotals.rent },
            { category: '  공과금', amount: yearlyTotals.utilities },
            { category: '  기타지출', amount: yearlyTotals.other_expense },
            { category: '  지출 소계', amount: yearlyTotals.total_expense },
            { category: '', amount: null },
            { category: '【순이익】', amount: yearlyTotals.net_income }
        ];

        summaryData.forEach((item) => {
            const row = summarySheet.addRow(item);
            if (item.category.includes('소계') || item.category.includes('순이익')) {
                applyTotalRowStyle(row);
                if (item.category.includes('순이익') && item.amount < 0) {
                    row.getCell(2).font = { bold: true, color: { argb: 'FFFF0000' } };
                }
            } else if (item.category.startsWith('【')) {
                row.getCell(1).font = { bold: true, size: 12 };
            }
        });
        summarySheet.getColumn('amount').numFmt = '#,##0"원"';

        // 파일명 생성
        const filename = `재무리포트_${targetYear}년.xlsx`;

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);

        await workbook.xlsx.write(res);
        res.end();

    } catch (error) {
        console.error('Error exporting financial report:', error);
        res.status(500).json({
            error: 'Server Error',
            message: error.message || 'Failed to export financial report'
        });
    }
});

/**
 * GET /paca/exports/payments
 * 미납/납부 내역 엑셀 다운로드
 */
router.get('/payments', verifyToken, requireRole('owner', 'admin'), async (req, res) => {
    try {
        const { status, year, month, start_date, end_date } = req.query;

        let dateFilter = '';
        const params = [req.user.academyId];

        if (start_date && end_date) {
            dateFilter = 'AND p.due_date BETWEEN ? AND ?';
            params.push(start_date, end_date);
        } else if (year && month) {
            dateFilter = 'AND p.year_month = ?';
            params.push(`${year}-${month.toString().padStart(2, '0')}`);
        }

        let statusFilter = '';
        if (status && ['pending', 'partial', 'paid', 'cancelled'].includes(status)) {
            statusFilter = 'AND p.payment_status = ?';
            params.push(status);
        }

        const [payments] = await db.query(`
            SELECT
                p.id,
                p.year_month,
                p.payment_type,
                p.base_amount,
                p.discount_amount,
                p.additional_amount,
                p.final_amount,
                COALESCE(p.paid_amount, 0) as paid_amount,
                p.due_date,
                p.paid_date,
                p.payment_status,
                p.payment_method,
                p.description,
                s.name as student_name,
                s.student_number,
                s.grade
            FROM student_payments p
            JOIN students s ON p.student_id = s.id
            WHERE p.academy_id = ?
            ${dateFilter}
            ${statusFilter}
            ORDER BY p.due_date DESC, s.name
        `, params);

        // Excel 생성
        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'P-ACA';
        workbook.created = new Date();

        const sheet = workbook.addWorksheet('납부 내역');
        sheet.columns = [
            { header: '학생명', key: 'student_name', width: 12 },
            { header: '학번', key: 'student_number', width: 10 },
            { header: '학년', key: 'grade', width: 8 },
            { header: '년월', key: 'year_month', width: 10 },
            { header: '구분', key: 'payment_type', width: 10 },
            { header: '청구액', key: 'final_amount', width: 12 },
            { header: '납부액', key: 'paid_amount', width: 12 },
            { header: '미납액', key: 'unpaid', width: 12 },
            { header: '납부일', key: 'paid_date', width: 12 },
            { header: '마감일', key: 'due_date', width: 12 },
            { header: '상태', key: 'status', width: 10 },
            { header: '결제방법', key: 'payment_method', width: 10 }
        ];

        applyHeaderStyle(sheet.getRow(1));

        const STATUS_LABELS = {
            pending: '미납',
            partial: '부분납부',
            paid: '완납',
            cancelled: '취소'
        };

        const PAYMENT_TYPE_LABELS = {
            monthly: '월회비',
            season: '시즌비'
        };

        let totalFinal = 0, totalPaid = 0, totalUnpaid = 0;

        payments.forEach((payment) => {
            const finalAmount = parseFloat(payment.final_amount) || 0;
            const paidAmount = parseFloat(payment.paid_amount) || 0;
            const unpaid = finalAmount - paidAmount;

            totalFinal += finalAmount;
            totalPaid += paidAmount;
            totalUnpaid += unpaid;

            const row = sheet.addRow({
                student_name: payment.student_name,
                student_number: payment.student_number || '-',
                grade: payment.grade || '-',
                year_month: payment.year_month,
                payment_type: PAYMENT_TYPE_LABELS[payment.payment_type] || payment.payment_type,
                final_amount: finalAmount,
                paid_amount: paidAmount,
                unpaid: unpaid,
                paid_date: payment.paid_date ? new Date(payment.paid_date).toLocaleDateString('ko-KR') : '-',
                due_date: payment.due_date ? new Date(payment.due_date).toLocaleDateString('ko-KR') : '-',
                status: STATUS_LABELS[payment.payment_status] || payment.payment_status,
                payment_method: PAYMENT_METHOD_LABELS[payment.payment_method] || payment.payment_method || '-'
            });

            row.eachCell((cell, colNumber) => {
                applyCellStyle(cell, [6, 7, 8].includes(colNumber));
                // 미납 상태면 빨간 배경
                if (payment.payment_status === 'pending') {
                    cell.fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: 'FFFCE4D6' }
                    };
                }
            });
        });

        // 합계 행
        const totalRow = sheet.addRow({
            student_name: '합계',
            student_number: '',
            grade: '',
            year_month: '',
            payment_type: '',
            final_amount: totalFinal,
            paid_amount: totalPaid,
            unpaid: totalUnpaid,
            paid_date: '',
            due_date: '',
            status: '',
            payment_method: ''
        });
        applyTotalRowStyle(totalRow);

        // 숫자 형식
        ['final_amount', 'paid_amount', 'unpaid'].forEach(col => {
            sheet.getColumn(col).numFmt = '#,##0"원"';
        });

        // 파일명 생성
        const dateStr = start_date && end_date
            ? `${start_date}_${end_date}`
            : year && month
                ? `${year}년${month}월`
                : new Date().toISOString().split('T')[0];
        const statusStr = status ? `_${STATUS_LABELS[status] || status}` : '';
        const filename = `납부내역${statusStr}_${dateStr}.xlsx`;

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);

        await workbook.xlsx.write(res);
        res.end();

    } catch (error) {
        console.error('Error exporting payments:', error);
        res.status(500).json({
            error: 'Server Error',
            message: error.message || 'Failed to export payment data'
        });
    }
});

module.exports = router;

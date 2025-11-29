const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { verifyToken, requireRole } = require('../middleware/auth');

/**
 * GET /paca/reports/dashboard
 * Get dashboard summary with key metrics
 * Access: owner, admin, staff
 */
router.get('/dashboard', verifyToken, requireRole('owner', 'admin', 'staff'), async (req, res) => {
    try {
        const academyId = req.user.academyId;
        const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM

        // Get student counts
        const [studentStats] = await db.query(
            `SELECT
                COUNT(*) as total_students,
                SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_students,
                SUM(CASE WHEN status = 'paused' THEN 1 ELSE 0 END) as paused_students,
                SUM(CASE WHEN status = 'withdrawn' THEN 1 ELSE 0 END) as withdrawn_students
            FROM students
            WHERE academy_id = ? AND deleted_at IS NULL`,
            [academyId]
        );

        // Get instructor counts
        const [instructorStats] = await db.query(
            `SELECT
                COUNT(*) as total_instructors,
                SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_instructors
            FROM instructors
            WHERE academy_id = ?`,
            [academyId]
        );

        // Get current month revenue (학원비 + 기타수입)
        // 1. 학원비 (student_payments에서 paid된 금액)
        const [paymentRevenue] = await db.query(
            `SELECT
                COUNT(*) as count,
                COALESCE(SUM(COALESCE(paid_amount, final_amount)), 0) as amount
            FROM student_payments
            WHERE academy_id = ?
            AND payment_status = 'paid'
            AND DATE_FORMAT(paid_at, '%Y-%m') = ?`,
            [academyId, currentMonth]
        );

        // 2. 기타수입 (other_incomes 테이블)
        const [otherIncome] = await db.query(
            `SELECT
                COUNT(*) as count,
                COALESCE(SUM(amount), 0) as amount
            FROM other_incomes
            WHERE academy_id = ?
            AND DATE_FORMAT(income_date, '%Y-%m') = ?
            AND deleted_at IS NULL`,
            [academyId, currentMonth]
        );

        // 총 수입 합산
        const totalRevenueCount = parseInt(paymentRevenue[0].count) + parseInt(otherIncome[0].count);
        const totalRevenueAmount = parseFloat(paymentRevenue[0].amount) + parseFloat(otherIncome[0].amount);

        // Get current month expenses (일반지출 + 급여)
        // 1. 일반 지출
        const [expenseStats] = await db.query(
            `SELECT
                COUNT(*) as count,
                COALESCE(SUM(amount), 0) as amount
            FROM expenses
            WHERE academy_id = ?
            AND DATE_FORMAT(expense_date, '%Y-%m') = ?
            AND deleted_at IS NULL`,
            [academyId, currentMonth]
        );

        // 2. 급여 지출 (instructor_salaries에서 paid된 금액)
        const [salaryExpense] = await db.query(
            `SELECT
                COUNT(*) as count,
                COALESCE(SUM(total_amount), 0) as amount
            FROM instructor_salaries
            WHERE academy_id = ?
            AND payment_status = 'paid'
            AND DATE_FORMAT(paid_at, '%Y-%m') = ?`,
            [academyId, currentMonth]
        );

        // 총 지출 합산
        const totalExpenseCount = parseInt(expenseStats[0].count) + parseInt(salaryExpense[0].count);
        const totalExpenseAmount = parseFloat(expenseStats[0].amount) + parseFloat(salaryExpense[0].amount);

        // Get unpaid/overdue payments
        const [unpaidStats] = await db.query(
            `SELECT
                COUNT(*) as unpaid_count,
                COALESCE(SUM(final_amount), 0) as unpaid_amount
            FROM student_payments
            WHERE academy_id = ?
            AND payment_status IN ('pending', 'partial', 'overdue')`,
            [academyId]
        );

        // Calculate net income
        const netIncome = totalRevenueAmount - totalExpenseAmount;

        res.json({
            students: studentStats[0],
            instructors: instructorStats[0],
            current_month: {
                month: currentMonth,
                revenue: {
                    count: totalRevenueCount,
                    amount: totalRevenueAmount
                },
                expenses: {
                    count: totalExpenseCount,
                    amount: totalExpenseAmount
                },
                net_income: netIncome
            },
            unpaid_payments: {
                count: unpaidStats[0].unpaid_count,
                amount: parseFloat(unpaidStats[0].unpaid_amount)
            }
        });
    } catch (error) {
        console.error('Error fetching dashboard:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to fetch dashboard data'
        });
    }
});

/**
 * GET /paca/reports/financial/monthly
 * Get monthly financial report (revenue, expenses, net income)
 * Access: owner, admin
 */
router.get('/financial/monthly', verifyToken, requireRole('owner', 'admin'), async (req, res) => {
    try {
        const { year, month } = req.query;

        if (!year || !month) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'year and month are required'
            });
        }

        const yearMonth = `${year}-${String(month).padStart(2, '0')}`;
        const academyId = req.user.academyId;

        // Get revenue breakdown
        const [revenues] = await db.query(
            `SELECT
                category,
                COUNT(*) as count,
                SUM(amount) as total_amount
            FROM revenues
            WHERE academy_id = ?
            AND DATE_FORMAT(revenue_date, '%Y-%m') = ?
            GROUP BY category
            ORDER BY total_amount DESC`,
            [academyId, yearMonth]
        );

        // Get total revenue
        const [revenueTotal] = await db.query(
            `SELECT COALESCE(SUM(amount), 0) as total_revenue
            FROM revenues
            WHERE academy_id = ?
            AND DATE_FORMAT(revenue_date, '%Y-%m') = ?`,
            [academyId, yearMonth]
        );

        // Get expense breakdown
        const [expenses] = await db.query(
            `SELECT
                category,
                COUNT(*) as count,
                SUM(amount) as total_amount
            FROM expenses
            WHERE academy_id = ?
            AND DATE_FORMAT(expense_date, '%Y-%m') = ?
            GROUP BY category
            ORDER BY total_amount DESC`,
            [academyId, yearMonth]
        );

        // Get total expenses
        const [expenseTotal] = await db.query(
            `SELECT COALESCE(SUM(amount), 0) as total_expenses
            FROM expenses
            WHERE academy_id = ?
            AND DATE_FORMAT(expense_date, '%Y-%m') = ?`,
            [academyId, yearMonth]
        );

        const totalRevenue = parseFloat(revenueTotal[0].total_revenue);
        const totalExpenses = parseFloat(expenseTotal[0].total_expenses);
        const netIncome = totalRevenue - totalExpenses;

        res.json({
            year_month: yearMonth,
            revenue: {
                total: totalRevenue,
                breakdown: revenues.map(r => ({
                    category: r.category,
                    count: r.count,
                    amount: parseFloat(r.total_amount)
                }))
            },
            expenses: {
                total: totalExpenses,
                breakdown: expenses.map(e => ({
                    category: e.category,
                    count: e.count,
                    amount: parseFloat(e.total_amount)
                }))
            },
            net_income: netIncome
        });
    } catch (error) {
        console.error('Error fetching monthly financial report:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to fetch monthly financial report'
        });
    }
});

/**
 * GET /paca/reports/financial/yearly
 * Get yearly financial trend (monthly breakdown)
 * Access: owner, admin
 */
router.get('/financial/yearly', verifyToken, requireRole('owner', 'admin'), async (req, res) => {
    try {
        const { year } = req.query;

        if (!year) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'year is required'
            });
        }

        const academyId = req.user.academyId;

        // Get monthly revenue trend
        const [revenues] = await db.query(
            `SELECT
                DATE_FORMAT(revenue_date, '%Y-%m') as month,
                COUNT(*) as count,
                SUM(amount) as total_amount
            FROM revenues
            WHERE academy_id = ?
            AND YEAR(revenue_date) = ?
            GROUP BY DATE_FORMAT(revenue_date, '%Y-%m')
            ORDER BY month`,
            [academyId, year]
        );

        // Get monthly expense trend
        const [expenses] = await db.query(
            `SELECT
                DATE_FORMAT(expense_date, '%Y-%m') as month,
                COUNT(*) as count,
                SUM(amount) as total_amount
            FROM expenses
            WHERE academy_id = ?
            AND YEAR(expense_date) = ?
            GROUP BY DATE_FORMAT(expense_date, '%Y-%m')
            ORDER BY month`,
            [academyId, year]
        );

        // Combine data by month
        const monthlyData = {};

        revenues.forEach(r => {
            monthlyData[r.month] = {
                month: r.month,
                revenue: parseFloat(r.total_amount),
                expenses: 0,
                net_income: 0
            };
        });

        expenses.forEach(e => {
            if (!monthlyData[e.month]) {
                monthlyData[e.month] = {
                    month: e.month,
                    revenue: 0,
                    expenses: 0,
                    net_income: 0
                };
            }
            monthlyData[e.month].expenses = parseFloat(e.total_amount);
        });

        // Calculate net income for each month
        Object.values(monthlyData).forEach(data => {
            data.net_income = data.revenue - data.expenses;
        });

        const trend = Object.values(monthlyData).sort((a, b) => a.month.localeCompare(b.month));

        // Calculate yearly totals
        const yearlyTotal = trend.reduce((acc, month) => ({
            revenue: acc.revenue + month.revenue,
            expenses: acc.expenses + month.expenses,
            net_income: acc.net_income + month.net_income
        }), { revenue: 0, expenses: 0, net_income: 0 });

        res.json({
            year,
            monthly_trend: trend,
            yearly_total: yearlyTotal
        });
    } catch (error) {
        console.error('Error fetching yearly financial trend:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to fetch yearly financial trend'
        });
    }
});

/**
 * GET /paca/reports/students
 * Get student statistics
 * Access: owner, admin
 */
router.get('/students', verifyToken, requireRole('owner', 'admin'), async (req, res) => {
    try {
        const academyId = req.user.academyId;

        // Get overall statistics
        const [overall] = await db.query(
            `SELECT
                COUNT(*) as total_students,
                SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
                SUM(CASE WHEN status = 'paused' THEN 1 ELSE 0 END) as paused,
                SUM(CASE WHEN status = 'graduated' THEN 1 ELSE 0 END) as graduated,
                SUM(CASE WHEN status = 'withdrawn' THEN 1 ELSE 0 END) as withdrawn
            FROM students
            WHERE academy_id = ? AND deleted_at IS NULL`,
            [academyId]
        );

        // Get breakdown by grade
        const [byGrade] = await db.query(
            `SELECT
                grade,
                grade_type,
                COUNT(*) as count
            FROM students
            WHERE academy_id = ?
            AND deleted_at IS NULL
            AND status IN ('active', 'paused')
            GROUP BY grade, grade_type
            ORDER BY grade, grade_type`,
            [academyId]
        );

        // Get breakdown by admission type
        const [byAdmission] = await db.query(
            `SELECT
                admission_type,
                COUNT(*) as count
            FROM students
            WHERE academy_id = ?
            AND deleted_at IS NULL
            AND status IN ('active', 'paused')
            GROUP BY admission_type`,
            [academyId]
        );

        res.json({
            overall: overall[0],
            by_grade: byGrade,
            by_admission_type: byAdmission
        });
    } catch (error) {
        console.error('Error fetching student statistics:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to fetch student statistics'
        });
    }
});

/**
 * GET /paca/reports/instructors
 * Get instructor statistics
 * Access: owner, admin
 */
router.get('/instructors', verifyToken, requireRole('owner', 'admin'), async (req, res) => {
    try {
        const academyId = req.user.academyId;

        // Get overall statistics
        const [overall] = await db.query(
            `SELECT
                COUNT(*) as total_instructors,
                SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
                SUM(CASE WHEN status = 'on_leave' THEN 1 ELSE 0 END) as on_leave,
                SUM(CASE WHEN status = 'retired' THEN 1 ELSE 0 END) as retired
            FROM instructors
            WHERE academy_id = ?`,
            [academyId]
        );

        // Get breakdown by salary type
        const [bySalaryType] = await db.query(
            `SELECT
                salary_type,
                COUNT(*) as count
            FROM instructors
            WHERE academy_id = ?
            AND status = 'active'
            GROUP BY salary_type`,
            [academyId]
        );

        // Get breakdown by tax type
        const [byTaxType] = await db.query(
            `SELECT
                tax_type,
                COUNT(*) as count
            FROM instructors
            WHERE academy_id = ?
            AND status = 'active'
            GROUP BY tax_type`,
            [academyId]
        );

        res.json({
            overall: overall[0],
            by_salary_type: bySalaryType,
            by_tax_type: byTaxType
        });
    } catch (error) {
        console.error('Error fetching instructor statistics:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to fetch instructor statistics'
        });
    }
});

/**
 * GET /paca/reports/attendance
 * Get attendance statistics
 * Access: owner, admin
 */
router.get('/attendance', verifyToken, requireRole('owner', 'admin'), async (req, res) => {
    try {
        const { start_date, end_date } = req.query;
        const academyId = req.user.academyId;

        if (!start_date || !end_date) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'start_date and end_date are required'
            });
        }

        // Get attendance statistics
        const [stats] = await db.query(
            `SELECT
                COUNT(*) as total_records,
                SUM(CASE WHEN a.attendance_status = 'present' THEN 1 ELSE 0 END) as present_count,
                SUM(CASE WHEN a.attendance_status = 'absent' THEN 1 ELSE 0 END) as absent_count,
                SUM(CASE WHEN a.attendance_status = 'late' THEN 1 ELSE 0 END) as late_count,
                SUM(CASE WHEN a.attendance_status = 'excused' THEN 1 ELSE 0 END) as excused_count
            FROM attendance a
            JOIN class_schedules cs ON a.class_schedule_id = cs.id
            JOIN students s ON a.student_id = s.id
            WHERE s.academy_id = ?
            AND cs.class_date BETWEEN ? AND ?`,
            [academyId, start_date, end_date]
        );

        const totalRecords = stats[0].total_records;
        const presentCount = stats[0].present_count;
        const attendanceRate = totalRecords > 0 ? ((presentCount / totalRecords) * 100).toFixed(2) : 0;

        // Get student-wise attendance
        const [byStudent] = await db.query(
            `SELECT
                s.id as student_id,
                s.name as student_name,
                s.student_number,
                COUNT(*) as total_days,
                SUM(CASE WHEN a.attendance_status = 'present' THEN 1 ELSE 0 END) as present_days,
                SUM(CASE WHEN a.attendance_status = 'absent' THEN 1 ELSE 0 END) as absent_days,
                SUM(CASE WHEN a.attendance_status = 'late' THEN 1 ELSE 0 END) as late_days
            FROM students s
            LEFT JOIN attendance a ON s.id = a.student_id
            LEFT JOIN class_schedules cs ON a.class_schedule_id = cs.id
                AND cs.class_date BETWEEN ? AND ?
            WHERE s.academy_id = ?
            AND s.deleted_at IS NULL
            AND s.status = 'active'
            GROUP BY s.id, s.name, s.student_number
            HAVING total_days > 0
            ORDER BY s.name`,
            [start_date, end_date, academyId]
        );

        // Calculate attendance rate for each student
        const studentStats = byStudent.map(student => ({
            student_id: student.student_id,
            student_name: student.student_name,
            student_number: student.student_number,
            total_days: student.total_days,
            present_days: student.present_days,
            absent_days: student.absent_days,
            late_days: student.late_days,
            attendance_rate: student.total_days > 0
                ? ((student.present_days / student.total_days) * 100).toFixed(2)
                : 0
        }));

        res.json({
            period: {
                start_date,
                end_date
            },
            overall: {
                total_records: totalRecords,
                present_count: presentCount,
                absent_count: stats[0].absent_count,
                late_count: stats[0].late_count,
                excused_count: stats[0].excused_count,
                attendance_rate: parseFloat(attendanceRate)
            },
            by_student: studentStats
        });
    } catch (error) {
        console.error('Error fetching attendance statistics:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to fetch attendance statistics'
        });
    }
});

/**
 * GET /paca/reports/payments/unpaid
 * Get unpaid/overdue payment summary
 * Access: owner, admin
 */
router.get('/payments/unpaid', verifyToken, requireRole('owner', 'admin'), async (req, res) => {
    try {
        const academyId = req.user.academyId;

        // Get unpaid payment statistics
        const [stats] = await db.query(
            `SELECT
                payment_status,
                COUNT(*) as count,
                SUM(final_amount) as total_amount
            FROM student_payments
            WHERE academy_id = ?
            AND payment_status IN ('pending', 'partial', 'overdue')
            GROUP BY payment_status`,
            [academyId]
        );

        // Get student-wise unpaid details
        const [byStudent] = await db.query(
            `SELECT
                s.id as student_id,
                s.name as student_name,
                s.student_number,
                s.phone,
                s.parent_phone,
                COUNT(*) as unpaid_count,
                SUM(p.final_amount) as unpaid_amount
            FROM student_payments p
            JOIN students s ON p.student_id = s.id
            WHERE p.academy_id = ?
            AND p.payment_status IN ('pending', 'partial', 'overdue')
            GROUP BY s.id, s.name, s.student_number, s.phone, s.parent_phone
            ORDER BY unpaid_amount DESC`,
            [academyId]
        );

        const totalUnpaid = stats.reduce((sum, stat) => sum + parseFloat(stat.total_amount), 0);

        res.json({
            summary: {
                total_unpaid_amount: totalUnpaid,
                by_status: stats.map(s => ({
                    status: s.payment_status,
                    count: s.count,
                    amount: parseFloat(s.total_amount)
                }))
            },
            by_student: byStudent.map(s => ({
                student_id: s.student_id,
                student_name: s.student_name,
                student_number: s.student_number,
                phone: s.phone,
                parent_phone: s.parent_phone,
                unpaid_count: s.unpaid_count,
                unpaid_amount: parseFloat(s.unpaid_amount)
            }))
        });
    } catch (error) {
        console.error('Error fetching unpaid payment report:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to fetch unpaid payment report'
        });
    }
});

module.exports = router;

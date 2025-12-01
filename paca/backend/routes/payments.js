const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { verifyToken, requireRole, checkPermission } = require('../middleware/auth');
const { truncateToThousands, calculateProRatedFee, parseWeeklyDays } = require('../utils/seasonCalculator');

/**
 * 비시즌 종강 일할 계산 (다음 달 비시즌 종강일까지의 수업료)
 * @param {object} params - 파라미터
 * @param {number} params.studentId - 학생 ID
 * @param {number} params.academyId - 학원 ID
 * @param {number} params.year - 청구 연도
 * @param {number} params.month - 청구 월
 * @returns {object|null} 비시즌 종강 일할 정보 또는 null
 */
async function calculateNonSeasonEndProrated(params) {
    const { studentId, academyId, year, month } = params;

    // 다음 달 계산
    let nextYear = year;
    let nextMonth = month + 1;
    if (nextMonth > 12) {
        nextMonth = 1;
        nextYear = year + 1;
    }

    // 다음 달에 시작하는 시즌 조회 (해당 학생이 등록된)
    const [seasonEnrollments] = await db.query(
        `SELECT
            se.id as enrollment_id,
            se.student_id,
            s.id as season_id,
            s.name as season_name,
            s.start_date,
            s.end_date,
            s.non_season_end_date,
            st.monthly_tuition,
            st.discount_rate,
            st.weekly_schedule
        FROM student_seasons se
        JOIN seasons s ON se.season_id = s.id
        JOIN students st ON se.student_id = st.id
        WHERE se.student_id = ?
        AND se.status = 'active'
        AND s.academy_id = ?
        AND YEAR(s.start_date) = ?
        AND MONTH(s.start_date) = ?
        AND s.non_season_end_date IS NOT NULL
        AND s.non_season_end_date >= ?`,
        [studentId, academyId, nextYear, nextMonth, `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`]
    );

    if (seasonEnrollments.length === 0) {
        return null;
    }

    const enrollment = seasonEnrollments[0];
    const nonSeasonEndDate = new Date(enrollment.non_season_end_date);

    // 비시즌 종강일이 다음 달 1일 이후인지 확인
    const nextMonthStart = new Date(nextYear, nextMonth - 1, 1);
    if (nonSeasonEndDate < nextMonthStart) {
        return null; // 비시즌 종강일이 다음 달 전이면 일할 계산 필요 없음
    }

    // 비시즌 종강일이 시즌 시작일 이후이면 일할 계산 필요 없음
    const seasonStartDate = new Date(enrollment.start_date);
    if (nonSeasonEndDate >= seasonStartDate) {
        return null;
    }

    // 수업 요일 파싱
    const weeklyDays = parseWeeklyDays(enrollment.weekly_schedule);
    if (weeklyDays.length === 0) {
        return null;
    }

    // 비시즌 종강 일할 계산
    const proRatedResult = calculateProRatedFee({
        monthlyFee: parseFloat(enrollment.monthly_tuition) || 0,
        weeklyDays,
        nonSeasonEndDate,
        discountRate: parseFloat(enrollment.discount_rate) || 0
    });

    if (proRatedResult.proRatedFee <= 0) {
        return null;
    }

    return {
        amount: proRatedResult.proRatedFee,
        seasonName: enrollment.season_name,
        nonSeasonEndDate: enrollment.non_season_end_date,
        classCount: proRatedResult.classCountUntilEnd,
        totalMonthlyClasses: proRatedResult.totalMonthlyClasses,
        description: `비시즌 종강 일할 (${nextMonth}월 1일~${nonSeasonEndDate.getDate()}일, ${proRatedResult.classCountUntilEnd}회)`,
        details: proRatedResult.calculationDetails
    };
}

/**
 * GET /paca/payments
 * Get all payment records with filters
 * Access: owner, admin, staff (with payments view permission)
 */
router.get('/', verifyToken, checkPermission('payments', 'view'), async (req, res) => {
    try {
        const { student_id, payment_status, payment_type, year, month } = req.query;

        let query = `
            SELECT
                p.id,
                p.student_id,
                s.name as student_name,
                s.student_number,
                p.year_month,
                p.payment_type,
                p.base_amount,
                p.discount_amount,
                p.additional_amount,
                p.final_amount,
                p.paid_date,
                p.due_date,
                p.payment_status,
                p.payment_method,
                p.description,
                p.notes,
                p.created_at
            FROM student_payments p
            JOIN students s ON p.student_id = s.id
            WHERE p.academy_id = ?
        `;

        const params = [req.user.academyId];

        if (student_id) {
            query += ' AND p.student_id = ?';
            params.push(parseInt(student_id));
        }

        if (payment_status) {
            query += ' AND p.payment_status = ?';
            params.push(payment_status);
        }

        if (payment_type) {
            query += ' AND p.payment_type = ?';
            params.push(payment_type);
        }

        if (year && month) {
            query += ` AND DATE_FORMAT(p.due_date, '%Y-%m') = ?`;
            params.push(`${year}-${String(month).padStart(2, '0')}`);
        }

        query += ' ORDER BY p.due_date DESC';

        const [payments] = await db.query(query, params);

        res.json({
            message: `Found ${payments.length} payment records`,
            payments
        });
    } catch (error) {
        console.error('Error fetching payments:', error);
        res.status(500).json({
            error: 'Server Error',
            message: '납부 내역을 불러오는데 실패했습니다.'
        });
    }
});

/**
 * GET /paca/payments/unpaid
 * Get all unpaid/overdue payments
 * Access: owner, admin
 */
router.get('/unpaid', verifyToken, checkPermission('payments', 'view'), async (req, res) => {
    try {
        const [payments] = await db.query(
            `SELECT
                p.id,
                p.student_id,
                s.name as student_name,
                s.student_number,
                s.phone,
                s.parent_phone,
                p.year_month,
                p.payment_type,
                p.base_amount,
                p.discount_amount,
                p.additional_amount,
                p.final_amount,
                p.due_date,
                p.payment_status,
                DATEDIFF(CURDATE(), p.due_date) as days_overdue
            FROM student_payments p
            JOIN students s ON p.student_id = s.id
            WHERE p.academy_id = ?
            AND p.payment_status IN ('pending', 'partial')
            ORDER BY p.due_date ASC`,
            [req.user.academyId]
        );

        res.json({
            message: `Found ${payments.length} unpaid payments`,
            payments
        });
    } catch (error) {
        console.error('Error fetching unpaid payments:', error);
        res.status(500).json({
            error: 'Server Error',
            message: '미납 내역을 불러오는데 실패했습니다.'
        });
    }
});

/**
 * GET /paca/payments/:id
 * Get payment by ID
 * Access: owner, admin
 */
router.get('/:id', verifyToken, checkPermission('payments', 'view'), async (req, res) => {
    const paymentId = parseInt(req.params.id);

    try {
        const [payments] = await db.query(
            `SELECT
                p.*,
                s.name as student_name,
                s.student_number,
                s.phone,
                s.parent_phone
            FROM student_payments p
            JOIN students s ON p.student_id = s.id
            WHERE p.id = ?
            AND s.academy_id = ?`,
            [paymentId, req.user.academyId]
        );

        if (payments.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: '납부 내역을 찾을 수 없습니다.'
            });
        }

        res.json({
            payment: payments[0]
        });
    } catch (error) {
        console.error('Error fetching payment:', error);
        res.status(500).json({
            error: 'Server Error',
            message: '납부 내역을 불러오는데 실패했습니다.'
        });
    }
});

/**
 * POST /paca/payments
 * Create new payment record (charge)
 * Access: owner, admin
 */
router.post('/', verifyToken, checkPermission('payments', 'edit'), async (req, res) => {
    try {
        const {
            student_id,
            payment_type,
            base_amount,
            discount_amount,
            additional_amount,
            due_date,
            year_month,
            notes,
            description
        } = req.body;

        // Validation
        if (!student_id || !payment_type || !base_amount || !due_date || !year_month) {
            return res.status(400).json({
                error: 'Validation Error',
                message: '필수 항목을 모두 입력해주세요. (학생, 결제유형, 금액, 납부기한, 청구월)'
            });
        }

        // Verify student exists and belongs to this academy
        const [students] = await db.query(
            'SELECT id, academy_id FROM students WHERE id = ? AND academy_id = ? AND deleted_at IS NULL',
            [student_id, req.user.academyId]
        );

        if (students.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: '학생을 찾을 수 없습니다.'
            });
        }

        // Calculate final_amount (백원 단위 절삭)
        const finalAmount = truncateToThousands(
            parseFloat(base_amount) - parseFloat(discount_amount || 0) + parseFloat(additional_amount || 0)
        );

        // Insert payment record
        const [result] = await db.query(
            `INSERT INTO student_payments (
                student_id,
                academy_id,
                \`year_month\`,
                payment_type,
                base_amount,
                discount_amount,
                additional_amount,
                final_amount,
                due_date,
                payment_status,
                description,
                notes,
                recorded_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
            [
                student_id,
                students[0].academy_id,
                year_month,
                payment_type,
                base_amount,
                discount_amount || 0,
                additional_amount || 0,
                finalAmount,
                due_date,
                description || null,
                notes || null,
                req.user.userId
            ]
        );

        // Fetch created payment
        const [payments] = await db.query(
            `SELECT
                p.*,
                s.name as student_name,
                s.student_number
            FROM student_payments p
            JOIN students s ON p.student_id = s.id
            WHERE p.id = ?`,
            [result.insertId]
        );

        res.status(201).json({
            message: '납부 내역이 생성되었습니다.',
            payment: payments[0]
        });
    } catch (error) {
        console.error('Error creating payment:', error);
        res.status(500).json({
            error: 'Server Error',
            message: '납부 내역 생성에 실패했습니다.'
        });
    }
});

/**
 * POST /paca/payments/bulk-monthly
 * Create monthly tuition charges for all active students
 * Access: owner, admin
 */
router.post('/bulk-monthly', verifyToken, checkPermission('payments', 'edit'), async (req, res) => {
    try {
        const { year, month, due_date } = req.body;

        if (!year || !month || !due_date) {
            return res.status(400).json({
                error: 'Validation Error',
                message: '필수 항목을 모두 입력해주세요. (연도, 월, 납부기한)'
            });
        }

        // Get all active students
        const [students] = await db.query(
            `SELECT
                id,
                name,
                student_number,
                monthly_tuition,
                discount_rate
            FROM students
            WHERE academy_id = ?
            AND status = 'active'
            AND deleted_at IS NULL`,
            [req.user.academyId]
        );

        if (students.length === 0) {
            return res.json({
                message: '활성 상태인 학생이 없습니다.',
                created: 0
            });
        }

        // Check if charges already exist for this month
        const [existing] = await db.query(
            `SELECT COUNT(*) as count
            FROM student_payments p
            JOIN students s ON p.student_id = s.id
            WHERE s.academy_id = ?
            AND p.payment_type = 'monthly'
            AND DATE_FORMAT(p.due_date, '%Y-%m') = ?`,
            [req.user.academyId, `${year}-${String(month).padStart(2, '0')}`]
        );

        if (existing[0].count > 0) {
            return res.status(400).json({
                error: 'Validation Error',
                message: `${year}년 ${month}월 학원비가 이미 생성되어 있습니다.`
            });
        }

        // Create payment records for all students
        let created = 0;
        let withNonSeasonProrated = 0;
        let withCarryover = 0;
        const yearMonth = `${year}-${String(month).padStart(2, '0')}`;

        for (const student of students) {
            const baseAmount = parseFloat(student.monthly_tuition) || 0;
            const discountRate = parseFloat(student.discount_rate) || 0;
            const discount = truncateToThousands(baseAmount * (discountRate / 100));

            // 비시즌 종강 일할 계산 (다음 달 비시즌 종강일까지)
            let additionalAmount = 0;
            let notes = null;
            let description = `${year}년 ${month}월 수강료`;

            try {
                const nonSeasonProrated = await calculateNonSeasonEndProrated({
                    studentId: student.id,
                    academyId: req.user.academyId,
                    year,
                    month
                });

                if (nonSeasonProrated) {
                    additionalAmount = nonSeasonProrated.amount;
                    notes = `[비시즌 종강 일할] ${nonSeasonProrated.description}\n${nonSeasonProrated.details.formula}`;
                    description = `${year}년 ${month}월 수강료 + 비시즌 종강 일할`;
                    withNonSeasonProrated++;
                }
            } catch (err) {
                console.error(`Failed to calculate non-season prorated for student ${student.id}:`, err);
            }

            // 휴식 이월 크레딧 확인 및 적용
            let carryoverAmount = 0;
            let restCreditId = null;
            try {
                const [pendingCredits] = await db.query(
                    `SELECT id, remaining_amount FROM rest_credits
                     WHERE student_id = ?
                     AND academy_id = ?
                     AND credit_type = 'carryover'
                     AND status IN ('pending', 'partial')
                     AND remaining_amount > 0
                     ORDER BY created_at ASC`,
                    [student.id, req.user.academyId]
                );

                if (pendingCredits.length > 0) {
                    const credit = pendingCredits[0];
                    const amountBeforeCarryover = baseAmount - discount + additionalAmount;

                    // 이월 금액이 청구 금액보다 크면 청구 금액만큼만 차감
                    carryoverAmount = Math.min(credit.remaining_amount, amountBeforeCarryover);
                    restCreditId = credit.id;

                    // 크레딧 잔액 업데이트
                    const newRemaining = credit.remaining_amount - carryoverAmount;
                    const newStatus = newRemaining <= 0 ? 'applied' : 'partial';

                    await db.query(
                        `UPDATE rest_credits SET
                            remaining_amount = ?,
                            status = ?,
                            processed_at = NOW()
                         WHERE id = ?`,
                        [newRemaining, newStatus, credit.id]
                    );

                    notes = (notes || '') + `\n[이월 차감] 휴식 크레딧 ${carryoverAmount.toLocaleString()}원 차감`;
                    description += ' (이월 차감 적용)';
                    withCarryover++;
                }
            } catch (err) {
                console.error(`Failed to apply carryover credit for student ${student.id}:`, err);
            }

            const finalAmount = truncateToThousands(baseAmount - discount + additionalAmount - carryoverAmount);

            await db.query(
                `INSERT INTO student_payments (
                    student_id,
                    academy_id,
                    \`year_month\`,
                    payment_type,
                    base_amount,
                    discount_amount,
                    additional_amount,
                    carryover_amount,
                    rest_credit_id,
                    final_amount,
                    due_date,
                    payment_status,
                    description,
                    notes,
                    recorded_by
                ) VALUES (?, ?, ?, 'monthly', ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
                [
                    student.id,
                    req.user.academyId,
                    yearMonth,
                    baseAmount,
                    discount,
                    additionalAmount,
                    carryoverAmount,
                    restCreditId,
                    finalAmount,
                    due_date,
                    description,
                    notes,
                    req.user.userId
                ]
            );
            created++;
        }

        res.json({
            message: `${created}명의 학원비가 생성되었습니다.` +
                (withNonSeasonProrated > 0 ? ` (비시즌 종강 일할 포함: ${withNonSeasonProrated}명)` : '') +
                (withCarryover > 0 ? ` (이월 차감 적용: ${withCarryover}명)` : ''),
            created,
            withNonSeasonProrated,
            withCarryover,
            year,
            month,
            due_date
        });
    } catch (error) {
        console.error('Error creating bulk monthly charges:', error);
        res.status(500).json({
            error: 'Server Error',
            message: '학원비 일괄 생성에 실패했습니다.'
        });
    }
});

/**
 * POST /paca/payments/:id/pay
 * Record payment (full or partial)
 * Access: owner, admin
 */
router.post('/:id/pay', verifyToken, checkPermission('payments', 'edit'), async (req, res) => {
    const paymentId = parseInt(req.params.id);

    try {
        const { paid_amount, payment_method, payment_date, notes } = req.body;

        if (!paid_amount || !payment_method) {
            return res.status(400).json({
                error: 'Validation Error',
                message: '필수 항목을 모두 입력해주세요. (납부금액, 결제방법)'
            });
        }

        // Get payment record
        const [payments] = await db.query(
            `SELECT p.*
            FROM student_payments p
            WHERE p.id = ? AND p.academy_id = ?`,
            [paymentId, req.user.academyId]
        );

        if (payments.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: '납부 내역을 찾을 수 없습니다.'
            });
        }

        const payment = payments[0];

        // Check if payment already completed
        if (payment.payment_status === 'paid') {
            return res.status(400).json({
                error: 'Validation Error',
                message: '이미 완납된 내역입니다.'
            });
        }

        // Calculate amounts
        const totalDue = parseFloat(payment.final_amount);
        const currentPaidAmount = parseFloat(payment.paid_amount) || 0;
        const newPaidAmount = currentPaidAmount + parseFloat(paid_amount);

        // Validate paid_amount
        if (parseFloat(paid_amount) <= 0) {
            return res.status(400).json({
                error: 'Validation Error',
                message: '납부 금액은 0원보다 커야 합니다.'
            });
        }

        // Determine payment status based on total paid amount
        let paymentStatus;
        if (newPaidAmount >= totalDue) {
            paymentStatus = 'paid';
        } else {
            paymentStatus = 'partial';
        }

        await db.query(
            `UPDATE student_payments
            SET
                paid_amount = ?,
                payment_status = ?,
                payment_method = ?,
                paid_date = ?,
                notes = CONCAT(IFNULL(notes, ''), '\n', ?),
                updated_at = NOW()
            WHERE id = ?`,
            [
                newPaidAmount,
                paymentStatus,
                payment_method,
                payment_date || new Date().toISOString().split('T')[0],
                notes || `납부: ${paid_amount}원`,
                paymentId
            ]
        );

        // Record in revenues table (optional - table may not exist)
        // payment_type에 따라 적절한 카테고리와 설명 사용
        const revenueCategory = payment.payment_type === 'season' ? 'season' : 'tuition';
        const revenueDescription = payment.payment_type === 'season'
            ? `시즌비 납부 (${payment.description || ''})`.trim()
            : `수강료 납부 (결제ID: ${paymentId})`;

        try {
            await db.query(
                `INSERT INTO revenues (
                    academy_id,
                    category,
                    amount,
                    revenue_date,
                    payment_method,
                    student_id,
                    description
                ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [
                    payment.academy_id,
                    revenueCategory,
                    paid_amount,
                    payment_date || new Date().toISOString().split('T')[0],
                    payment_method,
                    payment.student_id,
                    revenueDescription
                ]
            );
        } catch (revenueError) {
            console.log('Revenue table insert skipped:', revenueError.message);
        }

        // Fetch updated payment
        const [updated] = await db.query(
            `SELECT
                p.*,
                s.name as student_name,
                s.student_number
            FROM student_payments p
            JOIN students s ON p.student_id = s.id
            WHERE p.id = ?`,
            [paymentId]
        );

        res.json({
            message: '납부가 기록되었습니다.',
            payment: updated[0]
        });
    } catch (error) {
        console.error('=== Error recording payment ===');
        console.error('Error:', error);
        console.error('Error message:', error.message);
        console.error('SQL State:', error.sqlState);
        console.error('SQL Message:', error.sqlMessage);
        console.error('Payment ID:', paymentId);
        console.error('Request body:', req.body);
        res.status(500).json({
            error: 'Server Error',
            message: '납부 기록에 실패했습니다.',
            details: process.env.NODE_ENV === 'development' ? error.toString() : undefined
        });
    }
});

/**
 * PUT /paca/payments/:id
 * Update payment record
 * Access: owner, admin
 */
router.put('/:id', verifyToken, checkPermission('payments', 'edit'), async (req, res) => {
    const paymentId = parseInt(req.params.id);

    try {
        // Verify payment exists and belongs to this academy
        const [payments] = await db.query(
            `SELECT p.id, s.academy_id
            FROM student_payments p
            JOIN students s ON p.student_id = s.id
            WHERE p.id = ?`,
            [paymentId]
        );

        if (payments.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: '납부 내역을 찾을 수 없습니다.'
            });
        }

        if (payments[0].academy_id !== req.user.academyId) {
            return res.status(403).json({
                error: 'Forbidden',
                message: '접근 권한이 없습니다.'
            });
        }

        const {
            payment_type,
            base_amount,
            discount_amount,
            additional_amount,
            due_date,
            payment_status,
            description,
            notes
        } = req.body;

        // Build update query dynamically
        const updates = [];
        const params = [];

        if (payment_type !== undefined) {
            updates.push('payment_type = ?');
            params.push(payment_type);
        }
        if (base_amount !== undefined) {
            updates.push('base_amount = ?');
            params.push(base_amount);
        }
        if (discount_amount !== undefined) {
            updates.push('discount_amount = ?');
            params.push(discount_amount);
        }
        if (additional_amount !== undefined) {
            updates.push('additional_amount = ?');
            params.push(additional_amount);
        }

        // Recalculate final_amount if any amount fields changed
        if (base_amount !== undefined || discount_amount !== undefined || additional_amount !== undefined) {
            const [current] = await db.query('SELECT base_amount, discount_amount, additional_amount FROM student_payments WHERE id = ?', [paymentId]);
            const currentData = current[0];

            const newBase = base_amount !== undefined ? base_amount : currentData.base_amount;
            const newDiscount = discount_amount !== undefined ? discount_amount : currentData.discount_amount;
            const newAdditional = additional_amount !== undefined ? additional_amount : currentData.additional_amount;

            const finalAmount = truncateToThousands(
                parseFloat(newBase) - parseFloat(newDiscount) + parseFloat(newAdditional)
            );
            updates.push('final_amount = ?');
            params.push(finalAmount);
        }

        if (due_date !== undefined) {
            updates.push('due_date = ?');
            params.push(due_date);
        }
        if (payment_status !== undefined) {
            updates.push('payment_status = ?');
            params.push(payment_status);
        }
        if (description !== undefined) {
            updates.push('description = ?');
            params.push(description);
        }
        if (notes !== undefined) {
            updates.push('notes = ?');
            params.push(notes);
        }

        if (updates.length === 0) {
            return res.status(400).json({
                error: 'Validation Error',
                message: '수정할 항목이 없습니다.'
            });
        }

        updates.push('updated_at = NOW()');
        params.push(paymentId);

        await db.query(
            `UPDATE student_payments SET ${updates.join(', ')} WHERE id = ?`,
            params
        );

        // Fetch updated payment
        const [updated] = await db.query(
            `SELECT
                p.*,
                s.name as student_name,
                s.student_number
            FROM student_payments p
            JOIN students s ON p.student_id = s.id
            WHERE p.id = ?`,
            [paymentId]
        );

        res.json({
            message: '납부 내역이 수정되었습니다.',
            payment: updated[0]
        });
    } catch (error) {
        console.error('Error updating payment:', error);
        res.status(500).json({
            error: 'Server Error',
            message: '납부 내역 수정에 실패했습니다.'
        });
    }
});

/**
 * DELETE /paca/payments/:id
 * Delete payment record
 * Access: owner only
 */
router.delete('/:id', verifyToken, requireRole('owner'), async (req, res) => {
    const paymentId = parseInt(req.params.id);

    try {
        // Verify payment exists and belongs to this academy
        const [payments] = await db.query(
            `SELECT p.id, p.student_id, s.name as student_name
            FROM student_payments p
            JOIN students s ON p.student_id = s.id
            WHERE p.id = ? AND p.academy_id = ?`,
            [paymentId, req.user.academyId]
        );

        if (payments.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: '납부 내역을 찾을 수 없습니다.'
            });
        }

        // Delete payment record
        await db.query('DELETE FROM student_payments WHERE id = ?', [paymentId]);

        res.json({
            message: '납부 내역이 삭제되었습니다.',
            payment: {
                id: paymentId,
                student_name: payments[0].student_name
            }
        });
    } catch (error) {
        console.error('Error deleting payment:', error);
        res.status(500).json({
            error: 'Server Error',
            message: '납부 내역 삭제에 실패했습니다.'
        });
    }
});

/**
 * GET /paca/payments/stats/summary
 * Get payment statistics summary
 * Access: owner, admin
 */
router.get('/stats/summary', verifyToken, checkPermission('payments', 'view'), async (req, res) => {
    try {
        const { year, month } = req.query;

        let dateFilter = '';
        const params = [req.user.academyId];

        if (year && month) {
            dateFilter = ` AND DATE_FORMAT(p.due_date, '%Y-%m') = ?`;
            params.push(`${year}-${String(month).padStart(2, '0')}`);
        }

        // Get payment statistics
        const [stats] = await db.query(
            `SELECT
                COUNT(*) as total_count,
                SUM(CASE WHEN p.payment_status = 'paid' THEN 1 ELSE 0 END) as paid_count,
                SUM(CASE WHEN p.payment_status = 'partial' THEN 1 ELSE 0 END) as partial_count,
                SUM(CASE WHEN p.payment_status = 'pending' THEN 1 ELSE 0 END) as unpaid_count,
                SUM(p.final_amount) as total_expected,
                SUM(CASE WHEN p.payment_status = 'paid' THEN p.final_amount ELSE 0 END) as total_collected,
                SUM(CASE WHEN p.payment_status IN ('pending', 'partial') THEN p.final_amount ELSE 0 END) as total_outstanding
            FROM student_payments p
            WHERE p.academy_id = ?${dateFilter}`,
            params
        );

        res.json({
            message: '납부 통계를 불러왔습니다.',
            stats: stats[0]
        });
    } catch (error) {
        console.error('Error fetching payment stats:', error);
        res.status(500).json({
            error: 'Server Error',
            message: '납부 통계를 불러오는데 실패했습니다.'
        });
    }
});

/**
 * POST /paca/payments/generate-prorated
 * Generate prorated payment for a student based on enrollment date
 * Access: owner, admin
 *
 * 등록일 기준 일할계산:
 * - 11/25 등록, 납부일 1일 → 11월: 25~30일 일할, 12월부터: 정상
 */
router.post('/generate-prorated', verifyToken, checkPermission('payments', 'edit'), async (req, res) => {
    try {
        const { student_id, enrollment_date } = req.body;

        if (!student_id) {
            return res.status(400).json({
                error: 'Validation Error',
                message: '학생을 선택해주세요.'
            });
        }

        // Get student with payment_due_day
        const [students] = await db.query(
            `SELECT
                s.id, s.name, s.monthly_tuition, s.discount_rate,
                s.payment_due_day, s.enrollment_date, s.class_days,
                a.tuition_due_day
            FROM students s
            JOIN academies ac ON s.academy_id = ac.id
            LEFT JOIN academy_settings a ON ac.id = a.academy_id
            WHERE s.id = ? AND s.academy_id = ? AND s.deleted_at IS NULL`,
            [student_id, req.user.academyId]
        );

        if (students.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: '학생을 찾을 수 없습니다.'
            });
        }

        const student = students[0];
        const regDate = new Date(enrollment_date || student.enrollment_date || new Date());

        // 납부일 결정: 학생 개별 납부일 > 학원 납부일 > 기본 5일
        const dueDay = student.payment_due_day || student.tuition_due_day || 5;

        // 등록월의 마지막 날
        const lastDayOfMonth = new Date(regDate.getFullYear(), regDate.getMonth() + 1, 0).getDate();
        const regDay = regDate.getDate();

        // 수업 요일 파싱
        let classDays = [];
        try {
            classDays = typeof student.class_days === 'string'
                ? JSON.parse(student.class_days)
                : (student.class_days || []);
        } catch (e) {
            classDays = [];
        }

        // 해당 월의 총 수업일수 계산
        const dayNameToNum = { '월': 1, '화': 2, '수': 3, '목': 4, '금': 5, '토': 6, '일': 0 };
        const classDayNums = classDays.map(d => dayNameToNum[d]).filter(d => d !== undefined);

        let totalClassDays = 0;
        let remainingClassDays = 0;

        for (let day = 1; day <= lastDayOfMonth; day++) {
            const date = new Date(regDate.getFullYear(), regDate.getMonth(), day);
            const dayOfWeek = date.getDay();
            if (classDayNums.includes(dayOfWeek)) {
                totalClassDays++;
                if (day >= regDay) {
                    remainingClassDays++;
                }
            }
        }

        // 일할계산 금액
        const baseAmount = parseFloat(student.monthly_tuition) || 0;
        const discountRate = parseFloat(student.discount_rate) || 0;
        const discountAmount = baseAmount * (discountRate / 100);

        let proRatedAmount = baseAmount;
        let isProrated = false;

        // 등록일이 1일이 아니면 일할계산
        if (regDay > 1 && totalClassDays > 0) {
            proRatedAmount = truncateToThousands(baseAmount * (remainingClassDays / totalClassDays));
            isProrated = true;
        }

        const finalAmount = truncateToThousands(proRatedAmount - (proRatedAmount * (discountRate / 100)));

        // 납부기한 계산 (등록월의 납부일 또는 등록일 + 7일)
        let dueDate;
        if (regDay <= dueDay) {
            // 등록일이 납부일 전이면 이번 달 납부일
            dueDate = new Date(regDate.getFullYear(), regDate.getMonth(), dueDay);
        } else {
            // 등록일이 납부일 후면 등록일 + 7일 (또는 다음달 납부일)
            dueDate = new Date(regDate);
            dueDate.setDate(regDate.getDate() + 7);
        }

        const yearMonth = `${regDate.getFullYear()}-${String(regDate.getMonth() + 1).padStart(2, '0')}`;

        // 이미 해당 월 납부건이 있는지 확인
        const [existing] = await db.query(
            `SELECT id FROM student_payments
            WHERE student_id = ? AND year_month = ? AND payment_type = 'monthly'`,
            [student_id, yearMonth]
        );

        if (existing.length > 0) {
            return res.status(400).json({
                error: 'Validation Error',
                message: `${yearMonth} 월 납부건이 이미 존재합니다.`
            });
        }

        // 납부 레코드 생성
        const prorationDetails = {
            enrollment_date: regDate.toISOString().split('T')[0],
            registration_day: regDay,
            total_class_days: totalClassDays,
            remaining_class_days: remainingClassDays,
            class_days: classDays,
            base_amount: baseAmount,
            prorated_amount: proRatedAmount,
            calculation: isProrated
                ? `${baseAmount}원 × (${remainingClassDays}/${totalClassDays}일) = ${proRatedAmount}원`
                : '일할계산 없음 (월초 등록)'
        };

        const [result] = await db.query(
            `INSERT INTO student_payments (
                student_id, academy_id, year_month, payment_type,
                base_amount, discount_amount, additional_amount, final_amount,
                is_prorated, proration_details,
                due_date, payment_status, description, recorded_by
            ) VALUES (?, ?, ?, 'monthly', ?, ?, 0, ?, ?, ?, ?, 'pending', ?, ?)`,
            [
                student_id,
                req.user.academyId,
                yearMonth,
                proRatedAmount,
                proRatedAmount * (discountRate / 100),
                finalAmount,
                isProrated ? 1 : 0,
                JSON.stringify(prorationDetails),
                dueDate.toISOString().split('T')[0],
                isProrated
                    ? `${regDate.getMonth() + 1}월 학원비 (일할: ${regDay}일~)`
                    : `${regDate.getMonth() + 1}월 학원비`,
                req.user.userId
            ]
        );

        // 생성된 납부건 조회
        const [created] = await db.query(
            `SELECT p.*, s.name as student_name
            FROM student_payments p
            JOIN students s ON p.student_id = s.id
            WHERE p.id = ?`,
            [result.insertId]
        );

        res.status(201).json({
            message: '일할계산 납부건이 생성되었습니다.',
            payment: created[0],
            proration: prorationDetails
        });
    } catch (error) {
        console.error('Error generating prorated payment:', error);
        res.status(500).json({
            error: 'Server Error',
            message: '일할계산 납부건 생성에 실패했습니다.'
        });
    }
});

/**
 * POST /paca/payments/generate-monthly-for-student
 * Generate next month's payment for a specific student
 * Access: owner, admin
 */
router.post('/generate-monthly-for-student', verifyToken, checkPermission('payments', 'edit'), async (req, res) => {
    try {
        const { student_id, year, month } = req.body;

        if (!student_id || !year || !month) {
            return res.status(400).json({
                error: 'Validation Error',
                message: '필수 항목을 모두 입력해주세요. (학생, 연도, 월)'
            });
        }

        // Get student info
        const [students] = await db.query(
            `SELECT
                s.id, s.name, s.monthly_tuition, s.discount_rate,
                s.payment_due_day,
                a.tuition_due_day
            FROM students s
            JOIN academies ac ON s.academy_id = ac.id
            LEFT JOIN academy_settings a ON ac.id = a.academy_id
            WHERE s.id = ? AND s.academy_id = ? AND s.deleted_at IS NULL`,
            [student_id, req.user.academyId]
        );

        if (students.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: '학생을 찾을 수 없습니다.'
            });
        }

        const student = students[0];
        const dueDay = student.payment_due_day || student.tuition_due_day || 5;
        const yearMonth = `${year}-${String(month).padStart(2, '0')}`;

        // Check existing
        const [existing] = await db.query(
            `SELECT id FROM student_payments
            WHERE student_id = ? AND year_month = ? AND payment_type = 'monthly'`,
            [student_id, yearMonth]
        );

        if (existing.length > 0) {
            return res.status(400).json({
                error: 'Validation Error',
                message: `${yearMonth} 월 납부건이 이미 존재합니다.`
            });
        }

        const baseAmount = parseFloat(student.monthly_tuition) || 0;
        const discountRate = parseFloat(student.discount_rate) || 0;
        const discountAmount = truncateToThousands(baseAmount * (discountRate / 100));

        // 비시즌 종강 일할 계산
        let additionalAmount = 0;
        let notes = null;
        let description = `${year}년 ${month}월 학원비`;
        let nonSeasonProratedInfo = null;

        try {
            const nonSeasonProrated = await calculateNonSeasonEndProrated({
                studentId: student_id,
                academyId: req.user.academyId,
                year,
                month
            });

            if (nonSeasonProrated) {
                additionalAmount = nonSeasonProrated.amount;
                notes = `[비시즌 종강 일할] ${nonSeasonProrated.description}\n${nonSeasonProrated.details.formula}`;
                description = `${year}년 ${month}월 학원비 + 비시즌 종강 일할`;
                nonSeasonProratedInfo = nonSeasonProrated;
            }
        } catch (err) {
            console.error(`Failed to calculate non-season prorated for student ${student_id}:`, err);
        }

        const finalAmount = truncateToThousands(baseAmount - discountAmount + additionalAmount);

        // Due date
        const dueDate = new Date(year, month - 1, dueDay);

        const [result] = await db.query(
            `INSERT INTO student_payments (
                student_id, academy_id, year_month, payment_type,
                base_amount, discount_amount, additional_amount, final_amount,
                due_date, payment_status, description, notes, recorded_by
            ) VALUES (?, ?, ?, 'monthly', ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
            [
                student_id,
                req.user.academyId,
                yearMonth,
                baseAmount,
                discountAmount,
                additionalAmount,
                finalAmount,
                dueDate.toISOString().split('T')[0],
                description,
                notes,
                req.user.userId
            ]
        );

        const [created] = await db.query(
            `SELECT p.*, s.name as student_name
            FROM student_payments p
            JOIN students s ON p.student_id = s.id
            WHERE p.id = ?`,
            [result.insertId]
        );

        res.status(201).json({
            message: nonSeasonProratedInfo
                ? '월 납부건이 생성되었습니다. (비시즌 종강 일할 포함)'
                : '월 납부건이 생성되었습니다.',
            payment: created[0],
            nonSeasonProrated: nonSeasonProratedInfo
        });
    } catch (error) {
        console.error('Error generating monthly payment:', error);
        res.status(500).json({
            error: 'Server Error',
            message: '월 납부건 생성에 실패했습니다.'
        });
    }
});

module.exports = router;

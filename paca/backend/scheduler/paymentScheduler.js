/**
 * Payment Scheduler
 * 학원비 자동 청구 스케줄러
 *
 * 매월 1일에 해당 월 학원비 자동 생성
 * (휴식 크레딧 이월 차감 포함)
 */

const cron = require('node-cron');
const db = require('../config/database');

/**
 * 천원 단위 절삭
 */
function truncateToThousands(amount) {
    return Math.floor(amount / 1000) * 1000;
}

/**
 * 학원비 자동 생성 로직
 * 매월 1일에 실행되어 모든 active 학생의 학원비를 생성
 */
async function generateMonthlyPayments() {
    console.log('[PaymentScheduler] Starting automatic payment generation...');

    const today = new Date();
    const currentDay = today.getDate();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth() + 1;
    const yearMonth = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;

    // 매월 1일에만 실행 (수동 호출 시 무시)
    // if (currentDay !== 1) {
    //     console.log(`[PaymentScheduler] Skipping - today is not 1st of month (current: ${currentDay})`);
    //     return 0;
    // }

    try {
        // 모든 학원 설정 조회
        const [academies] = await db.query(`
            SELECT
                a.id as academy_id,
                COALESCE(ast.tuition_due_day, 5) as default_due_day
            FROM academies a
            LEFT JOIN academy_settings ast ON a.id = ast.academy_id
        `);

        let totalGenerated = 0;
        let totalWithCarryover = 0;

        for (const academy of academies) {
            // 해당 학원의 모든 active 학생 조회
            const [students] = await db.query(`
                SELECT
                    s.id,
                    s.name,
                    s.monthly_tuition,
                    s.discount_rate,
                    COALESCE(s.payment_due_day, ?) as due_day
                FROM students s
                WHERE s.academy_id = ?
                AND s.status = 'active'
                AND s.deleted_at IS NULL
                AND s.monthly_tuition > 0
            `, [academy.default_due_day, academy.academy_id]);

            for (const student of students) {
                // 이미 해당 월 학원비가 있는지 확인
                const [existing] = await db.query(`
                    SELECT id FROM student_payments
                    WHERE student_id = ?
                    AND \`year_month\` = ?
                    AND payment_type = 'monthly'
                `, [student.id, yearMonth]);

                if (existing.length > 0) {
                    console.log(`[PaymentScheduler] Payment already exists for student ${student.id} (${student.name}) - ${yearMonth}`);
                    continue;
                }

                // 학원비 계산
                const baseAmount = parseFloat(student.monthly_tuition);
                const discountRate = parseFloat(student.discount_rate) || 0;
                const discountAmount = truncateToThousands(baseAmount * discountRate / 100);

                // 휴식 이월 크레딧 확인 및 적용
                let carryoverAmount = 0;
                let restCreditId = null;
                let notes = null;

                try {
                    const [pendingCredits] = await db.query(`
                        SELECT id, remaining_amount FROM rest_credits
                        WHERE student_id = ?
                        AND academy_id = ?
                        AND credit_type = 'carryover'
                        AND status IN ('pending', 'partial')
                        AND remaining_amount > 0
                        ORDER BY created_at ASC
                    `, [student.id, academy.academy_id]);

                    if (pendingCredits.length > 0) {
                        const credit = pendingCredits[0];
                        const amountBeforeCarryover = baseAmount - discountAmount;

                        carryoverAmount = Math.min(credit.remaining_amount, amountBeforeCarryover);
                        restCreditId = credit.id;

                        const newRemaining = credit.remaining_amount - carryoverAmount;
                        const newStatus = newRemaining <= 0 ? 'applied' : 'partial';

                        await db.query(`
                            UPDATE rest_credits SET
                                remaining_amount = ?,
                                status = ?,
                                applied_to_payment_id = NULL,
                                processed_at = NOW()
                            WHERE id = ?
                        `, [newRemaining, newStatus, credit.id]);

                        notes = `[이월 차감] 휴식 크레딧 ${carryoverAmount.toLocaleString()}원 차감`;
                        totalWithCarryover++;
                    }
                } catch (err) {
                    console.error(`[PaymentScheduler] Failed to apply carryover for student ${student.id}:`, err);
                }

                const finalAmount = truncateToThousands(baseAmount - discountAmount - carryoverAmount);

                // 납부일 계산
                const dueDay = student.due_day;
                const lastDayOfMonth = new Date(currentYear, currentMonth, 0).getDate();
                const actualDueDay = Math.min(dueDay, lastDayOfMonth);
                const dueDate = new Date(currentYear, currentMonth - 1, actualDueDay);

                const description = carryoverAmount > 0
                    ? `${currentMonth}월 학원비 (이월 차감 적용)`
                    : `${currentMonth}월 학원비`;

                await db.query(`
                    INSERT INTO student_payments (
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
                        notes
                    ) VALUES (?, ?, ?, 'monthly', ?, ?, 0, ?, ?, ?, ?, 'pending', ?, ?)
                `, [
                    student.id,
                    academy.academy_id,
                    yearMonth,
                    baseAmount,
                    discountAmount,
                    carryoverAmount,
                    restCreditId,
                    finalAmount,
                    dueDate.toISOString().split('T')[0],
                    description,
                    notes
                ]);

                console.log(`[PaymentScheduler] Generated payment for student ${student.id} (${student.name}) - ${yearMonth}`);
                totalGenerated++;
            }
        }

        console.log(`[PaymentScheduler] Completed. Generated ${totalGenerated} payments (${totalWithCarryover} with carryover).`);
        return { totalGenerated, totalWithCarryover };

    } catch (error) {
        console.error('[PaymentScheduler] Error:', error);
        throw error;
    }
}

/**
 * 스케줄러 초기화
 * 매월 1일 00:01에 실행
 */
function initScheduler() {
    // 매월 1일 00:01에 실행 (1 0 1 * *)
    cron.schedule('1 0 1 * *', async () => {
        console.log('[PaymentScheduler] Running scheduled task at', new Date().toISOString());
        try {
            await generateMonthlyPayments();
        } catch (error) {
            console.error('[PaymentScheduler] Scheduled task failed:', error);
        }
    }, {
        timezone: 'Asia/Seoul'
    });

    console.log('[PaymentScheduler] Scheduler initialized - runs monthly at 00:01 KST on the 1st');
}

module.exports = {
    initScheduler,
    generateMonthlyPayments
};

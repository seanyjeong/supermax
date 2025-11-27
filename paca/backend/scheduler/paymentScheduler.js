/**
 * Payment Scheduler
 * 학원비 자동 청구 스케줄러
 *
 * 납부일 2일 전에 해당 월 학원비 자동 생성
 */

const cron = require('node-cron');
const db = require('../config/database');

/**
 * 학원비 자동 생성 로직
 * 매일 자정에 실행되어 납부일 2일 전인 학생들의 학원비를 생성
 */
async function generateMonthlyPayments() {
    console.log('[PaymentScheduler] Starting automatic payment generation...');

    const today = new Date();
    const currentDay = today.getDate();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth() + 1;
    const yearMonth = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;

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

        for (const academy of academies) {
            // 해당 학원의 재원 학생 중 납부일이 오늘 + 2일인 학생들 조회
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
                // 납부일 2일 전인지 확인
                const dueDay = student.due_day;
                const checkDay = (dueDay - 2 + 31) % 31 || 31; // 납부일 2일 전

                if (currentDay !== checkDay) continue;

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

                // 학원비 생성
                const baseAmount = parseFloat(student.monthly_tuition);
                const discountRate = parseFloat(student.discount_rate) || 0;
                const discountAmount = Math.round(baseAmount * discountRate / 100);
                const finalAmount = baseAmount - discountAmount;

                // 납부일 계산
                const lastDayOfMonth = new Date(currentYear, currentMonth, 0).getDate();
                const actualDueDay = Math.min(dueDay, lastDayOfMonth);
                const dueDate = new Date(currentYear, currentMonth - 1, actualDueDay);

                await db.query(`
                    INSERT INTO student_payments (
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
                        description
                    ) VALUES (?, ?, ?, 'monthly', ?, ?, 0, ?, ?, 'pending', ?)
                `, [
                    student.id,
                    academy.academy_id,
                    yearMonth,
                    baseAmount,
                    discountAmount,
                    finalAmount,
                    dueDate.toISOString().split('T')[0],
                    `${currentMonth}월 학원비`
                ]);

                console.log(`[PaymentScheduler] Generated payment for student ${student.id} (${student.name}) - ${yearMonth}`);
                totalGenerated++;
            }
        }

        console.log(`[PaymentScheduler] Completed. Generated ${totalGenerated} payments.`);
        return totalGenerated;

    } catch (error) {
        console.error('[PaymentScheduler] Error:', error);
        throw error;
    }
}

/**
 * 스케줄러 초기화
 * 매일 자정(00:00)에 실행
 */
function initScheduler() {
    // 매일 자정에 실행 (0 0 * * *)
    cron.schedule('0 0 * * *', async () => {
        console.log('[PaymentScheduler] Running scheduled task at', new Date().toISOString());
        try {
            await generateMonthlyPayments();
        } catch (error) {
            console.error('[PaymentScheduler] Scheduled task failed:', error);
        }
    }, {
        timezone: 'Asia/Seoul'
    });

    console.log('[PaymentScheduler] Scheduler initialized - runs daily at 00:00 KST');
}

module.exports = {
    initScheduler,
    generateMonthlyPayments
};

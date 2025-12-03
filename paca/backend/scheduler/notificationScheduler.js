/**
 * 알림톡 자동 발송 스케줄러
 * 매일 자정에 실행되어, 설정된 자동 발송일에 미납 알림 발송
 */

const cron = require('node-cron');
const db = require('../config/database');
const {
    decryptApiKey,
    sendAlimtalk,
    createUnpaidNotificationMessage,
    isValidPhoneNumber
} = require('../utils/naverSens');

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;

/**
 * 미납 알림 자동 발송 작업
 */
async function sendScheduledNotifications() {
    const today = new Date();
    const currentDay = today.getDate();
    const currentHour = today.getHours();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth() + 1;

    console.log(`[NotificationScheduler] 자동 발송 체크 시작: ${currentYear}-${currentMonth}-${currentDay} ${currentHour}시`);

    try {
        // 오늘 날짜 + 현재 시간에 자동 발송 설정된 학원 조회
        // auto_send_days: 콤마로 구분된 날짜 목록 (예: "5,15,25")
        // auto_send_hour: 발송 시간 (0-23, 기본값 9)
        const [academies] = await db.query(
            `SELECT ns.*, a.name AS academy_name, a.phone AS academy_phone,
                    COALESCE(ast.tuition_due_day, 1) AS tuition_due_day
             FROM notification_settings ns
             JOIN academies a ON ns.academy_id = a.id
             LEFT JOIN academy_settings ast ON ns.academy_id = ast.academy_id
             WHERE ns.is_enabled = TRUE
               AND (ns.auto_send_day = ? OR FIND_IN_SET(?, ns.auto_send_days) > 0)
               AND COALESCE(ns.auto_send_hour, 9) = ?`,
            [currentDay, currentDay.toString(), currentHour]
        );

        if (academies.length === 0) {
            console.log(`[NotificationScheduler] ${currentDay}일 ${currentHour}시에 발송 설정된 학원 없음`);
            return;
        }

        console.log(`[NotificationScheduler] ${academies.length}개 학원 자동 발송 시작`);

        for (const academy of academies) {
            try {
                await sendNotificationsForAcademy(academy, currentYear, currentMonth);
            } catch (error) {
                console.error(`[NotificationScheduler] 학원 ID ${academy.academy_id} 발송 오류:`, error);
            }
        }

        console.log(`[NotificationScheduler] 자동 발송 완료`);
    } catch (error) {
        console.error('[NotificationScheduler] 스케줄러 오류:', error);
    }
}

/**
 * 특정 학원의 미납자에게 알림 발송
 */
async function sendNotificationsForAcademy(settings, year, month) {
    const academyId = settings.academy_id;
    const decryptedSecret = decryptApiKey(settings.naver_secret_key, ENCRYPTION_KEY);

    if (!decryptedSecret) {
        console.log(`[NotificationScheduler] 학원 ID ${academyId}: Secret Key 복호화 실패`);
        return;
    }

    // 미납자 조회 (학부모 또는 학생 전화가 있는 경우)
    const [unpaidPayments] = await db.query(
        `SELECT
            p.id AS payment_id,
            p.amount,
            p.due_date,
            s.id AS student_id,
            s.name AS student_name,
            s.parent_phone,
            s.phone AS student_phone
        FROM student_payments p
        JOIN students s ON p.student_id = s.id
        WHERE p.academy_id = ?
            AND p.year = ?
            AND p.month = ?
            AND p.payment_status IN ('pending', 'partial')
            AND s.status = 'active'
            AND (s.parent_phone IS NOT NULL OR s.phone IS NOT NULL)
            AND s.deleted_at IS NULL`,
        [academyId, year, month]
    );

    if (unpaidPayments.length === 0) {
        console.log(`[NotificationScheduler] 학원 ID ${academyId}: 미납자 없음`);
        return;
    }

    // 유효한 전화번호 필터링 (학부모 전화 우선, 없으면 학생 전화)
    const validRecipients = unpaidPayments
        .map(p => {
            const phone = isValidPhoneNumber(p.parent_phone) ? p.parent_phone : p.student_phone;
            return { ...p, effectivePhone: phone };
        })
        .filter(p => isValidPhoneNumber(p.effectivePhone));

    if (validRecipients.length === 0) {
        console.log(`[NotificationScheduler] 학원 ID ${academyId}: 유효한 전화번호 없음`);
        return;
    }

    console.log(`[NotificationScheduler] 학원 ID ${academyId}: ${validRecipients.length}명 발송 시작`);

    // 납부일 문자열 생성
    const dueDay = settings.tuition_due_day || 1;
    const dueDayText = `매월 ${dueDay}일`;

    // 메시지 준비
    const recipients = validRecipients.map(p => {
        const msg = createUnpaidNotificationMessage(
            {
                month: month.toString(),
                amount: p.amount,
                due_date: dueDayText
            },
            { name: p.student_name },
            { name: settings.academy_name || '', phone: settings.academy_phone || '' },
            settings.template_content  // 사용자 정의 템플릿
        );

        return {
            phone: p.effectivePhone,  // 학부모 또는 학생 전화
            content: msg.content,
            variables: msg.variables,
            studentId: p.student_id,
            paymentId: p.payment_id,
            studentName: p.student_name
        };
    });

    // 알림톡 발송 (배치로 처리)
    const batchSize = 100;
    let sentCount = 0;
    let failedCount = 0;

    for (let i = 0; i < recipients.length; i += batchSize) {
        const batch = recipients.slice(i, i + batchSize);

        const result = await sendAlimtalk(
            {
                naver_access_key: settings.naver_access_key,
                naver_secret_key: decryptedSecret,
                naver_service_id: settings.naver_service_id,
                kakao_channel_id: settings.kakao_channel_id
            },
            settings.template_code,
            batch
        );

        // 로그 기록
        for (const recipient of batch) {
            await db.query(
                `INSERT INTO notification_logs
                (academy_id, student_id, payment_id, recipient_name, recipient_phone,
                 message_type, template_code, message_content, status, request_id,
                 error_message, sent_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
                [
                    academyId,
                    recipient.studentId,
                    recipient.paymentId,
                    recipient.studentName,
                    recipient.phone,
                    'alimtalk',
                    settings.template_code,
                    recipient.content,
                    result.success ? 'sent' : 'failed',
                    result.requestId || null,
                    result.success ? null : (result.error || 'Unknown error')
                ]
            );

            if (result.success) {
                sentCount++;
            } else {
                failedCount++;
            }
        }
    }

    console.log(`[NotificationScheduler] 학원 ID ${academyId}: ${sentCount}명 성공, ${failedCount}명 실패`);
}

/**
 * 스케줄러 초기화
 * 매시간 정각에 실행 (한국 시간 기준)
 * 각 학원의 auto_send_hour 설정에 따라 발송
 */
function initNotificationScheduler() {
    // 매시간 정각 실행 (0 * * * *)
    cron.schedule('0 * * * *', async () => {
        console.log('[NotificationScheduler] 스케줄 작업 시작...');
        await sendScheduledNotifications();
    }, {
        scheduled: true,
        timezone: 'Asia/Seoul'
    });

    console.log('📨 알림톡 자동 발송 스케줄러 초기화 완료 (매시간 정각 체크)');
}

module.exports = {
    initNotificationScheduler,
    sendScheduledNotifications
};

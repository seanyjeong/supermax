/**
 * 알림톡 관련 API 라우트
 * 미납 학원비 알림 발송 기능
 */

const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { verifyToken, checkPermission } = require('../middleware/auth');
const {
    encryptApiKey,
    decryptApiKey,
    sendAlimtalk,
    createUnpaidNotificationMessage,
    isValidPhoneNumber
} = require('../utils/naverSens');

// 암호화 키 (환경변수에서 가져오거나 기본값 사용)
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'paca-notification-secret-key-2024';

/**
 * GET /paca/notifications/settings
 * 알림 설정 조회
 */
router.get('/settings', verifyToken, checkPermission('settings', 'view'), async (req, res) => {
    try {
        const [settings] = await db.query(
            `SELECT * FROM notification_settings WHERE academy_id = ?`,
            [req.user.academyId]
        );

        if (settings.length === 0) {
            return res.json({
                message: '알림 설정이 없습니다.',
                settings: {
                    naver_access_key: '',
                    naver_secret_key: '',
                    naver_service_id: '',
                    sms_service_id: '',
                    kakao_channel_id: '',
                    template_code: '',
                    template_content: '',
                    is_enabled: false,
                    auto_send_day: 0,
                    auto_send_days: '',
                    auto_send_hour: 9
                }
            });
        }

        // Secret Key 마스킹 (앞 4자리만 표시)
        const setting = settings[0];
        const decryptedSecret = decryptApiKey(setting.naver_secret_key, ENCRYPTION_KEY);
        const maskedSecret = decryptedSecret
            ? decryptedSecret.substring(0, 4) + '****'
            : '';

        res.json({
            message: '알림 설정 조회 성공',
            settings: {
                ...setting,
                naver_secret_key: maskedSecret,
                has_secret_key: !!setting.naver_secret_key
            }
        });
    } catch (error) {
        console.error('알림 설정 조회 오류:', error);
        res.status(500).json({
            error: 'Server Error',
            message: '알림 설정 조회에 실패했습니다.'
        });
    }
});

/**
 * PUT /paca/notifications/settings
 * 알림 설정 저장
 */
router.put('/settings', verifyToken, checkPermission('settings', 'edit'), async (req, res) => {
    try {
        const {
            naver_access_key,
            naver_secret_key,
            naver_service_id,
            sms_service_id,
            kakao_channel_id,
            template_code,
            template_content,
            is_enabled,
            auto_send_day,
            auto_send_days,
            auto_send_hour
        } = req.body;

        // 기존 설정 확인
        const [existing] = await db.query(
            'SELECT id, naver_secret_key FROM notification_settings WHERE academy_id = ?',
            [req.user.academyId]
        );

        // Secret Key 처리 (새로 입력된 경우에만 암호화)
        let encryptedSecret = null;
        if (naver_secret_key && !naver_secret_key.includes('****')) {
            encryptedSecret = encryptApiKey(naver_secret_key, ENCRYPTION_KEY);
        } else if (existing.length > 0) {
            encryptedSecret = existing[0].naver_secret_key;
        }

        if (existing.length === 0) {
            // 신규 생성
            await db.query(
                `INSERT INTO notification_settings
                (academy_id, naver_access_key, naver_secret_key, naver_service_id, sms_service_id,
                 kakao_channel_id, template_code, template_content, is_enabled, auto_send_day, auto_send_days, auto_send_hour)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    req.user.academyId,
                    naver_access_key || null,
                    encryptedSecret,
                    naver_service_id || null,
                    sms_service_id || null,
                    kakao_channel_id || null,
                    template_code || null,
                    template_content || null,
                    is_enabled || false,
                    auto_send_day || 0,
                    auto_send_days || '',
                    auto_send_hour ?? 9
                ]
            );
        } else {
            // 업데이트
            await db.query(
                `UPDATE notification_settings SET
                    naver_access_key = ?,
                    naver_secret_key = ?,
                    naver_service_id = ?,
                    sms_service_id = ?,
                    kakao_channel_id = ?,
                    template_code = ?,
                    template_content = ?,
                    is_enabled = ?,
                    auto_send_day = ?,
                    auto_send_days = ?,
                    auto_send_hour = ?
                WHERE academy_id = ?`,
                [
                    naver_access_key || null,
                    encryptedSecret,
                    naver_service_id || null,
                    sms_service_id || null,
                    kakao_channel_id || null,
                    template_code || null,
                    template_content || null,
                    is_enabled || false,
                    auto_send_day || 0,
                    auto_send_days || '',
                    auto_send_hour ?? 9,
                    req.user.academyId
                ]
            );
        }

        res.json({
            message: '알림 설정이 저장되었습니다.',
            success: true
        });
    } catch (error) {
        console.error('알림 설정 저장 오류:', error);
        res.status(500).json({
            error: 'Server Error',
            message: '알림 설정 저장에 실패했습니다.'
        });
    }
});

/**
 * POST /paca/notifications/test
 * 테스트 메시지 발송
 */
router.post('/test', verifyToken, checkPermission('settings', 'edit'), async (req, res) => {
    try {
        const { phone } = req.body;

        if (!phone || !isValidPhoneNumber(phone)) {
            return res.status(400).json({
                error: 'Validation Error',
                message: '유효한 전화번호를 입력해주세요.'
            });
        }

        // 설정 조회
        const [settings] = await db.query(
            'SELECT * FROM notification_settings WHERE academy_id = ?',
            [req.user.academyId]
        );

        if (settings.length === 0) {
            return res.status(400).json({
                error: 'Configuration Error',
                message: '알림 설정을 먼저 완료해주세요.'
            });
        }

        const setting = settings[0];

        // Secret Key 복호화
        const decryptedSecret = decryptApiKey(setting.naver_secret_key, ENCRYPTION_KEY);
        if (!decryptedSecret) {
            return res.status(400).json({
                error: 'Configuration Error',
                message: 'API Secret Key가 올바르지 않습니다.'
            });
        }

        // 학원 정보 조회
        const [academy] = await db.query(
            'SELECT name, phone FROM academies WHERE id = ?',
            [req.user.academyId]
        );

        // 테스트 메시지 발송
        const testMessage = createUnpaidNotificationMessage(
            { month: '12', amount: 300000, due_date: '2024-12-10' },
            { name: '테스트학생' },
            { name: academy[0]?.name || '테스트학원', phone: academy[0]?.phone || '02-1234-5678' },
            setting.template_content  // 사용자 정의 템플릿
        );

        const result = await sendAlimtalk(
            {
                naver_access_key: setting.naver_access_key,
                naver_secret_key: decryptedSecret,
                naver_service_id: setting.naver_service_id,
                kakao_channel_id: setting.kakao_channel_id
            },
            setting.template_code,
            [{ phone, content: testMessage.content, variables: testMessage.variables }]
        );

        if (result.success) {
            // 로그 기록
            await db.query(
                `INSERT INTO notification_logs
                (academy_id, recipient_name, recipient_phone, message_type, template_code,
                 message_content, status, request_id, sent_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
                [
                    req.user.academyId,
                    '테스트',
                    phone,
                    'alimtalk',
                    setting.template_code,
                    testMessage.content,
                    'sent',
                    result.requestId
                ]
            );

            res.json({
                message: '테스트 메시지가 발송되었습니다.',
                success: true,
                requestId: result.requestId
            });
        } else {
            res.status(400).json({
                error: 'Send Failed',
                message: '메시지 발송에 실패했습니다: ' + (result.error || '알 수 없는 오류'),
                details: result
            });
        }
    } catch (error) {
        console.error('테스트 발송 오류:', error);
        res.status(500).json({
            error: 'Server Error',
            message: '테스트 발송에 실패했습니다.'
        });
    }
});

/**
 * POST /paca/notifications/send-unpaid
 * 미납자 일괄 알림 발송
 */
router.post('/send-unpaid', verifyToken, checkPermission('settings', 'edit'), async (req, res) => {
    try {
        const { year, month } = req.body;

        if (!year || !month) {
            return res.status(400).json({
                error: 'Validation Error',
                message: '년도와 월을 지정해주세요.'
            });
        }

        // 설정 조회
        const [settings] = await db.query(
            'SELECT * FROM notification_settings WHERE academy_id = ?',
            [req.user.academyId]
        );

        if (settings.length === 0 || !settings[0].is_enabled) {
            return res.status(400).json({
                error: 'Configuration Error',
                message: '알림 설정을 먼저 완료하고 활성화해주세요.'
            });
        }

        const setting = settings[0];
        const decryptedSecret = decryptApiKey(setting.naver_secret_key, ENCRYPTION_KEY);

        if (!decryptedSecret) {
            return res.status(400).json({
                error: 'Configuration Error',
                message: 'API Secret Key가 올바르지 않습니다.'
            });
        }

        // 학원 정보
        const [academy] = await db.query(
            'SELECT name, phone FROM academies WHERE id = ?',
            [req.user.academyId]
        );

        // 미납자 조회 (학부모 전화 또는 학생 전화가 있는 경우)
        const yearMonth = `${year}-${String(month).padStart(2, '0')}`;
        const [unpaidPayments] = await db.query(
            `SELECT
                p.id AS payment_id,
                p.final_amount AS amount,
                p.due_date,
                s.id AS student_id,
                s.name AS student_name,
                s.parent_phone,
                s.phone AS student_phone
            FROM student_payments p
            JOIN students s ON p.student_id = s.id
            WHERE p.academy_id = ?
                AND p.year_month = ?
                AND p.payment_status IN ('pending', 'partial')
                AND s.status = 'active'
                AND (s.parent_phone IS NOT NULL OR s.phone IS NOT NULL)
                AND s.deleted_at IS NULL`,
            [req.user.academyId, yearMonth]
        );

        if (unpaidPayments.length === 0) {
            return res.json({
                message: '발송할 미납자가 없습니다.',
                sent: 0,
                failed: 0
            });
        }

        // 유효한 전화번호 필터링 (학부모 전화 우선, 없으면 학생 전화)
        const validRecipients = unpaidPayments
            .map(p => {
                // 학부모 전화 우선, 없으면 학생 전화 사용
                const phone = isValidPhoneNumber(p.parent_phone) ? p.parent_phone : p.student_phone;
                return { ...p, effectivePhone: phone };
            })
            .filter(p => isValidPhoneNumber(p.effectivePhone));

        if (validRecipients.length === 0) {
            return res.json({
                message: '유효한 전화번호가 있는 미납자가 없습니다.',
                sent: 0,
                failed: unpaidPayments.length
            });
        }

        // 메시지 준비
        const recipients = validRecipients.map(p => {
            const msg = createUnpaidNotificationMessage(
                {
                    month: month.toString(),
                    amount: p.amount,
                    due_date: p.due_date ? new Date(p.due_date).toLocaleDateString('ko-KR') : ''
                },
                { name: p.student_name },
                { name: academy[0]?.name || '', phone: academy[0]?.phone || '' },
                setting.template_content  // 사용자 정의 템플릿
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

        // 알림톡 발송 (배치로 처리, 최대 100명씩)
        const batchSize = 100;
        let sentCount = 0;
        let failedCount = 0;

        for (let i = 0; i < recipients.length; i += batchSize) {
            const batch = recipients.slice(i, i + batchSize);

            const result = await sendAlimtalk(
                {
                    naver_access_key: setting.naver_access_key,
                    naver_secret_key: decryptedSecret,
                    naver_service_id: setting.naver_service_id,
                    kakao_channel_id: setting.kakao_channel_id
                },
                setting.template_code,
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
                        req.user.academyId,
                        recipient.studentId,
                        recipient.paymentId,
                        recipient.studentName,
                        recipient.phone,
                        'alimtalk',
                        setting.template_code,
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

        res.json({
            message: `알림 발송 완료: ${sentCount}명 성공, ${failedCount}명 실패`,
            sent: sentCount,
            failed: failedCount
        });
    } catch (error) {
        console.error('일괄 발송 오류:', error);
        res.status(500).json({
            error: 'Server Error',
            message: '알림 발송에 실패했습니다.'
        });
    }
});

/**
 * POST /paca/notifications/send-individual
 * 개별 학생 알림 발송
 */
router.post('/send-individual', verifyToken, checkPermission('settings', 'edit'), async (req, res) => {
    try {
        const { payment_id } = req.body;

        if (!payment_id) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'payment_id가 필요합니다.'
            });
        }

        // 설정 조회
        const [settings] = await db.query(
            'SELECT * FROM notification_settings WHERE academy_id = ?',
            [req.user.academyId]
        );

        if (settings.length === 0 || !settings[0].is_enabled) {
            return res.status(400).json({
                error: 'Configuration Error',
                message: '알림 설정을 먼저 완료하고 활성화해주세요.'
            });
        }

        const setting = settings[0];
        const decryptedSecret = decryptApiKey(setting.naver_secret_key, ENCRYPTION_KEY);

        // 학원비 및 학생 정보 조회
        const [payments] = await db.query(
            `SELECT
                p.id AS payment_id,
                p.final_amount AS amount,
                p.year_month,
                p.due_date,
                s.id AS student_id,
                s.name AS student_name,
                s.parent_phone,
                s.phone AS student_phone
            FROM student_payments p
            JOIN students s ON p.student_id = s.id
            WHERE p.id = ? AND p.academy_id = ?`,
            [payment_id, req.user.academyId]
        );

        if (payments.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: '해당 학원비 정보를 찾을 수 없습니다.'
            });
        }

        const payment = payments[0];

        // 학부모 전화 우선, 없으면 학생 전화 사용
        const effectivePhone = isValidPhoneNumber(payment.parent_phone)
            ? payment.parent_phone
            : payment.student_phone;

        if (!isValidPhoneNumber(effectivePhone)) {
            return res.status(400).json({
                error: 'Validation Error',
                message: '학부모 또는 학생의 유효한 전화번호가 없습니다.'
            });
        }

        // 학원 정보
        const [academy] = await db.query(
            'SELECT name, phone FROM academies WHERE id = ?',
            [req.user.academyId]
        );

        // 메시지 생성 (year_month에서 월 추출: "2025-12" -> "12")
        const monthFromYearMonth = payment.year_month ? payment.year_month.split('-')[1] : '';
        const msg = createUnpaidNotificationMessage(
            {
                month: monthFromYearMonth,
                amount: payment.amount,
                due_date: payment.due_date ? new Date(payment.due_date).toLocaleDateString('ko-KR') : ''
            },
            { name: payment.student_name },
            { name: academy[0]?.name || '', phone: academy[0]?.phone || '' },
            setting.template_content  // 사용자 정의 템플릿
        );

        // 발송
        const result = await sendAlimtalk(
            {
                naver_access_key: setting.naver_access_key,
                naver_secret_key: decryptedSecret,
                naver_service_id: setting.naver_service_id,
                kakao_channel_id: setting.kakao_channel_id
            },
            setting.template_code,
            [{
                phone: effectivePhone,  // 학부모 또는 학생 전화
                content: msg.content,
                variables: msg.variables
            }]
        );

        // 로그 기록
        await db.query(
            `INSERT INTO notification_logs
            (academy_id, student_id, payment_id, recipient_name, recipient_phone,
             message_type, template_code, message_content, status, request_id,
             error_message, sent_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
            [
                req.user.academyId,
                payment.student_id,
                payment.payment_id,
                payment.student_name,
                effectivePhone,  // 실제 발송된 전화번호
                'alimtalk',
                setting.template_code,
                msg.content,
                result.success ? 'sent' : 'failed',
                result.requestId || null,
                result.success ? null : (result.error || 'Unknown error')
            ]
        );

        if (result.success) {
            res.json({
                message: `${payment.student_name} 학생에게 알림이 발송되었습니다.`,
                success: true,
                requestId: result.requestId
            });
        } else {
            res.status(400).json({
                error: 'Send Failed',
                message: '알림 발송에 실패했습니다: ' + (result.error || '알 수 없는 오류')
            });
        }
    } catch (error) {
        console.error('개별 발송 오류:', error);
        res.status(500).json({
            error: 'Server Error',
            message: '알림 발송에 실패했습니다.'
        });
    }
});

/**
 * GET /paca/notifications/logs
 * 발송 내역 조회
 */
router.get('/logs', verifyToken, checkPermission('settings', 'view'), async (req, res) => {
    try {
        const { page = 1, limit = 20, status, start_date, end_date } = req.query;
        const offset = (page - 1) * limit;

        let whereClause = 'WHERE n.academy_id = ?';
        const params = [req.user.academyId];

        if (status) {
            whereClause += ' AND n.status = ?';
            params.push(status);
        }

        if (start_date) {
            whereClause += ' AND DATE(n.created_at) >= ?';
            params.push(start_date);
        }

        if (end_date) {
            whereClause += ' AND DATE(n.created_at) <= ?';
            params.push(end_date);
        }

        // 총 개수
        const [countResult] = await db.query(
            `SELECT COUNT(*) AS total FROM notification_logs n ${whereClause}`,
            params
        );

        // 로그 목록
        const [logs] = await db.query(
            `SELECT
                n.*,
                s.name AS student_name
            FROM notification_logs n
            LEFT JOIN students s ON n.student_id = s.id
            ${whereClause}
            ORDER BY n.created_at DESC
            LIMIT ? OFFSET ?`,
            [...params, parseInt(limit), offset]
        );

        res.json({
            message: '발송 내역 조회 성공',
            logs,
            pagination: {
                total: countResult[0].total,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(countResult[0].total / limit)
            }
        });
    } catch (error) {
        console.error('발송 내역 조회 오류:', error);
        res.status(500).json({
            error: 'Server Error',
            message: '발송 내역 조회에 실패했습니다.'
        });
    }
});

/**
 * GET /paca/notifications/stats
 * 발송 통계
 */
router.get('/stats', verifyToken, checkPermission('settings', 'view'), async (req, res) => {
    try {
        const { year, month } = req.query;

        let whereClause = 'WHERE academy_id = ?';
        const params = [req.user.academyId];

        if (year && month) {
            whereClause += ' AND YEAR(created_at) = ? AND MONTH(created_at) = ?';
            params.push(year, month);
        }

        const [stats] = await db.query(
            `SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS sent,
                SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) AS delivered,
                SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
            FROM notification_logs
            ${whereClause}`,
            params
        );

        res.json({
            message: '발송 통계 조회 성공',
            stats: stats[0]
        });
    } catch (error) {
        console.error('발송 통계 조회 오류:', error);
        res.status(500).json({
            error: 'Server Error',
            message: '발송 통계 조회에 실패했습니다.'
        });
    }
});

module.exports = router;

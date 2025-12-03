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
const {
    sendAlimtalkSolapi,
    getBalanceSolapi
} = require('../utils/solapi');

// 암호화 키 (환경변수에서 가져옴)
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
if (!ENCRYPTION_KEY) {
    console.warn('[notifications] ENCRYPTION_KEY 환경변수가 설정되지 않았습니다.');
}

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
                    service_type: 'sens',
                    naver_access_key: '',
                    naver_secret_key: '',
                    naver_service_id: '',
                    sms_service_id: '',
                    kakao_channel_id: '',
                    // 솔라피 설정
                    solapi_api_key: '',
                    solapi_api_secret: '',
                    solapi_pfid: '',
                    solapi_sender_phone: '',
                    // 공통 설정
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

        // SENS Secret Key 마스킹
        const decryptedSecret = decryptApiKey(setting.naver_secret_key, ENCRYPTION_KEY);
        const maskedSecret = decryptedSecret
            ? decryptedSecret.substring(0, 4) + '****'
            : '';

        // 솔라피 API Secret 마스킹
        const decryptedSolapiSecret = decryptApiKey(setting.solapi_api_secret, ENCRYPTION_KEY);
        const maskedSolapiSecret = decryptedSolapiSecret
            ? decryptedSolapiSecret.substring(0, 4) + '****'
            : '';

        res.json({
            message: '알림 설정 조회 성공',
            settings: {
                ...setting,
                naver_secret_key: maskedSecret,
                has_secret_key: !!setting.naver_secret_key,
                solapi_api_secret: maskedSolapiSecret,
                has_solapi_secret: !!setting.solapi_api_secret
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
            service_type,
            // SENS 설정
            naver_access_key,
            naver_secret_key,
            naver_service_id,
            sms_service_id,
            kakao_channel_id,
            template_code,
            template_content,
            // 솔라피 설정
            solapi_api_key,
            solapi_api_secret,
            solapi_pfid,
            solapi_sender_phone,
            solapi_template_id,
            solapi_template_content,
            // 공통 설정
            is_enabled,
            auto_send_day,
            auto_send_days,
            auto_send_hour
        } = req.body;

        // 기존 설정 확인
        const [existing] = await db.query(
            'SELECT id, naver_secret_key, solapi_api_secret FROM notification_settings WHERE academy_id = ?',
            [req.user.academyId]
        );

        // SENS Secret Key 처리 (새로 입력된 경우에만 암호화)
        let encryptedSecret = null;
        if (naver_secret_key && !naver_secret_key.includes('****')) {
            encryptedSecret = encryptApiKey(naver_secret_key, ENCRYPTION_KEY);
        } else if (existing.length > 0) {
            encryptedSecret = existing[0].naver_secret_key;
        }

        // 솔라피 API Secret 처리 (새로 입력된 경우에만 암호화)
        let encryptedSolapiSecret = null;
        if (solapi_api_secret && !solapi_api_secret.includes('****')) {
            encryptedSolapiSecret = encryptApiKey(solapi_api_secret, ENCRYPTION_KEY);
        } else if (existing.length > 0) {
            encryptedSolapiSecret = existing[0].solapi_api_secret;
        }

        if (existing.length === 0) {
            // 신규 생성
            await db.query(
                `INSERT INTO notification_settings
                (academy_id, service_type,
                 naver_access_key, naver_secret_key, naver_service_id, sms_service_id, kakao_channel_id,
                 solapi_api_key, solapi_api_secret, solapi_pfid, solapi_sender_phone, solapi_template_id, solapi_template_content,
                 template_code, template_content, is_enabled, auto_send_day, auto_send_days, auto_send_hour)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    req.user.academyId,
                    service_type || 'sens',
                    naver_access_key || null,
                    encryptedSecret,
                    naver_service_id || null,
                    sms_service_id || null,
                    kakao_channel_id || null,
                    solapi_api_key || null,
                    encryptedSolapiSecret,
                    solapi_pfid || null,
                    solapi_sender_phone || null,
                    solapi_template_id || null,
                    solapi_template_content || null,
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
                    service_type = ?,
                    naver_access_key = ?,
                    naver_secret_key = ?,
                    naver_service_id = ?,
                    sms_service_id = ?,
                    kakao_channel_id = ?,
                    solapi_api_key = ?,
                    solapi_api_secret = ?,
                    solapi_pfid = ?,
                    solapi_sender_phone = ?,
                    solapi_template_id = ?,
                    solapi_template_content = ?,
                    template_code = ?,
                    template_content = ?,
                    is_enabled = ?,
                    auto_send_day = ?,
                    auto_send_days = ?,
                    auto_send_hour = ?
                WHERE academy_id = ?`,
                [
                    service_type || 'sens',
                    naver_access_key || null,
                    encryptedSecret,
                    naver_service_id || null,
                    sms_service_id || null,
                    kakao_channel_id || null,
                    solapi_api_key || null,
                    encryptedSolapiSecret,
                    solapi_pfid || null,
                    solapi_sender_phone || null,
                    solapi_template_id || null,
                    solapi_template_content || null,
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
        const serviceType = setting.service_type || 'sens';

        // 학원 정보 조회
        const [academy] = await db.query(
            'SELECT name, phone FROM academies WHERE id = ?',
            [req.user.academyId]
        );

        // 납부일 문자열 생성 (기본값: 매월 5일)
        const dueDayText = '매월 5일';

        let result;
        let templateCode;
        let messageContent;

        if (serviceType === 'solapi') {
            // 솔라피 발송
            const decryptedSolapiSecret = decryptApiKey(setting.solapi_api_secret, ENCRYPTION_KEY);
            if (!decryptedSolapiSecret) {
                return res.status(400).json({
                    error: 'Configuration Error',
                    message: '솔라피 API Secret이 올바르지 않습니다.'
                });
            }

            // 테스트 메시지 생성 (솔라피 템플릿 사용)
            const testMessage = createUnpaidNotificationMessage(
                { month: '12', amount: 300000, due_date: dueDayText },
                { name: '테스트학생' },
                { name: academy[0]?.name || '테스트학원', phone: academy[0]?.phone || '02-1234-5678' },
                setting.solapi_template_content || setting.template_content
            );

            templateCode = setting.solapi_template_id;
            messageContent = testMessage.content;

            result = await sendAlimtalkSolapi(
                {
                    solapi_api_key: setting.solapi_api_key,
                    solapi_api_secret: decryptedSolapiSecret,
                    solapi_pfid: setting.solapi_pfid,
                    solapi_sender_phone: setting.solapi_sender_phone
                },
                setting.solapi_template_id,
                [{ phone, variables: testMessage.variables }]
            );
        } else {
            // SENS 발송 (기존 로직)
            const decryptedSecret = decryptApiKey(setting.naver_secret_key, ENCRYPTION_KEY);
            if (!decryptedSecret) {
                return res.status(400).json({
                    error: 'Configuration Error',
                    message: 'API Secret Key가 올바르지 않습니다.'
                });
            }

            // 테스트 메시지 발송
            const testMessage = createUnpaidNotificationMessage(
                { month: '12', amount: 300000, due_date: dueDayText },
                { name: '테스트학생' },
                { name: academy[0]?.name || '테스트학원', phone: academy[0]?.phone || '02-1234-5678' },
                setting.template_content
            );

            templateCode = setting.template_code;
            messageContent = testMessage.content;

            result = await sendAlimtalk(
                {
                    naver_access_key: setting.naver_access_key,
                    naver_secret_key: decryptedSecret,
                    naver_service_id: setting.naver_service_id,
                    kakao_channel_id: setting.kakao_channel_id
                },
                setting.template_code,
                [{ phone, content: testMessage.content, variables: testMessage.variables }]
            );
        }

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
                    templateCode,
                    messageContent,
                    'sent',
                    result.requestId || result.groupId
                ]
            );

            res.json({
                message: `테스트 메시지가 발송되었습니다. (${serviceType === 'solapi' ? '솔라피' : 'SENS'})`,
                success: true,
                requestId: result.requestId || result.groupId
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
        const serviceType = setting.service_type || 'sens';

        // 서비스 타입에 따라 Secret Key 복호화
        let decryptedSecret = null;
        let decryptedSolapiSecret = null;

        if (serviceType === 'solapi') {
            decryptedSolapiSecret = decryptApiKey(setting.solapi_api_secret, ENCRYPTION_KEY);
            if (!decryptedSolapiSecret) {
                return res.status(400).json({
                    error: 'Configuration Error',
                    message: '솔라피 API Secret이 올바르지 않습니다.'
                });
            }
        } else {
            decryptedSecret = decryptApiKey(setting.naver_secret_key, ENCRYPTION_KEY);
            if (!decryptedSecret) {
                return res.status(400).json({
                    error: 'Configuration Error',
                    message: 'API Secret Key가 올바르지 않습니다.'
                });
            }
        }

        // 학원 정보
        const [academy] = await db.query(
            'SELECT name, phone FROM academies WHERE id = ?',
            [req.user.academyId]
        );

        // 납부일 문자열 생성 (기본값: 매월 5일)
        const dueDayText = '매월 5일';

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

        // 서비스 타입에 따라 템플릿 선택
        const templateContent = serviceType === 'solapi'
            ? (setting.solapi_template_content || setting.template_content)
            : setting.template_content;
        const templateCode = serviceType === 'solapi'
            ? setting.solapi_template_id
            : setting.template_code;

        // 메시지 준비
        const recipients = validRecipients.map(p => {
            const msg = createUnpaidNotificationMessage(
                {
                    month: month.toString(),
                    amount: p.amount,
                    due_date: dueDayText  // 학원 설정의 납부일 사용
                },
                { name: p.student_name },
                { name: academy[0]?.name || '', phone: academy[0]?.phone || '' },
                templateContent
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

            let result;
            if (serviceType === 'solapi') {
                // 솔라피 발송
                result = await sendAlimtalkSolapi(
                    {
                        solapi_api_key: setting.solapi_api_key,
                        solapi_api_secret: decryptedSolapiSecret,
                        solapi_pfid: setting.solapi_pfid,
                        solapi_sender_phone: setting.solapi_sender_phone
                    },
                    templateCode,
                    batch
                );
            } else {
                // SENS 발송
                result = await sendAlimtalk(
                    {
                        naver_access_key: setting.naver_access_key,
                        naver_secret_key: decryptedSecret,
                        naver_service_id: setting.naver_service_id,
                        kakao_channel_id: setting.kakao_channel_id
                    },
                    templateCode,
                    batch
                );
            }

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
                        templateCode,
                        recipient.content,
                        result.success ? 'sent' : 'failed',
                        result.requestId || result.groupId || null,
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
            message: `알림 발송 완료 (${serviceType === 'solapi' ? '솔라피' : 'SENS'}): ${sentCount}명 성공, ${failedCount}명 실패`,
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
        const serviceType = setting.service_type || 'sens';

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

        // 납부일 문자열 생성 (기본값: 매월 5일)
        const dueDayText = '매월 5일';

        // 서비스 타입에 따라 템플릿 선택
        const templateContent = serviceType === 'solapi'
            ? (setting.solapi_template_content || setting.template_content)
            : setting.template_content;
        const templateCode = serviceType === 'solapi'
            ? setting.solapi_template_id
            : setting.template_code;

        // 메시지 생성 (year_month에서 월 추출: "2025-12" -> "12")
        const monthFromYearMonth = payment.year_month ? payment.year_month.split('-')[1] : '';
        const msg = createUnpaidNotificationMessage(
            {
                month: monthFromYearMonth,
                amount: payment.amount,
                due_date: dueDayText  // 학원 설정의 납부일 사용
            },
            { name: payment.student_name },
            { name: academy[0]?.name || '', phone: academy[0]?.phone || '' },
            templateContent
        );

        // 서비스 타입에 따라 발송
        let result;
        if (serviceType === 'solapi') {
            const decryptedSolapiSecret = decryptApiKey(setting.solapi_api_secret, ENCRYPTION_KEY);
            result = await sendAlimtalkSolapi(
                {
                    solapi_api_key: setting.solapi_api_key,
                    solapi_api_secret: decryptedSolapiSecret,
                    solapi_pfid: setting.solapi_pfid,
                    solapi_sender_phone: setting.solapi_sender_phone
                },
                templateCode,
                [{ phone: effectivePhone, variables: msg.variables }]
            );
        } else {
            const decryptedSecret = decryptApiKey(setting.naver_secret_key, ENCRYPTION_KEY);
            result = await sendAlimtalk(
                {
                    naver_access_key: setting.naver_access_key,
                    naver_secret_key: decryptedSecret,
                    naver_service_id: setting.naver_service_id,
                    kakao_channel_id: setting.kakao_channel_id
                },
                templateCode,
                [{
                    phone: effectivePhone,
                    content: msg.content,
                    variables: msg.variables
                }]
            );
        }

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
                effectivePhone,
                'alimtalk',
                templateCode,
                msg.content,
                result.success ? 'sent' : 'failed',
                result.requestId || result.groupId || null,
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

/**
 * SMS 발송 API 라우트
 * 공지, 안내 등 일반 문자 발송 기능
 */

const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { verifyToken, checkPermission } = require('../middleware/auth');
const {
    decryptApiKey,
    sendSMS,
    isValidPhoneNumber
} = require('../utils/naverSens');

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'paca-notification-secret-key-2024';

/**
 * POST /paca/sms/send
 * SMS 발송
 * body: { target: 'all' | 'students' | 'parents' | 'custom', content, customPhones?: [] }
 */
router.post('/send', verifyToken, checkPermission('settings', 'edit'), async (req, res) => {
    try {
        const { target, content, customPhones } = req.body;

        if (!content || content.trim().length === 0) {
            return res.status(400).json({
                error: 'Validation Error',
                message: '문자 내용을 입력해주세요.'
            });
        }

        // 알림톡 설정에서 API 키 가져오기 (같은 SENS 서비스 사용)
        const [settings] = await db.query(
            'SELECT * FROM notification_settings WHERE academy_id = ?',
            [req.user.academyId]
        );

        if (settings.length === 0) {
            return res.status(400).json({
                error: 'Configuration Error',
                message: '알림톡 설정을 먼저 완료해주세요. (설정 > 알림톡 설정)'
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

        // 학원 정보에서 발신번호 가져오기
        const [academy] = await db.query(
            'SELECT phone FROM academies WHERE id = ?',
            [req.user.academyId]
        );

        if (!academy[0]?.phone) {
            return res.status(400).json({
                error: 'Configuration Error',
                message: '학원 전화번호가 설정되지 않았습니다. 설정 > 학원 기본 정보에서 전화번호를 입력해주세요.'
            });
        }

        const fromPhone = academy[0].phone;

        // 수신자 목록 조회
        let recipients = [];

        if (target === 'custom' && customPhones && customPhones.length > 0) {
            // 직접 입력한 전화번호
            recipients = customPhones
                .filter(phone => isValidPhoneNumber(phone))
                .map(phone => ({ phone, name: '직접입력' }));
        } else {
            // 학생/학부모 전화번호 조회
            let query = `
                SELECT
                    s.id,
                    s.name,
                    s.phone AS student_phone,
                    s.parent_phone
                FROM students s
                WHERE s.academy_id = ?
                  AND s.status = 'active'
                  AND s.deleted_at IS NULL
            `;

            const [students] = await db.query(query, [req.user.academyId]);

            if (target === 'all') {
                // 모두: 학부모 전화 우선, 없으면 학생 전화
                recipients = students
                    .map(s => {
                        const phone = isValidPhoneNumber(s.parent_phone) ? s.parent_phone :
                                     isValidPhoneNumber(s.student_phone) ? s.student_phone : null;
                        return phone ? { phone, name: s.name, studentId: s.id } : null;
                    })
                    .filter(Boolean);
            } else if (target === 'students') {
                // 학생에게만
                recipients = students
                    .filter(s => isValidPhoneNumber(s.student_phone))
                    .map(s => ({ phone: s.student_phone, name: s.name, studentId: s.id }));
            } else if (target === 'parents') {
                // 학부모에게만
                recipients = students
                    .filter(s => isValidPhoneNumber(s.parent_phone))
                    .map(s => ({ phone: s.parent_phone, name: s.name, studentId: s.id }));
            }
        }

        // 중복 제거
        const uniquePhones = new Map();
        recipients.forEach(r => {
            const normalizedPhone = r.phone.replace(/-/g, '');
            if (!uniquePhones.has(normalizedPhone)) {
                uniquePhones.set(normalizedPhone, r);
            }
        });
        recipients = Array.from(uniquePhones.values());

        if (recipients.length === 0) {
            return res.json({
                message: '발송할 수신자가 없습니다.',
                sent: 0,
                failed: 0
            });
        }

        // SMS 발송 (배치로 처리, 최대 100명씩)
        const batchSize = 100;
        let sentCount = 0;
        let failedCount = 0;

        for (let i = 0; i < recipients.length; i += batchSize) {
            const batch = recipients.slice(i, i + batchSize);

            const result = await sendSMS(
                {
                    naver_access_key: setting.naver_access_key,
                    naver_secret_key: decryptedSecret,
                    naver_service_id: setting.naver_service_id
                },
                fromPhone,
                batch,
                content
            );

            // 로그 기록
            for (const recipient of batch) {
                await db.query(
                    `INSERT INTO notification_logs
                    (academy_id, student_id, recipient_name, recipient_phone,
                     message_type, message_content, status, request_id,
                     error_message, sent_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
                    [
                        req.user.academyId,
                        recipient.studentId || null,
                        recipient.name,
                        recipient.phone,
                        'sms',
                        content,
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
            message: `문자 발송 완료: ${sentCount}명 성공, ${failedCount}명 실패`,
            sent: sentCount,
            failed: failedCount,
            total: recipients.length
        });
    } catch (error) {
        console.error('SMS 발송 오류:', error);
        res.status(500).json({
            error: 'Server Error',
            message: error.message || 'SMS 발송에 실패했습니다.'
        });
    }
});

/**
 * GET /paca/sms/recipients-count
 * 대상별 수신자 수 조회
 */
router.get('/recipients-count', verifyToken, async (req, res) => {
    try {
        // 활성 학생 목록 조회
        const [students] = await db.query(
            `SELECT
                s.phone AS student_phone,
                s.parent_phone
            FROM students s
            WHERE s.academy_id = ?
              AND s.status = 'active'
              AND s.deleted_at IS NULL`,
            [req.user.academyId]
        );

        // 각 카테고리별 유효한 전화번호 수 계산
        const studentPhones = new Set();
        const parentPhones = new Set();
        const allPhones = new Set();

        students.forEach(s => {
            if (isValidPhoneNumber(s.student_phone)) {
                studentPhones.add(s.student_phone.replace(/-/g, ''));
            }
            if (isValidPhoneNumber(s.parent_phone)) {
                parentPhones.add(s.parent_phone.replace(/-/g, ''));
            }
            // 모두: 학부모 우선, 없으면 학생
            const effectivePhone = isValidPhoneNumber(s.parent_phone) ? s.parent_phone :
                                   isValidPhoneNumber(s.student_phone) ? s.student_phone : null;
            if (effectivePhone) {
                allPhones.add(effectivePhone.replace(/-/g, ''));
            }
        });

        res.json({
            all: allPhones.size,
            students: studentPhones.size,
            parents: parentPhones.size
        });
    } catch (error) {
        console.error('수신자 수 조회 오류:', error);
        res.status(500).json({
            error: 'Server Error',
            message: '수신자 수 조회에 실패했습니다.'
        });
    }
});

/**
 * GET /paca/sms/logs
 * SMS 발송 내역 조회
 */
router.get('/logs', verifyToken, async (req, res) => {
    try {
        const { page = 1, limit = 20 } = req.query;
        const offset = (page - 1) * limit;

        // 총 개수
        const [countResult] = await db.query(
            `SELECT COUNT(*) AS total FROM notification_logs
             WHERE academy_id = ? AND message_type = 'sms'`,
            [req.user.academyId]
        );

        // 로그 목록
        const [logs] = await db.query(
            `SELECT * FROM notification_logs
             WHERE academy_id = ? AND message_type = 'sms'
             ORDER BY created_at DESC
             LIMIT ? OFFSET ?`,
            [req.user.academyId, parseInt(limit), offset]
        );

        res.json({
            logs,
            pagination: {
                total: countResult[0].total,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(countResult[0].total / limit)
            }
        });
    } catch (error) {
        console.error('SMS 로그 조회 오류:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'SMS 발송 내역 조회에 실패했습니다.'
        });
    }
});

module.exports = router;

/**
 * Naver Cloud SENS API 유틸리티
 * KakaoTalk 알림톡 발송을 위한 API 호출 함수들
 */

const crypto = require('crypto');
const axios = require('axios');

const SENS_API_URL = 'https://sens.apigw.ntruss.com';

/**
 * HMAC-SHA256 서명 생성
 * Naver Cloud API 인증에 필요
 */
function generateSignature(method, url, timestamp, accessKey, secretKey) {
    const space = ' ';
    const newLine = '\n';

    const message = [
        method,
        space,
        url,
        newLine,
        timestamp,
        newLine,
        accessKey
    ].join('');

    const hmac = crypto.createHmac('sha256', secretKey);
    hmac.update(message);
    return hmac.digest('base64');
}

/**
 * API 키 암호화 (DB 저장용)
 */
function encryptApiKey(text, encryptionKey) {
    if (!text) return null;

    const iv = crypto.randomBytes(16);
    const key = crypto.scryptSync(encryptionKey, 'salt', 32);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    return iv.toString('hex') + ':' + encrypted;
}

/**
 * API 키 복호화 (DB에서 읽을 때)
 */
function decryptApiKey(encryptedText, encryptionKey) {
    if (!encryptedText) return null;

    try {
        const parts = encryptedText.split(':');
        if (parts.length !== 2) return null;

        const iv = Buffer.from(parts[0], 'hex');
        const encrypted = parts[1];
        const key = crypto.scryptSync(encryptionKey, 'salt', 32);
        const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);

        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');

        return decrypted;
    } catch (error) {
        console.error('Decryption error:', error);
        return null;
    }
}

/**
 * 알림톡 발송
 * @param {Object} settings - 알림 설정 (API 키 등)
 * @param {string} templateCode - 승인받은 템플릿 코드
 * @param {Array} recipients - 수신자 목록 [{phone, variables}]
 * @returns {Object} - 발송 결과
 */
async function sendAlimtalk(settings, templateCode, recipients) {
    const {
        naver_access_key: accessKey,
        naver_secret_key: secretKey,
        naver_service_id: serviceId,
        kakao_channel_id: channelId
    } = settings;

    if (!accessKey || !secretKey || !serviceId || !channelId) {
        throw new Error('알림톡 설정이 완료되지 않았습니다. API 키와 채널 ID를 확인해주세요.');
    }

    const timestamp = Date.now().toString();
    const uri = `/alimtalk/v2/services/${serviceId}/messages`;
    const signature = generateSignature('POST', uri, timestamp, accessKey, secretKey);

    // 메시지 구성
    const messages = recipients.map(r => ({
        countryCode: '82',
        to: r.phone.replace(/^0/, '').replace(/-/g, ''),  // 010-1234-5678 -> 1012345678
        content: r.content || '',  // 템플릿 변수가 치환된 내용
        ...(r.variables && { templateParameter: r.variables })  // 템플릿 변수
    }));

    const body = {
        plusFriendId: channelId,
        templateCode: templateCode,
        messages: messages
    };

    try {
        const response = await axios.post(
            `${SENS_API_URL}${uri}`,
            body,
            {
                headers: {
                    'Content-Type': 'application/json; charset=utf-8',
                    'x-ncp-apigw-timestamp': timestamp,
                    'x-ncp-iam-access-key': accessKey,
                    'x-ncp-apigw-signature-v2': signature
                }
            }
        );

        return {
            success: true,
            requestId: response.data.requestId,
            requestTime: response.data.requestTime,
            statusCode: response.data.statusCode,
            statusName: response.data.statusName
        };
    } catch (error) {
        console.error('알림톡 발송 오류:', error.response?.data || error.message);

        return {
            success: false,
            error: error.response?.data?.error || error.message,
            statusCode: error.response?.status || 500
        };
    }
}

/**
 * 알림톡 템플릿에 변수 치환
 * @param {string} template - 템플릿 내용
 * @param {Object} variables - 변수 객체 {학원명: '파파체대', 학생명: '홍길동', ...}
 * @returns {string} - 치환된 내용
 */
function replaceTemplateVariables(template, variables) {
    let result = template;
    for (const [key, value] of Object.entries(variables)) {
        result = result.replace(new RegExp(`#{${key}}`, 'g'), value || '');
    }
    return result;
}

/**
 * 미납 알림 메시지 생성
 * @param {Object} payment - 학원비 정보
 * @param {Object} student - 학생 정보
 * @param {Object} academy - 학원 정보
 * @param {string} customTemplate - 사용자 정의 템플릿 (선택)
 * @returns {Object} - {content, variables}
 */
function createUnpaidNotificationMessage(payment, student, academy, customTemplate) {
    // 변수 매핑 (다양한 변수명 지원)
    const variables = {
        // 학생 관련
        '이름': student.name || '',
        '학생명': student.name || '',
        // 학원 관련
        '학원명': academy.name || '',
        '학원전화': academy.phone || '',
        // 납부 관련
        '월': payment.month || '',
        '교육비': payment.amount ? payment.amount.toLocaleString() : '0',
        '날짜': payment.due_date || '',
        '납부기한': payment.due_date || ''
    };

    // 사용자 정의 템플릿이 있으면 사용, 없으면 기본 템플릿
    const template = customTemplate || `[#{학원명}] 학원비 납부 안내

안녕하세요, #{학생명} 학부모님.

#{월}월 학원비 #{교육비}원이 아직 납부되지 않았습니다.

납부기한: #{납부기한}

문의: #{학원전화}

※ 이미 납부하셨다면 이 메시지는 무시해주세요.`;

    return {
        content: replaceTemplateVariables(template, variables),
        variables
    };
}

/**
 * 전화번호 유효성 검사
 */
function isValidPhoneNumber(phone) {
    if (!phone) return false;
    const cleaned = phone.replace(/-/g, '');
    return /^01[0-9]{8,9}$/.test(cleaned);
}

/**
 * SMS 발송
 * @param {Object} settings - API 설정 (access_key, secret_key, service_id)
 * @param {string} from - 발신번호 (SENS에 등록된 번호)
 * @param {Array} recipients - 수신자 목록 [{phone}]
 * @param {string} content - 문자 내용
 * @param {string} type - SMS (80bytes), LMS (2000bytes)
 * @returns {Object} - 발송 결과
 */
async function sendSMS(settings, from, recipients, content, type = 'SMS') {
    const {
        naver_access_key: accessKey,
        naver_secret_key: secretKey,
        naver_service_id: serviceId
    } = settings;

    if (!accessKey || !secretKey || !serviceId) {
        throw new Error('SMS 설정이 완료되지 않았습니다. API 키를 확인해주세요.');
    }

    if (!from) {
        throw new Error('발신번호가 설정되지 않았습니다. 학원 설정에서 전화번호를 확인해주세요.');
    }

    const timestamp = Date.now().toString();
    const uri = `/sms/v2/services/${serviceId}/messages`;
    const signature = generateSignature('POST', uri, timestamp, accessKey, secretKey);

    // 메시지 구성
    const messages = recipients.map(r => ({
        to: r.phone.replace(/^0/, '').replace(/-/g, '')  // 010-1234-5678 -> 1012345678
    }));

    // 80바이트 초과시 자동으로 LMS로 변경
    const contentBytes = Buffer.byteLength(content, 'utf8');
    const messageType = contentBytes > 80 ? 'LMS' : (type || 'SMS');

    const body = {
        type: messageType,
        contentType: 'COMM',  // 일반 메시지
        countryCode: '82',
        from: from.replace(/-/g, ''),  // 발신번호 (하이픈 제거)
        content: content,
        messages: messages
    };

    try {
        const response = await axios.post(
            `${SENS_API_URL}${uri}`,
            body,
            {
                headers: {
                    'Content-Type': 'application/json; charset=utf-8',
                    'x-ncp-apigw-timestamp': timestamp,
                    'x-ncp-iam-access-key': accessKey,
                    'x-ncp-apigw-signature-v2': signature
                }
            }
        );

        return {
            success: true,
            requestId: response.data.requestId,
            requestTime: response.data.requestTime,
            statusCode: response.data.statusCode,
            statusName: response.data.statusName,
            messageType: messageType
        };
    } catch (error) {
        console.error('SMS 발송 오류:', error.response?.data || error.message);

        return {
            success: false,
            error: error.response?.data?.error || error.message,
            statusCode: error.response?.status || 500
        };
    }
}

/**
 * MMS 발송 (이미지 첨부)
 * @param {Object} settings - API 설정 (access_key, secret_key, service_id)
 * @param {string} from - 발신번호 (SENS에 등록된 번호)
 * @param {Array} recipients - 수신자 목록 [{phone}]
 * @param {string} content - 문자 내용
 * @param {Array} images - 이미지 배열 [{name: 'image.jpg', data: 'base64string'}] (최대 3장)
 * @returns {Object} - 발송 결과
 */
async function sendMMS(settings, from, recipients, content, images = []) {
    const {
        naver_access_key: accessKey,
        naver_secret_key: secretKey,
        naver_service_id: serviceId
    } = settings;

    if (!accessKey || !secretKey || !serviceId) {
        throw new Error('SMS 설정이 완료되지 않았습니다. API 키를 확인해주세요.');
    }

    if (!from) {
        throw new Error('발신번호가 설정되지 않았습니다. 학원 설정에서 전화번호를 확인해주세요.');
    }

    if (!images || images.length === 0) {
        throw new Error('MMS는 이미지가 필요합니다.');
    }

    if (images.length > 3) {
        throw new Error('이미지는 최대 3장까지 첨부 가능합니다.');
    }

    const timestamp = Date.now().toString();
    const uri = `/sms/v2/services/${serviceId}/messages`;
    const signature = generateSignature('POST', uri, timestamp, accessKey, secretKey);

    // 메시지 구성
    const messages = recipients.map(r => ({
        to: r.phone.replace(/^0/, '').replace(/-/g, '')  // 010-1234-5678 -> 1012345678
    }));

    // 이미지 파일 구성
    const files = images.map(img => ({
        name: img.name,
        body: img.data  // base64 인코딩된 이미지
    }));

    const body = {
        type: 'MMS',
        contentType: 'COMM',  // 일반 메시지
        countryCode: '82',
        from: from.replace(/-/g, ''),  // 발신번호 (하이픈 제거)
        content: content,
        messages: messages,
        files: files
    };

    try {
        const response = await axios.post(
            `${SENS_API_URL}${uri}`,
            body,
            {
                headers: {
                    'Content-Type': 'application/json; charset=utf-8',
                    'x-ncp-apigw-timestamp': timestamp,
                    'x-ncp-iam-access-key': accessKey,
                    'x-ncp-apigw-signature-v2': signature
                }
            }
        );

        return {
            success: true,
            requestId: response.data.requestId,
            requestTime: response.data.requestTime,
            statusCode: response.data.statusCode,
            statusName: response.data.statusName,
            messageType: 'MMS'
        };
    } catch (error) {
        console.error('MMS 발송 오류:', error.response?.data || error.message);

        return {
            success: false,
            error: error.response?.data?.error || error.response?.data?.errorMessage || error.message,
            statusCode: error.response?.status || 500
        };
    }
}

module.exports = {
    generateSignature,
    encryptApiKey,
    decryptApiKey,
    sendAlimtalk,
    sendSMS,
    sendMMS,
    replaceTemplateVariables,
    createUnpaidNotificationMessage,
    isValidPhoneNumber
};

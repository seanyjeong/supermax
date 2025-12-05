/**
 * Solapi API 유틸리티
 * KakaoTalk 알림톡 및 SMS/MMS 발송을 위한 API 호출 함수들
 *
 * 솔라피 API 문서: https://docs.solapi.com/
 */

const crypto = require('crypto');
const axios = require('axios');

const SOLAPI_API_URL = 'https://api.solapi.com';

/**
 * HMAC-SHA256 서명 생성 (솔라피용)
 * @param {string} apiKey - API Key
 * @param {string} apiSecret - API Secret
 * @param {string} date - ISO 8601 형식의 날짜
 * @param {string} salt - 랜덤 문자열
 * @returns {string} - 서명
 */
function generateSolapiSignature(apiSecret, date, salt) {
    const message = date + salt;
    const hmac = crypto.createHmac('sha256', apiSecret);
    hmac.update(message);
    return hmac.digest('hex');
}

/**
 * 솔라피 인증 헤더 생성
 * @param {string} apiKey - API Key
 * @param {string} apiSecret - API Secret
 * @returns {Object} - Authorization 헤더
 */
function getSolapiAuthHeader(apiKey, apiSecret) {
    const date = new Date().toISOString();
    const salt = crypto.randomBytes(32).toString('hex');
    const signature = generateSolapiSignature(apiSecret, date, salt);

    return {
        'Authorization': `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`,
        'Content-Type': 'application/json'
    };
}

/**
 * 알림톡 발송 (솔라피)
 * @param {Object} settings - 솔라피 설정
 * @param {string} templateId - 템플릿 ID
 * @param {Array} recipients - 수신자 목록 [{phone, variables}]
 * @returns {Object} - 발송 결과
 */
async function sendAlimtalkSolapi(settings, templateId, recipients) {
    const {
        solapi_api_key: apiKey,
        solapi_api_secret: apiSecret,
        solapi_pfid: pfId  // 카카오 채널 ID
    } = settings;

    if (!apiKey || !apiSecret || !pfId) {
        throw new Error('솔라피 알림톡 설정이 완료되지 않았습니다. API 키와 채널 ID를 확인해주세요.');
    }

    const headers = getSolapiAuthHeader(apiKey, apiSecret);

    // 메시지 구성
    // 솔라피는 variables가 아니라 text에 변수가 치환된 전체 내용을 보내야 함
    const messages = recipients.map(r => ({
        to: r.phone.replace(/-/g, ''),  // 010-1234-5678 -> 01012345678
        from: settings.solapi_sender_phone?.replace(/-/g, '') || '',  // 발신번호
        text: r.content || '',  // 변수가 치환된 전체 메시지 내용
        kakaoOptions: {
            pfId: pfId,
            templateId: templateId
        }
    }));

    const body = {
        messages: messages
    };

    try {
        const response = await axios.post(
            `${SOLAPI_API_URL}/messages/v4/send-many/detail`,
            body,
            { headers }
        );

        return {
            success: true,
            groupId: response.data.groupId,
            messageId: response.data.messageId,
            to: response.data.to,
            statusCode: response.data.statusCode,
            statusMessage: response.data.statusMessage
        };
    } catch (error) {
        console.error('솔라피 알림톡 발송 오류:', error.response?.data || error.message);

        return {
            success: false,
            error: error.response?.data?.errorMessage || error.response?.data?.message || error.message,
            statusCode: error.response?.status || 500
        };
    }
}

/**
 * SMS 발송 (솔라피)
 * @param {Object} settings - 솔라피 설정
 * @param {Array} recipients - 수신자 목록 [{phone}]
 * @param {string} content - 문자 내용
 * @param {string} type - SMS (90bytes), LMS (2000bytes)
 * @returns {Object} - 발송 결과
 */
async function sendSMSSolapi(settings, recipients, content, type = 'SMS') {
    const {
        solapi_api_key: apiKey,
        solapi_api_secret: apiSecret,
        solapi_sender_phone: from
    } = settings;

    if (!apiKey || !apiSecret) {
        throw new Error('솔라피 SMS 설정이 완료되지 않았습니다. API 키를 확인해주세요.');
    }

    if (!from) {
        throw new Error('발신번호가 설정되지 않았습니다. 솔라피 설정에서 발신번호를 확인해주세요.');
    }

    const headers = getSolapiAuthHeader(apiKey, apiSecret);

    // 90바이트 초과시 자동으로 LMS로 변경
    const contentBytes = Buffer.byteLength(content, 'utf8');
    const messageType = contentBytes > 90 ? 'LMS' : (type || 'SMS');

    // 메시지 구성
    const messages = recipients.map(r => ({
        to: r.phone.replace(/-/g, ''),
        from: from.replace(/-/g, ''),
        text: content,
        type: messageType
    }));

    const body = {
        messages: messages
    };

    try {
        const response = await axios.post(
            `${SOLAPI_API_URL}/messages/v4/send-many/detail`,
            body,
            { headers }
        );

        return {
            success: true,
            groupId: response.data.groupId,
            messageType: messageType
        };
    } catch (error) {
        console.error('솔라피 SMS 발송 오류:', error.response?.data || error.message);

        return {
            success: false,
            error: error.response?.data?.errorMessage || error.response?.data?.message || error.message,
            statusCode: error.response?.status || 500
        };
    }
}

/**
 * MMS 발송 (솔라피)
 * @param {Object} settings - 솔라피 설정
 * @param {Array} recipients - 수신자 목록 [{phone}]
 * @param {string} content - 문자 내용
 * @param {Array} images - 이미지 배열 [{name: 'image.jpg', data: 'base64string'}]
 * @returns {Object} - 발송 결과
 */
async function sendMMSSolapi(settings, recipients, content, images = []) {
    const {
        solapi_api_key: apiKey,
        solapi_api_secret: apiSecret,
        solapi_sender_phone: from
    } = settings;

    if (!apiKey || !apiSecret) {
        throw new Error('솔라피 MMS 설정이 완료되지 않았습니다. API 키를 확인해주세요.');
    }

    if (!from) {
        throw new Error('발신번호가 설정되지 않았습니다.');
    }

    if (!images || images.length === 0) {
        throw new Error('MMS는 이미지가 필요합니다.');
    }

    const headers = getSolapiAuthHeader(apiKey, apiSecret);

    // 이미지 업로드 먼저 수행
    const imageIds = [];
    for (const img of images) {
        try {
            const uploadResponse = await axios.post(
                `${SOLAPI_API_URL}/storage/v1/files`,
                {
                    file: img.data,  // base64 데이터
                    type: 'MMS'
                },
                { headers }
            );
            imageIds.push(uploadResponse.data.fileId);
        } catch (uploadError) {
            console.error('이미지 업로드 실패:', uploadError.response?.data || uploadError.message);
        }
    }

    // 메시지 구성
    const messages = recipients.map(r => ({
        to: r.phone.replace(/-/g, ''),
        from: from.replace(/-/g, ''),
        text: content,
        type: 'MMS',
        imageId: imageIds[0] || null  // 첫 번째 이미지
    }));

    const body = {
        messages: messages
    };

    try {
        const response = await axios.post(
            `${SOLAPI_API_URL}/messages/v4/send-many/detail`,
            body,
            { headers }
        );

        return {
            success: true,
            groupId: response.data.groupId,
            messageType: 'MMS'
        };
    } catch (error) {
        console.error('솔라피 MMS 발송 오류:', error.response?.data || error.message);

        return {
            success: false,
            error: error.response?.data?.errorMessage || error.response?.data?.message || error.message,
            statusCode: error.response?.status || 500
        };
    }
}

/**
 * 잔액 조회 (솔라피)
 * @param {Object} settings - 솔라피 설정
 * @returns {Object} - 잔액 정보
 */
async function getBalanceSolapi(settings) {
    const {
        solapi_api_key: apiKey,
        solapi_api_secret: apiSecret
    } = settings;

    if (!apiKey || !apiSecret) {
        throw new Error('솔라피 설정이 완료되지 않았습니다.');
    }

    const headers = getSolapiAuthHeader(apiKey, apiSecret);

    try {
        const response = await axios.get(
            `${SOLAPI_API_URL}/cash/v1/balance`,
            { headers }
        );

        return {
            success: true,
            balance: response.data.balance,
            point: response.data.point
        };
    } catch (error) {
        console.error('솔라피 잔액 조회 오류:', error.response?.data || error.message);

        return {
            success: false,
            error: error.response?.data?.errorMessage || error.message
        };
    }
}

module.exports = {
    generateSolapiSignature,
    getSolapiAuthHeader,
    sendAlimtalkSolapi,
    sendSMSSolapi,
    sendMMSSolapi,
    getBalanceSolapi
};

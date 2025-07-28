// 파일 이름: test_sens.js

const crypto = require('crypto');
const axios = require('axios');

// ======== 네 정보가 올바른지 마지막으로 확인! ========
const NAVER_ACCESS_KEY = 'A8zINaiL6JjWUNbT1uDB';
const NAVER_SECRET_KEY = 'eA958IeOvpxWQI1vYYA9GcXSeVFQYMEv4gCtEorW';
const SERVICE_ID = 'ncp:sms:kr:284240549231:sean';
const FROM_PHONE = '01021446765';
const TO_PHONE = '01021446765'; // 테스트 문자를 받을 본인 전화번호
// ====================================================

function makeSignature(method, url, timestamp, accessKey, secretKey) {
    console.log(`[시그니처 생성 시작] secretKey 타입: ${typeof secretKey}`);
    if (typeof secretKey !== 'string' || !secretKey) {
        throw new Error('Secret Key가 유효하지 않습니다. 값과 타입을 확인하세요.');
    }
    const space = " ";
    const newLine = "\n";
    const message = [];
    message.push(method);
    message.push(space);
    message.push(url);
    message.push(newLine);
    message.push(timestamp);
    message.push(newLine);
    message.push(accessKey);

    const hmac = crypto.createHmac('sha256', secretKey);
    const signature = hmac.update(message.join('')).digest('base64');
    console.log(`[시그니처 생성 완료]`);
    return signature;
}

async function sendTestSms() {
    console.log('--- SMS 발송 테스트 시작 ---');
    try {
        const code = Math.floor(1000 + Math.random() * 9000).toString();
        const timestamp = Date.now().toString();
        const url = `/sms/v2/services/${SERVICE_ID}/messages`;
        
        console.log(`사용될 Access Key: ${NAVER_ACCESS_KEY}`);
        
        const signature = makeSignature('POST', url, timestamp, NAVER_ACCESS_KEY, NAVER_SECRET_KEY);

        const response = await axios({
            method: 'POST',
            url: `https://sens.apigw.ntruss.com${url}`,
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'x-ncp-apigw-timestamp': timestamp,
                'x-ncp-iam-access-key': NAVER_ACCESS_KEY,
                'x-ncp-apigw-signature-v2': signature,
            },
            data: {
                type: 'SMS',
                from: FROM_PHONE,
                content: `[테스트] 인증번호 [${code}] 발송 테스트입니다.`,
                messages: [{ to: TO_PHONE }],
            },
        });

        console.log('✅✅✅ SMS 발송 성공! ✅✅✅');
        console.log('응답 데이터:', response.data);

    } catch (error) {
        console.error('❌❌❌ SMS 발송 실패! ❌❌❌');
        if (error.response) {
            console.error('에러 응답 상태:', error.response.status);
            console.error('에러 응답 데이터:', error.response.data);
        } else {
            console.error('에러 메시지:', error.message);
        }
    }
}

// 테스트 함수 실행
sendTestSms();
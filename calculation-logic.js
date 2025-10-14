// 파일 이름: calculation-logic.js

function calculateFinalScore(대학ID, 종목별점수, 내신점수, config, 종목별감수) {
    const 환산방식 = config.환산방식 || '단순합산';
    let 실기총점 = 0;
    let 총감수 = 0;

    const rawSum = Object.values(종목별점수).reduce((sum, score) => sum + (Number(score) || 0), 0);
    const rawGamSum = Object.values(종목별감수).reduce((sum, gam) => sum + (Number(gam) || 0), 0);

    switch (환산방식) {
        case '특수식':
            총감수 = rawGamSum;

            switch (Number(대학ID)) {
                // [규칙] 단순합산 + 기본점수 20점
                case 121:
                    실기총점 = rawSum + 20;
                    break;
                 case 257:
                 case 259:
                    const X = rawSum;
                    if (X === 0) {
                        실기총점 = 0;
                    } else {
                        실기총점 = (X / 3 - 80) * (7 / 6) + 560;
                    }
                    break;
                case 260:
                    const Y = rawSum;
                    if (Y === 0) {
                        실기총점 = 0;
                    } else {
                        실기총점 = (Y / 2 - 80) + 480;
                    }
                    break;

                // ▼▼▼▼▼ 여기가 핵심 수정 부분 ▼▼▼▼▼

                // [신규 규칙] ID 238: 기본점수 80 + ((상위 3종목 합) / 3 * 3.2)
                case 238:
                    { // 변수 스코프를 위해 중괄호 추가
                        const eventData = Object.keys(종목별점수).map(name => ({ name, score: Number(종목별점수[name]) || 0, gam: Number(종목별감수[name]) || 0 }));
                        eventData.sort((a, b) => b.score - a.score);
                        const top3Events = eventData.slice(0, 3);
                        const top3Sum = top3Events.reduce((sum, event) => sum + event.score, 0);
                        총감수 = top3Events.reduce((sum, event) => sum + event.gam, 0);
                        
                        실기총점 = 80 + ((top3Sum / 3) * 3.2);
                        break;
                    }

                // [신규 규칙] ID 232, 242: 기본점수 160 + ((상위 3종목 합) / 3 * 6.4)
                case 232:
                case 242:
                    { // 변수 스코프를 위해 중괄호 추가
                        const eventData = Object.keys(종목별점수).map(name => ({ name, score: Number(종목별점수[name]) || 0, gam: Number(종목별감수[name]) || 0 }));
                        eventData.sort((a, b) => b.score - a.score);
                        const top3Events = eventData.slice(0, 3);
                        const top3Sum = top3Events.reduce((sum, event) => sum + event.score, 0);
                        총감수 = top3Events.reduce((sum, event) => sum + event.gam, 0);

                        실기총점 = 160 + ((top3Sum / 3) * 6.4);
                        break;
                    }

                // [기존 규칙 유지] ID 209, 206: 상위 3개 종목 합산 후 비율 환산
                case 209:
                case 206:
                    {
                        const eventData = Object.keys(종목별점수).map(name => ({ name, score: Number(종목별점수[name]) || 0, gam: Number(종목별감수[name]) || 0 }));
                        eventData.sort((a, b) => b.score - a.score);
                        const top3Events = eventData.slice(0, 3);
                        const top3Sum = top3Events.reduce((sum, event) => sum + event.score, 0);
                        총감수 = top3Events.reduce((sum, event) => sum + event.gam, 0);
                        
                        if (config.기준총점 > 0 && config.실기반영총점 > 0) {
                            실기총점 = (top3Sum / config.기준총점) * config.실기반영총점;
                        } else {
                            실기총점 = top3Sum;
                        }
                        break;
                    }
                
                // ▲▲▲▲▲ 여기가 핵심 수정 부분 ▲▲▲▲▲

                case 248:
                    실기총점 = rawSum;
                    break;
                
                case 270:
                    실기총점 = rawSum + 30;
                    break;
                    
                case 332:
                case 333:
                    실기총점 = rawSum * 0.75;
                    break;
                
                case 334:
                case 335:
                case 336:
                    실기총점 = rawSum + 10;
                    break;
                
                 case 338:
                    const passCount = Object.values(종목별점수).filter(score => {
                        const scoreStr = String(score).toUpperCase();
                        return scoreStr === 'P' || scoreStr === 'PASS';
                    }).length;
                    
                    실기총점 = (passCount * 100) + 200;
                    총감수 = 0;
                    break;
                default:
                    실기총점 = rawSum;
                    break;
            }
            break;

        case '비율환산':
            const 기준총점 = config.기준총점 || rawSum;
            const 실기반영총점 = config.실기반영총점 || rawSum;
            실기총점 = (기준총점 > 0) ? (rawSum / 기준총점) * 실기반영총점 : rawSum;
            총감수 = rawGamSum;
            break;

        default: // '단순합산'
            실기총점 = rawSum;
            총감수 = rawGamSum;
            break;
    }

    const 합산점수 = 실기총점 + (Number(내신점수) || 0);

    return {
        실기총점: parseFloat(실기총점.toFixed(2)),
        합산점수: parseFloat(합산점수.toFixed(2)),
        총감수: 총감수
    };
}

module.exports = { calculateFinalScore };

// [calculation-logic.js] 파일 전체를 이걸로 교체

function calculateFinalScore(대학ID, 종목별점수, 내신점수, config, 종목별감수) {
    const 환산방식 = config.환산방식 || '단순합산';
    let 실기총점 = 0;
    let 총감수 = 0;

    switch (환산방식) {
        case '특수식':
            switch (Number(대학ID)) {
                case 232:
                case 242:
                case 209: 
                case 206:    
                    // 1. 점수와 감수를 쌍으로 묶은 배열 생성
                    const eventData = Object.keys(종목별점수).map(eventName => ({
                        name: eventName,
                        score: Number(종목별점수[eventName]) || 0,
                        gam: Number(종목별감수[eventName]) || 0
                    }));

                    // 2. 점수(score) 기준으로 내림차순 정렬
                    eventData.sort((a, b) => b.score - a.score);

                    // 3. 상위 3개 종목만 선택
                    const top3Events = eventData.slice(0, 3);

                    // 4. 선택된 3개 종목의 점수와 감수만 각각 합산
                    const top3Sum = top3Events.reduce((sum, event) => sum + event.score, 0);
                    총감수 = top3Events.reduce((sum, event) => sum + event.gam, 0);
                    
                    // 5. 합산된 점수로 비율환산 적용
                    const 기준총점 = config.기준총점;
                    const 실기반영총점 = config.실기반영총점;
                    if (기준총점 > 0 && 실기반영총점 > 0) {
                        실기총점 = (top3Sum / 기준총점) * 실기반영총점;
                    } else {
                        실기총점 = top3Sum;
                    }
                    break;

                default:
                    실기총점 = Object.values(종목별점수).reduce((sum, score) => sum + (Number(score) || 0), 0);
                    총감수 = Object.values(종목별감수).reduce((sum, gam) => sum + (Number(gam) || 0), 0);
                    break;
            }
            break;

        case '비율환산':
            const rawSum = Object.values(종목별점수).reduce((sum, score) => sum + (Number(score) || 0), 0);
            const 기준총점 = config.기준총점 || rawSum;
            const 실기반영총점 = config.실기반영총점 || rawSum;
            실기총점 = (기준총점 > 0) ? (rawSum / 기준총점) * 실기반영총점 : rawSum;
            총감수 = Object.values(종목별감수).reduce((sum, gam) => sum + (Number(gam) || 0), 0);
            break;

        default: // '단순합산'
            실기총점 = Object.values(종목별점수).reduce((sum, score) => sum + (Number(score) || 0), 0);
            총감수 = Object.values(종목별감수).reduce((sum, gam) => sum + (Number(gam) || 0), 0);
            break;
    }

    const 합산점수 = 실기총점 + (Number(내신점수) || 0);

    return {
        실기총점: parseFloat(실기총점.toFixed(2)),
        합산점수: parseFloat(합산점수.toFixed(2)),
        총감수: 총감수 // ✅ 계산된 총감수 반환
    };
}

module.exports = { calculateFinalScore };

function calculateFinalScore(대학ID, 종목별점수, 내신점수, config, 종목별감수) {
    const 환산방식 = config.환산방식 || '단순합산';
    let 실기총점 = 0;
    let 총감수 = 0;

    // 219번: 각 종목 최소 420점 보정
    let 보정된종목별점수 = 종목별점수;
    if (Number(대학ID) === 219) {
        보정된종목별점수 = {};
        for (const [eventName, score] of Object.entries(종목별점수)) {
            const numericScore = Number(score) || 0;

            // 숫자로 못 바꾸는 값(P/F 등)은 여기서는 그냥 420으로 처리 중
            // (정책이 다르면 여기만 바꾸면 됨)
            if (isNaN(numericScore)) {
                보정된종목별점수[eventName] = 420;
            } else {
                보정된종목별점수[eventName] = (numericScore < 420) ? 420 : numericScore;
            }
        }
    }

    // 이 이후부턴 workingScores만 참고하도록 통일
    const workingScores = (Number(대학ID) === 219) ? 보정된종목별점수 : 종목별점수;

    const rawSum = Object.values(workingScores).reduce(
        (sum, score) => sum + (Number(score) || 0), 
        0
    );
    const rawGamSum = Object.values(종목별감수).reduce(
        (sum, gam) => sum + (Number(gam) || 0), 
        0
    );

    switch (환산방식) {
        case '특수식':
            총감수 = rawGamSum;

            switch (Number(대학ID)) {
                // [규칙] 단순합산 + 기본점수 20점
                case 121: {
                    실기총점 = rawSum + 20;
                    break;
                }

                case 257:
                case 259: {
                    const X = rawSum;
                    if (X === 0) {
                        실기총점 = 0;
                    } else {
                        실기총점 = (X / 3 - 80) * (7 / 6) + 560;
                    }
                    break;
                }

                case 260: {
                    const Y = rawSum;
                    if (Y === 0) {
                        실기총점 = 0;
                    } else {
                        실기총점 = (Y / 2 - 80) + 480;
                    }
                    break;
                }

                // ID 238: 기본 80 + ((상위 3종목 합)/3 * 3.2)
                case 238: {
                    const eventData = Object.keys(workingScores).map(name => ({
                        name,
                        score: Number(workingScores[name]) || 0,
                        gam: Number(종목별감수[name]) || 0
                    }));
                    eventData.sort((a, b) => b.score - a.score);

                    const top3Events = eventData.slice(0, 3);
                    const top3Sum = top3Events.reduce((sum, e) => sum + e.score, 0);
                    총감수 = top3Events.reduce((sum, e) => sum + e.gam, 0);

                    실기총점 = 80 + ((top3Sum / 3) * 3.2);
                    break;
                }

                // ID 232, 242: 기본 160 + ((상위 3종목 합)/3 * 6.4)
                case 232:
                case 242: {
                    const eventData = Object.keys(workingScores).map(name => ({
                        name,
                        score: Number(workingScores[name]) || 0,
                        gam: Number(종목별감수[name]) || 0
                    }));
                    eventData.sort((a, b) => b.score - a.score);

                    const top3Events = eventData.slice(0, 3);
                    const top3Sum = top3Events.reduce((sum, e) => sum + e.score, 0);
                    총감수 = top3Events.reduce((sum, e) => sum + e.gam, 0);

                    실기총점 = 160 + ((top3Sum / 3) * 6.4);
                    break;
                }

                // ID 209, 206: 상위 3개 비율환산
                case 209:
                case 206: {
                    const eventData = Object.keys(workingScores).map(name => ({
                        name,
                        score: Number(workingScores[name]) || 0,
                        gam: Number(종목별감수[name]) || 0
                    }));
                    eventData.sort((a, b) => b.score - a.score);

                    const top3Events = eventData.slice(0, 3);
                    const top3Sum = top3Events.reduce((sum, e) => sum + e.score, 0);
                    총감수 = top3Events.reduce((sum, e) => sum + e.gam, 0);

                    if (config.기준총점 > 0 && config.실기반영총점 > 0) {
                        실기총점 = (top3Sum / config.기준총점) * config.실기반영총점;
                    } else {
                        실기총점 = top3Sum;
                    }
                    break;
                }

                case 248: {
                    실기총점 = rawSum;
                    break;
                }

                case 270: {
                    실기총점 = rawSum + 30;
                    break;
                }

                case 332:
                case 333: {
                    실기총점 = rawSum * 0.75;
                    break;
                }

                case 334:
                case 335:
                case 336: {
                    실기총점 = rawSum + 10;
                    break;
                }

                case 338: {
                    const passCount = Object.values(workingScores).filter(score => {
                        const scoreStr = String(score).toUpperCase();
                        return scoreStr === 'P' || scoreStr === 'PASS';
                    }).length;

                    실기총점 = (passCount * 100) + 200;
                    총감수 = 0;
                    break;
                }

                default: {
                    실기총점 = rawSum;
                    break;
                }
            }
            break;

        case '비율환산': {
            const 기준총점 = config.기준총점 || rawSum;
            const 실기반영총점 = config.실기반영총점 || rawSum;
            실기총점 = (기준총점 > 0)
                ? (rawSum / 기준총점) * 실기반영총점
                : rawSum;
            총감수 = rawGamSum;
            break;
        }

        default: { // '단순합산'
            실기총점 = rawSum;
            총감수 = rawGamSum;
            break;
        }
    }

    const 합산점수 = 실기총점 + (Number(내신점수) || 0);

    return {
        실기총점: parseFloat(실기총점.toFixed(2)),
        합산점수: parseFloat(합산점수.toFixed(2)),
        총감수: 총감수
    };
}

module.exports = { calculateFinalScore };

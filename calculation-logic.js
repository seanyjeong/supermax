function calculateFinalScore(대학ID, 종목별점수, 내신점수, config, 종목별감수, inputs) {
    const 환산방식 = config.환산방식 || '단순합산';
    let 실기총점 = 0;
    let 총감수 = 0;

    // ---- [1] 대학ID 219일 때 종목별 최소점 보정 로직 ----
    // 조건:
    // - 해당 종목에 학생이 기록을 "입력"했다면 최소 420
    // - 기록 입력 안 한 종목은 0으로 두고 합산해도 0
    let 보정된종목별점수 = 종목별점수;

    if (Number(대학ID) === 219) {
        보정된종목별점수 = {};

        // inputs: [{ 종목명, 기록: "123" }, ...]
        // 이걸 빠르게 조회할 수 있게 맵으로 변환
        const 기록입력여부 = {};
        for (const row of inputs) {
            // "학생이 이 종목은 시도했는가?" = 기록이 비어 있지 않은가?
            // 기록이 null/''/undefined만 아니면 시도했다고 본다.
            if (row && row.종목명) {
                const hasTried = row.기록 !== null && row.기록 !== undefined && row.기록 !== '' && row.기록 !== 0 && row.기록 !== '0';
                기록입력여부[row.종목명] = hasTried;
            }
        }

        for (const [eventName, score] of Object.entries(종목별점수)) {
            const numericScore = Number(score);

            const triedThisEvent = 기록입력여부[eventName] === true;

            if (!triedThisEvent) {
                // 학생이 이 종목은 아예 기록 안 넣음 → 그냥 0점 유지
                보정된종목별점수[eventName] = 0;
                continue;
            }

            // 여기로 왔다는 건 "해당 종목은 입력된 기록이 있다"는 뜻

            if (isNaN(numericScore)) {
                // 점수가 'P','F','-' 등 숫자가 아니게 들어온 경우라도
                // 219 룰에서는 시도했으면 최소 420 줘버린다
                보정된종목별점수[eventName] = 420;
                continue;
            }

            if (numericScore <= 0) {
                // 표에서 못 찾았거나 너무 나빠서 기존 로직이 0 줬던 케이스
                // -> 하지만 학생은 시도함 -> 최소 420
                보정된종목별점수[eventName] = 420;
                continue;
            }

            // 정상 점수인데 420보다 낮으면 420으로 끌어올리기
            보정된종목별점수[eventName] = (numericScore < 420) ? 420 : numericScore;
        }
    }

    // ---- [2] 이후 계산은 보정된 점수(219면 보정, 아니면 원점수) 기준으로 ----
    const workingScores = (Number(대학ID) === 219) ? 보정된종목별점수 : 종목별점수;

    const rawSum = Object.values(workingScores).reduce(
        (sum, score) => sum + (Number(score) || 0),
        0
    );

    const rawGamSum = Object.values(종목별감수).reduce(
        (sum, gam) => sum + (Number(gam) || 0),
        0
    );

    // ---- [3] 환산방식/학교별 특수식은 기존 그대로인데
    //          상위3 뽑는 로직 등은 workingScores 써야 한다 ----
    switch (환산방식) {
        case '특수식':
            총감수 = rawGamSum;

            switch (Number(대학ID)) {
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

                // 238: 상위3 평균을 3.2배 후 +80
                case 238: {
                    const eventData = Object.keys(workingScores).map(name => ({
                        name,
                        score: Number(workingScores[name]) || 0,
                        gam: Number(종목별감수[name]) || 0,
                    }));
                    eventData.sort((a, b) => b.score - a.score);

                    const top3 = eventData.slice(0, 3);
                    const top3Sum = top3.reduce((sum, e) => sum + e.score, 0);
                    총감수 = top3.reduce((sum, e) => sum + e.gam, 0);

                    실기총점 = 80 + ((top3Sum / 3) * 3.2);
                    break;
                }

                // 232, 242: 상위3 평균을 6.4배 후 +160
                case 232:
                case 242: {
                    const eventData = Object.keys(workingScores).map(name => ({
                        name,
                        score: Number(workingScores[name]) || 0,
                        gam: Number(종목별감수[name]) || 0,
                    }));
                    eventData.sort((a, b) => b.score - a.score);

                    const top3 = eventData.slice(0, 3);
                    const top3Sum = top3.reduce((sum, e) => sum + e.score, 0);
                    총감수 = top3.reduce((sum, e) => sum + e.gam, 0);

                    실기총점 = 160 + ((top3Sum / 3) * 6.4);
                    break;
                }

                // 206, 209: 상위3 비율 환산
                case 206:
                case 209: {
                    const eventData = Object.keys(workingScores).map(name => ({
                        name,
                        score: Number(workingScores[name]) || 0,
                        gam: Number(종목별감수[name]) || 0,
                    }));
                    eventData.sort((a, b) => b.score - a.score);

                    const top3 = eventData.slice(0, 3);
                    const top3Sum = top3.reduce((sum, e) => sum + e.score, 0);
                    총감수 = top3.reduce((sum, e) => sum + e.gam, 0);

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
                        const s = String(score).toUpperCase();
                        return s === 'P' || s === 'PASS';
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

        default: { // 단순합산
            실기총점 = rawSum;
            총감수 = rawGamSum;
            break;
        }
    }

    const 합산점수 = 실기총점 + (Number(내신점수) || 0);

    return {
        실기총점: parseFloat(실기총점.toFixed(2)),
        합산점수: parseFloat(합산점수.toFixed(2)),
        총감수: 총감수,
    };
}

module.exports = { calculateFinalScore };

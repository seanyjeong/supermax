// 파일 이름: calculation-logic.js

function calculateFinalScore(대학ID, 종목별점수, 내신점수, config) {
    const 환산방식 = config.환산방식 || '단순합산';
    let 실기총점 = 0;
    
    // 이 로그를 통해 어떤 계산 방식을 타는지 확인
    console.log(`[계산 시작] 대학ID: ${대학ID}, 환산방식: ${환산방식}`);

    switch (환산방식) {
        case '특수식':
            switch (대학ID) {
                // ✅ ID를 242로 다시 수정!
                case 232:
                case 242:
                    console.log(`  -> 특수식(상위 3개 합산) 적용됨.`);
                    const scores = Object.values(종목별점수).map(s => Number(s) || 0);
                    scores.sort((a, b) => b - a);
                    const top3Sum = scores.slice(0, 3).reduce((sum, score) => sum + score, 0);
                    
                    const 기준총점 = config.기준총점;
                    const 실기반영총점 = config.실기반영총점;

                    // 이 로그를 통해 DB에서 가져온 값을 확인
                    console.log(`  -> 상위 3개 합산: ${top3Sum}, DB 기준총점: ${기준총점}, DB 실기반영총점: ${실기반영총점}`);

                    if (기준총점 > 0 && 실기반영총점 > 0) {
                        실기총점 = (top3Sum / 기준총점) * 실기반영총점;
                        console.log(`  -> 비율 환산 적용 결과: ${실기총점}`);
                    } else {
                        실기총점 = top3Sum;
                        console.log(`  -> DB 기준/반영 총점 없어서 단순 합산 결과: ${실기총점}`);
                    }
                    break;

                default:
                    console.log(`  -> 특수식 default(단순 합산) 적용됨.`);
                    실기총점 = Object.values(종목별점수).reduce((sum, score) => sum + (Number(score) || 0), 0);
                    break;
            }
            break;

        case '비율환산':
            console.log(`  -> 일반 비율환산 적용됨.`);
            const rawSum = Object.values(종목별점수).reduce((sum, score) => sum + (Number(score) || 0), 0);
            const 기준총점 = config.기준총점 || rawSum;
            const 실기반영총점 = config.실기반영총점 || rawSum;
            실기총점 = (기준총점 > 0) ? (rawSum / 기준총점) * 실기반영총점 : rawSum;
            break;

        default: // '단순합산'
            console.log(`  -> 단순합산 적용됨.`);
            실기총점 = Object.values(종목별점수).reduce((sum, score) => sum + (Number(score) || 0), 0);
            break;
    }

    const 합산점수 = 실기총점 + (Number(내신점수) || 0);

    return {
        실기총점: parseFloat(실기총점.toFixed(2)),
        합산점수: parseFloat(합산점수.toFixed(2))
    };
}

module.exports = { calculateFinalScore };

// 파일 이름: calculation-logic.js

function calculateFinalScore(대학ID, 종목별점수, 내신점수, config) {
    const 환산방식 = config.환산방식 || '단순합산';
    let 실기총점 = 0;

    // =========================================================
    // ✅ 여기에 대학별 특수식을 계속 추가하면 돼!
    // =========================================================
    switch (환산방식) {
        case '특수식':
            // 대학ID에 따라 다른 계산식을 적용
            switch (대학ID) {
                // ✅ 요청한 특수식: 상위 3개 종목 합산 후 비율 환산
                case 232:
                case 242:
                    // 1. 모든 종목의 점수를 배열로 만듦
                    const scores = Object.values(종목별점수).map(s => Number(s) || 0);
                    // 2. 점수를 내림차순으로 정렬
                    scores.sort((a, b) => b - a);
                    // 3. 상위 3개 점수만 잘라서 합산
                    const top3Sum = scores.slice(0, 3).reduce((sum, score) => sum + score, 0);
                    
                    // 4. 비율환산 공식 적용
                    const 기준총점_상위3 = config.기준총점 || top3Sum;
                    const 실기반영총점_상위3 = config.실기반영총점 || top3Sum;
                    if (기준총점_상위3 > 0) {
                        실기총점 = (top3Sum / 기준총점_상위3) * 실기반영총점_상위3;
                    } else {
                        실기총점 = top3Sum;
                    }
                    break;

                // 여기에 다른 대학 특수식 case를 계속 추가...
                // case '다른특수식대학_ID':
                //     실기총점 = ...
                //     break;

                default:
                    // 특수식으로 지정되었지만 case가 없는 경우, 일단 단순 합산 처리
                    실기총점 = Object.values(종목별점수).reduce((sum, score) => sum + (Number(score) || 0), 0);
                    break;
            }
            break;

        case '비율환산':
            const rawSum = Object.values(종목별점수).reduce((sum, score) => sum + (Number(score) || 0), 0);
            const 기준총점 = config.기준총점 || rawSum;
            const 실기반영총점 = config.실기반영총점 || rawSum;
            if (기준총점 > 0) {
                실기총점 = (rawSum / 기준총점) * 실기반영총점;
            } else {
                실기총점 = rawSum;
            }
            break;

        default: // '단순합산' 또는 그 외
            실기총점 = Object.values(종목별점수).reduce((sum, score) => sum + (Number(score) || 0), 0);
            break;
    }

    const 합산점수 = 실기총점 + (Number(내신점수) || 0);

    // 계산된 최종 결과를 객체로 반환
    return {
        실기총점: parseFloat(실기총점.toFixed(2)),
        합산점수: parseFloat(합산점수.toFixed(2))
    };
}

// 이 함수를 다른 파일에서 사용할 수 있도록 export
module.exports = { calculateFinalScore };

/**
 * 학년 자동 진급 스케줄러
 * 매년 3월 1일에 실행되어 학생 학년을 자동으로 진급 처리
 *
 * 진급 규칙:
 * - 중1 → 중2
 * - 중2 → 중3
 * - 중3 → 고1
 * - 고1 → 고2
 * - 고2 → 고3
 * - 고3 → N수 (status가 active인 경우만)
 * - N수 → N수 (유지)
 *
 * 졸업 처리:
 * - 고3 학생 중 졸업 처리할 학생은 status를 'graduated'로 변경
 * - graduated 상태 학생은 스케줄에 포함되지 않음
 */

const cron = require('node-cron');
const db = require('../config/database');

// 학년 진급 매핑
const GRADE_PROMOTION_MAP = {
    '중1': '중2',
    '중2': '중3',
    '중3': '고1',
    '고1': '고2',
    '고2': '고3',
    '고3': 'N수',  // 고3은 기본적으로 N수로 진급
    'N수': 'N수'   // N수는 유지
};

/**
 * 학년 진급 처리 로직
 * @param {boolean} isDryRun - true면 실제 DB 변경 없이 미리보기만
 */
async function promoteStudentGrades(isDryRun = false) {
    const today = new Date();
    const currentMonth = today.getMonth() + 1;
    const currentDay = today.getDate();

    console.log(`[GradePromotionScheduler] Starting grade promotion check... (${today.toISOString()})`);

    // 3월 1일이 아니면 스킵 (수동 실행 시에는 무시 가능하도록 인자 추가 가능)
    // if (currentMonth !== 3 || currentDay !== 1) {
    //     console.log(`[GradePromotionScheduler] Skipping - today is not March 1st`);
    //     return { promoted: 0, graduated: 0, skipped: 0 };
    // }

    try {
        // 모든 학원의 active/paused 학생 조회 (graduated 제외)
        const [students] = await db.query(`
            SELECT
                s.id,
                s.academy_id,
                s.name,
                s.grade,
                s.status
            FROM students s
            WHERE s.deleted_at IS NULL
              AND s.status IN ('active', 'paused')
              AND s.grade IS NOT NULL
            ORDER BY s.academy_id, s.grade
        `);

        if (students.length === 0) {
            console.log('[GradePromotionScheduler] No active students found');
            return { promoted: 0, graduated: 0, skipped: 0 };
        }

        console.log(`[GradePromotionScheduler] Found ${students.length} active students to process`);

        let promotedCount = 0;
        let graduatedCount = 0;
        let skippedCount = 0;
        const promotionLog = [];

        for (const student of students) {
            const currentGrade = student.grade;
            const newGrade = GRADE_PROMOTION_MAP[currentGrade];

            if (!newGrade) {
                // 매핑에 없는 학년은 스킵 (예: null, 빈값 등)
                skippedCount++;
                continue;
            }

            if (currentGrade === newGrade) {
                // N수 → N수처럼 변화 없으면 스킵
                skippedCount++;
                continue;
            }

            promotionLog.push({
                studentId: student.id,
                name: student.name,
                academyId: student.academy_id,
                from: currentGrade,
                to: newGrade
            });

            if (!isDryRun) {
                // 실제 학년 업데이트
                await db.query(
                    `UPDATE students SET grade = ?, updated_at = NOW() WHERE id = ?`,
                    [newGrade, student.id]
                );
            }

            promotedCount++;
        }

        // 로그 출력
        if (promotionLog.length > 0) {
            console.log('[GradePromotionScheduler] Promotion summary:');
            const byGrade = {};
            promotionLog.forEach(log => {
                const key = `${log.from} → ${log.to}`;
                byGrade[key] = (byGrade[key] || 0) + 1;
            });
            Object.entries(byGrade).forEach(([transition, count]) => {
                console.log(`  ${transition}: ${count}명`);
            });
        }

        console.log(`[GradePromotionScheduler] Completed - Promoted: ${promotedCount}, Skipped: ${skippedCount}`);

        return {
            promoted: promotedCount,
            graduated: graduatedCount,
            skipped: skippedCount,
            details: promotionLog
        };

    } catch (error) {
        console.error('[GradePromotionScheduler] Error:', error);
        throw error;
    }
}

/**
 * 고3 학생 졸업 처리
 * 고3 중 졸업시킬 학생의 status를 'graduated'로 변경
 * @param {number[]} studentIds - 졸업 처리할 학생 ID 배열
 */
async function graduateStudents(studentIds) {
    if (!studentIds || studentIds.length === 0) {
        return { graduated: 0 };
    }

    try {
        const [result] = await db.query(
            `UPDATE students
             SET status = 'graduated', updated_at = NOW()
             WHERE id IN (?) AND grade = '고3' AND status = 'active'`,
            [studentIds]
        );

        console.log(`[GradePromotionScheduler] Graduated ${result.affectedRows} students`);

        return { graduated: result.affectedRows };
    } catch (error) {
        console.error('[GradePromotionScheduler] Graduation error:', error);
        throw error;
    }
}

/**
 * 스케줄러 초기화
 * 매년 3월 1일 오전 1시에 실행 (한국 시간)
 */
function initGradePromotionScheduler() {
    // 매년 3월 1일 01:00에 실행 (0 1 1 3 *)
    cron.schedule('0 1 1 3 *', async () => {
        console.log('[GradePromotionScheduler] Annual grade promotion starting...');
        await promoteStudentGrades(false);
    }, {
        scheduled: true,
        timezone: 'Asia/Seoul'
    });

    console.log('🎓 학년 자동 진급 스케줄러 초기화 완료 (매년 3월 1일 01:00 실행)');
}

module.exports = {
    initGradePromotionScheduler,
    promoteStudentGrades,
    graduateStudents
};

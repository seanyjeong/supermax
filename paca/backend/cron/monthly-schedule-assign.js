/**
 * 월별 자동 스케줄 배정 크론잡
 *
 * 매월 1일 00:05에 실행
 * - 모든 활성 학생을 해당 월 스케줄에 자동 배정
 * - 기본 시간대: evening (저녁)
 *
 * 사용법:
 * 1. 직접 실행: node cron/monthly-schedule-assign.js
 * 2. PM2 cron: pm2 start cron/monthly-schedule-assign.js --cron "5 0 1 * *"
 * 3. 시스템 cron: 0 5 0 1 * * cd /path/to/backend && node cron/monthly-schedule-assign.js
 */

const db = require('../config/database');

const DEFAULT_TIME_SLOT = 'evening';

/**
 * 특정 학생을 해당 월에 배정
 */
async function assignStudentToMonth(dbConn, studentId, academyId, classDays, year, month, timeSlot = DEFAULT_TIME_SLOT) {
    const lastDay = new Date(year, month, 0).getDate(); // month는 1-12

    let assignedCount = 0;
    let createdCount = 0;

    for (let day = 1; day <= lastDay; day++) {
        const currentDate = new Date(year, month - 1, day);
        const dayOfWeek = currentDate.getDay();

        if (classDays.includes(dayOfWeek)) {
            const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

            // 해당 날짜+시간대의 스케줄 조회 또는 생성
            let [schedules] = await dbConn.query(
                `SELECT id FROM class_schedules
                 WHERE academy_id = ? AND class_date = ? AND time_slot = ?`,
                [academyId, dateStr, timeSlot]
            );

            let scheduleId;
            if (schedules.length === 0) {
                const [result] = await dbConn.query(
                    `INSERT INTO class_schedules (academy_id, class_date, time_slot, attendance_taken)
                     VALUES (?, ?, ?, false)`,
                    [academyId, dateStr, timeSlot]
                );
                scheduleId = result.insertId;
                createdCount++;
            } else {
                scheduleId = schedules[0].id;
            }

            // 이미 배정되어 있는지 확인
            const [existing] = await dbConn.query(
                `SELECT id FROM attendance WHERE class_schedule_id = ? AND student_id = ?`,
                [scheduleId, studentId]
            );

            if (existing.length === 0) {
                await dbConn.query(
                    `INSERT INTO attendance (class_schedule_id, student_id, attendance_status)
                     VALUES (?, ?, NULL)`,
                    [scheduleId, studentId]
                );
                assignedCount++;
            }
        }
    }

    return { assigned: assignedCount, created: createdCount };
}

/**
 * 메인 실행 함수
 */
async function runMonthlyAssignment() {
    const startTime = Date.now();
    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth() + 1; // 1-12

    console.log(`========================================`);
    console.log(`[${today.toISOString()}] 월별 자동 스케줄 배정 시작`);
    console.log(`대상 월: ${year}년 ${month}월`);
    console.log(`========================================`);

    try {
        // 모든 학원 조회
        const [academies] = await db.query(
            `SELECT DISTINCT academy_id FROM students WHERE status = 'active' AND deleted_at IS NULL`
        );

        console.log(`처리할 학원 수: ${academies.length}`);

        let totalStudents = 0;
        let totalAssigned = 0;
        let totalCreated = 0;

        for (const academy of academies) {
            const academyId = academy.academy_id;

            // 해당 학원의 활성 학생 조회 (class_days가 있는 학생만)
            const [students] = await db.query(
                `SELECT id, name, class_days
                 FROM students
                 WHERE academy_id = ?
                 AND status = 'active'
                 AND deleted_at IS NULL
                 AND class_days IS NOT NULL
                 AND class_days != '[]'`,
                [academyId]
            );

            console.log(`\n학원 ID ${academyId}: ${students.length}명 처리 중...`);

            for (const student of students) {
                try {
                    const classDays = typeof student.class_days === 'string'
                        ? JSON.parse(student.class_days)
                        : student.class_days;

                    if (!classDays || classDays.length === 0) continue;

                    const result = await assignStudentToMonth(
                        db,
                        student.id,
                        academyId,
                        classDays,
                        year,
                        month,
                        DEFAULT_TIME_SLOT
                    );

                    totalStudents++;
                    totalAssigned += result.assigned;
                    totalCreated += result.created;

                    if (result.assigned > 0) {
                        console.log(`  - ${student.name}: ${result.assigned}개 수업 배정`);
                    }
                } catch (err) {
                    console.error(`  [ERROR] 학생 ${student.id} (${student.name}) 배정 실패:`, err.message);
                }
            }
        }

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

        console.log(`\n========================================`);
        console.log(`[완료] ${year}년 ${month}월 자동 배정 완료`);
        console.log(`- 처리 학생 수: ${totalStudents}명`);
        console.log(`- 총 배정 수업: ${totalAssigned}개`);
        console.log(`- 새로 생성된 스케줄: ${totalCreated}개`);
        console.log(`- 소요 시간: ${elapsed}초`);
        console.log(`========================================\n`);

        return {
            success: true,
            year,
            month,
            totalStudents,
            totalAssigned,
            totalCreated,
            elapsed
        };
    } catch (error) {
        console.error('[FATAL ERROR] 월별 배정 실패:', error);
        throw error;
    }
}

// 직접 실행 시
if (require.main === module) {
    runMonthlyAssignment()
        .then(result => {
            console.log('결과:', result);
            process.exit(0);
        })
        .catch(err => {
            console.error('실행 실패:', err);
            process.exit(1);
        });
}

module.exports = { runMonthlyAssignment, assignStudentToMonth };

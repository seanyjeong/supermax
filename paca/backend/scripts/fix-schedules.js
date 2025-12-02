/**
 * 스케줄 정리 스크립트
 *
 * 1. 일반 학생(시즌 미등록)의 morning/afternoon 스케줄 삭제
 * 2. 학생의 수업요일과 맞지 않는 스케줄 삭제
 * 3. evening 시간대로 올바르게 재배정
 *
 * 실행: node scripts/fix-schedules.js
 */

const db = require('../config/database');

async function fixSchedules() {
    const connection = await db.getConnection();

    try {
        console.log('===== 스케줄 정리 시작 =====\n');

        // 1. 현재 상황 파악
        console.log('[1단계] 현재 상황 파악...');

        const [timeSlotStats] = await connection.query(`
            SELECT
                cs.time_slot,
                COUNT(DISTINCT cs.id) as schedule_count,
                COUNT(a.id) as attendance_count
            FROM class_schedules cs
            LEFT JOIN attendance a ON cs.id = a.class_schedule_id
            WHERE cs.class_date >= '2024-12-01'
            GROUP BY cs.time_slot
        `);

        console.log('시간대별 스케줄 현황:');
        timeSlotStats.forEach(row => {
            console.log(`  ${row.time_slot}: ${row.schedule_count}개 스케줄, ${row.attendance_count}개 출석기록`);
        });

        // 2. 일반 학생(시즌 미등록)의 morning/afternoon 배정 조회
        console.log('\n[2단계] 잘못된 스케줄 조회...');

        const [wrongSchedules] = await connection.query(`
            SELECT
                a.id as attendance_id,
                a.student_id,
                s.name as student_name,
                s.grade,
                s.class_days,
                cs.id as schedule_id,
                cs.class_date,
                cs.time_slot,
                DAYOFWEEK(cs.class_date) - 1 as day_of_week
            FROM attendance a
            JOIN class_schedules cs ON a.class_schedule_id = cs.id
            JOIN students s ON a.student_id = s.id
            LEFT JOIN student_seasons ss ON s.id = ss.student_id AND ss.is_cancelled = 0
            WHERE cs.class_date >= CURDATE()
            AND s.status = 'active'
            AND s.deleted_at IS NULL
            AND ss.id IS NULL
            AND (
                cs.time_slot IN ('morning', 'afternoon')
                OR NOT JSON_CONTAINS(s.class_days, CAST(DAYOFWEEK(cs.class_date) - 1 AS CHAR))
            )
            ORDER BY s.name, cs.class_date
        `);

        console.log(`잘못된 스케줄 수: ${wrongSchedules.length}개`);

        if (wrongSchedules.length > 0) {
            // 학생별로 그룹화해서 출력
            const byStudent = {};
            wrongSchedules.forEach(row => {
                if (!byStudent[row.student_name]) {
                    byStudent[row.student_name] = [];
                }
                byStudent[row.student_name].push(row);
            });

            Object.entries(byStudent).forEach(([name, schedules]) => {
                const classDays = schedules[0].class_days;
                console.log(`\n  ${name} (수업요일: ${classDays}):`);
                schedules.slice(0, 5).forEach(s => {
                    const reason = s.time_slot !== 'evening' ? `시간대: ${s.time_slot}` : `요일 불일치 (${s.day_of_week})`;
                    console.log(`    - ${s.class_date} (${reason})`);
                });
                if (schedules.length > 5) {
                    console.log(`    ... 외 ${schedules.length - 5}개`);
                }
            });
        }

        // 3. 잘못된 출석 기록 삭제
        console.log('\n[3단계] 잘못된 출석 기록 삭제...');

        const attendanceIds = wrongSchedules.map(w => w.attendance_id);

        if (attendanceIds.length > 0) {
            const [deleteResult] = await connection.query(
                `DELETE FROM attendance WHERE id IN (?) AND attendance_status IS NULL`,
                [attendanceIds]
            );
            console.log(`삭제된 출석 기록: ${deleteResult.affectedRows}개`);
        } else {
            console.log('삭제할 출석 기록 없음');
        }

        // 4. 빈 스케줄 삭제 (출석 기록이 없는 스케줄)
        console.log('\n[4단계] 빈 스케줄 삭제...');

        const [emptyScheduleResult] = await connection.query(`
            DELETE cs FROM class_schedules cs
            LEFT JOIN attendance a ON cs.id = a.class_schedule_id
            WHERE a.id IS NULL
            AND cs.class_date >= CURDATE()
        `);
        console.log(`삭제된 빈 스케줄: ${emptyScheduleResult.affectedRows}개`);

        // 5. 올바른 스케줄로 재배정
        console.log('\n[5단계] 올바른 스케줄로 재배정...');

        // 활성 학생 중 시즌 미등록자 조회
        const [activeStudents] = await connection.query(`
            SELECT s.id, s.name, s.academy_id, s.class_days
            FROM students s
            LEFT JOIN student_seasons ss ON s.id = ss.student_id AND ss.is_cancelled = 0
            WHERE s.status = 'active'
            AND s.deleted_at IS NULL
            AND s.class_days IS NOT NULL
            AND s.class_days != '[]'
            AND ss.id IS NULL
        `);

        console.log(`재배정 대상 학생: ${activeStudents.length}명`);

        let totalAssigned = 0;
        let totalCreated = 0;

        for (const student of activeStudents) {
            const classDays = typeof student.class_days === 'string'
                ? JSON.parse(student.class_days)
                : student.class_days;

            if (!Array.isArray(classDays) || classDays.length === 0) continue;

            // 오늘부터 월말까지 스케줄 배정
            const today = new Date();
            const year = today.getFullYear();
            const month = today.getMonth();
            const lastDay = new Date(year, month + 1, 0).getDate();

            for (let day = today.getDate(); day <= lastDay; day++) {
                const currentDate = new Date(year, month, day);
                const dayOfWeek = currentDate.getDay();

                if (classDays.includes(dayOfWeek)) {
                    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

                    // evening 스케줄 조회 또는 생성
                    let [schedules] = await connection.query(
                        `SELECT id FROM class_schedules
                         WHERE academy_id = ? AND class_date = ? AND time_slot = 'evening'`,
                        [student.academy_id, dateStr]
                    );

                    let scheduleId;
                    if (schedules.length === 0) {
                        const [result] = await connection.query(
                            `INSERT INTO class_schedules (academy_id, class_date, time_slot, attendance_taken)
                             VALUES (?, ?, 'evening', false)`,
                            [student.academy_id, dateStr]
                        );
                        scheduleId = result.insertId;
                        totalCreated++;
                    } else {
                        scheduleId = schedules[0].id;
                    }

                    // 이미 배정되어 있는지 확인
                    const [existing] = await connection.query(
                        `SELECT id FROM attendance WHERE class_schedule_id = ? AND student_id = ?`,
                        [scheduleId, student.id]
                    );

                    if (existing.length === 0) {
                        await connection.query(
                            `INSERT INTO attendance (class_schedule_id, student_id, attendance_status)
                             VALUES (?, ?, NULL)`,
                            [scheduleId, student.id]
                        );
                        totalAssigned++;
                    }
                }
            }
        }

        console.log(`새로 생성된 스케줄: ${totalCreated}개`);
        console.log(`재배정된 출석 기록: ${totalAssigned}개`);

        // 6. 최종 상황
        console.log('\n[6단계] 최종 상황 확인...');

        const [finalStats] = await connection.query(`
            SELECT
                cs.time_slot,
                COUNT(DISTINCT cs.id) as schedule_count,
                COUNT(a.id) as attendance_count
            FROM class_schedules cs
            LEFT JOIN attendance a ON cs.id = a.class_schedule_id
            WHERE cs.class_date >= CURDATE()
            GROUP BY cs.time_slot
        `);

        console.log('시간대별 스케줄 현황 (정리 후):');
        finalStats.forEach(row => {
            console.log(`  ${row.time_slot}: ${row.schedule_count}개 스케줄, ${row.attendance_count}개 출석기록`);
        });

        console.log('\n===== 스케줄 정리 완료 =====');

    } catch (error) {
        console.error('오류 발생:', error);
    } finally {
        connection.release();
        process.exit(0);
    }
}

fixSchedules();

const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { verifyToken, requireRole, checkPermission } = require('../middleware/auth');

/**
 * 학생을 해당 월의 스케줄에 자동 배정
 * @param {object} dbConn - 데이터베이스 연결
 * @param {number} studentId - 학생 ID
 * @param {number} academyId - 학원 ID
 * @param {array} classDays - 수업 요일 (예: [1, 3, 5] - 숫자 배열)
 * @param {string} enrollmentDate - 등록일 (YYYY-MM-DD)
 * @param {string} defaultTimeSlot - 기본 시간대 ('morning' | 'afternoon' | 'evening')
 */
async function autoAssignStudentToSchedules(dbConn, studentId, academyId, classDays, enrollmentDate, defaultTimeSlot = 'evening') {
    try {
        if (!classDays || classDays.length === 0) {
            console.log('No class days specified, skipping auto-assignment');
            return { assigned: 0, created: 0 };
        }

        const enrollDate = new Date(enrollmentDate + 'T00:00:00');
        const year = enrollDate.getFullYear();
        const month = enrollDate.getMonth();
        const enrollDay = enrollDate.getDate();
        const lastDay = new Date(year, month + 1, 0).getDate();

        let assignedCount = 0;
        let createdCount = 0;

        // 등록일부터 해당 월 말일까지 수업일 찾기
        for (let day = enrollDay; day <= lastDay; day++) {
            const currentDate = new Date(year, month, day);
            const dayOfWeek = currentDate.getDay();

            if (classDays.includes(dayOfWeek)) {
                const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

                // 해당 날짜+시간대의 스케줄 조회 또는 생성
                let [schedules] = await dbConn.query(
                    `SELECT id FROM class_schedules
                     WHERE academy_id = ? AND class_date = ? AND time_slot = ?`,
                    [academyId, dateStr, defaultTimeSlot]
                );

                let scheduleId;
                if (schedules.length === 0) {
                    // 스케줄 생성
                    const [result] = await dbConn.query(
                        `INSERT INTO class_schedules (academy_id, class_date, time_slot, attendance_taken)
                         VALUES (?, ?, ?, false)`,
                        [academyId, dateStr, defaultTimeSlot]
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
                    // 출석 기록 생성 (배정)
                    await dbConn.query(
                        `INSERT INTO attendance (class_schedule_id, student_id, attendance_status)
                         VALUES (?, ?, NULL)`,
                        [scheduleId, studentId]
                    );
                    assignedCount++;
                }
            }
        }

        console.log(`Auto-assigned student ${studentId}: ${assignedCount} schedules (${createdCount} new)`);
        return { assigned: assignedCount, created: createdCount };
    } catch (error) {
        console.error('Error in autoAssignStudentToSchedules:', error);
        throw error;
    }
}

/**
 * 학생 요일 변경 시 스케줄 재배정
 * - 기존 미출석 기록 삭제 (오늘 이후)
 * - 새 요일로 재배정 (오늘 이후 ~ 월말)
 */
async function reassignStudentSchedules(dbConn, studentId, academyId, oldClassDays, newClassDays, defaultTimeSlot = 'evening') {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayStr = today.toISOString().split('T')[0];

        const year = today.getFullYear();
        const month = today.getMonth();
        const lastDay = new Date(year, month + 1, 0).getDate();

        // 1. 오늘 이후 미출석 기록 삭제 (출석 처리 안된 것만)
        const [deleteResult] = await dbConn.query(
            `DELETE a FROM attendance a
             JOIN class_schedules cs ON a.class_schedule_id = cs.id
             WHERE a.student_id = ?
             AND cs.academy_id = ?
             AND cs.class_date >= ?
             AND a.attendance_status IS NULL`,
            [studentId, academyId, todayStr]
        );

        console.log(`Removed ${deleteResult.affectedRows} future attendance records for student ${studentId}`);

        // 2. 새 요일로 재배정 (오늘부터 월말까지)
        let assignedCount = 0;
        let createdCount = 0;

        for (let day = today.getDate(); day <= lastDay; day++) {
            const currentDate = new Date(year, month, day);
            const dayOfWeek = currentDate.getDay();

            if (newClassDays.includes(dayOfWeek)) {
                const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

                // 해당 날짜+시간대의 스케줄 조회 또는 생성
                let [schedules] = await dbConn.query(
                    `SELECT id FROM class_schedules
                     WHERE academy_id = ? AND class_date = ? AND time_slot = ?`,
                    [academyId, dateStr, defaultTimeSlot]
                );

                let scheduleId;
                if (schedules.length === 0) {
                    const [result] = await dbConn.query(
                        `INSERT INTO class_schedules (academy_id, class_date, time_slot, attendance_taken)
                         VALUES (?, ?, ?, false)`,
                        [academyId, dateStr, defaultTimeSlot]
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

        console.log(`Reassigned student ${studentId}: ${assignedCount} schedules (${createdCount} new)`);
        return { removed: deleteResult.affectedRows, assigned: assignedCount, created: createdCount };
    } catch (error) {
        console.error('Error in reassignStudentSchedules:', error);
        throw error;
    }
}

/**
 * GET /paca/students
 * Get all students with optional filters
 * Access: owner, admin, teacher
 */
router.get('/', verifyToken, async (req, res) => {
    try {
        const { grade, student_type, admission_type, status, search } = req.query;

        let query = `
            SELECT
                s.id,
                s.student_number,
                s.name,
                s.student_type,
                s.phone,
                s.parent_phone,
                s.school,
                s.grade,
                s.age,
                s.admission_type,
                s.class_days,
                s.weekly_count,
                s.monthly_tuition,
                s.discount_rate,
                s.discount_reason,
                s.payment_due_day,
                s.enrollment_date,
                s.status,
                s.rest_start_date,
                s.rest_end_date,
                s.rest_reason,
                s.created_at
            FROM students s
            WHERE s.academy_id = ?
            AND s.deleted_at IS NULL
        `;

        const params = [req.user.academyId];

        if (grade) {
            query += ' AND s.grade = ?';
            params.push(grade);
        }

        if (student_type) {
            query += ' AND s.student_type = ?';
            params.push(student_type);
        }

        if (admission_type) {
            query += ' AND s.admission_type = ?';
            params.push(admission_type);
        }

        if (status) {
            query += ' AND s.status = ?';
            params.push(status);
        }

        if (search) {
            query += ' AND (s.name LIKE ? OR s.student_number LIKE ? OR s.phone LIKE ?)';
            const searchTerm = `%${search}%`;
            params.push(searchTerm, searchTerm, searchTerm);
        }

        query += ' ORDER BY s.enrollment_date DESC';

        const [students] = await db.query(query, params);

        res.json({
            message: `Found ${students.length} students`,
            students
        });
    } catch (error) {
        console.error('Error fetching students:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to fetch students'
        });
    }
});

/**
 * GET /paca/students/:id
 * Get student by ID with performance records
 * Access: owner, admin, teacher
 */
router.get('/:id', verifyToken, async (req, res) => {
    const studentId = parseInt(req.params.id);

    try {
        // Get student basic info
        const [students] = await db.query(
            `SELECT
                s.*,
                a.name as academy_name
            FROM students s
            LEFT JOIN academies a ON s.academy_id = a.id
            WHERE s.id = ?
            AND s.academy_id = ?
            AND s.deleted_at IS NULL`,
            [studentId, req.user.academyId]
        );

        if (students.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Student not found'
            });
        }

        const student = students[0];

        // Get performance records
        const [performances] = await db.query(
            `SELECT
                id,
                record_date,
                record_type,
                performance_data,
                notes,
                created_at
            FROM student_performance
            WHERE student_id = ?
            ORDER BY record_date DESC
            LIMIT 10`,
            [studentId]
        );

        // Get payment records
        const [payments] = await db.query(
            `SELECT
                id,
                payment_type,
                base_amount,
                final_amount,
                paid_date,
                due_date,
                payment_status,
                payment_method
            FROM student_payments
            WHERE student_id = ?
            ORDER BY due_date DESC
            LIMIT 10`,
            [studentId]
        );

        res.json({
            student,
            performances,
            payments
        });
    } catch (error) {
        console.error('Error fetching student:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to fetch student'
        });
    }
});

/**
 * POST /paca/students
 * Create new student
 * Access: owner, admin
 */
router.post('/', verifyToken, checkPermission('students', 'edit'), async (req, res) => {
    try {
        const {
            student_number,
            name,
            gender,
            student_type,
            phone,
            parent_phone,
            school,
            grade,
            age,
            admission_type,
            class_days,
            weekly_count,
            monthly_tuition,
            discount_rate,
            discount_reason,
            payment_due_day,
            enrollment_date,
            address,
            notes
        } = req.body;

        // Validation
        if (!name || !phone) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'Required fields: name, phone'
            });
        }

        // Validate student_type
        const validStudentTypes = ['exam', 'adult'];
        if (student_type && !validStudentTypes.includes(student_type)) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'student_type must be exam or adult'
            });
        }

        // Validate grade (for exam students)
        const validGrades = ['고1', '고2', '고3', 'N수'];
        if (grade && !validGrades.includes(grade)) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'grade must be one of: 고1, 고2, 고3, N수'
            });
        }

        // Validate admission_type
        const validAdmissionTypes = ['regular', 'early', 'civil_service'];
        if (admission_type && !validAdmissionTypes.includes(admission_type)) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'admission_type must be regular, early, or civil_service'
            });
        }

        // Check if student_number already exists
        if (student_number) {
            const [existing] = await db.query(
                'SELECT id FROM students WHERE student_number = ? AND academy_id = ? AND deleted_at IS NULL',
                [student_number, req.user.academyId]
            );

            if (existing.length > 0) {
                return res.status(400).json({
                    error: 'Validation Error',
                    message: 'Student number already exists'
                });
            }
        }

        // Generate student number if not provided
        let finalStudentNumber = student_number;
        if (!finalStudentNumber) {
            const year = new Date().getFullYear();
            const [lastStudent] = await db.query(
                `SELECT student_number FROM students
                WHERE academy_id = ?
                AND student_number LIKE '${year}%'
                ORDER BY student_number DESC LIMIT 1`,
                [req.user.academyId]
            );

            if (lastStudent.length > 0) {
                const lastNum = parseInt(lastStudent[0].student_number.slice(-3));
                finalStudentNumber = `${year}${String(lastNum + 1).padStart(3, '0')}`;
            } else {
                finalStudentNumber = `${year}001`;
            }
        }

        // Insert student
        const [result] = await db.query(
            `INSERT INTO students (
                academy_id,
                student_number,
                name,
                gender,
                student_type,
                phone,
                parent_phone,
                school,
                grade,
                age,
                admission_type,
                class_days,
                weekly_count,
                monthly_tuition,
                discount_rate,
                discount_reason,
                payment_due_day,
                enrollment_date,
                address,
                notes,
                status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
            [
                req.user.academyId,
                finalStudentNumber,
                name,
                gender || null,
                student_type || 'exam',
                phone,
                parent_phone,
                school || null,
                grade || null,
                age || null,
                admission_type || 'regular',
                JSON.stringify(class_days || []),
                weekly_count || 0,
                monthly_tuition || 0,
                discount_rate || 0,
                discount_reason || null,
                payment_due_day || null,
                enrollment_date || new Date().toISOString().split('T')[0],
                address || null,
                notes || null
            ]
        );

        // Fetch created student
        const [students] = await db.query(
            'SELECT * FROM students WHERE id = ?',
            [result.insertId]
        );

        const createdStudent = students[0];

        // 첫 달 학원비 자동 생성 (일할계산)
        let firstPayment = null;
        if (monthly_tuition && monthly_tuition > 0) {
            const enrollDate = new Date(enrollment_date || new Date().toISOString().split('T')[0]);
            const year = enrollDate.getFullYear();
            const month = enrollDate.getMonth() + 1;

            // 학원 납부일 조회 (기본값 5일)
            const [academySettings] = await db.query(
                'SELECT tuition_due_day FROM academy_settings WHERE academy_id = ?',
                [req.user.academyId]
            );
            const academyDueDay = academySettings.length > 0 ? academySettings[0].tuition_due_day : 5;
            const studentDueDay = payment_due_day || academyDueDay;

            // 일할계산: 등록일부터 말일까지
            const lastDayOfMonth = new Date(year, month, 0).getDate();
            const enrollDay = enrollDate.getDate();
            const remainingDays = lastDayOfMonth - enrollDay + 1;

            // 수업 요일 계산 (등록일부터 말일까지 수업일수)
            let classDaysCount = 0;
            const parsedClassDays = class_days || [];
            for (let d = enrollDay; d <= lastDayOfMonth; d++) {
                const checkDate = new Date(year, month - 1, d);
                const dayOfWeek = checkDate.getDay();
                if (parsedClassDays.includes(dayOfWeek)) {
                    classDaysCount++;
                }
            }

            // 전체 월 수업일수 계산
            let totalClassDaysInMonth = 0;
            for (let d = 1; d <= lastDayOfMonth; d++) {
                const checkDate = new Date(year, month - 1, d);
                const dayOfWeek = checkDate.getDay();
                if (parsedClassDays.includes(dayOfWeek)) {
                    totalClassDaysInMonth++;
                }
            }

            // 일할계산 금액
            const baseAmount = parseFloat(monthly_tuition);
            const discountRateNum = parseFloat(discount_rate) || 0;
            let proRatedAmount;

            if (totalClassDaysInMonth > 0 && classDaysCount > 0) {
                const dailyRate = baseAmount / totalClassDaysInMonth;
                proRatedAmount = Math.round(dailyRate * classDaysCount);
            } else {
                // 수업요일 설정 없으면 일수 기준
                proRatedAmount = Math.round(baseAmount * remainingDays / lastDayOfMonth);
            }

            // 할인 적용
            const discountAmount = Math.round(proRatedAmount * discountRateNum / 100);
            const finalAmount = proRatedAmount - discountAmount;

            // 납부일 계산
            const dueDate = new Date(year, month - 1, Math.min(studentDueDay, lastDayOfMonth));
            if (dueDate < enrollDate) {
                // 납부일이 등록일보다 이전이면 다음 달 납부일로
                dueDate.setMonth(dueDate.getMonth() + 1);
            }

            // 학원비 레코드 생성
            const yearMonth = `${year}-${String(month).padStart(2, '0')}`;
            const [paymentResult] = await db.query(
                `INSERT INTO student_payments (
                    student_id,
                    academy_id,
                    \`year_month\`,
                    payment_type,
                    base_amount,
                    discount_amount,
                    additional_amount,
                    final_amount,
                    due_date,
                    payment_status,
                    description,
                    recorded_by
                ) VALUES (?, ?, ?, 'monthly', ?, ?, 0, ?, ?, 'pending', ?, ?)`,
                [
                    result.insertId,
                    req.user.academyId,
                    yearMonth,
                    proRatedAmount,
                    discountAmount,
                    finalAmount,
                    dueDate.toISOString().split('T')[0],
                    `${month}월 학원비 (${enrollDay}일 등록, 일할계산)`,
                    req.user.userId
                ]
            );

            const [payments] = await db.query(
                'SELECT * FROM student_payments WHERE id = ?',
                [paymentResult.insertId]
            );
            firstPayment = payments[0];
        }

        // 자동 스케줄 배정 (등록일 이후 해당 월의 수업에 배정)
        let autoAssignResult = null;
        const parsedClassDays = class_days || [];
        if (parsedClassDays.length > 0) {
            try {
                autoAssignResult = await autoAssignStudentToSchedules(
                    db,
                    result.insertId,
                    req.user.academyId,
                    parsedClassDays,
                    enrollment_date || new Date().toISOString().split('T')[0],
                    'evening'  // 기본 시간대: 저녁
                );
            } catch (assignError) {
                console.error('Auto-assign failed:', assignError);
                // 배정 실패해도 학생 생성은 성공으로 처리
            }
        }

        res.status(201).json({
            message: 'Student created successfully',
            student: createdStudent,
            firstPayment,
            autoAssigned: autoAssignResult
        });
    } catch (error) {
        console.error('Error creating student:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to create student'
        });
    }
});

/**
 * PUT /paca/students/:id
 * Update student
 * Access: owner, admin
 */
router.put('/:id', verifyToken, checkPermission('students', 'edit'), async (req, res) => {
    const studentId = parseInt(req.params.id);

    try {
        // Check if student exists and get current class_days
        const [students] = await db.query(
            'SELECT id, class_days FROM students WHERE id = ? AND academy_id = ? AND deleted_at IS NULL',
            [studentId, req.user.academyId]
        );

        if (students.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Student not found'
            });
        }

        // 기존 class_days 파싱
        const oldClassDays = students[0].class_days
            ? (typeof students[0].class_days === 'string'
                ? JSON.parse(students[0].class_days)
                : students[0].class_days)
            : [];

        const {
            student_number,
            name,
            gender,
            student_type,
            phone,
            parent_phone,
            school,
            grade,
            age,
            admission_type,
            class_days,
            weekly_count,
            monthly_tuition,
            discount_rate,
            discount_reason,
            payment_due_day,
            enrollment_date,
            address,
            notes,
            status,
            rest_start_date,
            rest_end_date,
            rest_reason
        } = req.body;

        // Validate student_type
        if (student_type && !['exam', 'adult'].includes(student_type)) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'student_type must be exam or adult'
            });
        }

        // Validate grade
        const validGrades = ['고1', '고2', '고3', 'N수'];
        if (grade && !validGrades.includes(grade)) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'grade must be one of: 고1, 고2, 고3, N수'
            });
        }

        // Validate admission_type
        if (admission_type && !['regular', 'early', 'civil_service'].includes(admission_type)) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'admission_type must be regular, early, or civil_service'
            });
        }

        // Check if new student_number already exists (if changed)
        if (student_number) {
            const [existing] = await db.query(
                'SELECT id FROM students WHERE student_number = ? AND academy_id = ? AND id != ? AND deleted_at IS NULL',
                [student_number, req.user.academyId, studentId]
            );

            if (existing.length > 0) {
                return res.status(400).json({
                    error: 'Validation Error',
                    message: 'Student number already exists'
                });
            }
        }

        // Build update query dynamically
        const updates = [];
        const params = [];

        if (student_number !== undefined) {
            updates.push('student_number = ?');
            params.push(student_number);
        }
        if (name !== undefined) {
            updates.push('name = ?');
            params.push(name);
        }
        if (gender !== undefined) {
            updates.push('gender = ?');
            params.push(gender);
        }
        if (student_type !== undefined) {
            updates.push('student_type = ?');
            params.push(student_type);
        }
        if (phone !== undefined) {
            updates.push('phone = ?');
            params.push(phone);
        }
        if (parent_phone !== undefined) {
            updates.push('parent_phone = ?');
            params.push(parent_phone);
        }
        if (school !== undefined) {
            updates.push('school = ?');
            params.push(school);
        }
        if (grade !== undefined) {
            updates.push('grade = ?');
            params.push(grade);
        }
        if (age !== undefined) {
            updates.push('age = ?');
            params.push(age);
        }
        if (admission_type !== undefined) {
            updates.push('admission_type = ?');
            params.push(admission_type);
        }
        if (class_days !== undefined) {
            updates.push('class_days = ?');
            params.push(JSON.stringify(class_days));
        }
        if (weekly_count !== undefined) {
            updates.push('weekly_count = ?');
            params.push(weekly_count);
        }
        if (monthly_tuition !== undefined) {
            updates.push('monthly_tuition = ?');
            params.push(monthly_tuition);
        }
        if (discount_rate !== undefined) {
            updates.push('discount_rate = ?');
            params.push(discount_rate);
        }
        if (discount_reason !== undefined) {
            updates.push('discount_reason = ?');
            params.push(discount_reason);
        }
        if (payment_due_day !== undefined) {
            updates.push('payment_due_day = ?');
            params.push(payment_due_day);
        }
        if (enrollment_date !== undefined) {
            updates.push('enrollment_date = ?');
            params.push(enrollment_date);
        }
        if (address !== undefined) {
            updates.push('address = ?');
            params.push(address);
        }
        if (notes !== undefined) {
            updates.push('notes = ?');
            params.push(notes);
        }
        if (status !== undefined) {
            updates.push('status = ?');
            params.push(status);

            // 상태가 paused가 아니면 휴식 관련 필드 초기화
            if (status !== 'paused') {
                updates.push('rest_start_date = NULL');
                updates.push('rest_end_date = NULL');
                updates.push('rest_reason = NULL');
            }
        }
        if (rest_start_date !== undefined) {
            updates.push('rest_start_date = ?');
            params.push(rest_start_date || null);
        }
        if (rest_end_date !== undefined) {
            updates.push('rest_end_date = ?');
            params.push(rest_end_date || null);
        }
        if (rest_reason !== undefined) {
            updates.push('rest_reason = ?');
            params.push(rest_reason || null);
        }

        if (updates.length === 0) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'No fields to update'
            });
        }

        updates.push('updated_at = NOW()');
        params.push(studentId);

        await db.query(
            `UPDATE students SET ${updates.join(', ')} WHERE id = ?`,
            params
        );

        // Fetch updated student
        const [updatedStudents] = await db.query(
            'SELECT * FROM students WHERE id = ?',
            [studentId]
        );

        // class_days가 변경되었으면 스케줄 재배정
        let reassignResult = null;
        if (class_days !== undefined) {
            const newClassDays = class_days || [];
            // 요일이 실제로 변경되었는지 확인
            const oldSet = new Set(oldClassDays);
            const newSet = new Set(newClassDays);
            const isChanged = oldClassDays.length !== newClassDays.length ||
                              oldClassDays.some(d => !newSet.has(d)) ||
                              newClassDays.some(d => !oldSet.has(d));

            if (isChanged && newClassDays.length > 0) {
                try {
                    reassignResult = await reassignStudentSchedules(
                        db,
                        studentId,
                        req.user.academyId,
                        oldClassDays,
                        newClassDays,
                        'evening'
                    );
                } catch (reassignError) {
                    console.error('Reassign failed:', reassignError);
                    // 재배정 실패해도 업데이트는 성공으로 처리
                }
            }
        }

        res.json({
            message: 'Student updated successfully',
            student: updatedStudents[0],
            scheduleReassigned: reassignResult
        });
    } catch (error) {
        console.error('Error updating student:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to update student'
        });
    }
});

/**
 * DELETE /paca/students/:id
 * Hard delete student (완전 삭제)
 * Access: owner only
 */
router.delete('/:id', verifyToken, requireRole('owner'), async (req, res) => {
    const studentId = parseInt(req.params.id);

    try {
        // Check if student exists
        const [students] = await db.query(
            'SELECT id, name FROM students WHERE id = ? AND academy_id = ?',
            [studentId, req.user.academyId]
        );

        if (students.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Student not found'
            });
        }

        const connection = await db.getConnection();
        await connection.beginTransaction();

        try {
            // 관련 데이터 삭제 (스케줄, 출석, 학원비, 성적 등)
            await connection.query('DELETE FROM schedules WHERE student_id = ?', [studentId]);
            await connection.query('DELETE FROM attendance WHERE student_id = ?', [studentId]);
            await connection.query('DELETE FROM student_payments WHERE student_id = ?', [studentId]);
            await connection.query('DELETE FROM student_performance WHERE student_id = ?', [studentId]);
            await connection.query('DELETE FROM season_students WHERE student_id = ?', [studentId]);
            await connection.query('DELETE FROM student_seasons WHERE student_id = ?', [studentId]);
            await connection.query('DELETE FROM rest_credits WHERE student_id = ?', [studentId]);
            await connection.query('DELETE FROM notification_logs WHERE student_id = ?', [studentId]);

            // 학생 삭제
            await connection.query('DELETE FROM students WHERE id = ?', [studentId]);

            await connection.commit();
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }

        res.json({
            message: 'Student deleted permanently',
            student: {
                id: studentId,
                name: students[0].name
            }
        });
    } catch (error) {
        console.error('Error deleting student:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to delete student'
        });
    }
});

/**
 * POST /paca/students/:id/withdraw
 * 퇴원 처리
 * Access: owner, admin
 */
router.post('/:id/withdraw', verifyToken, checkPermission('students', 'edit'), async (req, res) => {
    const studentId = parseInt(req.params.id);
    const { reason, withdrawal_date } = req.body;

    try {
        // Check if student exists
        const [students] = await db.query(
            'SELECT id, name, status FROM students WHERE id = ? AND academy_id = ? AND deleted_at IS NULL',
            [studentId, req.user.academyId]
        );

        if (students.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Student not found'
            });
        }

        if (students[0].status === 'withdrawn') {
            return res.status(400).json({
                error: 'Bad Request',
                message: '이미 퇴원 처리된 학생입니다'
            });
        }

        // 퇴원 처리
        await db.query(
            `UPDATE students
             SET status = 'withdrawn',
                 withdrawal_date = ?,
                 withdrawal_reason = ?,
                 updated_at = NOW()
             WHERE id = ?`,
            [withdrawal_date || new Date().toISOString().split('T')[0], reason || null, studentId]
        );

        // 미래 스케줄에서 제거 (오늘 이후)
        const today = new Date().toISOString().split('T')[0];
        await db.query(
            `DELETE a FROM attendance a
             JOIN class_schedules cs ON a.class_schedule_id = cs.id
             WHERE a.student_id = ? AND cs.class_date > ? AND a.attendance_status IS NULL`,
            [studentId, today]
        );

        res.json({
            message: '퇴원 처리되었습니다',
            student: {
                id: studentId,
                name: students[0].name,
                status: 'withdrawn',
                withdrawal_date: withdrawal_date || today,
                withdrawal_reason: reason
            }
        });
    } catch (error) {
        console.error('Error withdrawing student:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to withdraw student'
        });
    }
});

/**
 * POST /paca/students/grade-upgrade
 * Bulk upgrade student grades (진급 처리)
 * Access: owner, admin
 */
router.post('/grade-upgrade', verifyToken, checkPermission('students', 'edit'), async (req, res) => {
    try {
        const { upgrades } = req.body;

        if (!Array.isArray(upgrades) || upgrades.length === 0) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'upgrades must be a non-empty array'
            });
        }

        const validGrades = ['고1', '고2', '고3', 'N수', null];
        const validStatuses = ['active', 'inactive', 'graduated'];

        // Validate all upgrades first
        for (const upgrade of upgrades) {
            if (!upgrade.student_id) {
                return res.status(400).json({
                    error: 'Validation Error',
                    message: 'Each upgrade must have student_id'
                });
            }

            if (upgrade.new_grade !== null && upgrade.new_grade !== undefined && !validGrades.includes(upgrade.new_grade)) {
                return res.status(400).json({
                    error: 'Validation Error',
                    message: `Invalid grade: ${upgrade.new_grade}. Must be one of: 고1, 고2, 고3, N수`
                });
            }

            if (upgrade.new_status && !validStatuses.includes(upgrade.new_status)) {
                return res.status(400).json({
                    error: 'Validation Error',
                    message: `Invalid status: ${upgrade.new_status}. Must be one of: active, inactive, graduated`
                });
            }
        }

        // Verify all students belong to this academy
        const studentIds = upgrades.map(u => u.student_id);
        const [existingStudents] = await db.query(
            `SELECT id FROM students
             WHERE id IN (?)
             AND academy_id = ?
             AND deleted_at IS NULL`,
            [studentIds, req.user.academyId]
        );

        if (existingStudents.length !== studentIds.length) {
            const foundIds = existingStudents.map(s => s.id);
            const missingIds = studentIds.filter(id => !foundIds.includes(id));
            return res.status(400).json({
                error: 'Validation Error',
                message: `Students not found: ${missingIds.join(', ')}`
            });
        }

        // Perform updates in transaction
        const connection = await db.getConnection();
        await connection.beginTransaction();

        try {
            let updatedCount = 0;

            for (const upgrade of upgrades) {
                const updates = [];
                const params = [];

                if (upgrade.new_grade !== undefined) {
                    updates.push('grade = ?');
                    params.push(upgrade.new_grade);
                }

                if (upgrade.new_status) {
                    updates.push('status = ?');
                    params.push(upgrade.new_status);
                }

                if (updates.length > 0) {
                    updates.push('updated_at = NOW()');
                    params.push(upgrade.student_id);

                    await connection.query(
                        `UPDATE students SET ${updates.join(', ')} WHERE id = ?`,
                        params
                    );
                    updatedCount++;
                }
            }

            await connection.commit();

            res.json({
                message: `Successfully upgraded ${updatedCount} students`,
                updated_count: updatedCount
            });
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error('Error upgrading student grades:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to upgrade student grades'
        });
    }
});

/**
 * POST /paca/students/auto-promote
 * 학년 자동 진급 (3월 신학기)
 * Access: owner only
 *
 * 진급 규칙:
 * - 중1 → 중2, 중2 → 중3, 중3 → 고1
 * - 고1 → 고2, 고2 → 고3, 고3 → N수
 * - N수 → N수 (유지)
 *
 * Body (선택):
 * - dry_run: true면 실제 변경 없이 미리보기만
 * - graduate_student_ids: 고3 중 졸업 처리할 학생 ID 배열 (status를 'graduated'로 변경)
 */
router.post('/auto-promote', verifyToken, requireRole('owner'), async (req, res) => {
    try {
        const { dry_run = false, graduate_student_ids = [] } = req.body;
        const academyId = req.user.academyId;

        // 학년 진급 매핑
        const GRADE_PROMOTION_MAP = {
            '중1': '중2',
            '중2': '중3',
            '중3': '고1',
            '고1': '고2',
            '고2': '고3',
            '고3': 'N수',
            'N수': 'N수'
        };

        // 해당 학원의 active/paused 학생 조회 (graduated 제외)
        const [students] = await db.query(`
            SELECT id, name, grade, status
            FROM students
            WHERE academy_id = ?
              AND deleted_at IS NULL
              AND status IN ('active', 'paused')
              AND grade IS NOT NULL
            ORDER BY grade
        `, [academyId]);

        if (students.length === 0) {
            return res.json({
                message: '진급 대상 학생이 없습니다',
                promoted: 0,
                graduated: 0,
                details: []
            });
        }

        const promotionDetails = [];
        let promotedCount = 0;
        let graduatedCount = 0;

        const connection = await db.getConnection();
        await connection.beginTransaction();

        try {
            for (const student of students) {
                const currentGrade = student.grade;
                const newGrade = GRADE_PROMOTION_MAP[currentGrade];

                // 졸업 처리 대상인지 확인 (고3 학생 중)
                const shouldGraduate = currentGrade === '고3' &&
                    graduate_student_ids.includes(student.id);

                if (shouldGraduate) {
                    // 졸업 처리
                    if (!dry_run) {
                        await connection.query(
                            `UPDATE students SET status = 'graduated', updated_at = NOW() WHERE id = ?`,
                            [student.id]
                        );
                    }
                    promotionDetails.push({
                        studentId: student.id,
                        name: student.name,
                        from: currentGrade,
                        to: '졸업',
                        action: 'graduated'
                    });
                    graduatedCount++;
                } else if (newGrade && currentGrade !== newGrade) {
                    // 진급 처리
                    if (!dry_run) {
                        await connection.query(
                            `UPDATE students SET grade = ?, updated_at = NOW() WHERE id = ?`,
                            [newGrade, student.id]
                        );
                    }
                    promotionDetails.push({
                        studentId: student.id,
                        name: student.name,
                        from: currentGrade,
                        to: newGrade,
                        action: 'promoted'
                    });
                    promotedCount++;
                }
            }

            if (!dry_run) {
                await connection.commit();
            } else {
                await connection.rollback();
            }
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }

        // 진급 요약
        const summary = {};
        promotionDetails.forEach(d => {
            const key = `${d.from} → ${d.to}`;
            summary[key] = (summary[key] || 0) + 1;
        });

        res.json({
            message: dry_run
                ? `진급 미리보기: ${promotedCount}명 진급, ${graduatedCount}명 졸업 예정`
                : `진급 완료: ${promotedCount}명 진급, ${graduatedCount}명 졸업 처리`,
            dry_run,
            promoted: promotedCount,
            graduated: graduatedCount,
            summary,
            details: promotionDetails
        });

    } catch (error) {
        console.error('Auto-promote error:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to auto-promote students'
        });
    }
});

/**
 * GET /paca/students/:id/seasons
 * Get student's season enrollment history
 * Access: owner, admin, teacher
 */
router.get('/:id/seasons', verifyToken, async (req, res) => {
    const studentId = parseInt(req.params.id);

    try {
        // Verify student exists and belongs to academy
        const [students] = await db.query(
            'SELECT id, name FROM students WHERE id = ? AND academy_id = ? AND deleted_at IS NULL',
            [studentId, req.user.academyId]
        );

        if (students.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Student not found'
            });
        }

        // Get season enrollment history
        const [seasons] = await db.query(
            `SELECT
                ss.id as enrollment_id,
                ss.season_id,
                ss.season_fee,
                ss.registration_date,
                ss.after_season_action,
                ss.prorated_month,
                ss.prorated_amount,
                ss.prorated_details,
                ss.is_continuous,
                ss.previous_season_id,
                ss.discount_type,
                ss.discount_amount,
                ss.payment_status,
                ss.paid_date,
                ss.paid_amount,
                ss.payment_method,
                ss.is_cancelled,
                ss.cancellation_date,
                ss.refund_amount,
                ss.time_slots,
                ss.created_at,
                s.season_name,
                s.season_type,
                s.season_start_date,
                s.season_end_date,
                s.non_season_end_date,
                s.status as season_status,
                s.operating_days,
                s.grade_time_slots
            FROM student_seasons ss
            JOIN seasons s ON ss.season_id = s.id
            WHERE ss.student_id = ?
            ORDER BY ss.registration_date DESC`,
            [studentId]
        );

        res.json({
            message: `Found ${seasons.length} season enrollments`,
            student: students[0],
            seasons
        });
    } catch (error) {
        console.error('Error fetching student seasons:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to fetch student seasons'
        });
    }
});

/**
 * GET /paca/students/search
 * Search students (for autocomplete, etc)
 * Access: owner, admin, teacher
 */
router.get('/search', verifyToken, async (req, res) => {
    try {
        const { q } = req.query;

        if (!q || q.length < 2) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'Search query must be at least 2 characters'
            });
        }

        const [students] = await db.query(
            `SELECT
                id,
                student_number,
                name,
                phone,
                grade,
                grade_type
            FROM students
            WHERE academy_id = ?
            AND deleted_at IS NULL
            AND (name LIKE ? OR student_number LIKE ? OR phone LIKE ?)
            ORDER BY name
            LIMIT 20`,
            [req.user.academyId, `%${q}%`, `%${q}%`, `%${q}%`]
        );

        res.json({
            message: `Found ${students.length} students`,
            students
        });
    } catch (error) {
        console.error('Error searching students:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to search students'
        });
    }
});

/**
 * POST /paca/students/:id/rest
 * 학생 휴식 처리 (이월/환불 크레딧 생성)
 * Access: owner, admin
 */
router.post('/:id/rest', verifyToken, checkPermission('students', 'edit'), async (req, res) => {
    const studentId = parseInt(req.params.id);
    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        // 1. 학생 존재 확인 및 현재 정보 조회
        const [students] = await connection.query(
            `SELECT id, name, monthly_tuition, discount_rate, status, academy_id
             FROM students WHERE id = ? AND academy_id = ? AND deleted_at IS NULL`,
            [studentId, req.user.academyId]
        );

        if (students.length === 0) {
            await connection.rollback();
            return res.status(404).json({
                error: 'Not Found',
                message: 'Student not found'
            });
        }

        const student = students[0];

        const {
            rest_start_date,
            rest_end_date,
            rest_reason,
            credit_type,  // 'carryover' | 'refund' | 'none'
            source_payment_id  // 이미 납부한 학원비 ID (선택)
        } = req.body;

        // 2. 필수 필드 검증
        if (!rest_start_date) {
            await connection.rollback();
            return res.status(400).json({
                error: 'Validation Error',
                message: '휴식 시작일은 필수입니다.'
            });
        }

        // 3. 학생 상태를 paused로 변경하고 휴식 정보 저장
        await connection.query(
            `UPDATE students SET
                status = 'paused',
                rest_start_date = ?,
                rest_end_date = ?,
                rest_reason = ?,
                updated_at = NOW()
             WHERE id = ?`,
            [rest_start_date, rest_end_date || null, rest_reason || null, studentId]
        );

        let restCredit = null;

        // 4. 이월/환불 크레딧 처리
        if (credit_type && credit_type !== 'none') {
            // 휴식 기간 계산
            const startDate = new Date(rest_start_date);
            let endDate;

            if (rest_end_date) {
                endDate = new Date(rest_end_date);
            } else {
                // 무기한인 경우 해당 월 말일까지로 계산
                endDate = new Date(startDate.getFullYear(), startDate.getMonth() + 1, 0);
            }

            // 해당 월 내 휴식 일수 계산
            const year = startDate.getFullYear();
            const month = startDate.getMonth();
            const monthStart = new Date(year, month, 1);
            const monthEnd = new Date(year, month + 1, 0);
            const daysInMonth = monthEnd.getDate();

            const effectiveStart = startDate > monthStart ? startDate : monthStart;
            const effectiveEnd = endDate < monthEnd ? endDate : monthEnd;
            const restDays = Math.ceil((effectiveEnd - effectiveStart) / (1000 * 60 * 60 * 24)) + 1;

            // 일할 금액 계산
            const monthlyTuition = parseFloat(student.monthly_tuition) || 0;
            const dailyRate = monthlyTuition / daysInMonth;
            const creditAmount = Math.floor((dailyRate * restDays) / 1000) * 1000;  // 천원 단위 절삭

            if (creditAmount > 0) {
                // 휴식 크레딧 생성
                const [creditResult] = await connection.query(
                    `INSERT INTO rest_credits (
                        student_id,
                        academy_id,
                        source_payment_id,
                        rest_start_date,
                        rest_end_date,
                        rest_days,
                        credit_amount,
                        remaining_amount,
                        credit_type,
                        status,
                        notes
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
                    [
                        studentId,
                        req.user.academyId,
                        source_payment_id || null,
                        rest_start_date,
                        rest_end_date || effectiveEnd.toISOString().split('T')[0],
                        restDays,
                        creditAmount,
                        creditAmount,  // remaining_amount = credit_amount 초기값
                        credit_type,
                        `휴식 기간: ${rest_start_date} ~ ${rest_end_date || '무기한'}, 사유: ${rest_reason || '없음'}`
                    ]
                );

                const [credits] = await connection.query(
                    'SELECT * FROM rest_credits WHERE id = ?',
                    [creditResult.insertId]
                );
                restCredit = credits[0];
            }
        }

        // 5. 오늘 이후 미출석 스케줄 삭제 (휴식 시작일 기준)
        await connection.query(
            `DELETE a FROM attendance a
             JOIN class_schedules cs ON a.class_schedule_id = cs.id
             WHERE a.student_id = ?
             AND cs.academy_id = ?
             AND cs.class_date >= ?
             AND a.attendance_status IS NULL`,
            [studentId, req.user.academyId, rest_start_date]
        );

        await connection.commit();

        // 업데이트된 학생 정보 조회
        const [updatedStudents] = await db.query(
            'SELECT * FROM students WHERE id = ?',
            [studentId]
        );

        res.json({
            message: '휴식 처리가 완료되었습니다.',
            student: updatedStudents[0],
            restCredit
        });
    } catch (error) {
        await connection.rollback();
        console.error('Error processing rest:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to process rest'
        });
    } finally {
        connection.release();
    }
});

/**
 * POST /paca/students/:id/resume
 * 학생 휴식 복귀 처리
 * - 복귀 시 해당 월 학원비가 없으면 일할계산하여 자동 생성
 * Access: owner, admin
 */
router.post('/:id/resume', verifyToken, checkPermission('students', 'edit'), async (req, res) => {
    const studentId = parseInt(req.params.id);

    try {
        // 학생 존재 확인 (수강료 정보 포함)
        const [students] = await db.query(
            `SELECT s.id, s.name, s.status, s.class_days, s.monthly_tuition, s.discount_rate,
                    COALESCE(s.payment_due_day, ast.tuition_due_day, 5) as due_day
             FROM students s
             LEFT JOIN academy_settings ast ON s.academy_id = ast.academy_id
             WHERE s.id = ? AND s.academy_id = ? AND s.deleted_at IS NULL`,
            [studentId, req.user.academyId]
        );

        if (students.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Student not found'
            });
        }

        const student = students[0];

        if (student.status !== 'paused') {
            return res.status(400).json({
                error: 'Validation Error',
                message: '휴식 상태인 학생만 복귀할 수 있습니다.'
            });
        }

        // 상태를 active로 변경하고 휴식 정보 초기화
        await db.query(
            `UPDATE students SET
                status = 'active',
                rest_start_date = NULL,
                rest_end_date = NULL,
                rest_reason = NULL,
                updated_at = NOW()
             WHERE id = ?`,
            [studentId]
        );

        // class_days가 있으면 오늘부터 스케줄 재배정
        const classDays = student.class_days
            ? (typeof student.class_days === 'string'
                ? JSON.parse(student.class_days)
                : student.class_days)
            : [];

        let reassignResult = null;
        if (classDays.length > 0) {
            try {
                const today = new Date().toISOString().split('T')[0];
                reassignResult = await autoAssignStudentToSchedules(
                    db,
                    studentId,
                    req.user.academyId,
                    classDays,
                    today,
                    'evening'
                );
            } catch (assignError) {
                console.error('Auto-assign failed:', assignError);
            }
        }

        // 복귀 시 해당 월 학원비 자동 생성 (일할계산)
        let paymentCreated = null;
        try {
            const today = new Date();
            const year = today.getFullYear();
            const month = today.getMonth() + 1;
            const currentDay = today.getDate();
            const yearMonth = `${year}-${String(month).padStart(2, '0')}`;

            // 이미 해당 월 학원비가 있는지 확인
            const [existingPayment] = await db.query(
                `SELECT id FROM student_payments
                 WHERE student_id = ? AND academy_id = ? AND \`year_month\` = ? AND payment_type = 'monthly'`,
                [studentId, req.user.academyId, yearMonth]
            );

            if (existingPayment.length === 0 && student.monthly_tuition > 0) {
                // 일할계산: 복귀일부터 말일까지
                const lastDayOfMonth = new Date(year, month, 0).getDate();
                const remainingDays = lastDayOfMonth - currentDay + 1;

                // 수업 요일 기준 일할 계산
                const dayNameToNum = { '월': 1, '화': 2, '수': 3, '목': 4, '금': 5, '토': 6, '일': 0 };
                const classDayNums = classDays.map(d => dayNameToNum[d]).filter(d => d !== undefined);

                let totalClassDays = 0;
                let remainingClassDays = 0;

                for (let day = 1; day <= lastDayOfMonth; day++) {
                    const date = new Date(year, month - 1, day);
                    const dayOfWeek = date.getDay();
                    if (classDayNums.length === 0 || classDayNums.includes(dayOfWeek)) {
                        totalClassDays++;
                        if (day >= currentDay) {
                            remainingClassDays++;
                        }
                    }
                }

                const baseAmount = parseFloat(student.monthly_tuition);
                const discountRate = parseFloat(student.discount_rate) || 0;

                // 일할 금액 계산
                let proRatedAmount = baseAmount;
                if (totalClassDays > 0 && currentDay > 1) {
                    proRatedAmount = Math.floor((baseAmount * remainingClassDays / totalClassDays) / 1000) * 1000;
                }

                const discountAmount = Math.floor((proRatedAmount * discountRate / 100) / 1000) * 1000;
                const finalAmount = proRatedAmount - discountAmount;

                // 납부기한: 복귀일 + 7일
                const dueDate = new Date(today);
                dueDate.setDate(dueDate.getDate() + 7);

                const description = `${month}월 학원비 (${currentDay}일 복귀, 일할계산)`;
                const notes = `복귀일: ${currentDay}일, 남은 수업일: ${remainingClassDays}/${totalClassDays}일\n` +
                              `계산: ${baseAmount.toLocaleString()}원 × (${remainingClassDays}/${totalClassDays}) = ${proRatedAmount.toLocaleString()}원`;

                const [result] = await db.query(
                    `INSERT INTO student_payments (
                        student_id, academy_id, \`year_month\`, payment_type,
                        base_amount, discount_amount, additional_amount, final_amount,
                        is_prorated, due_date, payment_status, description, notes, recorded_by
                    ) VALUES (?, ?, ?, 'monthly', ?, ?, 0, ?, 1, ?, 'pending', ?, ?, ?)`,
                    [
                        studentId,
                        req.user.academyId,
                        yearMonth,
                        proRatedAmount,
                        discountAmount,
                        finalAmount,
                        dueDate.toISOString().split('T')[0],
                        description,
                        notes,
                        req.user.userId
                    ]
                );

                paymentCreated = {
                    id: result.insertId,
                    yearMonth,
                    baseAmount: proRatedAmount,
                    finalAmount,
                    remainingClassDays,
                    totalClassDays
                };
            }
        } catch (paymentError) {
            console.error('Auto payment creation failed:', paymentError);
        }

        // 업데이트된 학생 정보 조회
        const [updatedStudents] = await db.query(
            'SELECT * FROM students WHERE id = ?',
            [studentId]
        );

        res.json({
            message: paymentCreated
                ? `복귀 처리가 완료되었습니다. ${paymentCreated.yearMonth} 학원비 ${paymentCreated.finalAmount.toLocaleString()}원이 생성되었습니다.`
                : '복귀 처리가 완료되었습니다.',
            student: updatedStudents[0],
            scheduleAssigned: reassignResult,
            paymentCreated
        });
    } catch (error) {
        console.error('Error resuming student:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to resume student'
        });
    }
});

/**
 * GET /paca/students/:id/rest-credits
 * 학생의 휴식 크레딧 내역 조회
 * Access: owner, admin, teacher
 */
router.get('/:id/rest-credits', verifyToken, async (req, res) => {
    const studentId = parseInt(req.params.id);

    try {
        // 학생 존재 확인
        const [students] = await db.query(
            'SELECT id, name FROM students WHERE id = ? AND academy_id = ? AND deleted_at IS NULL',
            [studentId, req.user.academyId]
        );

        if (students.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Student not found'
            });
        }

        // 휴식 크레딧 내역 조회
        const [credits] = await db.query(
            `SELECT * FROM rest_credits
             WHERE student_id = ?
             ORDER BY created_at DESC`,
            [studentId]
        );

        // 미적용 크레딧 합계
        const pendingTotal = credits
            .filter(c => c.status === 'pending' || c.status === 'partial')
            .reduce((sum, c) => sum + (c.remaining_amount || 0), 0);

        res.json({
            message: `Found ${credits.length} rest credits`,
            student: students[0],
            credits,
            pendingTotal
        });
    } catch (error) {
        console.error('Error fetching rest credits:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to fetch rest credits'
        });
    }
});

module.exports = router;

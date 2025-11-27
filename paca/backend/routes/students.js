const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { verifyToken, requireRole } = require('../middleware/auth');

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
router.post('/', verifyToken, requireRole('owner', 'admin'), async (req, res) => {
    try {
        const {
            student_number,
            name,
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
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
            [
                req.user.academyId,
                finalStudentNumber,
                name,
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

        res.status(201).json({
            message: 'Student created successfully',
            student: createdStudent,
            firstPayment
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
router.put('/:id', verifyToken, requireRole('owner', 'admin'), async (req, res) => {
    const studentId = parseInt(req.params.id);

    try {
        // Check if student exists
        const [students] = await db.query(
            'SELECT id FROM students WHERE id = ? AND academy_id = ? AND deleted_at IS NULL',
            [studentId, req.user.academyId]
        );

        if (students.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Student not found'
            });
        }

        const {
            student_number,
            name,
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

        res.json({
            message: 'Student updated successfully',
            student: updatedStudents[0]
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
 * Soft delete student
 * Access: owner, admin
 */
router.delete('/:id', verifyToken, requireRole('owner', 'admin'), async (req, res) => {
    const studentId = parseInt(req.params.id);

    try {
        // Check if student exists
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

        // Soft delete
        await db.query(
            'UPDATE students SET deleted_at = NOW(), updated_at = NOW() WHERE id = ?',
            [studentId]
        );

        res.json({
            message: 'Student deleted successfully',
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
 * POST /paca/students/grade-upgrade
 * Bulk upgrade student grades (year-end transition)
 * Access: owner, admin
 *
 * Body: {
 *   upgrades: [
 *     { student_id: 1, new_grade: '고2', new_status: 'active' },
 *     { student_id: 2, new_grade: 'N수', new_status: 'active' },
 *     { student_id: 3, new_grade: null, new_status: 'graduated' }
 *   ]
 * }
 */
router.post('/grade-upgrade', verifyToken, requireRole('owner', 'admin'), async (req, res) => {
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

module.exports = router;

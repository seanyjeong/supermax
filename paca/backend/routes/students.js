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
        const { grade, grade_type, admission_type, status, search } = req.query;

        let query = `
            SELECT
                s.id,
                s.student_number,
                s.name,
                s.phone,
                s.parent_phone,
                s.school,
                s.grade,
                s.grade_type,
                s.admission_type,
                s.class_days,
                s.weekly_count,
                s.monthly_tuition,
                s.discount_rate,
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
            params.push(parseInt(grade));
        }

        if (grade_type) {
            query += ' AND s.grade_type = ?';
            params.push(grade_type);
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
                amount,
                paid_amount,
                payment_date,
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
            phone,
            parent_phone,
            school,
            grade,
            grade_type,
            admission_type,
            class_days,
            weekly_count,
            monthly_tuition,
            discount_rate,
            enrollment_date,
            address,
            notes
        } = req.body;

        // Validation - DB 스키마에 맞게 필수 필드만 검증
        // grade, parent_phone은 DB에서 nullable이므로 제외
        if (!name || !phone || !grade_type || !admission_type) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'Required fields: name, phone, grade_type, admission_type'
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
                phone,
                parent_phone,
                school,
                grade,
                grade_type,
                admission_type,
                class_days,
                weekly_count,
                monthly_tuition,
                discount_rate,
                enrollment_date,
                address,
                notes,
                status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
            [
                req.user.academyId,
                finalStudentNumber,
                name,
                phone,
                parent_phone,
                school || null,
                grade,
                grade_type,
                admission_type,
                JSON.stringify(class_days || []),
                weekly_count || 0,
                monthly_tuition || 0,
                discount_rate || 0,
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

        res.status(201).json({
            message: 'Student created successfully',
            student: students[0]
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
            phone,
            parent_phone,
            school,
            grade,
            grade_type,
            admission_type,
            class_days,
            weekly_count,
            monthly_tuition,
            discount_rate,
            enrollment_date,
            address,
            notes,
            status
        } = req.body;

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
        if (grade_type !== undefined) {
            updates.push('grade_type = ?');
            params.push(grade_type);
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

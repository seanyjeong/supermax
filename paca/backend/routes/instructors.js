const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { verifyToken, requireRole } = require('../middleware/auth');

/**
 * GET /paca/instructors
 * Get all instructors with optional filters
 * Access: owner, admin
 */
router.get('/', verifyToken, requireRole('owner', 'admin'), async (req, res) => {
    try {
        const { status, salary_type, instructor_type, search } = req.query;

        let query = `
            SELECT
                i.id,
                i.name,
                i.phone,
                i.hire_date,
                i.salary_type,
                i.instructor_type,
                i.hourly_rate,
                i.base_salary,
                i.tax_type,
                i.work_days,
                i.work_start_time,
                i.work_end_time,
                i.status,
                i.created_at
            FROM instructors i
            WHERE i.academy_id = ?
            AND i.deleted_at IS NULL
        `;

        const params = [req.user.academyId];

        if (status) {
            query += ' AND i.status = ?';
            params.push(status);
        }

        if (salary_type) {
            query += ' AND i.salary_type = ?';
            params.push(salary_type);
        }

        if (instructor_type) {
            query += ' AND i.instructor_type = ?';
            params.push(instructor_type);
        }

        if (search) {
            query += ' AND (i.name LIKE ? OR i.phone LIKE ?)';
            const searchTerm = `%${search}%`;
            params.push(searchTerm, searchTerm);
        }

        query += ' ORDER BY i.hire_date DESC';

        const [instructors] = await db.query(query, params);

        res.json({
            message: `Found ${instructors.length} instructors`,
            instructors
        });
    } catch (error) {
        console.error('Error fetching instructors:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to fetch instructors'
        });
    }
});

// ============================================
// 고정 라우트 (/:id 보다 먼저 정의해야 함)
// ============================================

/**
 * GET /paca/instructors/overtime/pending
 * Get all pending overtime approval requests
 * Access: owner, admin
 */
router.get('/overtime/pending', verifyToken, requireRole('owner', 'admin'), async (req, res) => {
    try {
        const [requests] = await db.query(`
            SELECT
                oa.*,
                i.name as instructor_name,
                i.salary_type,
                i.hourly_rate
            FROM overtime_approvals oa
            JOIN instructors i ON oa.instructor_id = i.id
            WHERE oa.academy_id = ?
            AND oa.status = 'pending'
            ORDER BY oa.created_at DESC
        `, [req.user.academyId]);

        res.json({
            message: `Found ${requests.length} pending requests`,
            requests
        });
    } catch (error) {
        console.error('Error fetching overtime requests:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to fetch overtime requests'
        });
    }
});

/**
 * GET /paca/instructors/overtime/history
 * Get overtime approval history
 * Access: owner, admin
 */
router.get('/overtime/history', verifyToken, requireRole('owner', 'admin'), async (req, res) => {
    const { year, month, instructor_id } = req.query;

    try {
        let query = `
            SELECT
                oa.*,
                i.name as instructor_name,
                i.salary_type,
                i.hourly_rate,
                u.name as approved_by_name
            FROM overtime_approvals oa
            JOIN instructors i ON oa.instructor_id = i.id
            LEFT JOIN users u ON oa.approved_by = u.id
            WHERE oa.academy_id = ?
        `;
        const params = [req.user.academyId];

        if (year && month) {
            query += ` AND DATE_FORMAT(oa.work_date, '%Y-%m') = ?`;
            params.push(`${year}-${String(month).padStart(2, '0')}`);
        }

        if (instructor_id) {
            query += ' AND oa.instructor_id = ?';
            params.push(instructor_id);
        }

        query += ' ORDER BY oa.work_date DESC, oa.created_at DESC';

        const [requests] = await db.query(query, params);

        res.json({
            message: `Found ${requests.length} overtime records`,
            requests
        });
    } catch (error) {
        console.error('Error fetching overtime history:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to fetch overtime history'
        });
    }
});

/**
 * PUT /paca/instructors/overtime/:approvalId/approve
 * Approve or reject overtime request
 * Access: owner, admin
 */
router.put('/overtime/:approvalId/approve', verifyToken, requireRole('owner', 'admin'), async (req, res) => {
    const approvalId = parseInt(req.params.approvalId);

    try {
        const { status, notes } = req.body;  // status: 'approved' | 'rejected'

        if (!status || !['approved', 'rejected'].includes(status)) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'status must be approved or rejected'
            });
        }

        // Check if request exists
        const [requests] = await db.query(
            'SELECT * FROM overtime_approvals WHERE id = ? AND academy_id = ?',
            [approvalId, req.user.academyId]
        );

        if (requests.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Overtime request not found'
            });
        }

        if (requests[0].status !== 'pending') {
            return res.status(400).json({
                error: 'Invalid State',
                message: 'This request has already been processed'
            });
        }

        await db.query(
            `UPDATE overtime_approvals
             SET status = ?, approved_by = ?, approved_at = NOW(), notes = COALESCE(?, notes)
             WHERE id = ?`,
            [status, req.user.id, notes, approvalId]
        );

        const [updated] = await db.query(
            'SELECT * FROM overtime_approvals WHERE id = ?',
            [approvalId]
        );

        res.json({
            message: `Overtime request ${status}`,
            overtime: updated[0]
        });
    } catch (error) {
        console.error('Error approving overtime:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to process overtime request'
        });
    }
});

/**
 * POST /paca/instructors/verify-admin-password
 * Verify admin password for approval operations
 * Access: owner, admin
 */
router.post('/verify-admin-password', verifyToken, requireRole('owner', 'admin'), async (req, res) => {
    try {
        const { password } = req.body;

        if (!password) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'Password is required'
            });
        }

        // Get user with password
        const [users] = await db.query(
            'SELECT id, password FROM users WHERE id = ?',
            [req.user.id]
        );

        if (users.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'User not found'
            });
        }

        const bcrypt = require('bcryptjs');
        const isMatch = await bcrypt.compare(password, users[0].password);

        if (!isMatch) {
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'Invalid password',
                verified: false
            });
        }

        res.json({
            message: 'Password verified',
            verified: true
        });
    } catch (error) {
        console.error('Error verifying password:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to verify password'
        });
    }
});

// ============================================
// 파라미터 라우트 (/:id)
// ============================================

/**
 * GET /paca/instructors/:id
 * Get instructor by ID with attendance and salary records
 * Access: owner, admin
 */
router.get('/:id', verifyToken, requireRole('owner', 'admin'), async (req, res) => {
    const instructorId = parseInt(req.params.id);

    try {
        // Get instructor basic info
        const [instructors] = await db.query(
            `SELECT
                i.*,
                a.name as academy_name
            FROM instructors i
            LEFT JOIN academies a ON i.academy_id = a.id
            WHERE i.id = ?
            AND i.academy_id = ?
            AND i.deleted_at IS NULL`,
            [instructorId, req.user.academyId]
        );

        if (instructors.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Instructor not found'
            });
        }

        const instructor = instructors[0];

        // Get recent attendance records
        const [attendances] = await db.query(
            `SELECT
                id,
                work_date,
                time_slot,
                check_in_time,
                check_out_time,
                attendance_status,
                notes,
                created_at
            FROM instructor_attendance
            WHERE instructor_id = ?
            ORDER BY work_date DESC
            LIMIT 30`,
            [instructorId]
        );

        // Get recent salary records
        const [salaries] = await db.query(
            `SELECT
                id,
                \`year_month\`,
                base_amount,
                incentive_amount,
                total_deduction,
                tax_amount,
                net_salary,
                payment_date,
                payment_status
            FROM salary_records
            WHERE instructor_id = ?
            ORDER BY \`year_month\` DESC
            LIMIT 12`,
            [instructorId]
        );

        res.json({
            instructor,
            attendances,
            salaries
        });
    } catch (error) {
        console.error('Error fetching instructor:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to fetch instructor'
        });
    }
});

/**
 * POST /paca/instructors
 * Create new instructor
 * Access: owner, admin
 */
router.post('/', verifyToken, requireRole('owner', 'admin'), async (req, res) => {
    try {
        const {
            name,
            phone,
            email,
            hire_date,
            salary_type,
            instructor_type,  // 'teacher' | 'assistant'
            hourly_rate,
            base_salary,
            tax_type,
            bank_name,
            account_number,
            address,
            notes,
            // 사무보조용 필드
            work_days,        // [1, 3, 5] 형태
            work_start_time,  // 'HH:MM' 형태
            work_end_time     // 'HH:MM' 형태
        } = req.body;

        // Validation
        if (!name || !phone || !salary_type || !tax_type) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'Required fields: name, phone, salary_type, tax_type'
            });
        }

        // Validate salary_type
        if (!['hourly', 'per_class', 'monthly', 'mixed'].includes(salary_type)) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'salary_type must be one of: hourly, per_class, monthly, mixed'
            });
        }

        // Validate instructor_type (시급일 때만)
        const finalInstructorType = salary_type === 'hourly' && instructor_type
            ? instructor_type
            : (salary_type === 'hourly' ? 'teacher' : null);

        if (finalInstructorType && !['teacher', 'assistant'].includes(finalInstructorType)) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'instructor_type must be teacher or assistant'
            });
        }

        // Validate tax_type
        if (!['3.3%', 'insurance', 'none'].includes(tax_type)) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'tax_type must be one of: 3.3%, insurance, none'
            });
        }

        // Validate salary amounts
        if (salary_type === 'monthly' && !base_salary) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'base_salary is required when salary_type is monthly'
            });
        }

        if ((salary_type === 'hourly' || salary_type === 'per_class') && !hourly_rate) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'hourly_rate is required when salary_type is hourly or per_class'
            });
        }

        // 사무보조인 경우 근무 설정 필수
        if (finalInstructorType === 'assistant') {
            if (!work_days || work_days.length === 0) {
                return res.status(400).json({
                    error: 'Validation Error',
                    message: 'work_days is required for assistant type'
                });
            }
            if (!work_start_time || !work_end_time) {
                return res.status(400).json({
                    error: 'Validation Error',
                    message: 'work_start_time and work_end_time are required for assistant type'
                });
            }
        }

        // Insert instructor
        const [result] = await db.query(
            `INSERT INTO instructors (
                academy_id,
                name,
                phone,
                email,
                hire_date,
                salary_type,
                instructor_type,
                hourly_rate,
                base_salary,
                tax_type,
                bank_name,
                account_number,
                address,
                notes,
                work_days,
                work_start_time,
                work_end_time,
                status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
            [
                req.user.academyId,
                name,
                phone,
                email || null,
                hire_date || new Date().toISOString().split('T')[0],
                salary_type,
                finalInstructorType,
                hourly_rate || 0,
                base_salary || 0,
                tax_type,
                bank_name || null,
                account_number || null,
                address || null,
                notes || null,
                work_days ? JSON.stringify(work_days) : null,
                work_start_time || null,
                work_end_time || null
            ]
        );

        // Fetch created instructor
        const [instructors] = await db.query(
            'SELECT * FROM instructors WHERE id = ?',
            [result.insertId]
        );

        res.status(201).json({
            message: 'Instructor created successfully',
            instructor: instructors[0]
        });
    } catch (error) {
        console.error('Error creating instructor:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to create instructor'
        });
    }
});

/**
 * PUT /paca/instructors/:id
 * Update instructor
 * Access: owner, admin
 */
router.put('/:id', verifyToken, requireRole('owner', 'admin'), async (req, res) => {
    const instructorId = parseInt(req.params.id);

    try {
        // Check if instructor exists
        const [instructors] = await db.query(
            'SELECT id FROM instructors WHERE id = ? AND academy_id = ? AND deleted_at IS NULL',
            [instructorId, req.user.academyId]
        );

        if (instructors.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Instructor not found'
            });
        }

        const {
            name,
            phone,
            email,
            hire_date,
            salary_type,
            instructor_type,  // 'teacher' | 'assistant'
            hourly_rate,
            base_salary,
            tax_type,
            bank_name,
            account_number,
            address,
            notes,
            status,
            // 사무보조용 필드
            work_days,        // [1, 3, 5] 형태
            work_start_time,  // 'HH:MM' 형태
            work_end_time     // 'HH:MM' 형태
        } = req.body;

        // Check if new email already exists (if changed)
        if (email) {
            const [existing] = await db.query(
                'SELECT id FROM instructors WHERE email = ? AND academy_id = ? AND id != ? AND deleted_at IS NULL',
                [email, req.user.academyId, instructorId]
            );

            if (existing.length > 0) {
                return res.status(400).json({
                    error: 'Validation Error',
                    message: 'Email already exists'
                });
            }
        }

        // Build update query dynamically
        const updates = [];
        const params = [];

        if (name !== undefined) {
            updates.push('name = ?');
            params.push(name);
        }
        if (phone !== undefined) {
            updates.push('phone = ?');
            params.push(phone);
        }
        if (email !== undefined) {
            updates.push('email = ?');
            params.push(email);
        }
        if (hire_date !== undefined) {
            updates.push('hire_date = ?');
            params.push(hire_date);
        }
        if (salary_type !== undefined) {
            updates.push('salary_type = ?');
            params.push(salary_type);
        }
        if (hourly_rate !== undefined) {
            updates.push('hourly_rate = ?');
            params.push(hourly_rate);
        }
        if (base_salary !== undefined) {
            updates.push('base_salary = ?');
            params.push(base_salary);
        }
        if (tax_type !== undefined) {
            updates.push('tax_type = ?');
            params.push(tax_type);
        }
        if (bank_name !== undefined) {
            updates.push('bank_name = ?');
            params.push(bank_name);
        }
        if (account_number !== undefined) {
            updates.push('account_number = ?');
            params.push(account_number);
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
        if (instructor_type !== undefined) {
            updates.push('instructor_type = ?');
            params.push(instructor_type);
        }
        if (work_days !== undefined) {
            updates.push('work_days = ?');
            params.push(work_days ? JSON.stringify(work_days) : null);
        }
        if (work_start_time !== undefined) {
            updates.push('work_start_time = ?');
            params.push(work_start_time || null);
        }
        if (work_end_time !== undefined) {
            updates.push('work_end_time = ?');
            params.push(work_end_time || null);
        }

        if (updates.length === 0) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'No fields to update'
            });
        }

        updates.push('updated_at = NOW()');
        params.push(instructorId);

        await db.query(
            `UPDATE instructors SET ${updates.join(', ')} WHERE id = ?`,
            params
        );

        // Fetch updated instructor
        const [updatedInstructors] = await db.query(
            'SELECT * FROM instructors WHERE id = ?',
            [instructorId]
        );

        res.json({
            message: 'Instructor updated successfully',
            instructor: updatedInstructors[0]
        });
    } catch (error) {
        console.error('Error updating instructor:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to update instructor'
        });
    }
});

/**
 * DELETE /paca/instructors/:id
 * Soft delete instructor
 * Access: owner, admin
 */
router.delete('/:id', verifyToken, requireRole('owner', 'admin'), async (req, res) => {
    const instructorId = parseInt(req.params.id);

    try {
        // Check if instructor exists
        const [instructors] = await db.query(
            'SELECT id, name FROM instructors WHERE id = ? AND academy_id = ? AND deleted_at IS NULL',
            [instructorId, req.user.academyId]
        );

        if (instructors.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Instructor not found'
            });
        }

        // Soft delete
        await db.query(
            'UPDATE instructors SET deleted_at = NOW(), updated_at = NOW() WHERE id = ?',
            [instructorId]
        );

        res.json({
            message: 'Instructor deleted successfully',
            instructor: {
                id: instructorId,
                name: instructors[0].name
            }
        });
    } catch (error) {
        console.error('Error deleting instructor:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to delete instructor'
        });
    }
});

/**
 * POST /paca/instructors/:id/attendance
 * Record instructor attendance (check-in/check-out)
 * Access: owner, admin, instructor (self)
 */
router.post('/:id/attendance', verifyToken, async (req, res) => {
    const instructorId = parseInt(req.params.id);

    try {
        // Check if instructor exists
        const [instructors] = await db.query(
            'SELECT id, name FROM instructors WHERE id = ? AND academy_id = ? AND deleted_at IS NULL',
            [instructorId, req.user.academyId]
        );

        if (instructors.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Instructor not found'
            });
        }

        const { work_date, time_slot, check_in_time, check_out_time, attendance_status, notes } = req.body;

        if (!work_date || !time_slot) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'work_date and time_slot are required'
            });
        }

        // Check if attendance record already exists for this date and time_slot
        const [existing] = await db.query(
            'SELECT id FROM instructor_attendance WHERE instructor_id = ? AND work_date = ? AND time_slot = ?',
            [instructorId, work_date, time_slot]
        );

        if (existing.length > 0) {
            // Update existing record
            await db.query(
                `UPDATE instructor_attendance
                SET check_in_time = ?, check_out_time = ?, attendance_status = ?, notes = ?, updated_at = NOW()
                WHERE id = ?`,
                [check_in_time || null, check_out_time || null, attendance_status || 'present', notes || null, existing[0].id]
            );

            const [updated] = await db.query(
                'SELECT * FROM instructor_attendance WHERE id = ?',
                [existing[0].id]
            );

            return res.json({
                message: 'Attendance updated successfully',
                attendance: updated[0]
            });
        } else {
            // Insert new record
            const [result] = await db.query(
                `INSERT INTO instructor_attendance (
                    instructor_id,
                    work_date,
                    time_slot,
                    check_in_time,
                    check_out_time,
                    attendance_status,
                    notes
                ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [instructorId, work_date, time_slot, check_in_time || null, check_out_time || null, attendance_status || 'present', notes || null]
            );

            const [created] = await db.query(
                'SELECT * FROM instructor_attendance WHERE id = ?',
                [result.insertId]
            );

            return res.status(201).json({
                message: 'Attendance recorded successfully',
                attendance: created[0]
            });
        }
    } catch (error) {
        console.error('Error recording attendance:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to record attendance'
        });
    }
});

/**
 * GET /paca/instructors/:id/attendance
 * Get instructor attendance records
 * Access: owner, admin
 */
router.get('/:id/attendance', verifyToken, requireRole('owner', 'admin'), async (req, res) => {
    const instructorId = parseInt(req.params.id);
    const { year, month } = req.query;

    try {
        let query = `
            SELECT
                id,
                work_date,
                time_slot,
                check_in_time,
                check_out_time,
                attendance_status,
                notes,
                created_at
            FROM instructor_attendance
            WHERE instructor_id = ?
        `;

        const params = [instructorId];

        if (year && month) {
            query += ` AND DATE_FORMAT(work_date, '%Y-%m') = ?`;
            params.push(`${year}-${String(month).padStart(2, '0')}`);
        }

        query += ' ORDER BY work_date DESC';

        const [attendances] = await db.query(query, params);

        res.json({
            message: `Found ${attendances.length} attendance records`,
            attendances
        });
    } catch (error) {
        console.error('Error fetching attendance:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to fetch attendance records'
        });
    }
});

/**
 * POST /paca/instructors/:id/overtime
 * Create overtime approval request
 * Access: owner, admin
 */
router.post('/:id/overtime', verifyToken, requireRole('owner', 'admin'), async (req, res) => {
    const instructorId = parseInt(req.params.id);

    try {
        const {
            work_date,
            time_slot,
            request_type,       // 'overtime' | 'extra_day'
            original_end_time,
            actual_end_time,
            overtime_minutes,
            notes
        } = req.body;

        if (!work_date || !request_type) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'work_date and request_type are required'
            });
        }

        // Check if instructor exists
        const [instructors] = await db.query(
            'SELECT id, name, instructor_type FROM instructors WHERE id = ? AND academy_id = ? AND deleted_at IS NULL',
            [instructorId, req.user.academyId]
        );

        if (instructors.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Instructor not found'
            });
        }

        // Check for duplicate
        const [existing] = await db.query(
            `SELECT id FROM overtime_approvals
             WHERE instructor_id = ? AND work_date = ? AND time_slot <=> ?`,
            [instructorId, work_date, time_slot || null]
        );

        if (existing.length > 0) {
            return res.status(400).json({
                error: 'Duplicate',
                message: 'Overtime request already exists for this date and time slot'
            });
        }

        const [result] = await db.query(
            `INSERT INTO overtime_approvals (
                academy_id,
                instructor_id,
                work_date,
                time_slot,
                request_type,
                original_end_time,
                actual_end_time,
                overtime_minutes,
                notes
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                req.user.academyId,
                instructorId,
                work_date,
                time_slot || null,
                request_type,
                original_end_time || null,
                actual_end_time || null,
                overtime_minutes || 0,
                notes || null
            ]
        );

        const [created] = await db.query(
            'SELECT * FROM overtime_approvals WHERE id = ?',
            [result.insertId]
        );

        res.status(201).json({
            message: 'Overtime request created',
            overtime: created[0]
        });
    } catch (error) {
        console.error('Error creating overtime request:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to create overtime request'
        });
    }
});

module.exports = router;

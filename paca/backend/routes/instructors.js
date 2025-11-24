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
        const { status, salary_type, search } = req.query;

        let query = `
            SELECT
                i.id,
                i.name,
                i.phone,
                i.hire_date,
                i.salary_type,
                i.hourly_rate,
                i.base_salary,
                i.tax_type,
                i.status,
                i.created_at
            FROM instructors i
            WHERE i.academy_id = ?
            AND i.is_deleted = false
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
            AND i.is_deleted = false`,
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
                attendance_date,
                check_in,
                check_out,
                work_hours,
                notes,
                created_at
            FROM instructor_attendance
            WHERE instructor_id = ?
            ORDER BY attendance_date DESC
            LIMIT 30`,
            [instructorId]
        );

        // Get recent salary records
        const [salaries] = await db.query(
            `SELECT
                id,
                \`year_month\`,
                base_amount,
                bonus,
                deduction,
                tax_amount,
                insurance_amount,
                net_amount,
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
            hourly_rate,
            base_salary,
            tax_type,
            bank_name,
            account_number,
            address,
            notes
        } = req.body;

        // Validation
        if (!name || !phone || !salary_type || !tax_type) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'Required fields: name, phone, salary_type, tax_type'
            });
        }

        // Validate salary_type
        if (!['hourly', 'per_class', 'monthly'].includes(salary_type)) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'salary_type must be one of: hourly, per_class, monthly'
            });
        }

        // Validate tax_type
        if (!['tax_3_3', 'insurance', 'none'].includes(tax_type)) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'tax_type must be one of: tax_3_3, insurance, none'
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

        // Insert instructor
        const [result] = await db.query(
            `INSERT INTO instructors (
                academy_id,
                name,
                phone,
                email,
                hire_date,
                salary_type,
                hourly_rate,
                base_salary,
                tax_type,
                bank_name,
                account_number,
                address,
                notes,
                status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
            [
                req.user.academyId,
                name,
                phone,
                email || null,
                hire_date || new Date().toISOString().split('T')[0],
                salary_type,
                hourly_rate || 0,
                base_salary || 0,
                tax_type,
                bank_name || null,
                account_number || null,
                address || null,
                notes || null
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
            'SELECT id FROM instructors WHERE id = ? AND academy_id = ? AND is_deleted = false',
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
            hourly_rate,
            base_salary,
            tax_type,
            bank_name,
            account_number,
            address,
            notes,
            status
        } = req.body;

        // Check if new email already exists (if changed)
        if (email) {
            const [existing] = await db.query(
                'SELECT id FROM instructors WHERE email = ? AND academy_id = ? AND id != ? AND is_deleted = false',
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
            'SELECT id, name FROM instructors WHERE id = ? AND academy_id = ? AND is_deleted = false',
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
            'UPDATE instructors SET is_deleted = true, updated_at = NOW() WHERE id = ?',
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
            'SELECT id, name FROM instructors WHERE id = ? AND academy_id = ? AND is_deleted = false',
            [instructorId, req.user.academyId]
        );

        if (instructors.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Instructor not found'
            });
        }

        const { attendance_date, check_in, check_out, notes } = req.body;

        if (!attendance_date) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'attendance_date is required'
            });
        }

        // Calculate work hours if both check_in and check_out are provided
        let work_hours = null;
        if (check_in && check_out) {
            const checkInTime = new Date(`2000-01-01 ${check_in}`);
            const checkOutTime = new Date(`2000-01-01 ${check_out}`);
            work_hours = (checkOutTime - checkInTime) / (1000 * 60 * 60); // hours
        }

        // Check if attendance record already exists for this date
        const [existing] = await db.query(
            'SELECT id FROM instructor_attendance WHERE instructor_id = ? AND attendance_date = ?',
            [instructorId, attendance_date]
        );

        if (existing.length > 0) {
            // Update existing record
            await db.query(
                `UPDATE instructor_attendance
                SET check_in = ?, check_out = ?, work_hours = ?, notes = ?, updated_at = NOW()
                WHERE id = ?`,
                [check_in, check_out, work_hours, notes || null, existing[0].id]
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
                    attendance_date,
                    check_in,
                    check_out,
                    work_hours,
                    notes
                ) VALUES (?, ?, ?, ?, ?, ?)`,
                [instructorId, attendance_date, check_in, check_out, work_hours, notes || null]
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
                attendance_date,
                check_in,
                check_out,
                work_hours,
                notes,
                created_at
            FROM instructor_attendance
            WHERE instructor_id = ?
        `;

        const params = [instructorId];

        if (year && month) {
            query += ` AND DATE_FORMAT(attendance_date, '%Y-%m') = ?`;
            params.push(`${year}-${String(month).padStart(2, '0')}`);
        }

        query += ' ORDER BY attendance_date DESC';

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

module.exports = router;

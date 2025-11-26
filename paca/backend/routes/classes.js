const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { verifyToken, requireRole } = require('../middleware/auth');

/**
 * GET /paca/classes
 * Get all classes (반 목록)
 * Access: owner, admin, teacher
 */
router.get('/', verifyToken, async (req, res) => {
    try {
        const { status, grade, grade_type, admission_type } = req.query;

        let query = `
            SELECT
                c.id,
                c.class_name,
                c.grade,
                c.grade_type,
                c.admission_type,
                c.description,
                c.default_time_slot,
                c.status,
                c.created_at,
                c.updated_at,
                (SELECT COUNT(*) FROM class_schedules cs WHERE cs.class_id = c.id) AS schedule_count
            FROM classes c
            WHERE c.academy_id = ?
        `;

        const params = [req.user.academyId];

        if (status) {
            query += ' AND c.status = ?';
            params.push(status);
        }

        if (grade) {
            query += ' AND c.grade = ?';
            params.push(parseInt(grade));
        }

        if (grade_type) {
            query += ' AND c.grade_type = ?';
            params.push(grade_type);
        }

        if (admission_type) {
            query += ' AND c.admission_type = ?';
            params.push(admission_type);
        }

        query += ' ORDER BY c.grade DESC, c.class_name ASC';

        const [classes] = await db.query(query, params);

        res.json({
            message: `Found ${classes.length} classes`,
            classes
        });
    } catch (error) {
        console.error('Error fetching classes:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to fetch classes'
        });
    }
});

/**
 * GET /paca/classes/:id
 * Get class details with schedules
 * Access: owner, admin, teacher
 */
router.get('/:id', verifyToken, async (req, res) => {
    const classId = parseInt(req.params.id);

    try {
        // Get class info
        const [classes] = await db.query(
            `SELECT * FROM classes WHERE id = ? AND academy_id = ?`,
            [classId, req.user.academyId]
        );

        if (classes.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Class not found'
            });
        }

        // Get recent schedules for this class
        const [schedules] = await db.query(
            `SELECT
                cs.id,
                cs.class_date,
                cs.time_slot,
                cs.instructor_id,
                i.name AS instructor_name,
                cs.attendance_taken
            FROM class_schedules cs
            LEFT JOIN instructors i ON cs.instructor_id = i.id
            WHERE cs.class_id = ?
            AND cs.class_date >= CURDATE() - INTERVAL 30 DAY
            ORDER BY cs.class_date DESC
            LIMIT 50`,
            [classId]
        );

        res.json({
            message: 'Class found',
            class: classes[0],
            schedules
        });
    } catch (error) {
        console.error('Error fetching class:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to fetch class'
        });
    }
});

/**
 * POST /paca/classes
 * Create new class (반 생성)
 * Access: owner, admin only
 */
router.post('/', verifyToken, requireRole('owner', 'admin'), async (req, res) => {
    try {
        const { class_name, grade, grade_type, admission_type, description, default_time_slot } = req.body;

        // Validation
        if (!class_name) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'class_name is required'
            });
        }

        // Validate grade_type
        if (grade_type && !['middle', 'high'].includes(grade_type)) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'grade_type must be middle or high'
            });
        }

        // Validate admission_type
        if (admission_type && !['regular', 'early'].includes(admission_type)) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'admission_type must be regular or early'
            });
        }

        // Validate default_time_slot
        if (default_time_slot && !['morning', 'afternoon', 'evening'].includes(default_time_slot)) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'default_time_slot must be morning, afternoon, or evening'
            });
        }

        // Check for duplicate class name
        const [existing] = await db.query(
            'SELECT id FROM classes WHERE academy_id = ? AND class_name = ?',
            [req.user.academyId, class_name]
        );

        if (existing.length > 0) {
            return res.status(409).json({
                error: 'Conflict',
                message: 'A class with this name already exists'
            });
        }

        // Create class
        const [result] = await db.query(
            `INSERT INTO classes
            (academy_id, class_name, grade, grade_type, admission_type, description, default_time_slot)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                req.user.academyId,
                class_name,
                grade || null,
                grade_type || 'high',
                admission_type || 'regular',
                description || null,
                default_time_slot || 'afternoon'
            ]
        );

        // Fetch created class
        const [newClass] = await db.query(
            'SELECT * FROM classes WHERE id = ?',
            [result.insertId]
        );

        res.status(201).json({
            message: 'Class created successfully',
            class: newClass[0]
        });
    } catch (error) {
        console.error('Error creating class:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to create class'
        });
    }
});

/**
 * PUT /paca/classes/:id
 * Update class
 * Access: owner, admin only
 */
router.put('/:id', verifyToken, requireRole('owner', 'admin'), async (req, res) => {
    const classId = parseInt(req.params.id);

    try {
        // Check if class exists
        const [classes] = await db.query(
            'SELECT id FROM classes WHERE id = ? AND academy_id = ?',
            [classId, req.user.academyId]
        );

        if (classes.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Class not found'
            });
        }

        const { class_name, grade, grade_type, admission_type, description, default_time_slot, status } = req.body;

        // Check for duplicate name if changing
        if (class_name) {
            const [existing] = await db.query(
                'SELECT id FROM classes WHERE academy_id = ? AND class_name = ? AND id != ?',
                [req.user.academyId, class_name, classId]
            );

            if (existing.length > 0) {
                return res.status(409).json({
                    error: 'Conflict',
                    message: 'A class with this name already exists'
                });
            }
        }

        // Build update query dynamically
        const updates = [];
        const params = [];

        if (class_name !== undefined) {
            updates.push('class_name = ?');
            params.push(class_name);
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
        if (description !== undefined) {
            updates.push('description = ?');
            params.push(description);
        }
        if (default_time_slot !== undefined) {
            updates.push('default_time_slot = ?');
            params.push(default_time_slot);
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

        params.push(classId);

        await db.query(
            `UPDATE classes SET ${updates.join(', ')} WHERE id = ?`,
            params
        );

        // Fetch updated class
        const [updated] = await db.query(
            'SELECT * FROM classes WHERE id = ?',
            [classId]
        );

        res.json({
            message: 'Class updated successfully',
            class: updated[0]
        });
    } catch (error) {
        console.error('Error updating class:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to update class'
        });
    }
});

/**
 * DELETE /paca/classes/:id
 * Delete class
 * Access: owner, admin only
 */
router.delete('/:id', verifyToken, requireRole('owner', 'admin'), async (req, res) => {
    const classId = parseInt(req.params.id);

    try {
        // Check if class exists
        const [classes] = await db.query(
            'SELECT id, class_name FROM classes WHERE id = ? AND academy_id = ?',
            [classId, req.user.academyId]
        );

        if (classes.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Class not found'
            });
        }

        // Check if class has schedules
        const [schedules] = await db.query(
            'SELECT COUNT(*) as count FROM class_schedules WHERE class_id = ?',
            [classId]
        );

        if (schedules[0].count > 0) {
            // Set class_id to NULL in related schedules instead of preventing deletion
            await db.query(
                'UPDATE class_schedules SET class_id = NULL WHERE class_id = ?',
                [classId]
            );
        }

        // Delete class
        await db.query('DELETE FROM classes WHERE id = ?', [classId]);

        res.json({
            message: 'Class deleted successfully',
            class: {
                id: classId,
                class_name: classes[0].class_name
            }
        });
    } catch (error) {
        console.error('Error deleting class:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to delete class'
        });
    }
});

module.exports = router;

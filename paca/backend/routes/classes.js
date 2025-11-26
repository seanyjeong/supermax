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
        const { status, grade, class_type, admission_type } = req.query;

        let query = `
            SELECT
                c.id,
                c.class_name,
                c.class_type,
                c.grade,
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
            params.push(grade);
        }

        if (class_type) {
            query += ' AND c.class_type = ?';
            params.push(class_type);
        }

        if (admission_type) {
            query += ' AND c.admission_type = ?';
            params.push(admission_type);
        }

        query += ' ORDER BY c.class_type, c.grade, c.class_name ASC';

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
 * GET /paca/classes/by-date/:date
 * Get classes that have schedules on a specific date
 * Access: owner, admin, teacher
 */
router.get('/by-date/:date', verifyToken, async (req, res) => {
    const dateParam = req.params.date;

    try {
        // Validate date format
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(dateParam)) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'Date must be in YYYY-MM-DD format'
            });
        }

        // Get classes that have schedules on this date
        const [classesWithSchedules] = await db.query(
            `SELECT DISTINCT
                c.id,
                c.class_name,
                c.class_type,
                c.grade,
                c.admission_type,
                c.default_time_slot,
                c.status,
                cs.id AS schedule_id,
                cs.time_slot,
                cs.instructor_id,
                i.name AS instructor_name
            FROM classes c
            INNER JOIN class_schedules cs ON cs.class_id = c.id
            LEFT JOIN instructors i ON cs.instructor_id = i.id
            WHERE c.academy_id = ?
            AND cs.class_date = ?
            ORDER BY cs.time_slot, c.class_name`,
            [req.user.academyId, dateParam]
        );

        // Group by class
        const classesMap = new Map();
        for (const row of classesWithSchedules) {
            if (!classesMap.has(row.id)) {
                classesMap.set(row.id, {
                    id: row.id,
                    class_name: row.class_name,
                    class_type: row.class_type,
                    grade: row.grade,
                    admission_type: row.admission_type,
                    default_time_slot: row.default_time_slot,
                    status: row.status,
                    schedules: []
                });
            }
            classesMap.get(row.id).schedules.push({
                schedule_id: row.schedule_id,
                time_slot: row.time_slot,
                instructor_id: row.instructor_id,
                instructor_name: row.instructor_name
            });
        }

        const classes = Array.from(classesMap.values());

        res.json({
            message: `Found ${classes.length} classes with schedules on ${dateParam}`,
            date: dateParam,
            classes
        });
    } catch (error) {
        console.error('Error fetching classes by date:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to fetch classes by date'
        });
    }
});

/**
 * PUT /paca/classes/:classId/schedules/:date/assign-instructors
 * Assign multiple instructors to a class schedule on a specific date
 * Access: owner, admin
 */
router.put('/:classId/schedules/:date/assign-instructors', verifyToken, requireRole('owner', 'admin'), async (req, res) => {
    const classId = parseInt(req.params.classId);
    const dateParam = req.params.date;

    try {
        const { instructor_ids, time_slot } = req.body;

        // Validate
        if (!Array.isArray(instructor_ids) || instructor_ids.length === 0) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'instructor_ids must be a non-empty array'
            });
        }

        if (!time_slot || !['morning', 'afternoon', 'evening'].includes(time_slot)) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'time_slot must be morning, afternoon, or evening'
            });
        }

        // Check class exists
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

        // Get existing schedule for this class on this date
        const [existingSchedules] = await db.query(
            `SELECT id FROM class_schedules
             WHERE class_id = ? AND class_date = ? AND time_slot = ?`,
            [classId, dateParam, time_slot]
        );

        const updatedSchedules = [];

        if (existingSchedules.length > 0) {
            // Update existing schedule with first instructor
            const scheduleId = existingSchedules[0].id;
            await db.query(
                'UPDATE class_schedules SET instructor_id = ? WHERE id = ?',
                [instructor_ids[0], scheduleId]
            );
            updatedSchedules.push(scheduleId);

            // Create additional schedules for extra instructors
            for (let i = 1; i < instructor_ids.length; i++) {
                const [result] = await db.query(
                    `INSERT INTO class_schedules (academy_id, class_id, class_date, time_slot, instructor_id)
                     VALUES (?, ?, ?, ?, ?)`,
                    [req.user.academyId, classId, dateParam, time_slot, instructor_ids[i]]
                );
                updatedSchedules.push(result.insertId);
            }
        } else {
            // Create new schedules for all instructors
            for (const instructorId of instructor_ids) {
                const [result] = await db.query(
                    `INSERT INTO class_schedules (academy_id, class_id, class_date, time_slot, instructor_id)
                     VALUES (?, ?, ?, ?, ?)`,
                    [req.user.academyId, classId, dateParam, time_slot, instructorId]
                );
                updatedSchedules.push(result.insertId);
            }
        }

        // Get updated schedules with instructor names
        const [schedules] = await db.query(
            `SELECT cs.*, i.name AS instructor_name, c.class_name
             FROM class_schedules cs
             LEFT JOIN instructors i ON cs.instructor_id = i.id
             LEFT JOIN classes c ON cs.class_id = c.id
             WHERE cs.id IN (?)`,
            [updatedSchedules]
        );

        res.json({
            message: `Assigned ${instructor_ids.length} instructor(s) to class`,
            schedules
        });
    } catch (error) {
        console.error('Error assigning instructors:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to assign instructors'
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
        const { class_name, class_type, grade, admission_type, description, default_time_slot } = req.body;

        // Validation
        if (!class_name) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'class_name is required'
            });
        }

        // Validate class_type (입시반/성인반)
        const validClassTypes = ['exam', 'adult'];
        if (class_type && !validClassTypes.includes(class_type)) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'class_type must be exam or adult'
            });
        }

        // Validate grade (고1, 고2, 고3, N수, 성인)
        const validGrades = ['고1', '고2', '고3', 'N수', '성인'];
        if (grade && !validGrades.includes(grade)) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'grade must be one of: 고1, 고2, 고3, N수, 성인'
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
            (academy_id, class_name, class_type, grade, admission_type, description, default_time_slot)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                req.user.academyId,
                class_name,
                class_type || 'exam',
                grade || null,
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

        const { class_name, class_type, grade, admission_type, description, default_time_slot, status } = req.body;

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

        // Validate class_type
        if (class_type && !['exam', 'adult'].includes(class_type)) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'class_type must be exam or adult'
            });
        }

        // Validate grade
        const validGrades = ['고1', '고2', '고3', 'N수', '성인'];
        if (grade && !validGrades.includes(grade)) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'grade must be one of: 고1, 고2, 고3, N수, 성인'
            });
        }

        // Build update query dynamically
        const updates = [];
        const params = [];

        if (class_name !== undefined) {
            updates.push('class_name = ?');
            params.push(class_name);
        }
        if (class_type !== undefined) {
            updates.push('class_type = ?');
            params.push(class_type);
        }
        if (grade !== undefined) {
            updates.push('grade = ?');
            params.push(grade);
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

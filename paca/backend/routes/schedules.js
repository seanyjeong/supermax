const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { verifyToken, requireRole } = require('../middleware/auth');

/**
 * GET /paca/schedules
 * Get class schedules (for calendar view)
 * Access: owner, admin, teacher
 */
router.get('/', verifyToken, async (req, res) => {
    try {
        const { start_date, end_date, instructor_id, time_slot } = req.query;

        let query = `
            SELECT
                cs.id,
                cs.class_date,
                cs.time_slot,
                cs.instructor_id,
                cs.title,
                cs.content,
                cs.attendance_taken,
                cs.notes,
                cs.created_at,
                i.name AS instructor_name
            FROM class_schedules cs
            LEFT JOIN instructors i ON cs.instructor_id = i.id
            WHERE cs.academy_id = ?
        `;

        const params = [req.user.academyId];

        // Date range filter
        if (start_date) {
            query += ' AND cs.class_date >= ?';
            params.push(start_date);
        }

        if (end_date) {
            query += ' AND cs.class_date <= ?';
            params.push(end_date);
        }

        // Instructor filter
        if (instructor_id) {
            query += ' AND cs.instructor_id = ?';
            params.push(parseInt(instructor_id));
        }

        // Time slot filter
        if (time_slot && ['morning', 'afternoon', 'evening'].includes(time_slot)) {
            query += ' AND cs.time_slot = ?';
            params.push(time_slot);
        }

        query += ' ORDER BY cs.class_date ASC, cs.time_slot ASC';

        const [schedules] = await db.query(query, params);

        res.json({
            message: `Found ${schedules.length} schedules`,
            schedules
        });
    } catch (error) {
        console.error('Error fetching schedules:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to fetch schedules'
        });
    }
});

/**
 * GET /paca/schedules/instructor/:instructor_id
 * Get schedules for specific instructor
 * Access: owner, admin, teacher
 */
router.get('/instructor/:instructor_id', verifyToken, async (req, res) => {
    const instructorId = parseInt(req.params.instructor_id);

    try {
        const { start_date, end_date } = req.query;

        // Verify instructor belongs to academy
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

        let query = `
            SELECT
                cs.id,
                cs.class_date,
                cs.time_slot,
                cs.title,
                cs.content,
                cs.attendance_taken,
                cs.notes
            FROM class_schedules cs
            WHERE cs.academy_id = ?
            AND cs.instructor_id = ?
        `;

        const params = [req.user.academyId, instructorId];

        if (start_date) {
            query += ' AND cs.class_date >= ?';
            params.push(start_date);
        }

        if (end_date) {
            query += ' AND cs.class_date <= ?';
            params.push(end_date);
        }

        query += ' ORDER BY cs.class_date ASC, cs.time_slot ASC';

        const [schedules] = await db.query(query, params);

        res.json({
            message: `Found ${schedules.length} schedules for ${instructors[0].name}`,
            instructor: instructors[0],
            schedules
        });
    } catch (error) {
        console.error('Error fetching instructor schedules:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to fetch instructor schedules'
        });
    }
});

/**
 * GET /paca/schedules/:id
 * Get schedule details
 * Access: owner, admin, teacher
 */
router.get('/:id', verifyToken, async (req, res) => {
    const scheduleId = parseInt(req.params.id);

    try {
        const [schedules] = await db.query(
            `SELECT
                cs.*,
                i.name AS instructor_name,
                i.phone AS instructor_phone
            FROM class_schedules cs
            LEFT JOIN instructors i ON cs.instructor_id = i.id
            WHERE cs.id = ?
            AND cs.academy_id = ?`,
            [scheduleId, req.user.academyId]
        );

        if (schedules.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Schedule not found'
            });
        }

        res.json({
            message: 'Schedule found',
            schedule: schedules[0]
        });
    } catch (error) {
        console.error('Error fetching schedule:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to fetch schedule'
        });
    }
});

/**
 * POST /paca/schedules/bulk
 * Create multiple schedules at once (일괄 스케줄 생성)
 * Access: owner, admin only
 */
router.post('/bulk', verifyToken, requireRole('owner', 'admin'), async (req, res) => {
    const connection = await db.getConnection();

    try {
        const { class_id, year, month, weekdays, excluded_dates, time_slot } = req.body;

        // Validation
        if (!class_id || !year || !month || !Array.isArray(weekdays) || weekdays.length === 0) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'class_id, year, month, and weekdays are required'
            });
        }

        // Validate class exists and belongs to academy
        const [classes] = await connection.query(
            'SELECT id, class_name, default_time_slot FROM classes WHERE id = ? AND academy_id = ?',
            [class_id, req.user.academyId]
        );

        if (classes.length === 0) {
            connection.release();
            return res.status(404).json({
                error: 'Not Found',
                message: 'Class not found'
            });
        }

        const classInfo = classes[0];
        const useTimeSlot = time_slot || classInfo.default_time_slot || 'afternoon';

        // Calculate dates for the given month and weekdays
        const targetDates = [];
        const firstDay = new Date(year, month - 1, 1);
        const lastDay = new Date(year, month, 0);
        const excludedSet = new Set(excluded_dates || []);

        for (let d = new Date(firstDay); d <= lastDay; d.setDate(d.getDate() + 1)) {
            const dayOfWeek = d.getDay(); // 0 = Sunday, 1 = Monday, etc.
            if (weekdays.includes(dayOfWeek)) {
                const dateStr = d.toISOString().split('T')[0];
                if (!excludedSet.has(dateStr)) {
                    targetDates.push(dateStr);
                }
            }
        }

        if (targetDates.length === 0) {
            connection.release();
            return res.status(400).json({
                error: 'Validation Error',
                message: 'No valid dates found for the given criteria'
            });
        }

        // Start transaction
        await connection.beginTransaction();

        const createdSchedules = [];
        const skippedDates = [];

        for (const dateStr of targetDates) {
            // Check for existing schedule on this date for this class
            const [existing] = await connection.query(
                'SELECT id FROM class_schedules WHERE academy_id = ? AND class_id = ? AND class_date = ? AND time_slot = ?',
                [req.user.academyId, class_id, dateStr, useTimeSlot]
            );

            if (existing.length > 0) {
                skippedDates.push(dateStr);
                continue;
            }

            // Create schedule without instructor (will be assigned later)
            const [result] = await connection.query(
                `INSERT INTO class_schedules
                (academy_id, class_id, class_date, time_slot, instructor_id, title)
                VALUES (?, ?, ?, ?, NULL, ?)`,
                [req.user.academyId, class_id, dateStr, useTimeSlot, classInfo.class_name]
            );

            createdSchedules.push({
                id: result.insertId,
                class_date: dateStr,
                time_slot: useTimeSlot
            });
        }

        await connection.commit();
        connection.release();

        res.status(201).json({
            message: `Created ${createdSchedules.length} schedules`,
            class_id,
            class_name: classInfo.class_name,
            created_count: createdSchedules.length,
            skipped_count: skippedDates.length,
            skipped_dates: skippedDates,
            schedules: createdSchedules
        });
    } catch (error) {
        await connection.rollback();
        connection.release();
        console.error('Error creating bulk schedules:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to create schedules'
        });
    }
});

/**
 * POST /paca/schedules
 * Create new class schedule
 * Access: owner, admin only
 */
router.post('/', verifyToken, requireRole('owner', 'admin'), async (req, res) => {
    try {
        const { class_date, time_slot, instructor_id, title, content, notes } = req.body;

        // Validation
        if (!class_date || !time_slot || !instructor_id) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'class_date, time_slot, and instructor_id are required'
            });
        }

        // Validate time_slot
        if (!['morning', 'afternoon', 'evening'].includes(time_slot)) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'time_slot must be morning, afternoon, or evening'
            });
        }

        // Validate date format (YYYY-MM-DD)
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(class_date)) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'class_date must be in YYYY-MM-DD format'
            });
        }

        // Verify instructor exists and belongs to academy
        const [instructors] = await db.query(
            'SELECT id FROM instructors WHERE id = ? AND academy_id = ? AND deleted_at IS NULL',
            [instructor_id, req.user.academyId]
        );

        if (instructors.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Instructor not found or does not belong to your academy'
            });
        }

        // Check for duplicate schedule (same date, time_slot, instructor)
        const [existing] = await db.query(
            `SELECT id FROM class_schedules
            WHERE academy_id = ?
            AND class_date = ?
            AND time_slot = ?
            AND instructor_id = ?`,
            [req.user.academyId, class_date, time_slot, instructor_id]
        );

        if (existing.length > 0) {
            return res.status(409).json({
                error: 'Conflict',
                message: 'A schedule already exists for this instructor at this date and time'
            });
        }

        // Create schedule
        const [result] = await db.query(
            `INSERT INTO class_schedules
            (academy_id, class_date, time_slot, instructor_id, title, content, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [req.user.academyId, class_date, time_slot, instructor_id, title || null, content || null, notes || null]
        );

        // Fetch created schedule
        const [newSchedule] = await db.query(
            `SELECT cs.*, i.name AS instructor_name
            FROM class_schedules cs
            LEFT JOIN instructors i ON cs.instructor_id = i.id
            WHERE cs.id = ?`,
            [result.insertId]
        );

        res.status(201).json({
            message: 'Schedule created successfully',
            schedule: newSchedule[0]
        });
    } catch (error) {
        console.error('Error creating schedule:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to create schedule'
        });
    }
});

/**
 * PUT /paca/schedules/:id/assign-instructor
 * Assign instructor to a schedule (강사 배정)
 * Access: owner, admin only
 */
router.put('/:id/assign-instructor', verifyToken, requireRole('owner', 'admin'), async (req, res) => {
    const scheduleId = parseInt(req.params.id);

    try {
        const { instructor_id, time_slots } = req.body;

        // Check if schedule exists
        const [schedules] = await db.query(
            'SELECT id, class_date, time_slot FROM class_schedules WHERE id = ? AND academy_id = ?',
            [scheduleId, req.user.academyId]
        );

        if (schedules.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Schedule not found'
            });
        }

        // Validate instructor if provided
        if (instructor_id) {
            const [instructors] = await db.query(
                'SELECT id, name FROM instructors WHERE id = ? AND academy_id = ? AND deleted_at IS NULL',
                [instructor_id, req.user.academyId]
            );

            if (instructors.length === 0) {
                return res.status(404).json({
                    error: 'Not Found',
                    message: 'Instructor not found'
                });
            }
        }

        // Update schedule with instructor
        await db.query(
            'UPDATE class_schedules SET instructor_id = ? WHERE id = ?',
            [instructor_id || null, scheduleId]
        );

        // If time_slots array provided, create/update instructor attendance records
        if (Array.isArray(time_slots) && time_slots.length > 0 && instructor_id) {
            const schedule = schedules[0];

            for (const slot of time_slots) {
                if (!['morning', 'afternoon', 'evening'].includes(slot)) continue;

                // UPSERT instructor attendance
                await db.query(
                    `INSERT INTO instructor_attendance
                    (instructor_id, class_schedule_id, work_date, time_slot, attendance_status)
                    VALUES (?, ?, ?, ?, 'present')
                    ON DUPLICATE KEY UPDATE
                    class_schedule_id = VALUES(class_schedule_id),
                    attendance_status = 'present',
                    updated_at = CURRENT_TIMESTAMP`,
                    [instructor_id, scheduleId, schedule.class_date, slot]
                );
            }
        }

        // Fetch updated schedule
        const [updated] = await db.query(
            `SELECT cs.*, i.name AS instructor_name
            FROM class_schedules cs
            LEFT JOIN instructors i ON cs.instructor_id = i.id
            WHERE cs.id = ?`,
            [scheduleId]
        );

        res.json({
            message: 'Instructor assigned successfully',
            schedule: updated[0]
        });
    } catch (error) {
        console.error('Error assigning instructor:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to assign instructor'
        });
    }
});

/**
 * PUT /paca/schedules/:id
 * Update class schedule
 * Access: owner, admin only
 */
router.put('/:id', verifyToken, requireRole('owner', 'admin'), async (req, res) => {
    const scheduleId = parseInt(req.params.id);

    try {
        const { class_date, time_slot, instructor_id, title, content, notes } = req.body;

        // Check if schedule exists
        const [schedules] = await db.query(
            'SELECT id FROM class_schedules WHERE id = ? AND academy_id = ?',
            [scheduleId, req.user.academyId]
        );

        if (schedules.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Schedule not found'
            });
        }

        // Validate time_slot if provided
        if (time_slot && !['morning', 'afternoon', 'evening'].includes(time_slot)) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'time_slot must be morning, afternoon, or evening'
            });
        }

        // Verify instructor if provided
        if (instructor_id) {
            const [instructors] = await db.query(
                'SELECT id FROM instructors WHERE id = ? AND academy_id = ? AND deleted_at IS NULL',
                [instructor_id, req.user.academyId]
            );

            if (instructors.length === 0) {
                return res.status(404).json({
                    error: 'Not Found',
                    message: 'Instructor not found'
                });
            }
        }

        // Build update query dynamically
        const updates = [];
        const params = [];

        if (class_date !== undefined) {
            updates.push('class_date = ?');
            params.push(class_date);
        }
        if (time_slot !== undefined) {
            updates.push('time_slot = ?');
            params.push(time_slot);
        }
        if (instructor_id !== undefined) {
            updates.push('instructor_id = ?');
            params.push(instructor_id);
        }
        if (title !== undefined) {
            updates.push('title = ?');
            params.push(title);
        }
        if (content !== undefined) {
            updates.push('content = ?');
            params.push(content);
        }
        if (notes !== undefined) {
            updates.push('notes = ?');
            params.push(notes);
        }

        if (updates.length === 0) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'No fields to update'
            });
        }

        params.push(scheduleId);

        await db.query(
            `UPDATE class_schedules SET ${updates.join(', ')} WHERE id = ?`,
            params
        );

        // Fetch updated schedule
        const [updated] = await db.query(
            `SELECT cs.*, i.name AS instructor_name
            FROM class_schedules cs
            LEFT JOIN instructors i ON cs.instructor_id = i.id
            WHERE cs.id = ?`,
            [scheduleId]
        );

        res.json({
            message: 'Schedule updated successfully',
            schedule: updated[0]
        });
    } catch (error) {
        console.error('Error updating schedule:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to update schedule'
        });
    }
});

/**
 * DELETE /paca/schedules/:id
 * Delete class schedule
 * Access: owner, admin only
 */
router.delete('/:id', verifyToken, requireRole('owner', 'admin'), async (req, res) => {
    const scheduleId = parseInt(req.params.id);

    try {
        // Check if schedule exists
        const [schedules] = await db.query(
            'SELECT id FROM class_schedules WHERE id = ? AND academy_id = ?',
            [scheduleId, req.user.academyId]
        );

        if (schedules.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Schedule not found'
            });
        }

        // Delete schedule (CASCADE will delete attendance records)
        await db.query('DELETE FROM class_schedules WHERE id = ?', [scheduleId]);

        res.json({
            message: 'Schedule deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting schedule:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to delete schedule'
        });
    }
});

/**
 * GET /paca/schedules/:id/attendance
 * Get attendance status for a specific class
 * Access: owner, admin, teacher
 */
router.get('/:id/attendance', verifyToken, async (req, res) => {
    const scheduleId = parseInt(req.params.id);

    try {
        // Get schedule details
        const [schedules] = await db.query(
            `SELECT
                cs.id,
                cs.class_date,
                cs.time_slot,
                cs.title,
                cs.attendance_taken,
                i.name AS instructor_name
            FROM class_schedules cs
            LEFT JOIN instructors i ON cs.instructor_id = i.id
            WHERE cs.id = ?
            AND cs.academy_id = ?`,
            [scheduleId, req.user.academyId]
        );

        if (schedules.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Schedule not found'
            });
        }

        const schedule = schedules[0];
        const classDate = new Date(schedule.class_date);
        const dayOfWeek = classDate.getDay();

        // Get all active students who have class on this day of week
        const [students] = await db.query(
            `SELECT
                s.id AS student_id,
                s.name AS student_name,
                s.student_number,
                s.class_days,
                a.attendance_status,
                a.notes AS attendance_notes
            FROM students s
            LEFT JOIN attendance a ON a.student_id = s.id AND a.class_schedule_id = ?
            WHERE s.academy_id = ?
            AND s.status = 'active'
            AND s.deleted_at IS NULL
            AND JSON_CONTAINS(s.class_days, ?)
            ORDER BY s.name ASC`,
            [scheduleId, req.user.academyId, dayOfWeek.toString()]
        );

        // Parse class_days JSON
        const studentsWithInfo = students.map(student => ({
            student_id: student.student_id,
            student_name: student.student_name,
            student_number: student.student_number,
            attendance_status: student.attendance_status || null,
            notes: student.attendance_notes || '',
            is_expected: true
        }));

        res.json({
            message: 'Attendance records retrieved',
            schedule: {
                id: schedule.id,
                class_date: schedule.class_date,
                time_slot: schedule.time_slot,
                instructor_name: schedule.instructor_name,
                title: schedule.title,
                attendance_taken: schedule.attendance_taken
            },
            students: studentsWithInfo
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
 * POST /paca/schedules/:id/attendance
 * Take attendance for a class
 * Access: owner, admin, teacher
 */
router.post('/:id/attendance', verifyToken, async (req, res) => {
    const scheduleId = parseInt(req.params.id);
    const connection = await db.getConnection();

    try {
        const { attendance_records } = req.body;

        // Validation
        if (!Array.isArray(attendance_records) || attendance_records.length === 0) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'attendance_records must be a non-empty array'
            });
        }

        // Check if schedule exists
        const [schedules] = await connection.query(
            'SELECT id, class_date FROM class_schedules WHERE id = ? AND academy_id = ?',
            [scheduleId, req.user.academyId]
        );

        if (schedules.length === 0) {
            connection.release();
            return res.status(404).json({
                error: 'Not Found',
                message: 'Schedule not found'
            });
        }

        const schedule = schedules[0];

        // Start transaction
        await connection.beginTransaction();

        const validStatuses = ['present', 'absent', 'late', 'excused'];
        const processedRecords = [];

        for (const record of attendance_records) {
            const { student_id, attendance_status, notes } = record;

            // Validate attendance_status
            if (!validStatuses.includes(attendance_status)) {
                await connection.rollback();
                connection.release();
                return res.status(400).json({
                    error: 'Validation Error',
                    message: `Invalid attendance_status: ${attendance_status}. Must be one of: ${validStatuses.join(', ')}`
                });
            }

            // Verify student exists and belongs to academy
            const [students] = await connection.query(
                'SELECT id, name FROM students WHERE id = ? AND academy_id = ? AND deleted_at IS NULL',
                [student_id, req.user.academyId]
            );

            if (students.length === 0) {
                await connection.rollback();
                connection.release();
                return res.status(404).json({
                    error: 'Not Found',
                    message: `Student with ID ${student_id} not found`
                });
            }

            // UPSERT attendance record
            await connection.query(
                `INSERT INTO attendance
                (class_schedule_id, student_id, attendance_status, notes, recorded_by)
                VALUES (?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                attendance_status = VALUES(attendance_status),
                notes = VALUES(notes),
                recorded_by = VALUES(recorded_by),
                updated_at = CURRENT_TIMESTAMP`,
                [scheduleId, student_id, attendance_status, notes || null, req.user.id]
            );

            processedRecords.push({
                student_id,
                student_name: students[0].name,
                attendance_status,
                notes: notes || ''
            });
        }

        // Mark attendance as taken
        await connection.query(
            'UPDATE class_schedules SET attendance_taken = true WHERE id = ?',
            [scheduleId]
        );

        // Commit transaction
        await connection.commit();
        connection.release();

        res.json({
            message: `Attendance recorded for ${processedRecords.length} students`,
            schedule_id: scheduleId,
            class_date: schedule.class_date,
            attendance_records: processedRecords
        });
    } catch (error) {
        await connection.rollback();
        connection.release();
        console.error('Error recording attendance:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to record attendance'
        });
    }
});

/**
 * GET /paca/schedules/:id/instructor-attendance
 * Get instructor attendance for a specific schedule
 * Access: owner, admin, teacher
 */
router.get('/:id/instructor-attendance', verifyToken, async (req, res) => {
    const scheduleId = parseInt(req.params.id);

    try {
        // Get schedule details
        const [schedules] = await db.query(
            `SELECT
                cs.id,
                cs.class_date,
                cs.time_slot,
                cs.instructor_id,
                i.name AS instructor_name
            FROM class_schedules cs
            LEFT JOIN instructors i ON cs.instructor_id = i.id
            WHERE cs.id = ?
            AND cs.academy_id = ?`,
            [scheduleId, req.user.academyId]
        );

        if (schedules.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Schedule not found'
            });
        }

        const schedule = schedules[0];

        // Get instructor attendance records for this date
        const [attendances] = await db.query(
            `SELECT
                ia.id,
                ia.instructor_id,
                i.name AS instructor_name,
                ia.time_slot,
                ia.attendance_status,
                ia.check_in_time,
                ia.check_out_time,
                ia.notes
            FROM instructor_attendance ia
            JOIN instructors i ON ia.instructor_id = i.id
            WHERE ia.work_date = ?
            AND i.academy_id = ?
            ORDER BY ia.time_slot, i.name`,
            [schedule.class_date, req.user.academyId]
        );

        res.json({
            message: 'Instructor attendance retrieved',
            schedule: {
                id: schedule.id,
                class_date: schedule.class_date,
                time_slot: schedule.time_slot,
                instructor_id: schedule.instructor_id,
                instructor_name: schedule.instructor_name
            },
            attendances
        });
    } catch (error) {
        console.error('Error fetching instructor attendance:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to fetch instructor attendance'
        });
    }
});

/**
 * POST /paca/schedules/:id/instructor-attendance
 * Record instructor attendance for a schedule
 * Access: owner, admin
 */
router.post('/:id/instructor-attendance', verifyToken, requireRole('owner', 'admin'), async (req, res) => {
    const scheduleId = parseInt(req.params.id);
    const connection = await db.getConnection();

    try {
        const { attendances } = req.body;

        // Validation
        if (!Array.isArray(attendances) || attendances.length === 0) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'attendances must be a non-empty array'
            });
        }

        // Check if schedule exists
        const [schedules] = await connection.query(
            'SELECT id, class_date, time_slot FROM class_schedules WHERE id = ? AND academy_id = ?',
            [scheduleId, req.user.academyId]
        );

        if (schedules.length === 0) {
            connection.release();
            return res.status(404).json({
                error: 'Not Found',
                message: 'Schedule not found'
            });
        }

        const schedule = schedules[0];

        await connection.beginTransaction();

        const validStatuses = ['present', 'absent', 'late', 'half_day'];
        const processedRecords = [];

        for (const record of attendances) {
            const { instructor_id, time_slot, attendance_status, check_in_time, check_out_time, notes } = record;

            // Validate attendance_status
            if (!validStatuses.includes(attendance_status)) {
                await connection.rollback();
                connection.release();
                return res.status(400).json({
                    error: 'Validation Error',
                    message: `Invalid attendance_status: ${attendance_status}. Must be one of: ${validStatuses.join(', ')}`
                });
            }

            // Validate time_slot
            const useTimeSlot = time_slot || schedule.time_slot;
            if (!['morning', 'afternoon', 'evening'].includes(useTimeSlot)) {
                await connection.rollback();
                connection.release();
                return res.status(400).json({
                    error: 'Validation Error',
                    message: 'Invalid time_slot'
                });
            }

            // Verify instructor exists
            const [instructors] = await connection.query(
                'SELECT id, name FROM instructors WHERE id = ? AND academy_id = ? AND deleted_at IS NULL',
                [instructor_id, req.user.academyId]
            );

            if (instructors.length === 0) {
                await connection.rollback();
                connection.release();
                return res.status(404).json({
                    error: 'Not Found',
                    message: `Instructor with ID ${instructor_id} not found`
                });
            }

            // UPSERT instructor attendance record
            await connection.query(
                `INSERT INTO instructor_attendance
                (instructor_id, work_date, time_slot, attendance_status, check_in_time, check_out_time, notes)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                attendance_status = VALUES(attendance_status),
                check_in_time = VALUES(check_in_time),
                check_out_time = VALUES(check_out_time),
                notes = VALUES(notes),
                updated_at = CURRENT_TIMESTAMP`,
                [instructor_id, schedule.class_date, useTimeSlot, attendance_status, check_in_time || null, check_out_time || null, notes || null]
            );

            processedRecords.push({
                instructor_id,
                instructor_name: instructors[0].name,
                time_slot: useTimeSlot,
                attendance_status,
                check_in_time,
                check_out_time
            });
        }

        await connection.commit();
        connection.release();

        res.json({
            message: `Instructor attendance recorded for ${processedRecords.length} records`,
            schedule_id: scheduleId,
            class_date: schedule.class_date,
            attendance_records: processedRecords
        });
    } catch (error) {
        await connection.rollback();
        connection.release();
        console.error('Error recording instructor attendance:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to record instructor attendance'
        });
    }
});

/**
 * GET /paca/schedules/date/:date/instructor-attendance
 * Get instructor attendance for a specific date (only instructors assigned to each time slot)
 * Access: owner, admin, teacher
 */
router.get('/date/:date/instructor-attendance', verifyToken, async (req, res) => {
    const workDate = req.params.date;

    try {
        // Validate date format
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(workDate)) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'Date must be in YYYY-MM-DD format'
            });
        }

        // Get instructors by time slot (only those assigned to each specific slot)
        const [schedulesBySlot] = await db.query(
            `SELECT cs.time_slot, i.id, i.name
            FROM class_schedules cs
            INNER JOIN instructors i ON cs.instructor_id = i.id
            WHERE cs.class_date = ?
            AND cs.academy_id = ?
            AND i.deleted_at IS NULL
            ORDER BY cs.time_slot, i.name`,
            [workDate, req.user.academyId]
        );

        // Group instructors by time slot
        const instructorsBySlot = {
            morning: [],
            afternoon: [],
            evening: []
        };

        for (const row of schedulesBySlot) {
            if (instructorsBySlot[row.time_slot]) {
                // Avoid duplicates
                const exists = instructorsBySlot[row.time_slot].some(i => i.id === row.id);
                if (!exists) {
                    instructorsBySlot[row.time_slot].push({ id: row.id, name: row.name });
                }
            }
        }

        // Get existing attendance records for this date
        const [attendances] = await db.query(
            `SELECT
                ia.id,
                ia.instructor_id,
                i.name AS instructor_name,
                ia.time_slot,
                ia.attendance_status,
                ia.check_in_time,
                ia.check_out_time,
                ia.notes
            FROM instructor_attendance ia
            JOIN instructors i ON ia.instructor_id = i.id
            WHERE ia.work_date = ?
            AND i.academy_id = ?
            ORDER BY ia.time_slot, i.name`,
            [workDate, req.user.academyId]
        );

        // Also return all instructors for backwards compatibility
        const allInstructors = [...new Map(
            schedulesBySlot.map(item => [item.id, { id: item.id, name: item.name }])
        ).values()];

        res.json({
            message: 'Instructor attendance retrieved',
            date: workDate,
            attendances,
            instructors: allInstructors,
            instructors_by_slot: instructorsBySlot
        });
    } catch (error) {
        console.error('Error fetching instructor attendance by date:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to fetch instructor attendance'
        });
    }
});

/**
 * POST /paca/schedules/date/:date/instructor-attendance
 * Record instructor attendance for a specific date (without schedule)
 * Access: owner, admin
 */
router.post('/date/:date/instructor-attendance', verifyToken, requireRole('owner', 'admin'), async (req, res) => {
    const workDate = req.params.date;
    const connection = await db.getConnection();

    try {
        const { attendances } = req.body;

        // Validate date format
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(workDate)) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'Date must be in YYYY-MM-DD format'
            });
        }

        if (!Array.isArray(attendances) || attendances.length === 0) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'attendances must be a non-empty array'
            });
        }

        await connection.beginTransaction();

        const validStatuses = ['present', 'absent', 'late', 'half_day'];
        const processedRecords = [];

        for (const record of attendances) {
            const { instructor_id, time_slot, attendance_status, check_in_time, check_out_time, notes } = record;

            if (!validStatuses.includes(attendance_status)) {
                await connection.rollback();
                connection.release();
                return res.status(400).json({
                    error: 'Validation Error',
                    message: `Invalid attendance_status: ${attendance_status}`
                });
            }

            if (!['morning', 'afternoon', 'evening'].includes(time_slot)) {
                await connection.rollback();
                connection.release();
                return res.status(400).json({
                    error: 'Validation Error',
                    message: 'Invalid time_slot'
                });
            }

            const [instructors] = await connection.query(
                'SELECT id, name FROM instructors WHERE id = ? AND academy_id = ? AND deleted_at IS NULL',
                [instructor_id, req.user.academyId]
            );

            if (instructors.length === 0) {
                await connection.rollback();
                connection.release();
                return res.status(404).json({
                    error: 'Not Found',
                    message: `Instructor with ID ${instructor_id} not found`
                });
            }

            await connection.query(
                `INSERT INTO instructor_attendance
                (instructor_id, work_date, time_slot, attendance_status, check_in_time, check_out_time, notes)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                attendance_status = VALUES(attendance_status),
                check_in_time = VALUES(check_in_time),
                check_out_time = VALUES(check_out_time),
                notes = VALUES(notes),
                updated_at = CURRENT_TIMESTAMP`,
                [instructor_id, workDate, time_slot, attendance_status, check_in_time || null, check_out_time || null, notes || null]
            );

            processedRecords.push({
                instructor_id,
                instructor_name: instructors[0].name,
                time_slot,
                attendance_status
            });
        }

        await connection.commit();
        connection.release();

        res.json({
            message: `Instructor attendance recorded for ${processedRecords.length} records`,
            date: workDate,
            attendance_records: processedRecords
        });
    } catch (error) {
        await connection.rollback();
        connection.release();
        console.error('Error recording instructor attendance:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to record instructor attendance'
        });
    }
});

module.exports = router;

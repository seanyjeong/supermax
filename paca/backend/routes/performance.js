const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { verifyToken, requireRole, checkPermission } = require('../middleware/auth');

/**
 * GET /paca/performance
 * Get all performance records with filters
 * Access: owner, admin, teacher
 */
router.get('/', verifyToken, async (req, res) => {
    try {
        const { student_id, record_type, start_date, end_date } = req.query;

        let query = `
            SELECT
                p.id,
                p.student_id,
                s.name as student_name,
                s.student_number,
                p.record_date,
                p.record_type,
                p.performance_data,
                p.notes,
                p.recorded_by,
                u.name as recorded_by_name,
                p.created_at
            FROM student_performance p
            JOIN students s ON p.student_id = s.id
            LEFT JOIN users u ON p.recorded_by = u.id
            WHERE s.academy_id = ?
            AND s.deleted_at IS NULL
        `;

        const params = [req.user.academyId];

        if (student_id) {
            query += ' AND p.student_id = ?';
            params.push(parseInt(student_id));
        }

        if (record_type) {
            query += ' AND p.record_type = ?';
            params.push(record_type);
        }

        if (start_date) {
            query += ' AND p.record_date >= ?';
            params.push(start_date);
        }

        if (end_date) {
            query += ' AND p.record_date <= ?';
            params.push(end_date);
        }

        query += ' ORDER BY p.record_date DESC, p.created_at DESC';

        const [performances] = await db.query(query, params);

        res.json({
            message: `Found ${performances.length} performance records`,
            performances
        });
    } catch (error) {
        console.error('Error fetching performance records:', error);
        res.status(500).json({
            error: 'Server Error',
            message: '성적 기록을 불러오는데 실패했습니다.'
        });
    }
});

/**
 * GET /paca/performance/:id
 * Get performance record by ID
 * Access: owner, admin, teacher
 */
router.get('/:id', verifyToken, async (req, res) => {
    const performanceId = parseInt(req.params.id);

    try {
        const [performances] = await db.query(
            `SELECT
                p.id,
                p.student_id,
                s.name as student_name,
                s.student_number,
                s.grade,
                s.grade_type,
                p.record_date,
                p.record_type,
                p.performance_data,
                p.notes,
                p.recorded_by,
                u.name as recorded_by_name,
                p.created_at,
                p.updated_at
            FROM student_performance p
            JOIN students s ON p.student_id = s.id
            LEFT JOIN users u ON p.recorded_by = u.id
            WHERE p.id = ?
            AND s.academy_id = ?
            AND s.deleted_at IS NULL`,
            [performanceId, req.user.academyId]
        );

        if (performances.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: '성적 기록을 찾을 수 없습니다.'
            });
        }

        res.json({ performance: performances[0] });
    } catch (error) {
        console.error('Error fetching performance record:', error);
        res.status(500).json({
            error: 'Server Error',
            message: '성적 기록을 불러오는데 실패했습니다.'
        });
    }
});

/**
 * GET /paca/performance/student/:student_id
 * Get all performance records for a specific student
 * Access: owner, admin, teacher
 */
router.get('/student/:student_id', verifyToken, async (req, res) => {
    const studentId = parseInt(req.params.student_id);

    try {
        // Verify student belongs to academy
        const [students] = await db.query(
            'SELECT id, name FROM students WHERE id = ? AND academy_id = ? AND deleted_at IS NULL',
            [studentId, req.user.academyId]
        );

        if (students.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: '학생을 찾을 수 없습니다.'
            });
        }

        const [performances] = await db.query(
            `SELECT
                p.id,
                p.record_date,
                p.record_type,
                p.performance_data,
                p.notes,
                p.recorded_by,
                u.name as recorded_by_name,
                p.created_at
            FROM student_performance p
            LEFT JOIN users u ON p.recorded_by = u.id
            WHERE p.student_id = ?
            ORDER BY p.record_date DESC, p.created_at DESC`,
            [studentId]
        );

        res.json({
            message: `${students[0].name} 학생의 성적 기록 ${performances.length}건을 불러왔습니다.`,
            student: students[0],
            performances
        });
    } catch (error) {
        console.error('Error fetching student performance records:', error);
        res.status(500).json({
            error: 'Server Error',
            message: '학생 성적 기록을 불러오는데 실패했습니다.'
        });
    }
});

/**
 * POST /paca/performance
 * Create new performance record
 * Access: owner, admin, teacher
 */
router.post('/', verifyToken, async (req, res) => {
    try {
        const {
            student_id,
            record_date,
            record_type,
            performance_data,
            notes
        } = req.body;

        // Validation
        if (!student_id || !record_date || !record_type) {
            return res.status(400).json({
                error: 'Validation Error',
                message: '필수 항목을 모두 입력해주세요. (학생, 기록일, 기록유형)'
            });
        }

        // Validate record_type
        const validTypes = ['mock_exam', 'physical', 'competition'];
        if (!validTypes.includes(record_type)) {
            return res.status(400).json({
                error: 'Validation Error',
                message: '유효하지 않은 기록유형입니다. (모의고사, 체력측정, 대회)'
            });
        }

        // Verify student exists and belongs to academy
        const [students] = await db.query(
            'SELECT id, name FROM students WHERE id = ? AND academy_id = ? AND deleted_at IS NULL',
            [student_id, req.user.academyId]
        );

        if (students.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: '학생을 찾을 수 없습니다.'
            });
        }

        // Validate performance_data structure based on record_type
        if (performance_data) {
            const validationResult = validatePerformanceData(record_type, performance_data);
            if (!validationResult.valid) {
                return res.status(400).json({
                    error: 'Validation Error',
                    message: validationResult.message
                });
            }
        }

        // Insert performance record
        const [result] = await db.query(
            `INSERT INTO student_performance (
                student_id,
                record_date,
                record_type,
                performance_data,
                notes,
                recorded_by
            ) VALUES (?, ?, ?, ?, ?, ?)`,
            [
                student_id,
                record_date,
                record_type,
                JSON.stringify(performance_data || {}),
                notes || null,
                req.user.userId
            ]
        );

        // Fetch created record
        const [performances] = await db.query(
            `SELECT
                p.*,
                s.name as student_name,
                s.student_number,
                u.name as recorded_by_name
            FROM student_performance p
            JOIN students s ON p.student_id = s.id
            LEFT JOIN users u ON p.recorded_by = u.id
            WHERE p.id = ?`,
            [result.insertId]
        );

        res.status(201).json({
            message: '성적 기록이 생성되었습니다.',
            performance: performances[0]
        });
    } catch (error) {
        console.error('Error creating performance record:', error);
        res.status(500).json({
            error: 'Server Error',
            message: '성적 기록 생성에 실패했습니다.'
        });
    }
});

/**
 * PUT /paca/performance/:id
 * Update performance record
 * Access: owner, admin, teacher
 */
router.put('/:id', verifyToken, async (req, res) => {
    const performanceId = parseInt(req.params.id);

    try {
        // Verify performance record exists and belongs to academy
        const [existing] = await db.query(
            `SELECT p.id, p.record_type
            FROM student_performance p
            JOIN students s ON p.student_id = s.id
            WHERE p.id = ? AND s.academy_id = ? AND s.deleted_at IS NULL`,
            [performanceId, req.user.academyId]
        );

        if (existing.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: '성적 기록을 찾을 수 없습니다.'
            });
        }

        const {
            record_date,
            record_type,
            performance_data,
            notes
        } = req.body;

        // Validate record_type if provided
        if (record_type) {
            const validTypes = ['mock_exam', 'physical', 'competition'];
            if (!validTypes.includes(record_type)) {
                return res.status(400).json({
                    error: 'Validation Error',
                    message: '유효하지 않은 기록유형입니다. (모의고사, 체력측정, 대회)'
                });
            }
        }

        // Validate performance_data if provided
        if (performance_data) {
            const typeToValidate = record_type || existing[0].record_type;
            const validationResult = validatePerformanceData(typeToValidate, performance_data);
            if (!validationResult.valid) {
                return res.status(400).json({
                    error: 'Validation Error',
                    message: validationResult.message
                });
            }
        }

        // Build update query
        const updates = [];
        const params = [];

        if (record_date !== undefined) {
            updates.push('record_date = ?');
            params.push(record_date);
        }
        if (record_type !== undefined) {
            updates.push('record_type = ?');
            params.push(record_type);
        }
        if (performance_data !== undefined) {
            updates.push('performance_data = ?');
            params.push(JSON.stringify(performance_data));
        }
        if (notes !== undefined) {
            updates.push('notes = ?');
            params.push(notes);
        }

        if (updates.length === 0) {
            return res.status(400).json({
                error: 'Validation Error',
                message: '수정할 항목이 없습니다.'
            });
        }

        updates.push('updated_at = NOW()');
        params.push(performanceId);

        await db.query(
            `UPDATE student_performance SET ${updates.join(', ')} WHERE id = ?`,
            params
        );

        // Fetch updated record
        const [performances] = await db.query(
            `SELECT
                p.*,
                s.name as student_name,
                s.student_number,
                u.name as recorded_by_name
            FROM student_performance p
            JOIN students s ON p.student_id = s.id
            LEFT JOIN users u ON p.recorded_by = u.id
            WHERE p.id = ?`,
            [performanceId]
        );

        res.json({
            message: '성적 기록이 수정되었습니다.',
            performance: performances[0]
        });
    } catch (error) {
        console.error('Error updating performance record:', error);
        res.status(500).json({
            error: 'Server Error',
            message: '성적 기록 수정에 실패했습니다.'
        });
    }
});

/**
 * DELETE /paca/performance/:id
 * Delete performance record
 * Access: owner, admin
 */
router.delete('/:id', verifyToken, checkPermission('students', 'edit'), async (req, res) => {
    const performanceId = parseInt(req.params.id);

    try {
        // Verify performance record exists and belongs to academy
        const [existing] = await db.query(
            `SELECT p.id, s.name as student_name
            FROM student_performance p
            JOIN students s ON p.student_id = s.id
            WHERE p.id = ? AND s.academy_id = ? AND s.deleted_at IS NULL`,
            [performanceId, req.user.academyId]
        );

        if (existing.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: '성적 기록을 찾을 수 없습니다.'
            });
        }

        // Delete record
        await db.query('DELETE FROM student_performance WHERE id = ?', [performanceId]);

        res.json({
            message: '성적 기록이 삭제되었습니다.',
            performance: {
                id: performanceId,
                student_name: existing[0].student_name
            }
        });
    } catch (error) {
        console.error('Error deleting performance record:', error);
        res.status(500).json({
            error: 'Server Error',
            message: '성적 기록 삭제에 실패했습니다.'
        });
    }
});

/**
 * Helper function to validate performance_data structure
 * @param {string} record_type - Type of record (mock_exam, physical, competition)
 * @param {object} performance_data - Performance data to validate
 * @returns {object} - { valid: boolean, message: string }
 */
function validatePerformanceData(record_type, performance_data) {
    if (!performance_data || typeof performance_data !== 'object') {
        return { valid: false, message: 'performance_data must be an object' };
    }

    switch (record_type) {
        case 'mock_exam':
            // Expected: { subjects: [{name, score, max_score}], rank: number }
            if (!performance_data.subjects || !Array.isArray(performance_data.subjects)) {
                return { valid: false, message: 'mock_exam requires subjects array' };
            }
            for (const subject of performance_data.subjects) {
                if (!subject.name || subject.score === undefined) {
                    return { valid: false, message: 'Each subject must have name and score' };
                }
            }
            break;

        case 'physical':
            // Expected: { events: [{name, record, unit}] }
            if (!performance_data.events || !Array.isArray(performance_data.events)) {
                return { valid: false, message: 'physical requires events array' };
            }
            for (const event of performance_data.events) {
                if (!event.name || event.record === undefined) {
                    return { valid: false, message: 'Each event must have name and record' };
                }
            }
            break;

        case 'competition':
            // Expected: { name, rank, participants }
            if (!performance_data.name) {
                return { valid: false, message: 'competition requires name' };
            }
            break;

        default:
            return { valid: false, message: 'Invalid record_type' };
    }

    return { valid: true };
}

module.exports = router;

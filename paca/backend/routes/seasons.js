const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { verifyToken, requireRole } = require('../middleware/auth');
const {
    calculateProRatedFee,
    calculateSeasonRefund,
    parseWeeklyDays,
    previewSeasonTransition
} = require('../utils/seasonCalculator');

/**
 * GET /paca/seasons
 * Get all seasons for academy
 * Access: owner, admin, teacher
 */
router.get('/', verifyToken, async (req, res) => {
    try {
        const { status, season_type } = req.query;

        let query = `
            SELECT * FROM seasons
            WHERE academy_id = ?
        `;
        const params = [req.user.academyId];

        if (status) {
            query += ' AND status = ?';
            params.push(status);
        }

        if (season_type) {
            query += ' AND season_type = ?';
            params.push(season_type);
        }

        query += ' ORDER BY season_start_date DESC';

        const [seasons] = await db.query(query, params);

        res.json({
            message: `Found ${seasons.length} seasons`,
            seasons
        });
    } catch (error) {
        console.error('Error fetching seasons:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to fetch seasons'
        });
    }
});

/**
 * GET /paca/seasons/:id
 * Get season by ID
 * Access: owner, admin, teacher
 */
router.get('/:id', verifyToken, async (req, res) => {
    const seasonId = parseInt(req.params.id);

    try {
        const [seasons] = await db.query(
            `SELECT * FROM seasons
            WHERE id = ? AND academy_id = ?`,
            [seasonId, req.user.academyId]
        );

        if (seasons.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Season not found'
            });
        }

        // Get enrolled students count
        const [enrolledCount] = await db.query(
            `SELECT COUNT(*) as count FROM student_seasons
            WHERE season_id = ? AND payment_status != 'cancelled'`,
            [seasonId]
        );

        const season = seasons[0];
        season.enrolled_students = enrolledCount[0].count;

        res.json({ season });
    } catch (error) {
        console.error('Error fetching season:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to fetch season'
        });
    }
});

/**
 * POST /paca/seasons
 * Create new season
 * Access: owner, admin
 */
router.post('/', verifyToken, requireRole('owner', 'admin'), async (req, res) => {
    try {
        const {
            season_name,
            season_type,
            season_start_date,
            season_end_date,
            non_season_end_date,
            operating_days,
            default_season_fee,
            allows_continuous,
            continuous_to_season_type,
            continuous_discount_type,
            continuous_discount_rate
        } = req.body;

        if (!season_name || !season_type || !season_start_date || !season_end_date || !non_season_end_date || !operating_days) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'Required fields: season_name, season_type, season_start_date, season_end_date, non_season_end_date, operating_days'
            });
        }

        // Validate season_type
        if (!['early', 'regular'].includes(season_type)) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'season_type must be early or regular'
            });
        }

        // Validate dates
        const nonSeasonEnd = new Date(non_season_end_date);
        const seasonStart = new Date(season_start_date);
        const seasonEnd = new Date(season_end_date);

        if (nonSeasonEnd >= seasonStart) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'non_season_end_date must be before season_start_date'
            });
        }

        if (seasonStart >= seasonEnd) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'season_start_date must be before season_end_date'
            });
        }

        const [result] = await db.query(
            `INSERT INTO seasons (
                academy_id,
                season_name,
                season_type,
                season_start_date,
                season_end_date,
                non_season_end_date,
                operating_days,
                default_season_fee,
                allows_continuous,
                continuous_to_season_type,
                continuous_discount_type,
                continuous_discount_rate,
                status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'upcoming')`,
            [
                req.user.academyId,
                season_name,
                season_type,
                season_start_date,
                season_end_date,
                non_season_end_date,
                JSON.stringify(operating_days),
                default_season_fee || 0,
                allows_continuous || false,
                continuous_to_season_type || null,
                continuous_discount_type || 'none',
                continuous_discount_rate || 0
            ]
        );

        const [created] = await db.query(
            'SELECT * FROM seasons WHERE id = ?',
            [result.insertId]
        );

        res.status(201).json({
            message: 'Season created successfully',
            season: created[0]
        });
    } catch (error) {
        console.error('Error creating season:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to create season'
        });
    }
});

/**
 * PUT /paca/seasons/:id
 * Update season
 * Access: owner, admin
 */
router.put('/:id', verifyToken, requireRole('owner', 'admin'), async (req, res) => {
    const seasonId = parseInt(req.params.id);

    try {
        // Verify exists and belongs to academy
        const [seasons] = await db.query(
            'SELECT * FROM seasons WHERE id = ? AND academy_id = ?',
            [seasonId, req.user.academyId]
        );

        if (seasons.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Season not found'
            });
        }

        const {
            season_name,
            season_type,
            season_start_date,
            season_end_date,
            non_season_end_date,
            operating_days,
            default_season_fee,
            allows_continuous,
            continuous_to_season_type,
            continuous_discount_type,
            continuous_discount_rate,
            status
        } = req.body;

        const updates = [];
        const params = [];

        if (season_name !== undefined) {
            updates.push('season_name = ?');
            params.push(season_name);
        }
        if (season_type !== undefined) {
            updates.push('season_type = ?');
            params.push(season_type);
        }
        if (season_start_date !== undefined) {
            updates.push('season_start_date = ?');
            params.push(season_start_date);
        }
        if (season_end_date !== undefined) {
            updates.push('season_end_date = ?');
            params.push(season_end_date);
        }
        if (non_season_end_date !== undefined) {
            updates.push('non_season_end_date = ?');
            params.push(non_season_end_date);
        }
        if (operating_days !== undefined) {
            updates.push('operating_days = ?');
            params.push(JSON.stringify(operating_days));
        }
        if (default_season_fee !== undefined) {
            updates.push('default_season_fee = ?');
            params.push(default_season_fee);
        }
        if (allows_continuous !== undefined) {
            updates.push('allows_continuous = ?');
            params.push(allows_continuous);
        }
        if (continuous_to_season_type !== undefined) {
            updates.push('continuous_to_season_type = ?');
            params.push(continuous_to_season_type);
        }
        if (continuous_discount_type !== undefined) {
            updates.push('continuous_discount_type = ?');
            params.push(continuous_discount_type);
        }
        if (continuous_discount_rate !== undefined) {
            updates.push('continuous_discount_rate = ?');
            params.push(continuous_discount_rate);
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
        params.push(seasonId);

        await db.query(
            `UPDATE seasons SET ${updates.join(', ')} WHERE id = ?`,
            params
        );

        const [updated] = await db.query(
            'SELECT * FROM seasons WHERE id = ?',
            [seasonId]
        );

        res.json({
            message: 'Season updated successfully',
            season: updated[0]
        });
    } catch (error) {
        console.error('Error updating season:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to update season'
        });
    }
});

/**
 * DELETE /paca/seasons/:id
 * Delete season (soft delete by setting status to 'ended')
 * Access: owner
 */
router.delete('/:id', verifyToken, requireRole('owner'), async (req, res) => {
    const seasonId = parseInt(req.params.id);

    try {
        const [seasons] = await db.query(
            'SELECT * FROM seasons WHERE id = ? AND academy_id = ?',
            [seasonId, req.user.academyId]
        );

        if (seasons.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Season not found'
            });
        }

        // Check if any students are enrolled
        const [enrolled] = await db.query(
            `SELECT COUNT(*) as count FROM student_seasons
            WHERE season_id = ? AND payment_status != 'cancelled'`,
            [seasonId]
        );

        if (enrolled[0].count > 0) {
            return res.status(400).json({
                error: 'Validation Error',
                message: `Cannot delete season with ${enrolled[0].count} enrolled students`
            });
        }

        // Soft delete by setting status to 'ended'
        await db.query(
            `UPDATE seasons SET status = 'ended', updated_at = NOW() WHERE id = ?`,
            [seasonId]
        );

        res.json({
            message: 'Season deactivated successfully',
            season: {
                id: seasonId,
                season_name: seasons[0].season_name
            }
        });
    } catch (error) {
        console.error('Error deleting season:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to delete season'
        });
    }
});

/**
 * POST /paca/seasons/:id/enroll
 * Enroll student to season with prorated fee calculation
 * Access: owner, admin
 */
router.post('/:id/enroll', verifyToken, requireRole('owner', 'admin'), async (req, res) => {
    const seasonId = parseInt(req.params.id);

    try {
        const {
            student_id,
            season_fee,
            registration_date,
            after_season_action,
            is_continuous,
            previous_season_id
        } = req.body;

        if (!student_id || !season_fee) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'Required fields: student_id, season_fee'
            });
        }

        // Verify season exists and belongs to academy
        const [seasons] = await db.query(
            `SELECT * FROM seasons WHERE id = ? AND academy_id = ? AND status != 'ended'`,
            [seasonId, req.user.academyId]
        );

        if (seasons.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Season not found or ended'
            });
        }

        const season = seasons[0];

        // Verify student exists and belongs to academy
        const [students] = await db.query(
            'SELECT * FROM students WHERE id = ? AND academy_id = ? AND deleted_at IS NULL',
            [student_id, req.user.academyId]
        );

        if (students.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Student not found'
            });
        }

        const student = students[0];

        // Check if already enrolled
        const [existing] = await db.query(
            `SELECT id FROM student_seasons
            WHERE student_id = ? AND season_id = ? AND payment_status != 'cancelled'`,
            [student_id, seasonId]
        );

        if (existing.length > 0) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'Student already enrolled in this season'
            });
        }

        // Calculate prorated fee
        const weeklyDays = parseWeeklyDays(student.class_days);
        const nonSeasonEnd = new Date(season.non_season_end_date);
        const proRatedMonth = `${nonSeasonEnd.getFullYear()}-${String(nonSeasonEnd.getMonth() + 1).padStart(2, '0')}`;

        const proRated = calculateProRatedFee({
            monthlyFee: parseFloat(student.monthly_tuition) || 0,
            weeklyDays,
            nonSeasonEndDate: nonSeasonEnd,
            discountRate: parseFloat(student.discount_rate) || 0
        });

        // Calculate discount for continuous enrollment
        let discountType = 'none';
        let discountAmount = 0;
        let finalSeasonFee = parseFloat(season_fee);

        if (is_continuous && previous_season_id && season.continuous_discount_type !== 'none') {
            discountType = season.continuous_discount_type;
            if (discountType === 'free') {
                discountAmount = finalSeasonFee;
                finalSeasonFee = 0;
            } else if (discountType === 'rate' && season.continuous_discount_rate > 0) {
                discountAmount = Math.floor(finalSeasonFee * (season.continuous_discount_rate / 100));
                finalSeasonFee -= discountAmount;
            }
        }

        // Enroll student
        const [result] = await db.query(
            `INSERT INTO student_seasons (
                student_id,
                season_id,
                season_fee,
                registration_date,
                after_season_action,
                prorated_month,
                prorated_amount,
                prorated_details,
                is_continuous,
                previous_season_id,
                discount_type,
                discount_amount,
                payment_status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
            [
                student_id,
                seasonId,
                finalSeasonFee,
                registration_date || new Date().toISOString().split('T')[0],
                after_season_action || 'regular',
                proRatedMonth,
                proRated.proRatedFee,
                JSON.stringify(proRated),
                is_continuous || false,
                previous_season_id || null,
                discountType,
                discountAmount
            ]
        );

        // Update student's season registration status
        await db.query(
            `UPDATE students SET is_season_registered = true, current_season_id = ? WHERE id = ?`,
            [seasonId, student_id]
        );

        // Get enrollment details
        const [enrollment] = await db.query(
            `SELECT
                ss.*,
                s.name as student_name,
                se.season_name,
                se.season_type
            FROM student_seasons ss
            JOIN students s ON ss.student_id = s.id
            JOIN seasons se ON ss.season_id = se.id
            WHERE ss.id = ?`,
            [result.insertId]
        );

        res.status(201).json({
            message: 'Student enrolled in season successfully',
            enrollment: enrollment[0],
            proRatedCalculation: proRated
        });
    } catch (error) {
        console.error('Error enrolling student:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to enroll student'
        });
    }
});

/**
 * GET /paca/seasons/:id/students
 * Get enrolled students for season
 * Access: owner, admin, teacher
 */
router.get('/:id/students', verifyToken, async (req, res) => {
    const seasonId = parseInt(req.params.id);

    try {
        const [enrollments] = await db.query(
            `SELECT
                ss.*,
                s.name as student_name,
                s.phone as student_phone,
                s.parent_phone,
                s.class_days
            FROM student_seasons ss
            JOIN students s ON ss.student_id = s.id
            WHERE ss.season_id = ?
            AND s.academy_id = ?
            ORDER BY ss.registration_date DESC`,
            [seasonId, req.user.academyId]
        );

        res.json({
            message: `Found ${enrollments.length} enrolled students`,
            enrollments
        });
    } catch (error) {
        console.error('Error fetching enrolled students:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to fetch enrolled students'
        });
    }
});

/**
 * POST /paca/seasons/:id/preview
 * Preview prorated fee calculation for student
 * Access: owner, admin
 */
router.post('/:id/preview', verifyToken, requireRole('owner', 'admin'), async (req, res) => {
    const seasonId = parseInt(req.params.id);

    try {
        const { student_id } = req.body;

        if (!student_id) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'Required field: student_id'
            });
        }

        // Get season info
        const [seasons] = await db.query(
            'SELECT * FROM seasons WHERE id = ? AND academy_id = ?',
            [seasonId, req.user.academyId]
        );

        if (seasons.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Season not found'
            });
        }

        // Get student info
        const [students] = await db.query(
            'SELECT * FROM students WHERE id = ? AND academy_id = ? AND deleted_at IS NULL',
            [student_id, req.user.academyId]
        );

        if (students.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Student not found'
            });
        }

        const season = seasons[0];
        const student = students[0];

        // Calculate prorated fee
        const weeklyDays = parseWeeklyDays(student.class_days);
        const nonSeasonEnd = new Date(season.non_season_end_date);
        const seasonStart = new Date(season.season_start_date);

        const proRated = calculateProRatedFee({
            monthlyFee: parseFloat(student.monthly_tuition) || 0,
            weeklyDays,
            nonSeasonEndDate: nonSeasonEnd,
            discountRate: parseFloat(student.discount_rate) || 0
        });

        // Calculate gap period
        const gapStart = new Date(nonSeasonEnd);
        gapStart.setDate(gapStart.getDate() + 1);
        const gapEnd = new Date(seasonStart);
        gapEnd.setDate(gapEnd.getDate() - 1);
        const hasGap = gapStart <= gapEnd;

        // Check for continuous enrollment discount
        let continuousDiscount = null;
        if (season.allows_continuous && season.continuous_discount_type !== 'none') {
            continuousDiscount = {
                type: season.continuous_discount_type,
                rate: season.continuous_discount_rate,
                description: season.continuous_discount_type === 'free'
                    ? '연속등록 시 무료'
                    : `연속등록 시 ${season.continuous_discount_rate}% 할인`
            };
        }

        const preview = {
            student: {
                id: student.id,
                name: student.name,
                monthlyTuition: parseFloat(student.monthly_tuition),
                discountRate: parseFloat(student.discount_rate) || 0,
                classDays: weeklyDays
            },
            season: {
                id: season.id,
                name: season.season_name,
                type: season.season_type,
                nonSeasonEndDate: season.non_season_end_date,
                seasonStartDate: season.season_start_date,
                seasonEndDate: season.season_end_date,
                defaultSeasonFee: parseFloat(season.default_season_fee)
            },
            proRatedCalculation: proRated,
            gapPeriod: hasGap ? {
                start: gapStart.toISOString().split('T')[0],
                end: gapEnd.toISOString().split('T')[0],
                days: Math.ceil((gapEnd - gapStart) / (1000 * 60 * 60 * 24)) + 1
            } : null,
            continuousDiscount,
            summary: {
                proRatedMonth: `${nonSeasonEnd.getFullYear()}-${String(nonSeasonEnd.getMonth() + 1).padStart(2, '0')}`,
                proRatedAmount: proRated.proRatedFee,
                seasonFee: parseFloat(season.default_season_fee),
                totalDue: proRated.proRatedFee + parseFloat(season.default_season_fee)
            }
        };

        res.json({
            message: 'Season transition preview calculated',
            preview
        });
    } catch (error) {
        console.error('Error calculating preview:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to calculate preview'
        });
    }
});

/**
 * POST /paca/seasons/enrollments/:enrollment_id/pay
 * Record season fee payment
 * Access: owner, admin
 */
router.post('/enrollments/:enrollment_id/pay', verifyToken, requireRole('owner', 'admin'), async (req, res) => {
    const enrollmentId = parseInt(req.params.enrollment_id);

    try {
        const { paid_date, paid_amount, payment_method } = req.body;

        // Get enrollment
        const [enrollments] = await db.query(
            `SELECT
                ss.*,
                s.academy_id,
                s.name as student_name,
                se.season_name
            FROM student_seasons ss
            JOIN students s ON ss.student_id = s.id
            JOIN seasons se ON ss.season_id = se.id
            WHERE ss.id = ?`,
            [enrollmentId]
        );

        if (enrollments.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Enrollment not found'
            });
        }

        const enrollment = enrollments[0];

        if (enrollment.academy_id !== req.user.academyId) {
            return res.status(403).json({
                error: 'Forbidden',
                message: 'Access denied'
            });
        }

        if (enrollment.payment_status === 'paid') {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'Season fee already paid'
            });
        }

        // Update payment status
        const paymentDate = paid_date || new Date().toISOString().split('T')[0];
        const paymentAmount = paid_amount || enrollment.season_fee;

        await db.query(
            `UPDATE student_seasons
            SET payment_status = 'paid', paid_date = ?, paid_amount = ?, payment_method = ?, updated_at = NOW()
            WHERE id = ?`,
            [paymentDate, paymentAmount, payment_method || null, enrollmentId]
        );

        // Record in revenues table
        await db.query(
            `INSERT INTO revenues (
                academy_id,
                category,
                amount,
                revenue_date,
                student_id,
                description
            ) VALUES (?, 'season', ?, ?, ?, ?)`,
            [
                enrollment.academy_id,
                paymentAmount,
                paymentDate,
                enrollment.student_id,
                `시즌비 납부 (${enrollment.season_name})`
            ]
        );

        // Get updated record
        const [updated] = await db.query(
            `SELECT
                ss.*,
                s.name as student_name,
                se.season_name
            FROM student_seasons ss
            JOIN students s ON ss.student_id = s.id
            JOIN seasons se ON ss.season_id = se.id
            WHERE ss.id = ?`,
            [enrollmentId]
        );

        res.json({
            message: 'Season fee payment recorded successfully',
            enrollment: updated[0]
        });
    } catch (error) {
        console.error('Error recording payment:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to record payment'
        });
    }
});

/**
 * POST /paca/seasons/enrollments/:enrollment_id/cancel
 * Cancel season enrollment (refund calculation)
 * Access: owner, admin
 */
router.post('/enrollments/:enrollment_id/cancel', verifyToken, requireRole('owner', 'admin'), async (req, res) => {
    const enrollmentId = parseInt(req.params.enrollment_id);

    try {
        const { cancellation_date, refund_policy } = req.body;

        // Get enrollment
        const [enrollments] = await db.query(
            `SELECT
                ss.*,
                s.academy_id,
                s.name as student_name,
                s.class_days,
                se.season_name,
                se.season_start_date,
                se.season_end_date
            FROM student_seasons ss
            JOIN students s ON ss.student_id = s.id
            JOIN seasons se ON ss.season_id = se.id
            WHERE ss.id = ?`,
            [enrollmentId]
        );

        if (enrollments.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Enrollment not found'
            });
        }

        const enrollment = enrollments[0];

        if (enrollment.academy_id !== req.user.academyId) {
            return res.status(403).json({
                error: 'Forbidden',
                message: 'Access denied'
            });
        }

        if (enrollment.payment_status === 'cancelled') {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'Enrollment already cancelled'
            });
        }

        const cancelDate = cancellation_date || new Date().toISOString().split('T')[0];
        const weeklyDays = parseWeeklyDays(enrollment.class_days);

        // Calculate refund
        const refundResult = calculateSeasonRefund({
            seasonFee: parseFloat(enrollment.season_fee),
            seasonStartDate: new Date(enrollment.season_start_date),
            seasonEndDate: new Date(enrollment.season_end_date),
            cancellationDate: new Date(cancelDate),
            weeklyDays,
            refundPolicy: refund_policy || 'legal'
        });

        // Update enrollment
        await db.query(
            `UPDATE student_seasons
            SET
                payment_status = 'cancelled',
                is_cancelled = true,
                cancellation_date = ?,
                refund_amount = ?,
                refund_calculation = ?,
                updated_at = NOW()
            WHERE id = ?`,
            [cancelDate, refundResult.refundAmount, JSON.stringify(refundResult), enrollmentId]
        );

        // Update student's season registration status
        await db.query(
            `UPDATE students SET is_season_registered = false, current_season_id = NULL WHERE id = ?`,
            [enrollment.student_id]
        );

        // Record refund expense if amount > 0
        if (refundResult.refundAmount > 0 && enrollment.payment_status === 'paid') {
            await db.query(
                `INSERT INTO expenses (
                    academy_id,
                    category,
                    amount,
                    expense_date,
                    description
                ) VALUES (?, 'refund', ?, ?, ?)`,
                [
                    enrollment.academy_id,
                    refundResult.refundAmount,
                    cancelDate,
                    `시즌 중도 해지 환불 - ${enrollment.student_name} (${enrollment.season_name})`
                ]
            );
        }

        // Get updated record
        const [updated] = await db.query(
            `SELECT
                ss.*,
                s.name as student_name,
                se.season_name
            FROM student_seasons ss
            JOIN students s ON ss.student_id = s.id
            JOIN seasons se ON ss.season_id = se.id
            WHERE ss.id = ?`,
            [enrollmentId]
        );

        res.json({
            message: 'Season enrollment cancelled successfully',
            enrollment: updated[0],
            refundCalculation: refundResult
        });
    } catch (error) {
        console.error('Error cancelling enrollment:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to cancel enrollment'
        });
    }
});

/**
 * GET /paca/seasons/active
 * Get currently active season(s)
 * Access: owner, admin, teacher
 */
router.get('/active', verifyToken, async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];

        const [seasons] = await db.query(
            `SELECT * FROM seasons
            WHERE academy_id = ?
            AND status = 'active'
            AND season_start_date <= ?
            AND season_end_date >= ?
            ORDER BY season_type`,
            [req.user.academyId, today, today]
        );

        res.json({
            message: `Found ${seasons.length} active season(s)`,
            seasons
        });
    } catch (error) {
        console.error('Error fetching active seasons:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to fetch active seasons'
        });
    }
});

module.exports = router;

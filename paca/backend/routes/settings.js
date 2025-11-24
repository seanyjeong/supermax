const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { verifyToken, requireRole } = require('../middleware/auth');

/**
 * GET /paca/settings
 * Get academy settings
 * Access: owner, admin, teacher
 */
router.get('/', verifyToken, async (req, res) => {
    try {
        const [settings] = await db.query(
            `SELECT
                s.*,
                a.name AS academy_name,
                a.business_number,
                a.address AS academy_address,
                a.phone AS academy_phone,
                a.email AS academy_email,
                a.operating_hours
            FROM academy_settings s
            JOIN academies a ON s.academy_id = a.id
            WHERE s.academy_id = ?`,
            [req.user.academyId]
        );

        if (settings.length === 0) {
            // If settings don't exist, return default values
            const [academy] = await db.query(
                'SELECT * FROM academies WHERE id = ?',
                [req.user.academyId]
            );

            if (academy.length === 0) {
                return res.status(404).json({
                    error: 'Not Found',
                    message: 'Academy not found'
                });
            }

            return res.json({
                message: 'Settings not configured yet (using defaults)',
                settings: {
                    academy_id: req.user.academyId,
                    academy_name: academy[0].name,
                    academy_address: academy[0].address,
                    academy_phone: academy[0].phone,
                    academy_email: academy[0].email,
                    business_number: academy[0].business_number,
                    operating_hours: academy[0].operating_hours,
                    tuition_due_day: 5,
                    salary_payment_day: 10,
                    morning_class_time: '09:30-12:00',
                    afternoon_class_time: '14:00-18:00',
                    evening_class_time: '18:30-21:00',
                    weekly_tuition_rates: null,
                    settings: null
                }
            });
        }

        res.json({
            message: 'Settings retrieved successfully',
            settings: settings[0]
        });
    } catch (error) {
        console.error('Error fetching settings:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to fetch settings'
        });
    }
});

/**
 * PUT /paca/settings
 * Update academy settings
 * Access: owner, admin only
 */
router.put('/', verifyToken, requireRole('owner', 'admin'), async (req, res) => {
    try {
        const {
            tuition_due_day,
            salary_payment_day,
            morning_class_time,
            afternoon_class_time,
            evening_class_time,
            weekly_tuition_rates,
            settings
        } = req.body;

        // Validation
        if (tuition_due_day !== undefined) {
            const day = parseInt(tuition_due_day);
            if (isNaN(day) || day < 1 || day > 31) {
                return res.status(400).json({
                    error: 'Validation Error',
                    message: 'tuition_due_day must be between 1 and 31'
                });
            }
        }

        if (salary_payment_day !== undefined) {
            const day = parseInt(salary_payment_day);
            if (isNaN(day) || day < 1 || day > 31) {
                return res.status(400).json({
                    error: 'Validation Error',
                    message: 'salary_payment_day must be between 1 and 31'
                });
            }
        }

        // Time format validation (HH:MM-HH:MM)
        const timeRegex = /^\d{2}:\d{2}-\d{2}:\d{2}$/;
        if (morning_class_time && !timeRegex.test(morning_class_time)) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'morning_class_time must be in HH:MM-HH:MM format'
            });
        }
        if (afternoon_class_time && !timeRegex.test(afternoon_class_time)) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'afternoon_class_time must be in HH:MM-HH:MM format'
            });
        }
        if (evening_class_time && !timeRegex.test(evening_class_time)) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'evening_class_time must be in HH:MM-HH:MM format'
            });
        }

        // Check if settings exist
        const [existing] = await db.query(
            'SELECT id FROM academy_settings WHERE academy_id = ?',
            [req.user.academyId]
        );

        if (existing.length === 0) {
            // Create new settings
            const [result] = await db.query(
                `INSERT INTO academy_settings
                (academy_id, tuition_due_day, salary_payment_day,
                 morning_class_time, afternoon_class_time, evening_class_time,
                 weekly_tuition_rates, settings)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    req.user.academyId,
                    tuition_due_day || 5,
                    salary_payment_day || 10,
                    morning_class_time || '09:30-12:00',
                    afternoon_class_time || '14:00-18:00',
                    evening_class_time || '18:30-21:00',
                    weekly_tuition_rates ? JSON.stringify(weekly_tuition_rates) : null,
                    settings ? JSON.stringify(settings) : null
                ]
            );

            const [newSettings] = await db.query(
                `SELECT s.*, a.name AS academy_name
                FROM academy_settings s
                JOIN academies a ON s.academy_id = a.id
                WHERE s.id = ?`,
                [result.insertId]
            );

            return res.status(201).json({
                message: 'Settings created successfully',
                settings: newSettings[0]
            });
        }

        // Update existing settings
        const updates = [];
        const params = [];

        if (tuition_due_day !== undefined) {
            updates.push('tuition_due_day = ?');
            params.push(tuition_due_day);
        }
        if (salary_payment_day !== undefined) {
            updates.push('salary_payment_day = ?');
            params.push(salary_payment_day);
        }
        if (morning_class_time !== undefined) {
            updates.push('morning_class_time = ?');
            params.push(morning_class_time);
        }
        if (afternoon_class_time !== undefined) {
            updates.push('afternoon_class_time = ?');
            params.push(afternoon_class_time);
        }
        if (evening_class_time !== undefined) {
            updates.push('evening_class_time = ?');
            params.push(evening_class_time);
        }
        if (weekly_tuition_rates !== undefined) {
            updates.push('weekly_tuition_rates = ?');
            params.push(JSON.stringify(weekly_tuition_rates));
        }
        if (settings !== undefined) {
            updates.push('settings = ?');
            params.push(JSON.stringify(settings));
        }

        if (updates.length === 0) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'No fields to update'
            });
        }

        params.push(req.user.academyId);

        await db.query(
            `UPDATE academy_settings SET ${updates.join(', ')} WHERE academy_id = ?`,
            params
        );

        // Fetch updated settings
        const [updated] = await db.query(
            `SELECT s.*, a.name AS academy_name
            FROM academy_settings s
            JOIN academies a ON s.academy_id = a.id
            WHERE s.academy_id = ?`,
            [req.user.academyId]
        );

        res.json({
            message: 'Settings updated successfully',
            settings: updated[0]
        });
    } catch (error) {
        console.error('Error updating settings:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to update settings'
        });
    }
});

/**
 * PUT /paca/settings/academy
 * Update academy basic information
 * Access: owner only
 */
router.put('/academy', verifyToken, requireRole('owner'), async (req, res) => {
    try {
        const {
            name,
            business_number,
            address,
            phone,
            email,
            operating_hours
        } = req.body;

        // Build update query dynamically
        const updates = [];
        const params = [];

        if (name !== undefined) {
            updates.push('name = ?');
            params.push(name);
        }
        if (business_number !== undefined) {
            updates.push('business_number = ?');
            params.push(business_number);
        }
        if (address !== undefined) {
            updates.push('address = ?');
            params.push(address);
        }
        if (phone !== undefined) {
            updates.push('phone = ?');
            params.push(phone);
        }
        if (email !== undefined) {
            updates.push('email = ?');
            params.push(email);
        }
        if (operating_hours !== undefined) {
            updates.push('operating_hours = ?');
            params.push(JSON.stringify(operating_hours));
        }

        if (updates.length === 0) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'No fields to update'
            });
        }

        params.push(req.user.academyId);

        await db.query(
            `UPDATE academies SET ${updates.join(', ')} WHERE id = ?`,
            params
        );

        // Fetch updated academy info
        const [updated] = await db.query(
            'SELECT * FROM academies WHERE id = ?',
            [req.user.academyId]
        );

        res.json({
            message: 'Academy information updated successfully',
            academy: updated[0]
        });
    } catch (error) {
        console.error('Error updating academy info:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to update academy information'
        });
    }
});

/**
 * GET /paca/settings/tuition-rates
 * Get weekly tuition rates configuration
 * Access: owner, admin, teacher
 */
router.get('/tuition-rates', verifyToken, async (req, res) => {
    try {
        const [settings] = await db.query(
            'SELECT weekly_tuition_rates FROM academy_settings WHERE academy_id = ?',
            [req.user.academyId]
        );

        if (settings.length === 0 || !settings[0].weekly_tuition_rates) {
            // Return default structure
            return res.json({
                message: 'Tuition rates not configured (using defaults)',
                tuition_rates: {
                    weekly_1: 200000,
                    weekly_2: 300000,
                    weekly_3: 400000,
                    weekly_4: 450000,
                    weekly_5: 500000,
                    weekly_6: 550000,
                    weekly_7: 600000
                }
            });
        }

        res.json({
            message: 'Tuition rates retrieved successfully',
            tuition_rates: settings[0].weekly_tuition_rates
        });
    } catch (error) {
        console.error('Error fetching tuition rates:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to fetch tuition rates'
        });
    }
});

/**
 * PUT /paca/settings/tuition-rates
 * Update weekly tuition rates
 * Access: owner, admin only
 */
router.put('/tuition-rates', verifyToken, requireRole('owner', 'admin'), async (req, res) => {
    try {
        const { tuition_rates } = req.body;

        if (!tuition_rates || typeof tuition_rates !== 'object') {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'tuition_rates object is required'
            });
        }

        // Check if settings exist
        const [existing] = await db.query(
            'SELECT id FROM academy_settings WHERE academy_id = ?',
            [req.user.academyId]
        );

        if (existing.length === 0) {
            // Create new settings with tuition rates
            await db.query(
                `INSERT INTO academy_settings (academy_id, weekly_tuition_rates)
                VALUES (?, ?)`,
                [req.user.academyId, JSON.stringify(tuition_rates)]
            );
        } else {
            // Update existing settings
            await db.query(
                'UPDATE academy_settings SET weekly_tuition_rates = ? WHERE academy_id = ?',
                [JSON.stringify(tuition_rates), req.user.academyId]
            );
        }

        res.json({
            message: 'Tuition rates updated successfully',
            tuition_rates
        });
    } catch (error) {
        console.error('Error updating tuition rates:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to update tuition rates'
        });
    }
});

module.exports = router;

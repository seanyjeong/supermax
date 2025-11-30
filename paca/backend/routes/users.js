const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { verifyToken, requireRole } = require('../middleware/auth');

/**
 * GET /paca/users/pending
 * Get all pending users waiting for approval
 * Access: owner, admin
 */
router.get('/pending', verifyToken, requireRole('owner', 'admin'), async (req, res) => {
    try {
        const [users] = await db.query(
            `SELECT
                u.id,
                u.email,
                u.name,
                u.phone,
                u.role,
                u.approval_status,
                u.created_at,
                a.name as academy_name
            FROM users u
            LEFT JOIN academies a ON u.academy_id = a.id
            WHERE u.approval_status = 'pending'
            AND u.is_active = true
            ORDER BY u.created_at DESC`
        );

        res.json({
            message: `Found ${users.length} pending users`,
            users
        });
    } catch (error) {
        console.error('Error fetching pending users:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to fetch pending users'
        });
    }
});

/**
 * POST /paca/users/approve/:id
 * Approve a pending user
 * Access: owner, admin
 */
router.post('/approve/:id', verifyToken, requireRole('owner', 'admin'), async (req, res) => {
    const userId = parseInt(req.params.id);

    try {
        // Check if user exists and is pending
        const [users] = await db.query(
            'SELECT id, email, name, approval_status FROM users WHERE id = ?',
            [userId]
        );

        if (users.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'User not found'
            });
        }

        const user = users[0];

        if (user.approval_status !== 'pending') {
            return res.status(400).json({
                error: 'Bad Request',
                message: `User is already ${user.approval_status}`
            });
        }

        // Approve user
        await db.query(
            'UPDATE users SET approval_status = ?, updated_at = NOW() WHERE id = ?',
            ['approved', userId]
        );

        res.json({
            message: 'User approved successfully',
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                approval_status: 'approved'
            }
        });
    } catch (error) {
        console.error('Error approving user:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to approve user'
        });
    }
});

/**
 * POST /paca/users/reject/:id
 * Reject a pending user
 * Access: owner, admin
 */
router.post('/reject/:id', verifyToken, requireRole('owner', 'admin'), async (req, res) => {
    const userId = parseInt(req.params.id);

    try {
        // Check if user exists and is pending
        const [users] = await db.query(
            'SELECT id, email, name, approval_status FROM users WHERE id = ?',
            [userId]
        );

        if (users.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'User not found'
            });
        }

        const user = users[0];

        if (user.approval_status !== 'pending') {
            return res.status(400).json({
                error: 'Bad Request',
                message: `User is already ${user.approval_status}`
            });
        }

        // Reject user
        await db.query(
            'UPDATE users SET approval_status = ?, updated_at = NOW() WHERE id = ?',
            ['rejected', userId]
        );

        res.json({
            message: 'User rejected successfully',
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                approval_status: 'rejected'
            }
        });
    } catch (error) {
        console.error('Error rejecting user:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to reject user'
        });
    }
});

/**
 * GET /paca/users
 * Get all users (with optional filters)
 * Access: owner, admin
 */
router.get('/', verifyToken, requireRole('owner', 'admin'), async (req, res) => {
    try {
        const { role, approval_status } = req.query;

        let query = `
            SELECT
                u.id,
                u.email,
                u.name,
                u.phone,
                u.role,
                u.approval_status,
                u.is_active,
                u.created_at,
                a.name as academy_name
            FROM users u
            LEFT JOIN academies a ON u.academy_id = a.id
            WHERE 1=1
        `;

        const params = [];

        if (role) {
            query += ' AND u.role = ?';
            params.push(role);
        }

        if (approval_status) {
            query += ' AND u.approval_status = ?';
            params.push(approval_status);
        }

        query += ' ORDER BY u.created_at DESC';

        const [users] = await db.query(query, params);

        res.json({
            message: `Found ${users.length} users`,
            users
        });
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to fetch users'
        });
    }
});

/**
 * GET /paca/users/:id
 * Get user by ID
 * Access: owner, admin
 */
router.get('/:id', verifyToken, requireRole('owner', 'admin'), async (req, res) => {
    const userId = parseInt(req.params.id);

    try {
        const [users] = await db.query(
            `SELECT
                u.id,
                u.email,
                u.name,
                u.phone,
                u.role,
                u.approval_status,
                u.is_active,
                u.created_at,
                u.updated_at,
                u.last_login,
                a.id as academy_id,
                a.name as academy_name
            FROM users u
            LEFT JOIN academies a ON u.academy_id = a.id
            WHERE u.id = ?`,
            [userId]
        );

        if (users.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'User not found'
            });
        }

        res.json({ user: users[0] });
    } catch (error) {
        console.error('Error fetching user:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to fetch user'
        });
    }
});

module.exports = router;

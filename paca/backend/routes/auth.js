/**
 * Authentication Routes
 * /api/auth
 */

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../config/database');
const { generateToken, verifyToken } = require('../middleware/auth');

/**
 * POST /api/auth/register
 * Register new user
 */
router.post('/register', async (req, res) => {
    const connection = await db.getConnection();

    try {
        const {
            email,
            password,
            name,
            phone,
            role = 'owner', // 첫 가입자는 원장으로 등록
            academyName // 원장이 가입할 때 학원명
        } = req.body;

        // Validation
        if (!email || !password || !name) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'Email, password, and name are required'
            });
        }

        // Email format validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'Invalid email format'
            });
        }

        // Password strength validation
        if (password.length < 8) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'Password must be at least 8 characters'
            });
        }

        await connection.beginTransaction();

        // Check if email already exists
        const [existingUsers] = await connection.query(
            'SELECT id FROM users WHERE email = ?',
            [email]
        );

        if (existingUsers.length > 0) {
            await connection.rollback();
            return res.status(409).json({
                error: 'Conflict',
                message: 'Email already registered'
            });
        }

        // Hash password
        const passwordHash = await bcrypt.hash(password, 10);

        // Insert user (원장으로 등록, 승인 대기 상태)
        const [userResult] = await connection.query(
            `INSERT INTO users
            (email, password_hash, name, phone, role, approval_status, is_active)
            VALUES (?, ?, ?, ?, ?, 'pending', TRUE)`,
            [email, passwordHash, name, phone, role]
        );

        const userId = userResult.insertId;

        // 원장인 경우 학원 정보도 생성
        if (role === 'owner' && academyName) {
            const [academyResult] = await connection.query(
                'INSERT INTO academies (owner_user_id, name) VALUES (?, ?)',
                [userId, academyName]
            );

            const academyId = academyResult.insertId;

            // Update user's academy_id
            await connection.query(
                'UPDATE users SET academy_id = ? WHERE id = ?',
                [academyId, userId]
            );

            // Create default academy settings
            await connection.query(
                'INSERT INTO academy_settings (academy_id) VALUES (?)',
                [academyId]
            );
        }

        await connection.commit();

        res.status(201).json({
            message: 'Registration successful. Please wait for administrator approval.',
            user: {
                id: userId,
                email,
                name,
                role,
                approvalStatus: 'pending'
            }
        });

    } catch (error) {
        await connection.rollback();
        console.error('Registration error:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Registration failed',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    } finally {
        connection.release();
    }
});

/**
 * POST /api/auth/login
 * User login
 */
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        // Validation
        if (!email || !password) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'Email and password are required'
            });
        }

        // Find user
        const [users] = await db.query(
            `SELECT id, email, password_hash, name, role, academy_id,
             approval_status, is_active, position, permissions
             FROM users
             WHERE email = ? AND deleted_at IS NULL`,
            [email]
        );

        if (users.length === 0) {
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'Invalid email or password'
            });
        }

        const user = users[0];

        // Check password
        const isPasswordValid = await bcrypt.compare(password, user.password_hash);

        if (!isPasswordValid) {
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'Invalid email or password'
            });
        }

        // Check if account is active
        if (!user.is_active) {
            return res.status(403).json({
                error: 'Forbidden',
                message: 'Account is inactive'
            });
        }

        // Check if account is approved
        if (user.approval_status !== 'approved') {
            return res.status(403).json({
                error: 'Forbidden',
                message: 'Account is pending approval. Please contact administrator.',
                approvalStatus: user.approval_status
            });
        }

        // Update last login
        await db.query(
            'UPDATE users SET last_login_at = NOW() WHERE id = ?',
            [user.id]
        );

        // Generate token
        const token = generateToken(user.id);

        // Get academy info if exists
        let academy = null;
        if (user.academy_id) {
            const [academies] = await db.query(
                'SELECT id, name FROM academies WHERE id = ?',
                [user.academy_id]
            );
            academy = academies[0] || null;
        }

        // Parse permissions JSON
        let permissions = {};
        if (user.permissions) {
            try {
                permissions = typeof user.permissions === 'string'
                    ? JSON.parse(user.permissions)
                    : user.permissions;
            } catch (e) {
                console.error('Failed to parse permissions:', e);
            }
        }

        res.json({
            message: 'Login successful',
            token,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role,
                academyId: user.academy_id,
                academy,
                position: user.position,
                permissions: permissions
            }
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Login failed',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

/**
 * GET /api/auth/me
 * Get current user info
 */
router.get('/me', verifyToken, async (req, res) => {
    try {
        const [users] = await db.query(
            `SELECT u.id, u.email, u.name, u.phone, u.role, u.academy_id,
             a.name as academy_name
             FROM users u
             LEFT JOIN academies a ON u.academy_id = a.id
             WHERE u.id = ?`,
            [req.user.id]
        );

        if (users.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'User not found'
            });
        }

        res.json({
            user: users[0]
        });

    } catch (error) {
        console.error('Get user error:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to get user info'
        });
    }
});

/**
 * POST /api/auth/change-password
 * Change user password
 */
router.post('/change-password', verifyToken, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'Current password and new password are required'
            });
        }

        if (newPassword.length < 8) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'New password must be at least 8 characters'
            });
        }

        // Get current password hash
        const [users] = await db.query(
            'SELECT password_hash FROM users WHERE id = ?',
            [req.user.id]
        );

        if (users.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'User not found'
            });
        }

        // Verify current password
        const isValid = await bcrypt.compare(currentPassword, users[0].password_hash);

        if (!isValid) {
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'Current password is incorrect'
            });
        }

        // Hash new password
        const newPasswordHash = await bcrypt.hash(newPassword, 10);

        // Update password
        await db.query(
            'UPDATE users SET password_hash = ?, updated_at = NOW() WHERE id = ?',
            [newPasswordHash, req.user.id]
        );

        res.json({
            message: 'Password changed successfully'
        });

    } catch (error) {
        console.error('Change password error:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to change password'
        });
    }
});

module.exports = router;

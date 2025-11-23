/**
 * JWT Authentication Middleware
 */

const jwt = require('jsonwebtoken');
const db = require('../config/database');

const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key';

/**
 * Verify JWT Token
 */
const verifyToken = async (req, res, next) => {
    try {
        // Get token from header
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'No token provided'
            });
        }

        const token = authHeader.substring(7); // Remove 'Bearer ' prefix

        // Verify token
        const decoded = jwt.verify(token, JWT_SECRET);

        // Check if user still exists and is active
        const [users] = await db.query(
            'SELECT id, email, name, role, academy_id, is_active, approval_status FROM users WHERE id = ? AND deleted_at IS NULL',
            [decoded.userId]
        );

        if (users.length === 0) {
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'User not found'
            });
        }

        const user = users[0];

        // Check if user is active
        if (!user.is_active) {
            return res.status(403).json({
                error: 'Forbidden',
                message: 'Account is inactive'
            });
        }

        // Check if user is approved
        if (user.approval_status !== 'approved') {
            return res.status(403).json({
                error: 'Forbidden',
                message: 'Account is not approved yet'
            });
        }

        // Attach user to request
        req.user = {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            academyId: user.academy_id
        };

        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'Token expired'
            });
        }

        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'Invalid token'
            });
        }

        console.error('Auth middleware error:', error);
        return res.status(500).json({
            error: 'Internal Server Error',
            message: 'Authentication error'
        });
    }
};

/**
 * Check if user has required role
 */
const requireRole = (...roles) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'Authentication required'
            });
        }

        if (!roles.includes(req.user.role)) {
            return res.status(403).json({
                error: 'Forbidden',
                message: `Required role: ${roles.join(' or ')}`
            });
        }

        next();
    };
};

/**
 * Check if user belongs to the same academy
 */
const checkAcademyAccess = async (req, res, next) => {
    try {
        const { academyId } = req.params;

        // Owner can access any academy
        if (req.user.role === 'owner') {
            return next();
        }

        // Check if user belongs to the academy
        if (req.user.academyId != academyId) {
            return res.status(403).json({
                error: 'Forbidden',
                message: 'Access denied to this academy'
            });
        }

        next();
    } catch (error) {
        console.error('Academy access check error:', error);
        return res.status(500).json({
            error: 'Internal Server Error',
            message: 'Access check error'
        });
    }
};

/**
 * Generate JWT Token
 */
const generateToken = (userId, expiresIn = '24h') => {
    return jwt.sign(
        { userId },
        JWT_SECRET,
        { expiresIn }
    );
};

module.exports = {
    verifyToken,
    requireRole,
    checkAcademyAccess,
    generateToken
};

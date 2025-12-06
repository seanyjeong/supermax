/**
 * JWT Authentication Middleware
 */

const jwt = require('jsonwebtoken');
const db = require('../config/database');

const JWT_SECRET = process.env.JWT_SECRET || 'jeong-paca-secret';
const N8N_API_KEY = process.env.N8N_API_KEY || 'paca-n8n-api-key-2024';

/**
 * Verify JWT Token or N8N API Key
 */
const verifyToken = async (req, res, next) => {
    try {
        // Check for N8N API Key first
        const apiKey = req.headers['x-api-key'];
        if (apiKey && apiKey === N8N_API_KEY) {
            // N8N 서비스 계정으로 처리 (academy_id는 쿼리에서 받음)
            const academyId = req.query.academy_id || req.body.academy_id || null;
            req.user = {
                id: 0,
                email: 'n8n@system',
                name: 'N8N Service',
                role: 'admin',
                academyId: academyId,
                academy_id: academyId, // 호환성 위해 둘 다 설정
                position: 'system',
                permissions: {},
                isServiceAccount: true
            };
            return next();
        }

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
            'SELECT id, email, name, role, academy_id, is_active, approval_status, position, permissions, instructor_id FROM users WHERE id = ? AND deleted_at IS NULL',
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

        // Parse permissions JSON
        let permissions = {};
        if (user.permissions) {
            try {
                permissions = typeof user.permissions === 'string'
                    ? JSON.parse(user.permissions)
                    : user.permissions;
            } catch (e) {
                // Failed to parse permissions
            }
        }

        // Attach user to request
        req.user = {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            academyId: user.academy_id,
            academy_id: user.academy_id, // 호환성 위해 둘 다 설정
            position: user.position,
            permissions: permissions,
            instructorId: user.instructor_id
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
        return res.status(500).json({
            error: 'Internal Server Error',
            message: 'Access check error'
        });
    }
};

/**
 * 페이지 이름을 한글로 변환
 */
const PAGE_LABELS = {
    students: '학생 관리',
    instructors: '강사 관리',
    payments: '학원비',
    salaries: '급여 관리',
    schedules: '스케줄',
    reports: '리포트',
    expenses: '지출 관리',
    incomes: '기타수입',
    seasons: '시즌 관리',
    settings: '설정',
    staff: '직원 관리',
    dashboard_finance: '대시보드 매출',
    dashboard_unpaid: '대시보드 미수금',
    overtime_approval: '초과근무 승인'
};

/**
 * 액션을 한글로 변환
 */
const ACTION_LABELS = {
    view: '조회',
    edit: '수정'
};

/**
 * Check if user has permission for specific page and action
 * Usage: checkPermission('students', 'edit')
 */
const checkPermission = (page, action) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                error: 'Unauthorized',
                message: '로그인이 필요합니다.'
            });
        }

        // owner는 모든 권한
        if (req.user.role === 'owner') {
            return next();
        }

        // admin(시스템 관리자)도 모든 권한
        if (req.user.role === 'admin') {
            return next();
        }

        // staff는 permissions 체크
        const permissions = req.user.permissions || {};
        const pagePermission = permissions[page] || { view: false, edit: false };

        if (!pagePermission[action]) {
            const pageLabel = PAGE_LABELS[page] || page;
            const actionLabel = ACTION_LABELS[action] || action;
            return res.status(403).json({
                error: 'Permission Denied',
                message: `${pageLabel} ${actionLabel} 권한이 없습니다.`,
                permission_required: { page, action }
            });
        }

        next();
    };
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
    checkPermission,
    generateToken
};

/**
 * Staff Management Routes
 * /paca/staff
 *
 * 원장이 등록된 강사 중에서 선택하여 관리 권한을 부여하는 API
 */

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../config/database');
const { verifyToken, requireRole } = require('../middleware/auth');

/**
 * GET /paca/staff
 * 권한이 부여된 직원 목록 조회
 * Access: owner only
 */
router.get('/', verifyToken, requireRole('owner'), async (req, res) => {
    try {
        const [staff] = await db.query(`
            SELECT
                u.id,
                u.email,
                u.name,
                u.position,
                u.permissions,
                u.instructor_id,
                u.is_active,
                u.created_at,
                i.name as instructor_name,
                i.phone as instructor_phone
            FROM users u
            LEFT JOIN instructors i ON u.instructor_id = i.id
            WHERE u.academy_id = ?
            AND u.role = 'staff'
            AND u.deleted_at IS NULL
            ORDER BY u.created_at DESC
        `, [req.user.academyId]);

        // Parse permissions JSON
        const staffWithParsedPermissions = staff.map(s => ({
            ...s,
            permissions: s.permissions ? (typeof s.permissions === 'string' ? JSON.parse(s.permissions) : s.permissions) : {}
        }));

        res.json({
            message: `Found ${staff.length} staff members`,
            staff: staffWithParsedPermissions
        });
    } catch (error) {
        console.error('Error fetching staff:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to fetch staff'
        });
    }
});

/**
 * GET /paca/staff/available-instructors
 * 권한 부여 가능한 강사 목록 (아직 계정이 없는 강사)
 * Access: owner only
 */
router.get('/available-instructors', verifyToken, requireRole('owner'), async (req, res) => {
    try {
        const [instructors] = await db.query(`
            SELECT
                i.id,
                i.name,
                i.phone,
                i.status,
                i.instructor_type
            FROM instructors i
            LEFT JOIN users u ON u.instructor_id = i.id AND u.deleted_at IS NULL
            WHERE i.academy_id = ?
            AND i.deleted_at IS NULL
            AND i.status = 'active'
            AND u.id IS NULL
            ORDER BY i.name
        `, [req.user.academyId]);

        res.json({
            message: `Found ${instructors.length} available instructors`,
            instructors
        });
    } catch (error) {
        console.error('Error fetching available instructors:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to fetch available instructors'
        });
    }
});

/**
 * POST /paca/staff
 * 강사에게 권한 부여 (계정 생성)
 * Access: owner only
 */
router.post('/', verifyToken, requireRole('owner'), async (req, res) => {
    const connection = await db.getConnection();

    try {
        const {
            instructor_id,
            email,
            password,
            position,
            permissions
        } = req.body;

        // Validation
        if (!instructor_id || !email || !password) {
            return res.status(400).json({
                error: 'Validation Error',
                message: '강사, 이메일, 비밀번호는 필수입니다.'
            });
        }

        // Email format validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({
                error: 'Validation Error',
                message: '올바른 이메일 형식이 아닙니다.'
            });
        }

        // Password strength validation
        if (password.length < 8) {
            return res.status(400).json({
                error: 'Validation Error',
                message: '비밀번호는 8자 이상이어야 합니다.'
            });
        }

        await connection.beginTransaction();

        // Check if instructor exists and belongs to this academy
        const [instructors] = await connection.query(
            'SELECT id, name FROM instructors WHERE id = ? AND academy_id = ? AND deleted_at IS NULL',
            [instructor_id, req.user.academyId]
        );

        if (instructors.length === 0) {
            await connection.rollback();
            return res.status(404).json({
                error: 'Not Found',
                message: '강사를 찾을 수 없습니다.'
            });
        }

        // Check if instructor already has an account
        const [existingAccounts] = await connection.query(
            'SELECT id FROM users WHERE instructor_id = ? AND deleted_at IS NULL',
            [instructor_id]
        );

        if (existingAccounts.length > 0) {
            await connection.rollback();
            return res.status(409).json({
                error: 'Conflict',
                message: '이 강사는 이미 계정이 있습니다.'
            });
        }

        // Check if email already exists
        const [existingUsers] = await connection.query(
            'SELECT id FROM users WHERE email = ?',
            [email]
        );

        if (existingUsers.length > 0) {
            await connection.rollback();
            return res.status(409).json({
                error: 'Conflict',
                message: '이미 사용 중인 이메일입니다.'
            });
        }

        // Hash password
        const passwordHash = await bcrypt.hash(password, 10);

        // Insert user with staff role
        const [result] = await connection.query(
            `INSERT INTO users
            (email, password_hash, name, role, academy_id, position, permissions, instructor_id, created_by, approval_status, is_active)
            VALUES (?, ?, ?, 'staff', ?, ?, ?, ?, ?, 'approved', TRUE)`,
            [
                email,
                passwordHash,
                instructors[0].name,
                req.user.academyId,
                position || null,
                permissions ? JSON.stringify(permissions) : null,
                instructor_id,
                req.user.id
            ]
        );

        await connection.commit();

        res.status(201).json({
            message: '직원 계정이 생성되었습니다.',
            staff: {
                id: result.insertId,
                email,
                name: instructors[0].name,
                position,
                permissions,
                instructor_id
            }
        });

    } catch (error) {
        await connection.rollback();
        console.error('Error creating staff:', error);
        res.status(500).json({
            error: 'Server Error',
            message: '직원 계정 생성에 실패했습니다.',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    } finally {
        connection.release();
    }
});

/**
 * GET /paca/staff/:id
 * 직원 상세 조회
 * Access: owner only
 */
router.get('/:id', verifyToken, requireRole('owner'), async (req, res) => {
    try {
        const { id } = req.params;

        const [staff] = await db.query(`
            SELECT
                u.id,
                u.email,
                u.name,
                u.position,
                u.permissions,
                u.instructor_id,
                u.is_active,
                u.created_at,
                u.last_login_at,
                i.name as instructor_name,
                i.phone as instructor_phone,
                i.instructor_type
            FROM users u
            LEFT JOIN instructors i ON u.instructor_id = i.id
            WHERE u.id = ?
            AND u.academy_id = ?
            AND u.role = 'staff'
            AND u.deleted_at IS NULL
        `, [id, req.user.academyId]);

        if (staff.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: '직원을 찾을 수 없습니다.'
            });
        }

        const staffMember = staff[0];
        staffMember.permissions = staffMember.permissions
            ? (typeof staffMember.permissions === 'string' ? JSON.parse(staffMember.permissions) : staffMember.permissions)
            : {};

        res.json({
            staff: staffMember
        });
    } catch (error) {
        console.error('Error fetching staff:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to fetch staff'
        });
    }
});

/**
 * PUT /paca/staff/:id
 * 직원 정보 수정 (직급, 권한, 비밀번호)
 * Access: owner only
 */
router.put('/:id', verifyToken, requireRole('owner'), async (req, res) => {
    try {
        const { id } = req.params;
        const { position, permissions, password, is_active } = req.body;

        // Check if staff exists
        const [existing] = await db.query(
            'SELECT id FROM users WHERE id = ? AND academy_id = ? AND role = ? AND deleted_at IS NULL',
            [id, req.user.academyId, 'staff']
        );

        if (existing.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: '직원을 찾을 수 없습니다.'
            });
        }

        // Build update query
        const updates = [];
        const params = [];

        if (position !== undefined) {
            updates.push('position = ?');
            params.push(position);
        }

        if (permissions !== undefined) {
            updates.push('permissions = ?');
            params.push(JSON.stringify(permissions));
        }

        if (password) {
            if (password.length < 8) {
                return res.status(400).json({
                    error: 'Validation Error',
                    message: '비밀번호는 8자 이상이어야 합니다.'
                });
            }
            const passwordHash = await bcrypt.hash(password, 10);
            updates.push('password_hash = ?');
            params.push(passwordHash);
        }

        if (is_active !== undefined) {
            updates.push('is_active = ?');
            params.push(is_active);
        }

        if (updates.length === 0) {
            return res.status(400).json({
                error: 'Validation Error',
                message: '수정할 내용이 없습니다.'
            });
        }

        updates.push('updated_at = NOW()');
        params.push(id);

        await db.query(
            `UPDATE users SET ${updates.join(', ')} WHERE id = ?`,
            params
        );

        res.json({
            message: '직원 정보가 수정되었습니다.'
        });
    } catch (error) {
        console.error('Error updating staff:', error);
        res.status(500).json({
            error: 'Server Error',
            message: '직원 정보 수정에 실패했습니다.'
        });
    }
});

/**
 * PUT /paca/staff/:id/permissions
 * 직원 권한만 수정
 * Access: owner only
 */
router.put('/:id/permissions', verifyToken, requireRole('owner'), async (req, res) => {
    try {
        const { id } = req.params;
        const { permissions } = req.body;

        if (!permissions) {
            return res.status(400).json({
                error: 'Validation Error',
                message: '권한 정보가 필요합니다.'
            });
        }

        // Check if staff exists
        const [existing] = await db.query(
            'SELECT id FROM users WHERE id = ? AND academy_id = ? AND role = ? AND deleted_at IS NULL',
            [id, req.user.academyId, 'staff']
        );

        if (existing.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: '직원을 찾을 수 없습니다.'
            });
        }

        await db.query(
            'UPDATE users SET permissions = ?, updated_at = NOW() WHERE id = ?',
            [JSON.stringify(permissions), id]
        );

        res.json({
            message: '권한이 수정되었습니다.'
        });
    } catch (error) {
        console.error('Error updating permissions:', error);
        res.status(500).json({
            error: 'Server Error',
            message: '권한 수정에 실패했습니다.'
        });
    }
});

/**
 * DELETE /paca/staff/:id
 * 직원 권한 제거 (soft delete)
 * Access: owner only
 */
router.delete('/:id', verifyToken, requireRole('owner'), async (req, res) => {
    try {
        const { id } = req.params;

        // Check if staff exists
        const [existing] = await db.query(
            'SELECT id, instructor_id FROM users WHERE id = ? AND academy_id = ? AND role = ? AND deleted_at IS NULL',
            [id, req.user.academyId, 'staff']
        );

        if (existing.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: '직원을 찾을 수 없습니다.'
            });
        }

        // Soft delete
        await db.query(
            'UPDATE users SET deleted_at = NOW(), is_active = FALSE WHERE id = ?',
            [id]
        );

        res.json({
            message: '직원 계정이 삭제되었습니다.'
        });
    } catch (error) {
        console.error('Error deleting staff:', error);
        res.status(500).json({
            error: 'Server Error',
            message: '직원 삭제에 실패했습니다.'
        });
    }
});

/**
 * GET /paca/staff/permissions/pages
 * 페이지 권한 목록 반환 (프론트엔드에서 권한 설정 UI에 사용)
 * Access: owner only
 */
router.get('/permissions/pages', verifyToken, requireRole('owner'), async (req, res) => {
    const pages = [
        { key: 'students', label: '학생 관리', description: '학생 목록, 등록, 수정' },
        { key: 'instructors', label: '강사 관리', description: '강사 목록, 등록' },
        { key: 'payments', label: '학원비', description: '수납 관리' },
        { key: 'salaries', label: '급여 관리', description: '강사 급여' },
        { key: 'schedules', label: '스케줄', description: '시간표, 출결' },
        { key: 'reports', label: '리포트', description: '수입/지출 리포트' },
        { key: 'expenses', label: '지출 관리', description: '지출 기록' },
        { key: 'incomes', label: '기타수입', description: '기타 수입 기록' },
        { key: 'seasons', label: '시즌 관리', description: '수시/정시 시즌' },
        { key: 'settings', label: '설정', description: '학원 설정' },
        { key: 'staff', label: '직원 관리', description: '관리자 추가/권한 설정' }
    ];

    res.json({ pages });
});

module.exports = router;

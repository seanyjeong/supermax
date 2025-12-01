/**
 * Search Routes
 * 통합 검색 API
 */

const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { verifyToken } = require('../middleware/auth');

/**
 * GET /paca/search
 * 학생, 강사, 전화번호 통합 검색
 * Access: 로그인 사용자
 */
router.get('/', verifyToken, async (req, res) => {
    try {
        const { q } = req.query;

        if (!q || q.trim().length < 1) {
            return res.json({
                message: '검색어를 입력해주세요.',
                results: []
            });
        }

        const searchTerm = `%${q.trim()}%`;
        const academyId = req.user.academyId;

        // 학생 검색 (이름, 학번, 전화번호, 부모 전화번호)
        const [students] = await db.query(
            `SELECT
                id, name, student_number, phone, parent_phone, school, status,
                'student' as type
            FROM students
            WHERE academy_id = ?
            AND deleted_at IS NULL
            AND (
                name LIKE ?
                OR student_number LIKE ?
                OR phone LIKE ?
                OR parent_phone LIKE ?
            )
            ORDER BY name
            LIMIT 10`,
            [academyId, searchTerm, searchTerm, searchTerm, searchTerm]
        );

        // 강사 검색 (이름, 전화번호)
        const [instructors] = await db.query(
            `SELECT
                id, name, phone, specialization, status,
                'instructor' as type
            FROM instructors
            WHERE academy_id = ?
            AND deleted_at IS NULL
            AND (
                name LIKE ?
                OR phone LIKE ?
            )
            ORDER BY name
            LIMIT 10`,
            [academyId, searchTerm, searchTerm]
        );

        // 결과 합치기
        const results = [
            ...students.map(s => ({
                id: s.id,
                type: 'student',
                name: s.name,
                subtext: s.student_number ? `${s.student_number} · ${s.school || ''}` : s.school || '',
                phone: s.phone || s.parent_phone,
                status: s.status
            })),
            ...instructors.map(i => ({
                id: i.id,
                type: 'instructor',
                name: i.name,
                subtext: i.specialization || '강사',
                phone: i.phone,
                status: i.status
            }))
        ];

        res.json({
            message: `${results.length}건의 검색 결과`,
            query: q,
            results
        });
    } catch (error) {
        console.error('Error searching:', error);
        res.status(500).json({
            error: 'Server Error',
            message: '검색에 실패했습니다.'
        });
    }
});

module.exports = router;

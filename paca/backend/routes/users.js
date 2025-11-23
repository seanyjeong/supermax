const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { verifyToken, requireRole } = require('../middleware/auth');

// TODO: Implement user management routes
// - GET / - Get all users (admin only)
// - GET /:id - Get user by ID
// - PUT /:id - Update user
// - DELETE /:id - Delete user (soft delete)
// - POST /approve/:id - Approve user (owner only)
// - POST /reject/:id - Reject user (owner only)

router.get('/', verifyToken, requireRole('owner', 'admin'), async (req, res) => {
    res.json({ message: 'Get all users - TODO' });
});

module.exports = router;

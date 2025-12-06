/**
 * P-ACA 체대입시 학원관리시스템 Backend Server
 * Port: 8320
 * Database: MySQL (paca)
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 8320;

// Trust proxy - nginx 리버스 프록시 뒤에서 실행될 때 필요
app.set('trust proxy', 1);

// ==========================================
// Middleware Configuration
// ==========================================

// CORS Configuration (MUST be before helmet!)
const corsOptions = {
  origin: '*',
  methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
  // allowedHeaders: '*',  // 아예 지워도 cors 패키지가 자동으로 맞춰줌
  credentials: false,
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));
// 프리플라이트 확실히 처리하고 싶으면 한 줄 더
app.options('*', cors(corsOptions));


// Security Headers (configured to not interfere with CORS)
app.use(helmet({
    crossOriginResourcePolicy: false,
    crossOriginEmbedderPolicy: false
}));

// Body Parser
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Compression
app.use(compression());

// Logging
if (process.env.NODE_ENV === 'development') {
    app.use(morgan('dev'));
} else {
    app.use(morgan('combined'));
}

// Rate Limiting - 비활성화 (내부용 시스템)
// const limiter = rateLimit({
//     windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
//     max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 10000,
//     standardHeaders: true,
//     legacyHeaders: false,
//     validate: {
//         trustProxy: false,
//         xForwardedForHeader: false
//     }
// });
// app.use('/paca', limiter);

// ==========================================
// Database Connection
// ==========================================
const db = require('./config/database');

// Test database connection
db.getConnection()
    .then(connection => {
        console.log('✅ MySQL Database Connected Successfully');
        connection.release();
    })
    .catch(err => {
        console.error('❌ MySQL Connection Error:', err.message);
        process.exit(1);
    });

// ==========================================
// Routes
// ==========================================

// Health Check
app.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'development'
    });
});

// API Base Route
app.get('/paca', (req, res) => {
    res.json({
        message: 'P-ACA API Server',
        version: '1.0.0',
        endpoints: {
            auth: '/paca/auth',
            users: '/paca/users',
            students: '/paca/students',
            instructors: '/paca/instructors',
            payments: '/paca/payments',
            salaries: '/paca/salaries',
            seasons: '/paca/seasons',
            schedules: '/paca/schedules',
            settings: '/paca/settings',
            performance: '/paca/performance',
            expenses: '/paca/expenses',
            incomes: '/paca/incomes',
            reports: '/paca/reports',
            staff: '/paca/staff',
            notifications: '/paca/notifications'
        }
    });
});

// Import Routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const studentRoutes = require('./routes/students');
const instructorRoutes = require('./routes/instructors');
const paymentRoutes = require('./routes/payments');
const salaryRoutes = require('./routes/salaries');
const seasonRoutes = require('./routes/seasons');
const scheduleRoutes = require('./routes/schedules');
const settingRoutes = require('./routes/settings');
const performanceRoutes = require('./routes/performance');
const expenseRoutes = require('./routes/expenses');
const incomeRoutes = require('./routes/incomes');
const reportRoutes = require('./routes/reports');
const exportRoutes = require('./routes/exports');
const staffRoutes = require('./routes/staff');
const onboardingRoutes = require('./routes/onboarding');
const searchRoutes = require('./routes/search');
const notificationRoutes = require('./routes/notifications');
const smsRoutes = require('./routes/sms');
const publicRoutes = require('./routes/public');
const consultationRoutes = require('./routes/consultations');

// Register Routes
app.use('/paca/auth', authRoutes);
app.use('/paca/users', userRoutes);
app.use('/paca/students', studentRoutes);
app.use('/paca/instructors', instructorRoutes);
app.use('/paca/payments', paymentRoutes);
app.use('/paca/salaries', salaryRoutes);
app.use('/paca/seasons', seasonRoutes);
app.use('/paca/schedules', scheduleRoutes);
app.use('/paca/settings', settingRoutes);
app.use('/paca/performance', performanceRoutes);
app.use('/paca/expenses', expenseRoutes);
app.use('/paca/incomes', incomeRoutes);
app.use('/paca/reports', reportRoutes);
app.use('/paca/exports', exportRoutes);
app.use('/paca/staff', staffRoutes);
app.use('/paca/onboarding', onboardingRoutes);
app.use('/paca/search', searchRoutes);
app.use('/paca/notifications', notificationRoutes);
app.use('/paca/sms', smsRoutes);
app.use('/paca/public', publicRoutes);
app.use('/paca/consultations', consultationRoutes);

// ==========================================
// Error Handling
// ==========================================

// 404 Handler
app.use((req, res, next) => {
    res.status(404).json({
        error: 'Not Found',
        message: `Cannot ${req.method} ${req.originalUrl}`,
        path: req.originalUrl
    });
});

// Global Error Handler
app.use((err, req, res, next) => {
    console.error('Error:', err);

    // JWT Authentication Error
    if (err.name === 'UnauthorizedError') {
        return res.status(401).json({
            error: 'Unauthorized',
            message: 'Invalid or expired token'
        });
    }

    // Validation Error
    if (err.name === 'ValidationError') {
        return res.status(400).json({
            error: 'Validation Error',
            message: err.message,
            details: err.details
        });
    }

    // Database Error
    if (err.code && err.code.startsWith('ER_')) {
        return res.status(500).json({
            error: 'Database Error',
            message: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error',
            code: err.code
        });
    }

    // Default Error
    res.status(err.status || 500).json({
        error: err.name || 'Internal Server Error',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong',
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
});

// ==========================================
// Scheduler
// ==========================================
const { initScheduler } = require('./scheduler/paymentScheduler');
const { initNotificationScheduler } = require('./scheduler/notificationScheduler');
const { initGradePromotionScheduler } = require('./scheduler/gradePromotionScheduler');

// ==========================================
// Start Server
// ==========================================
app.listen(PORT, () => {
    console.log('==========================================');
    console.log('🏋️  P-ACA Backend Server');
    console.log('==========================================');
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🗄️  Database: ${process.env.DB_NAME}@${process.env.DB_HOST}`);
    console.log(`🌐 API Base: http://localhost:${PORT}/paca`);
    console.log('==========================================');

    // 스케줄러 초기화
    initScheduler();
    initNotificationScheduler();
    initGradePromotionScheduler();
});

// Graceful Shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing HTTP server');
    app.close(() => {
        console.log('HTTP server closed');
        db.end();
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('\nSIGINT signal received: closing HTTP server');
    process.exit(0);
});

module.exports = app;

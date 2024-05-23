const express = require('express');
const mysql = require('mysql');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const https = require('https');
const helmet = require('helmet');

const app = express();
app.use(bodyParser.json());
app.use(cors());
app.use(helmet());

app.use((req, res, next) => {
    res.setHeader("Permissions-Policy", "interest-cohort=()");
    next();
});

const dbConfig = {
    host: 'my8003.gabiadb.com',
    user: 'maxilsan',
    password: 'q141171616!',
    database: 'supermax',
    charset: 'utf8mb4'
};

const pool = mysql.createPool({
    ...dbConfig,
    connectionLimit: 10,
    waitForConnections: true,
    queueLimit: 0
});

pool.getConnection((err, connection) => {
    if (err) {
        console.error('MySQL connection failed:', err);
    } else {
        console.log('MySQL Connected...');
        connection.release();
    }
});

function getScore(universityName, eventName, record, gender, callback) {
    let column = gender === 'male' ? 'male_record' : 'female_record';
    let sql;

    if (eventName === '제멀' || eventName === '배근력' || eventName === '메던') {
        sql = `SELECT score FROM \`실기테이블\`
               WHERE university_name = ? AND event_name = ?
               AND ${column} <= ? ORDER BY ${column} DESC LIMIT 1`;
    } else if (eventName === '10m') {
        sql = `SELECT score FROM \`실기테이블\`
               WHERE university_name = ? AND event_name = ?
               AND ${column} >= ? ORDER BY ${column} ASC LIMIT 1`;
    } else {
        console.error(`Unknown event: ${eventName}`);
        callback('Unknown event', null);
        return;
    }

    pool.query(sql, [universityName, eventName, record], (err, results) => {
        if (err) {
            callback(err, null);
        } else if (results.length > 0) {
            callback(null, results[0].score);
        } else {
            if (eventName === '제멀' || eventName === '배근력' || eventName === '메던') {
                callback(null, record >= 300 ? 100 : 0);
            } else if (eventName === '10m') {
                callback(null, record <= 5 ? 100 : 0);
            } else {
                callback('No matching score found', null);
            }
        }
    });
}

app.post('/get-total-score', (req, res) => {
    const students = req.body.students;

    let processed = 0;
    let errors = [];
    let results = [];

    students.forEach(student => {
        let studentResult = { name: student.name, scores: {}, totalScore: 0 };
        let processedEvents = 0;
        const events = ['제멀', '메던', '10m', '배근력'];

        events.forEach(event => {
            getScore(student.university, event, parseFloat(student.record[event]), student.gender, (err, score) => {
                if (err) {
                    errors.push(err);
                } else {
                    studentResult.scores[event] = score;
                    studentResult.totalScore += score;
                }

                processedEvents++;
                if (processedEvents === events.length) {
                    results.push(studentResult);
                    processed++;
                    if (processed === students.length) {
                        if (errors.length > 0) {
                            res.json({ error: errors.join(', ') });
                        } else {
                            res.json(results);
                        }
                    }
                }
            });
        });
    });
});

app.post('/save-scores', (req, res) => {
    const students = req.body.students;

    let processed = 0;
    let errors = [];

    students.forEach(student => {
        const events = ['제멀', '메던', '10m', '배근력'];
        let studentScores = {};
        let totalScore = 0;

        let processedEvents = 0;
        events.forEach(event => {
            getScore(student.university, event, parseFloat(student.record[event]), student.gender, (err, score) => {
                if (err) {
                    errors.push(err);
                } else {
                    studentScores[event] = score;
                    totalScore += score;
                }

                processedEvents++;
                if (processedEvents === events.length) {
                    const sql = `
                        INSERT INTO student_scores (student_name, university_name, gender, record_jemul, score_jemul, record_medun, score_medun, record_10m, score_10m, record_back_strength, score_back_strength, total_score)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ON DUPLICATE KEY UPDATE
                        university_name = VALUES(university_name),
                        gender = VALUES(gender),
                        record_jemul = VALUES(record_jemul),
                        score_jemul = VALUES(score_jemul),
                        record_medun = VALUES(record_medun),
                        score_medun = VALUES(score_medun),
                        record_10m = VALUES(record_10m),
                        score_10m = VALUES(score_10m),
                        record_back_strength = VALUES(record_back_strength),
                        score_back_strength = VALUES(score_back_strength),
                        total_score = VALUES(total_score),
                        created_at = CURRENT_TIMESTAMP`;

                    pool.query(sql, [
                        student.name, student.university, student.gender,
                        student.record['제멀'], studentScores['제멀'],
                        student.record['메던'], studentScores['메던'],
                        student.record['10m'], studentScores['10m'],
                        student.record['배근력'], studentScores['배근력'],
                        totalScore
                    ], (err, result) => {
                        if (err) {
                            errors.push(err);
                        }

                        processed++;
                        if (processed === students.length) {
                            if (errors.length > 0) {
                                res.json({ error: errors.join(', ') });
                            } else {
                                res.json({ message: 'All scores saved successfully' });
                            }
                        }
                    });
                }
            });
        });
    });
});

app.get('/get-student', (req, res) => {
    const studentName = req.query.name;

    const sql = `SELECT * FROM student_scores WHERE student_name = ?`;

    pool.query(sql, [studentName], (err, results) => {
        if (err) {
            res.json({ error: err });
        } else if (results.length > 0) {
            res.json({ student: results });
        } else {
            res.json({ message: 'No data found for the student' });
        }
    });
});

const sslOptions = {
    key: fs.readFileSync('/etc/letsencrypt/live/supermax.kr/privkey.pem'),
    cert: fs.readFileSync('/etc/letsencrypt/live/supermax.kr/fullchain.pem')
};

const PORT = 4000;
https.createServer(sslOptions, app).listen(PORT, () => {
    console.log(`HTTPS Server running on port ${PORT}`);
});

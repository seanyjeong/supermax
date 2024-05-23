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

    console.log(`Executing SQL: ${sql}`);
    console.log(`With parameters: ${universityName}, ${eventName}, ${record}`);

    pool.query(sql, [universityName, eventName, record], (err, results) => {
        if (err) {
            console.error('Query error:', err);
            callback(err, null);
        } else if (results.length > 0) {
            console.log('Query results:', results);
            callback(null, results[0].score);
        } else {
            console.log('No matching score found');
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

    console.log('Received request to calculate total score for students:', students);

    let processed = 0;
    let errors = [];
    let totalScores = [];

    students.forEach(student => {
        let totalScore = 0;
        getScore(student.university, student.event, parseFloat(student.record), student.gender, (err, score) => {
            if (err) {
                errors.push(err);
            } else {
                totalScore += score;
            }

            processed++;
            if (processed === students.length) {
                totalScores.push({ name: student.name, totalScore: totalScore });
                if (totalScores.length === students.length) {
                    if (errors.length > 0) {
                        console.error('Errors:', errors);
                        res.json({ error: errors.join(', ') });
                    } else {
                        console.log('Total scores:', totalScores);
                        res.json(totalScores);
                    }
                }
            }
        });
    });
});

app.post('/save-scores', (req, res) => {
    const students = req.body.students;

    console.log('Received request to save scores for students:', students);

    let processed = 0;
    let errors = [];

    students.forEach(student => {
        getScore(student.university, student.event, parseFloat(student.record), student.gender, (err, score) => {
            if (err) {
                errors.push(err);
            } else {
                const sql = `
                    INSERT INTO student_scores (student_name, university_name, event_name, gender, record, score)
                    VALUES (?, ?, ?, ?, ?, ?)
                    ON DUPLICATE KEY UPDATE
                    university_name = VALUES(university_name),
                    gender = VALUES(gender),
                    record = VALUES(record),
                    score = VALUES(score),
                    created_at = CURRENT_TIMESTAMP`;
                pool.query(sql, [student.name, student.university, student.event, student.gender, student.record, score], (err, result) => {
                    if (err) {
                        errors.push(err);
                    }
                });
            }

            processed++;
            if (processed === students.length) {
                if (errors.length > 0) {
                    console.error('Errors:', errors);
                    res.json({ error: errors.join(', ') });
                } else {
                    console.log('All scores saved successfully');
                    res.json({ message: 'All scores saved successfully' });
                }
            }
        });
    });
});

app.get('/get-student', (req, res) => {
    const studentName = req.query.name;

    console.log(`Received request to get scores for student: ${studentName}`);

    const sql = `SELECT * FROM student_scores WHERE student_name = ?`;

    pool.query(sql, [studentName], (err, results) => {
        if (err) {
            console.error('Query error:', err);
            res.json({ error: err });
        } else if (results.length > 0) {
            console.log('Query results:', results);
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

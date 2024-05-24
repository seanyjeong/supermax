const express = require('express');
const mysql = require('mysql');
const bodyParser = require('body-parser');
const app = express();

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

const db = mysql.createConnection({
    host: '211.37.174.218',
    user: 'maxilsan',
    password: 'q141171616!',
    database: 'supermax'
});

db.connect(err => {
    if (err) {
        throw err;
    }
    console.log('MySQL Connected...');
});

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

app.post('/submit', (req, res) => {
    const { university_name, event_name, gender, record } = req.body;

    let query;
    if (event_name === '10m') {
        query = `SELECT score FROM records WHERE university_name = ? AND event_name = ? AND ? <= (CASE WHEN ? = 'male' THEN male_record ELSE female_record END) ORDER BY (CASE WHEN ? = 'male' THEN male_record ELSE female_record END) LIMIT 1`;
    } else {
        query = `SELECT score FROM records WHERE university_name = ? AND event_name = ? AND ? >= (CASE WHEN ? = 'male' THEN male_record ELSE female_record END) ORDER BY (CASE WHEN ? = 'male' THEN male_record ELSE female_record END) DESC LIMIT 1`;
    }

    db.query(query, [university_name, event_name, record, gender, gender], (err, results) => {
        if (err) throw err;

        let score = results.length ? results[0].score : 0;
        res.json({ score });
    });
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

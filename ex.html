<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Update Scores</title>
    <style>
        body { font-family: Arial, sans-serif; padding: 20px; text-align: center; }
        button { padding: 10px 20px; font-size: 16px; cursor: pointer; }
        .message { margin-top: 20px; font-size: 18px; }
    </style>
    <script>
        async function updateScores() {
            try {
                const response = await fetch('https://supermax.kr/update-scores');
                if (!response.ok) {
                    throw new Error('Network response was not ok');
                }
                const result = await response.json();
                document.getElementById('message').innerText = result.message;

                // 로그를 기록
                logUpdate('Success: ' + result.message);
            } catch (error) {
                document.getElementById('message').innerText = 'Error: Unable to update scores';
                
                // 오류 로그를 기록
                logUpdate('Error: ' + error.message);
            }
        }

        async function logUpdate(logMessage) {
            try {
                await fetch('https://supermax.kr/log', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ message: logMessage })
                });
            } catch (error) {
                console.error('Error logging update:', error);
            }
        }
    </script>
</head>
<body>
    <h1>Update Scores</h1>
    <button onclick="updateScores()">Update Now</button>
    <div class="message" id="message"></div>
</body>
</html>

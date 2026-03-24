-- Zagros OSINT Demo Database - Small sample for testing
CREATE TABLE IF NOT EXISTS users (
    id INT PRIMARY KEY,
    username VARCHAR(50),
    email VARCHAR(100),
    discord_id VARCHAR(50),
    ip_address VARCHAR(45),
    created_at TIMESTAMP
);

INSERT INTO users (id, username, email, discord_id, ip_address, created_at) VALUES
(1, 'demo_user1', 'demo1@test.com', '123456789012345678', '192.168.1.1', '2023-01-01 10:00:00'),
(2, 'demo_user2', 'demo2@test.com', '987654321098765432', '10.0.0.1', '2023-01-02 11:00:00'),
(3, 'osint_tester', 'osint@test.com', '111222333444555666', '203.0.113.1', '2023-01-03 12:00:00');

CREATE TABLE IF NOT EXISTS logs (
    log_id INT PRIMARY KEY,
    user_id VARCHAR(50),
    action VARCHAR(50),
    timestamp TIMESTAMP
);

INSERT INTO logs (log_id, user_id, action, timestamp) VALUES
(1, '123456789012345678', 'login', '2023-01-01 10:05:00'),
(2, '987654321098765432', 'logout', '2023-01-02 11:30:00'),
(3, '111222333444555666', 'message', '2023-01-03 12:15:00');

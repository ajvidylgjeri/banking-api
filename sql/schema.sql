CREATE DATABASE IF NOT EXISTS banking_db;
USE banking_db;

CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,                 -- bcrypt hash
  role ENUM('customer','admin') NOT NULL DEFAULT 'customer',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE accounts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  account_number CHAR(10) NOT NULL UNIQUE,
  account_type ENUM('savings','current') NOT NULL,
  balance DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  status ENUM('active','blocked') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT chk_no_overdraft CHECK (balance >= 0)  -- DB-level overdraft protection (MySQL 8.0.16+)
);

CREATE TABLE transactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  from_account INT NOT NULL,                        -- the account that is acted on (deposit/withdraw) or debited (transfer)
  to_account INT NULL,                              -- only for transfers
  amount DECIMAL(15,2) NOT NULL,
  type ENUM('deposit','withdraw','transfer') NOT NULL,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (from_account) REFERENCES accounts(id),
  FOREIGN KEY (to_account) REFERENCES accounts(id),
  CONSTRAINT chk_positive_amount CHECK (amount > 0),
  INDEX idx_from (from_account, timestamp),
  INDEX idx_to (to_account, timestamp)
);

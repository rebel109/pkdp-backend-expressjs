CREATE TABLE IF NOT EXISTS attendance_sessions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  period_id INT NOT NULL,
  class_id INT NULL,
  phase ENUM('ISC1','OJC','ISC2') NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT NULL,
  target_role ENUM('DOSEN','NARASUMBER','ALL') NOT NULL DEFAULT 'ALL',
  open_at DATETIME NULL,
  close_at DATETIME NULL,
  is_open_override TINYINT(1) NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_by INT NULL,
  updated_by INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_attendance_sessions_period (period_id),
  KEY idx_attendance_sessions_class (class_id),
  KEY idx_attendance_sessions_phase (phase),
  KEY idx_attendance_sessions_role (target_role),
  KEY idx_attendance_sessions_active (is_active),
  KEY idx_attendance_sessions_open (open_at),
  CONSTRAINT fk_attendance_sessions_period FOREIGN KEY (period_id) REFERENCES periods(id) ON DELETE CASCADE,
  CONSTRAINT fk_attendance_sessions_class FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE SET NULL,
  CONSTRAINT fk_attendance_sessions_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_attendance_sessions_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS attendance_records (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_id INT NOT NULL,
  user_id INT NOT NULL,
  attendance_role ENUM('DOSEN','NARASUMBER') NOT NULL,
  attended_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_attendance_records_session_user_role (session_id,user_id,attendance_role),
  KEY idx_attendance_records_user (user_id),
  CONSTRAINT fk_attendance_records_session FOREIGN KEY (session_id) REFERENCES attendance_sessions(id) ON DELETE CASCADE,
  CONSTRAINT fk_attendance_records_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

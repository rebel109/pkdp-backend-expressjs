-- Add BRIEFING support to tasks table
-- This migration adds briefing_open and briefing_close columns
-- and updates the task_type ENUM to include BRIEFING

ALTER TABLE tasks
MODIFY COLUMN task_type ENUM('PRETEST','POSTTEST','UPLOAD','BRIEFING') NOT NULL DEFAULT 'UPLOAD';

ALTER TABLE tasks
ADD COLUMN briefing_open DATETIME NULL AFTER posttest_close,
ADD COLUMN briefing_close DATETIME NULL AFTER briefing_open;

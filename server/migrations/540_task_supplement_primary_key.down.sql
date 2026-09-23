-- Roll back the supplement migration batch together (536-541). PostgreSQL
-- drops the attached index with the constraint; 539 recreates it on upgrade.
ALTER TABLE task_supplement DROP CONSTRAINT IF EXISTS task_supplement_pkey;

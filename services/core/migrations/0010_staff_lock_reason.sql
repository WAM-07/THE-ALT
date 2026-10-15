-- A lock set by ALT staff (the Command Centre) says so at sign-in, instead of looking like the
-- automatic lock after failed passwords. NULL for that automatic lock.
ALTER TABLE core.users ADD COLUMN lock_reason text CHECK (length(lock_reason) <= 1000);

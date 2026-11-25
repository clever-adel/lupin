-- Two-step sign-in for staff (owner and admin): a 6-digit code from an authenticator app after the password.

-- The app's shared key, encrypted (AES-GCM, see TwoFactorService). Set while pairing; counts only once enabled.
alter table users add column totp_secret     varchar(200);
alter table users add column totp_enabled_at timestamptz;
-- The last 30-second step a code was accepted for, so the same code cannot be used twice.
alter table users add column totp_last_step  bigint;

-- When this sign-in (the whole refresh family) proved the second step. Staff pages need it.
alter table auth_sessions add column mfa_at timestamptz;

-- One-time codes for when the phone is lost. Only a SHA-256 hash of each code is kept.
create table staff_recovery_codes (
    id         uuid primary key default gen_random_uuid(),
    user_id    uuid        not null references users (id) on delete cascade,
    code_hash  varchar(64) not null,
    used_at    timestamptz,
    created_at timestamptz not null default now()
);
create index staff_recovery_codes_user_idx on staff_recovery_codes (user_id);

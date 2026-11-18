-- "Forgot password": one-time links sent by email. Only a SHA-256 of the token is stored, so a copy
-- of the database cannot be used to reset anyone's password. A link works once, for one hour.
create table password_reset_tokens (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid        not null references users (id) on delete cascade,
    token_hash  varchar(64) not null unique,
    expires_at  timestamptz not null,
    used_at     timestamptz,
    created_at  timestamptz not null default now()
);
create index password_reset_tokens_user_idx on password_reset_tokens (user_id);

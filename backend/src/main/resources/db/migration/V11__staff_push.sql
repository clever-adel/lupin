-- Push notifications to staff phones and computers (Web Push).

-- The store's own VAPID key pair, made once on first use. It only proves to the push services
-- (Google, Apple, Mozilla, Microsoft) that the messages come from this store.
create table web_push_keys (
    id          smallint primary key check (id = 1),
    public_key  text        not null,
    private_key text        not null,
    created_at  timestamptz not null default now()
);

-- One row per browser where a staff member turned alerts on.
create table push_subscriptions (
    id              uuid primary key default gen_random_uuid(),
    user_id         uuid         not null references users (id) on delete cascade,
    endpoint        varchar(1000) not null unique,
    p256dh          varchar(200) not null,
    auth            varchar(100) not null,
    device          varchar(200),
    created_at      timestamptz  not null default now(),
    last_success_at timestamptz
);
create index push_subscriptions_user_idx on push_subscriptions (user_id);

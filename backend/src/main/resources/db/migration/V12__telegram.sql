-- New-order alerts through a Telegram bot. A staff member links their Telegram from the dashboard:
-- the dashboard opens the bot with a one-time code, and the bot's webhook ties that chat to them.

create table telegram_chats (
    id         uuid primary key default gen_random_uuid(),
    user_id    uuid        not null references users (id) on delete cascade,
    chat_id    bigint      not null unique,
    username   varchar(64),
    created_at timestamptz not null default now()
);
create index telegram_chats_user_idx on telegram_chats (user_id);

create table telegram_link_codes (
    code_hash  varchar(64) primary key,
    user_id    uuid        not null references users (id) on delete cascade,
    expires_at timestamptz not null,
    created_at timestamptz not null default now()
);

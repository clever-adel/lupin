-- A screenshot of the customer's InstaPay or wallet transfer, kept private: only staff can open it.
-- One per payment; sending a new one (after a rejected transfer) replaces the old one.
create table transfer_receipts (
    payment_id   uuid primary key references payments (id) on delete cascade,
    content_type varchar(40) not null,
    bytes        bytea       not null,
    size_bytes   integer     not null,
    created_at   timestamptz not null default now()
);

-- Courier integration (Bosta). A shipment now remembers the courier's own delivery id and the last
-- status the courier reported, and every status message the courier sends is stored once.

alter table shipments add column provider_delivery_id varchar(64);
alter table shipments add column provider_state       smallint;
alter table shipments add column provider_state_label varchar(60);
alter table shipments add column provider_state_at    timestamptz;
alter table shipments add column last_exception       varchar(300);
alter table shipments add column cod_amount           numeric(12,2) check (cod_amount >= 0);
alter table shipments add column updated_at           timestamptz not null default now();
create unique index shipments_provider_delivery_uq on shipments (carrier, provider_delivery_id)
    where provider_delivery_id is not null;

-- The courier retries; unique (provider, event_key) makes a repeated message harmless.
create table shipment_events (
    id           bigint generated always as identity primary key,
    shipment_id  bigint references shipments (id) on delete set null,
    provider     varchar(20)  not null,
    event_key    varchar(150) not null,
    state        smallint,
    payload      jsonb        not null,
    received_at  timestamptz  not null default now(),
    unique (provider, event_key)
);
create index shipment_events_shipment_idx on shipment_events (shipment_id, received_at);

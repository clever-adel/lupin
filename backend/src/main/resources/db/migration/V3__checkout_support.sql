-- Checkout support: safe retries for order placement, and Arabic snapshots so an order reads the
-- same in both languages even after the product, delivery option or promotion is edited or removed.

alter table orders add column idempotency_key varchar(80);
create unique index orders_idempotency_uq on orders (user_id, idempotency_key) where idempotency_key is not null;

alter table orders add column governorate_name_ar     varchar(60)  not null default '';
alter table orders add column delivery_option_name_ar varchar(80)  not null default '';
alter table orders add column delivery_estimate_ar    varchar(80)  not null default '';
alter table orders add column discount_label_en       varchar(120) not null default '';
alter table orders add column discount_label_ar       varchar(120) not null default '';

alter table order_items add column product_name_ar varchar(160) not null default '';
alter table order_items add column color_name_ar   varchar(60)  not null default '';

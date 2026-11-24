-- Sales and returns made in person at the shop, at whatever price was agreed there. Each receipt takes
-- its pieces out of (or, for a return, puts them back into) the same stock the online store sells from.
-- Lines keep a copy of the product name, colour and size so old receipts still read after a product is deleted.
create table shop_sales (
    id               bigint generated always as identity primary key,
    kind             varchar(10) not null check (kind in ('SALE', 'RETURN')),
    original_sale_id bigint references shop_sales (id),
    payment_method   varchar(20) not null default 'CASH'
                     check (payment_method in ('CASH', 'CARD', 'INSTAPAY', 'WALLET')),
    total            numeric(12,2) not null check (total >= 0),
    customer_name    varchar(120),
    customer_phone   varchar(30),
    note             varchar(300),
    actor_user_id    uuid references users (id),
    created_at       timestamptz not null default now(),
    constraint shop_sales_return_points_to_sale check (kind = 'RETURN' or original_sale_id is null)
);
create index shop_sales_created_idx on shop_sales (created_at desc);
create index shop_sales_original_idx on shop_sales (original_sale_id) where original_sale_id is not null;

create table shop_sale_items (
    id               bigint generated always as identity primary key,
    sale_id          bigint not null references shop_sales (id) on delete cascade,
    variant_id       bigint references product_variants (id) on delete set null,
    original_item_id bigint references shop_sale_items (id),
    product_id       bigint,
    product_name     varchar(160) not null,
    color            varchar(60) not null,
    size_code        varchar(12) not null,
    sku              varchar(64) not null,
    quantity         int not null check (quantity > 0),
    unit_price       numeric(12,2) not null check (unit_price >= 0)
);
create index shop_sale_items_sale_idx on shop_sale_items (sale_id);
create index shop_sale_items_original_idx on shop_sale_items (original_item_id) where original_item_id is not null;

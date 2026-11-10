-- LUPIN WEAR baseline schema. Money is numeric(12,2) in EGP. Timestamps are timestamptz (UTC).

-- ───────────────────────── identity ─────────────────────────
create table users (
    id                 uuid primary key default gen_random_uuid(),
    email              varchar(254),
    phone              varchar(20),
    password_hash      varchar(255),
    full_name          varchar(120) not null,
    status             varchar(20)  not null default 'ACTIVE' check (status in ('ACTIVE','DISABLED')),
    preferred_lang     varchar(2)   not null default 'en' check (preferred_lang in ('en','ar')),
    email_verified_at  timestamptz,
    phone_verified_at  timestamptz,
    failed_login_count int          not null default 0,
    locked_until       timestamptz,
    last_login_at      timestamptz,
    mfa_enabled        boolean      not null default false,
    mfa_secret_enc     varchar(512),
    created_at         timestamptz  not null default now(),
    updated_at         timestamptz  not null default now(),
    deleted_at         timestamptz,
    constraint users_contact_present check (email is not null or phone is not null),
    constraint users_email_lowercase check (email = lower(email))
);
create unique index users_email_uq on users (email) where email is not null;
create unique index users_phone_uq on users (phone) where phone is not null;

create table roles (
    id   smallint primary key,
    code varchar(30) not null unique
);
create table permissions (
    id   smallint primary key,
    code varchar(60) not null unique
);
create table role_permissions (
    role_id       smallint not null references roles (id),
    permission_id smallint not null references permissions (id),
    primary key (role_id, permission_id)
);
create table user_roles (
    user_id uuid     not null references users (id) on delete cascade,
    role_id smallint not null references roles (id),
    primary key (user_id, role_id)
);

-- One row per refresh token. A login starts a family; rotation adds rows to it.
create table auth_sessions (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid        not null references users (id) on delete cascade,
    family_id   uuid        not null,
    token_hash  varchar(64)   not null unique,
    expires_at  timestamptz not null,
    rotated_at  timestamptz,
    revoked_at  timestamptz,
    user_agent  varchar(300),
    ip          varchar(45),
    created_at  timestamptz not null default now()
);
create index auth_sessions_user_idx on auth_sessions (user_id);
create index auth_sessions_family_idx on auth_sessions (family_id);

create table auth_tokens (
    id          bigint generated always as identity primary key,
    user_id     uuid        not null references users (id) on delete cascade,
    purpose     varchar(20) not null check (purpose in ('EMAIL_VERIFY','PASSWORD_RESET','PHONE_OTP')),
    token_hash  varchar(64)   not null,
    expires_at  timestamptz not null,
    consumed_at timestamptz,
    attempts    int         not null default 0,
    created_at  timestamptz not null default now()
);
create index auth_tokens_lookup_idx on auth_tokens (purpose, token_hash);
create index auth_tokens_user_idx on auth_tokens (user_id, purpose);

create table oauth_identities (
    id         bigint generated always as identity primary key,
    user_id    uuid        not null references users (id) on delete cascade,
    provider   varchar(20) not null check (provider in ('GOOGLE','APPLE','FACEBOOK')),
    subject    varchar(255) not null,
    created_at timestamptz not null default now(),
    unique (provider, subject)
);

create table customer_profiles (
    user_id          uuid primary key references users (id) on delete cascade,
    marketing_opt_in boolean     not null default false,
    updated_at       timestamptz not null default now()
);

-- ───────────────────────── delivery reference ─────────────────────────
create table delivery_zones (
    id      smallint generated always as identity primary key,
    code    varchar(30)  not null unique,
    name_en varchar(80)  not null,
    name_ar varchar(80)  not null
);
create table governorates (
    id      smallint primary key,
    code    varchar(40) not null unique,
    name_en varchar(60) not null,
    name_ar varchar(60) not null,
    zone_id smallint references delivery_zones (id),
    active  boolean not null default true
);
create table delivery_options (
    id          int generated always as identity primary key,
    code        varchar(40) not null unique,
    type        varchar(20) not null check (type in ('STANDARD','EXPRESS','PICKUP')),
    name_en     varchar(80) not null,
    name_ar     varchar(80) not null,
    estimate_en varchar(80) not null default '',
    estimate_ar varchar(80) not null default '',
    note_en     varchar(120) not null default '',
    note_ar     varchar(120) not null default '',
    fee         numeric(12,2) not null check (fee >= 0),
    active      boolean not null default false,
    sort_order  int not null default 0,
    updated_at  timestamptz not null default now()
);
-- No rows for an option = available in every active governorate.
create table delivery_option_governorates (
    delivery_option_id int      not null references delivery_options (id) on delete cascade,
    governorate_id     smallint not null references governorates (id),
    fee_override       numeric(12,2) check (fee_override >= 0),
    primary key (delivery_option_id, governorate_id)
);

create table customer_addresses (
    id             bigint generated always as identity primary key,
    user_id        uuid         not null references users (id) on delete cascade,
    recipient_name varchar(120) not null,
    phone          varchar(20)  not null,
    governorate_id smallint     not null references governorates (id),
    city           varchar(80)  not null,
    address_line   varchar(300) not null,
    notes          varchar(300),
    is_default     boolean      not null default false,
    created_at     timestamptz  not null default now(),
    updated_at     timestamptz  not null default now()
);
create index customer_addresses_user_idx on customer_addresses (user_id);
create unique index customer_addresses_default_uq on customer_addresses (user_id) where is_default;

-- ───────────────────────── catalog ─────────────────────────
create table departments (
    id         int generated always as identity primary key,
    slug       varchar(60) not null unique,
    name_en    varchar(80) not null,
    name_ar    varchar(80) not null,
    status     varchar(20) not null default 'HIDDEN' check (status in ('ACTIVE','COMING_SOON','HIDDEN')),
    sort_order int not null default 0,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table categories (
    id            int generated always as identity primary key,
    department_id int not null references departments (id),
    parent_id     int references categories (id),
    slug          varchar(60) not null,
    name_en       varchar(80) not null,
    name_ar       varchar(80) not null,
    active        boolean not null default true,
    sort_order    int not null default 0,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now(),
    unique (department_id, slug)
);
create index categories_parent_idx on categories (parent_id);

create table collections (
    id         int generated always as identity primary key,
    slug       varchar(60) not null unique,
    name_en    varchar(80) not null,
    name_ar    varchar(80) not null,
    season     varchar(10) not null default 'ALL' check (season in ('SUMMER','WINTER','ALL')),
    year       smallint,
    active     boolean not null default true,
    created_at timestamptz not null default now()
);

create table sizes (
    id         int generated always as identity primary key,
    size_group varchar(20) not null default 'ADULT',
    code       varchar(12) not null,
    sort_order int not null default 0,
    unique (size_group, code)
);

create table products (
    id             bigint generated always as identity primary key,
    slug           varchar(120) not null unique,
    department_id  int not null references departments (id),
    category_id    int not null references categories (id),
    collection_id  int references collections (id),
    name_en        varchar(160) not null,
    name_ar        varchar(160) not null,
    description_en text not null default '',
    description_ar text not null default '',
    fabric_en      varchar(300) not null default '',
    fabric_ar      varchar(300) not null default '',
    fit_en         varchar(300) not null default '',
    fit_ar         varchar(300) not null default '',
    brand          varchar(80),
    badge          varchar(20) check (badge in ('NEW','BESTSELLER')),
    price          numeric(12,2) not null check (price > 0),
    sale_price     numeric(12,2) check (sale_price > 0),
    status         varchar(20) not null default 'DRAFT' check (status in ('DRAFT','ACTIVE','ARCHIVED')),
    featured       boolean not null default false,
    published_at   timestamptz,
    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now(),
    deleted_at     timestamptz,
    version        int not null default 0,
    constraint products_sale_below_price check (sale_price is null or sale_price < price)
);
create index products_listing_idx on products (department_id, status, category_id) where deleted_at is null;
create index products_published_idx on products (published_at desc) where status = 'ACTIVE' and deleted_at is null;

create table product_colors (
    id         bigint generated always as identity primary key,
    product_id bigint not null references products (id) on delete cascade,
    name_en    varchar(60) not null,
    name_ar    varchar(60) not null,
    hex        varchar(7) not null check (hex ~ '^#[0-9A-Fa-f]{6}$'),
    is_main    boolean not null default false,
    sort_order int not null default 0,
    unique (product_id, name_en)
);
create unique index product_colors_main_uq on product_colors (product_id) where is_main;

-- position 0..9 with a unique index = at most 10 photos per colour, enforced by the database.
create table product_images (
    id         bigint generated always as identity primary key,
    color_id   bigint not null references product_colors (id) on delete cascade,
    public_id  varchar(255) not null,
    url        varchar(600) not null,
    alt_en     varchar(200) not null default '',
    alt_ar     varchar(200) not null default '',
    width      int,
    height     int,
    position   smallint not null check (position between 0 and 9),
    created_at timestamptz not null default now(),
    unique (color_id, position)
);

create table product_variants (
    id         bigint generated always as identity primary key,
    product_id bigint not null references products (id) on delete cascade,
    color_id   bigint not null references product_colors (id) on delete cascade,
    size_id    int    not null references sizes (id),
    sku        varchar(64) not null unique,
    active     boolean not null default true,
    created_at timestamptz not null default now(),
    unique (product_id, color_id, size_id)
);
create index product_variants_color_idx on product_variants (color_id);

create table inventory (
    variant_id bigint primary key references product_variants (id) on delete cascade,
    on_hand    int not null default 0 check (on_hand >= 0),
    reserved   int not null default 0 check (reserved >= 0),
    updated_at timestamptz not null default now(),
    constraint inventory_reserved_within_stock check (reserved <= on_hand)
);

create table inventory_movements (
    id             bigint generated always as identity primary key,
    variant_id     bigint not null references product_variants (id),
    type           varchar(20) not null check (type in ('RECEIVE','ADJUST','RESERVE','RELEASE','SHIP','RETURN')),
    quantity       int not null,
    reference_type varchar(30),
    reference_id   varchar(64),
    note           varchar(300),
    actor_user_id  uuid references users (id),
    created_at     timestamptz not null default now()
);
create index inventory_movements_variant_idx on inventory_movements (variant_id, created_at desc);

-- ───────────────────────── cart & favourites ─────────────────────────
create table carts (
    id         uuid primary key default gen_random_uuid(),
    user_id    uuid not null unique references users (id) on delete cascade,
    updated_at timestamptz not null default now()
);
create table cart_items (
    id         bigint generated always as identity primary key,
    cart_id    uuid   not null references carts (id) on delete cascade,
    variant_id bigint not null references product_variants (id) on delete cascade,
    quantity   int    not null check (quantity between 1 and 20),
    added_at   timestamptz not null default now(),
    unique (cart_id, variant_id)
);
create table favorites (
    user_id    uuid   not null references users (id) on delete cascade,
    product_id bigint not null references products (id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (user_id, product_id)
);

-- ───────────────────────── promotions ─────────────────────────
create table promotions (
    id              bigint generated always as identity primary key,
    name_en         varchar(120) not null,
    name_ar         varchar(120) not null,
    automatic       boolean not null,
    type            varchar(20) not null check (type in ('PERCENT','FIXED','FREE_DELIVERY')),
    value           numeric(12,2) not null default 0 check (value >= 0),
    scope           varchar(20) not null default 'ALL' check (scope in ('ALL','DEPARTMENT','CATEGORY','COLLECTION','PRODUCT')),
    min_order_value numeric(12,2) not null default 0 check (min_order_value >= 0),
    starts_at       timestamptz,
    ends_at         timestamptz,
    active          boolean not null default false,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    constraint promotions_percent_range check (type <> 'PERCENT' or (value > 0 and value <= 90)),
    constraint promotions_window check (ends_at is null or starts_at is null or ends_at > starts_at)
);
create table promotion_targets (
    promotion_id bigint not null references promotions (id) on delete cascade,
    target_id    bigint not null,
    primary key (promotion_id, target_id)
);
create table promo_codes (
    id                 bigint generated always as identity primary key,
    code               varchar(30) not null unique check (code = upper(code)),
    promotion_id       bigint not null unique references promotions (id) on delete cascade,
    max_redemptions    int check (max_redemptions > 0),
    per_customer_limit int not null default 1 check (per_customer_limit > 0),
    redeemed_count     int not null default 0 check (redeemed_count >= 0),
    show_on_home       boolean not null default false,
    constraint promo_codes_within_limit check (max_redemptions is null or redeemed_count <= max_redemptions)
);

-- ───────────────────────── orders ─────────────────────────
create sequence order_reference_seq start 10000;

create table orders (
    id                   uuid primary key default gen_random_uuid(),
    reference            varchar(20) not null unique,
    user_id              uuid not null references users (id),
    status               varchar(20) not null check (status in
        ('PENDING','AWAITING_PAYMENT','PAID','CONFIRMED','PROCESSING','SHIPPED','DELIVERED','CANCELLED','REFUNDED')),
    payment_status       varchar(20) not null default 'PENDING' check (payment_status in
        ('NOT_REQUIRED','PENDING','VERIFYING','PAID','FAILED','REFUND_PENDING','REFUNDED','PARTIALLY_REFUNDED')),
    payment_method       varchar(30),
    currency             varchar(3) not null default 'EGP',
    subtotal             numeric(12,2) not null check (subtotal >= 0),
    discount_total       numeric(12,2) not null default 0 check (discount_total >= 0),
    delivery_fee         numeric(12,2) not null default 0 check (delivery_fee >= 0),
    total                numeric(12,2) not null check (total >= 0),
    promo_code_id        bigint references promo_codes (id),
    promo_code           varchar(30),
    customer_name        varchar(120) not null,
    customer_phone       varchar(20)  not null,
    governorate_id       smallint not null references governorates (id),
    governorate_name     varchar(60)  not null,
    city                 varchar(80)  not null,
    address_line         varchar(300) not null,
    delivery_notes       varchar(300),
    delivery_option_id   int references delivery_options (id),
    delivery_option_name varchar(80) not null,
    delivery_estimate    varchar(80) not null default '',
    status_before_cancel varchar(20),
    cancelled_at         timestamptz,
    undo_expires_at      timestamptz,
    placed_at            timestamptz not null default now(),
    updated_at           timestamptz not null default now(),
    version              int not null default 0,
    constraint orders_total_adds_up check (total = subtotal - discount_total + delivery_fee)
);
create index orders_user_idx on orders (user_id, placed_at desc);
create index orders_status_idx on orders (status, placed_at desc);

create table order_items (
    id           bigint generated always as identity primary key,
    order_id     uuid   not null references orders (id) on delete cascade,
    variant_id   bigint references product_variants (id) on delete set null,
    product_id   bigint references products (id) on delete set null,
    product_name varchar(160) not null,
    color_name   varchar(60)  not null,
    size_code    varchar(12)  not null,
    sku          varchar(64)  not null,
    image_url    varchar(600),
    unit_price   numeric(12,2) not null check (unit_price >= 0),
    quantity     int not null check (quantity > 0),
    line_total   numeric(12,2) not null check (line_total >= 0)
);
create index order_items_order_idx on order_items (order_id);
create index order_items_product_idx on order_items (product_id);

create table order_status_history (
    id            bigint generated always as identity primary key,
    order_id      uuid not null references orders (id) on delete cascade,
    from_status   varchar(20),
    to_status     varchar(20) not null,
    actor_user_id uuid references users (id),
    note          varchar(300),
    created_at    timestamptz not null default now()
);
create index order_status_history_order_idx on order_status_history (order_id, created_at);

create table promo_code_redemptions (
    id            bigint generated always as identity primary key,
    promo_code_id bigint not null references promo_codes (id),
    user_id       uuid   not null references users (id),
    order_id      uuid   not null unique references orders (id) on delete cascade,
    status        varchar(20) not null default 'RESERVED' check (status in ('RESERVED','CONFIRMED','RELEASED')),
    created_at    timestamptz not null default now()
);
create index promo_code_redemptions_lookup_idx on promo_code_redemptions (promo_code_id, user_id);

-- ───────────────────────── payments ─────────────────────────
create table payments (
    id                      uuid primary key default gen_random_uuid(),
    order_id                uuid not null references orders (id),
    provider                varchar(20) not null check (provider in ('PAYMOB','COD','MANUAL_TRANSFER')),
    method                  varchar(30) not null,
    status                  varchar(20) not null default 'PENDING' check (status in
        ('PENDING','VERIFYING','PAID','FAILED','CANCELLED','REFUNDED','PARTIALLY_REFUNDED')),
    amount                  numeric(12,2) not null check (amount > 0),
    currency                varchar(3) not null default 'EGP',
    idempotency_key         varchar(80) not null unique,
    provider_order_id       varchar(100),
    provider_transaction_id varchar(100),
    manual_reference        varchar(100),
    manual_proof_public_id  varchar(255),
    verified_by             uuid references users (id),
    verified_at             timestamptz,
    created_at              timestamptz not null default now(),
    updated_at              timestamptz not null default now()
);
create index payments_order_idx on payments (order_id);
create unique index payments_provider_txn_uq on payments (provider, provider_transaction_id) where provider_transaction_id is not null;

-- Webhook inbox. unique (provider, event_key) is what makes processing idempotent.
create table payment_events (
    id              bigint generated always as identity primary key,
    payment_id      uuid references payments (id),
    provider        varchar(20)  not null,
    event_key       varchar(150) not null,
    event_type      varchar(60),
    signature_valid boolean not null,
    payload         jsonb   not null,
    received_at     timestamptz not null default now(),
    processed_at    timestamptz,
    error           varchar(500),
    unique (provider, event_key)
);

create table refunds (
    id                 bigint generated always as identity primary key,
    payment_id         uuid not null references payments (id),
    amount             numeric(12,2) not null check (amount > 0),
    status             varchar(20) not null default 'PENDING' check (status in ('PENDING','SUCCEEDED','FAILED')),
    provider_refund_id varchar(100),
    reason             varchar(300),
    created_by         uuid references users (id),
    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now()
);

create table shipments (
    id                 bigint generated always as identity primary key,
    order_id           uuid not null references orders (id) on delete cascade,
    carrier            varchar(60),
    tracking_reference varchar(100),
    status             varchar(20) not null default 'PENDING' check (status in ('PENDING','SHIPPED','DELIVERED','RETURNED')),
    shipped_at         timestamptz,
    delivered_at       timestamptz,
    created_at         timestamptz not null default now()
);
create index shipments_order_idx on shipments (order_id);

-- ───────────────────────── reviews & content ─────────────────────────
create table reviews (
    id            bigint generated always as identity primary key,
    product_id    bigint not null references products (id) on delete cascade,
    user_id       uuid   not null references users (id) on delete cascade,
    order_item_id bigint not null unique references order_items (id) on delete cascade,
    rating        smallint not null check (rating between 1 and 5),
    body          varchar(1000) not null default '',
    status        varchar(20) not null default 'PENDING' check (status in ('PENDING','APPROVED','REJECTED')),
    moderated_by  uuid references users (id),
    moderated_at  timestamptz,
    created_at    timestamptz not null default now()
);
create index reviews_product_idx on reviews (product_id) where status = 'APPROVED';

create table faq_items (
    id          int generated always as identity primary key,
    question_en varchar(300) not null,
    question_ar varchar(300) not null,
    answer_en   text not null,
    answer_ar   text not null,
    sort_order  int not null default 0,
    published   boolean not null default false,
    updated_at  timestamptz not null default now()
);

create table policies (
    id          int generated always as identity primary key,
    slug        varchar(40) not null unique,
    title_en    varchar(120) not null,
    title_ar    varchar(120) not null,
    body_en     text not null default '',
    body_ar     text not null default '',
    status      varchar(20) not null default 'DRAFT' check (status in ('DRAFT','PUBLISHED')),
    sort_order  int not null default 0,
    approved_by uuid references users (id),
    approved_at timestamptz,
    updated_at  timestamptz not null default now(),
    constraint policies_published_needs_approval check (status = 'DRAFT' or approved_by is not null)
);

create table site_settings (
    key        varchar(60) primary key,
    value      jsonb not null,
    updated_by uuid references users (id),
    updated_at timestamptz not null default now()
);

create table audit_logs (
    id            bigint generated always as identity primary key,
    actor_user_id uuid references users (id),
    action        varchar(60) not null,
    entity_type   varchar(40) not null,
    entity_id     varchar(64),
    detail        jsonb,
    ip            varchar(45),
    created_at    timestamptz not null default now()
);
create index audit_logs_entity_idx on audit_logs (entity_type, entity_id, created_at desc);
create index audit_logs_actor_idx on audit_logs (actor_user_id, created_at desc);

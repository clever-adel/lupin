-- "Shop the look": an outfit built from real catalogue products, shown on one model photo.
-- The photo is either a real photoshoot upload or an AI image a staff member approved after comparing
-- it with the product photos. Customers only ever see published looks.

create table looks (
    id              bigint generated always as identity primary key,
    slug            varchar(120) not null unique,
    title_en        varchar(120) not null,
    title_ar        varchar(120) not null,
    description_en  varchar(600) not null default '',
    description_ar  varchar(600) not null default '',
    image_url       varchar(600),
    image_public_id varchar(255),
    image_source    varchar(10) check (image_source in ('AI', 'PHOTO')),
    status          varchar(20) not null default 'DRAFT' check (status in ('DRAFT', 'PUBLISHED')),
    sort_order      int not null default 0,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    constraint looks_image_complete check ((image_url is null) = (image_source is null)),
    constraint looks_published_has_image check (status <> 'PUBLISHED' or image_url is not null)
);
create index looks_published_idx on looks (sort_order, id) where status = 'PUBLISHED';

-- What the model wears. The colour is the one in the photo; shoppers may still pick another colour.
create table look_items (
    id         bigint generated always as identity primary key,
    look_id    bigint not null references looks (id) on delete cascade,
    product_id bigint not null references products (id) on delete cascade,
    color_id   bigint not null references product_colors (id) on delete cascade,
    role       varchar(12) not null check (role in ('TOP', 'BOTTOM', 'ONE_PIECE', 'OUTER', 'ACCESSORY')),
    position   smallint not null check (position between 0 and 7),
    unique (look_id, position),
    unique (look_id, product_id)
);
create index look_items_product_idx on look_items (product_id);

-- One AI run for a look. Candidate images are kept here until a staff member approves one (it is then
-- copied to the photo storage like any upload); old runs are removed after a week.
create table look_generations (
    id           uuid primary key default gen_random_uuid(),
    look_id      bigint not null references looks (id) on delete cascade,
    provider     varchar(20) not null,
    status       varchar(10) not null check (status in ('RUNNING', 'DONE', 'FAILED')),
    error        varchar(500),
    requested_by uuid references users (id),
    created_at   timestamptz not null default now(),
    finished_at  timestamptz
);
create index look_generations_look_idx on look_generations (look_id, created_at desc);
-- One run at a time per look, even when two staff members press the button together.
create unique index look_generations_one_running on look_generations (look_id) where status = 'RUNNING';

create table look_generation_images (
    generation_id uuid not null references look_generations (id) on delete cascade,
    position      smallint not null check (position between 0 and 3),
    content_type  varchar(20) not null check (content_type in ('image/png', 'image/jpeg')),
    bytes         bytea not null,
    primary key (generation_id, position)
);

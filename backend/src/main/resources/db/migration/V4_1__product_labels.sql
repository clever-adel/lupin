-- Labels on product photos. Besides "New" and "Bestseller" the owner can pick "Sale" or write
-- his own label, in English and Arabic (CUSTOM). The texts are stored only for CUSTOM.
-- Numbered 4.1 so it runs before any later migration that is still being written.

alter table products drop constraint if exists products_badge_check;
alter table products add column badge_en varchar(30);
alter table products add column badge_ar varchar(30);
alter table products add constraint products_badge_check
    check (badge in ('NEW', 'BESTSELLER', 'SALE', 'CUSTOM'));
alter table products add constraint products_badge_text_check
    check ((badge = 'CUSTOM' and badge_en is not null and badge_ar is not null)
        or (badge is distinct from 'CUSTOM' and badge_en is null and badge_ar is null));

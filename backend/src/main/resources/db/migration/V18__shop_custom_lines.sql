-- A shop receipt line may be something that is not on the site at all: staff type what it is and its
-- price, and it is counted in the receipt's money but takes nothing from (or back into) stock.
alter table shop_sale_items add column custom boolean not null default false;
alter table shop_sale_items add constraint shop_sale_items_custom_has_no_piece check (not custom or variant_id is null);

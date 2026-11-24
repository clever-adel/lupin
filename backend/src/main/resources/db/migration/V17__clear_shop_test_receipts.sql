-- Clean-up asked for by the owner on 24 Nov 2026: every shop receipt made so far (sales and returns) was
-- a test of the new Shop page, and is removed for good. Only receipts made before the cut-off below are
-- touched, so a real sale rung up after this was written is kept.
--
-- Stock goes back to where it would be without those tests: whatever the test sales took out and the test
-- returns did not put back is added back (and the other way round). It never drops below what is reserved
-- for open online orders, nor below zero. The audit log keeps its record of the tests; it is append-only.

-- A sale that a later (real) return points at is kept, so that return still reads.
create temporary table test_receipts as
select s.id from shop_sales s
where s.created_at < timestamptz '2026-11-24 16:22:00+00'
  and not exists (select 1 from shop_sales r
                  where r.original_sale_id = s.id and r.created_at >= timestamptz '2026-11-24 16:22:00+00');

create temporary table test_stock_change as
select it.variant_id,
       sum(case when s.kind = 'SALE' then it.quantity else -it.quantity end) as put_back
from shop_sale_items it join shop_sales s on s.id = it.sale_id
where it.sale_id in (select id from test_receipts) and it.variant_id is not null
group by it.variant_id;

update inventory i
set on_hand = greatest(i.on_hand + c.put_back, i.reserved, 0), updated_at = now()
from test_stock_change c
where i.variant_id = c.variant_id and c.put_back <> 0;

delete from inventory_movements
where reference_type in ('SHOP_SALE', 'SHOP_RETURN')
  and reference_id in (select id::text from test_receipts);

-- Returns point at their sale, and return lines at sale lines: remove the returns first.
delete from shop_sale_items where sale_id in (select id from test_receipts) and original_item_id is not null;
delete from shop_sales where id in (select id from test_receipts) and kind = 'RETURN';
delete from shop_sales where id in (select id from test_receipts);

-- With no receipts left, the first real receipt is #1 again.
select setval(pg_get_serial_sequence('shop_sales', 'id'), 1, false) where not exists (select 1 from shop_sales);
select setval(pg_get_serial_sequence('shop_sale_items', 'id'), 1, false) where not exists (select 1 from shop_sale_items);

drop table test_stock_change;
drop table test_receipts;

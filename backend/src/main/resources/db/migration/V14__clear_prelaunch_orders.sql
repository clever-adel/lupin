-- Launch clean-up, asked for by the owner on 21 Nov 2026: the seven orders placed while the store
-- was being tested (LP-10000 to LP-10006) are removed for good, with their payments and history.
-- Named one by one, so an order placed after launch can never be caught by this.
-- Stock is not touched here; the one test piece that was marked delivered is put back from the dashboard.

create temporary table prelaunch_orders as
select id, reference from orders
where reference in ('LP-10000', 'LP-10001', 'LP-10002', 'LP-10003', 'LP-10004', 'LP-10005', 'LP-10006');

delete from refunds
where payment_id in (select p.id from payments p where p.order_id in (select id from prelaunch_orders));

delete from payment_events
where payment_id in (select p.id from payments p where p.order_id in (select id from prelaunch_orders));

-- transfer_receipts go with their payment (on delete cascade).
delete from payments where order_id in (select id from prelaunch_orders);

-- order_items, order_status_history, promo_code_redemptions and shipments cascade.
delete from orders where id in (select id from prelaunch_orders);

-- With no orders left, the first real order is LP-10000 again.
select setval('order_reference_seq', 10000, false) where not exists (select 1 from orders);

drop table prelaunch_orders;

-- The order pieces appear in on the store, set by staff ("Display order"). Lower comes first; a piece
-- with none yet (newly added) comes before the arranged ones. Sold-out pieces always come last.
alter table products add column display_order int;

-- Start tidy: the same kind of piece together (in category order), newest first within each kind.
update products p set display_order = ranked.position * 10
from (select p2.id, row_number() over (
          order by c.sort_order, c.id, p2.published_at desc nulls last, p2.id desc) as position
      from products p2 join categories c on c.id = p2.category_id
      where p2.deleted_at is null) ranked
where ranked.id = p.id;

-- LOCAL DEVELOPMENT ONLY. Loaded only by the "local" Spring profile (see application.yml).
-- Demonstration data taken from the prototype PDF: names, prices, fees and codes here are NOT real
-- business data and must never reach staging or production.

update departments set status = 'ACTIVE' where slug = 'men';

insert into categories (department_id, slug, name_en, name_ar, sort_order)
select d.id, v.slug, v.name_en, v.name_ar, v.ord
from departments d,
     (values ('lightweight', 'Lightweight', 'خفيف', 1), ('bombers', 'Bombers', 'بومبر', 2),
             ('utility', 'Utility', 'عملي', 3), ('windbreakers', 'Windbreakers', 'واقي رياح', 4)) as v(slug, name_en, name_ar, ord)
where d.slug = 'men'
on conflict (department_id, slug) do nothing;

-- Demo delivery options and fees so a local order can be placed. Express is offered in Cairo and Giza only.
insert into delivery_options (code, type, name_en, name_ar, estimate_en, estimate_ar, fee, active, sort_order)
values ('demo-standard', 'STANDARD', 'Standard delivery (demo)', 'توصيل عادي (تجريبي)', '2–4 working days', '٢–٤ أيام عمل', 60, true, 1),
       ('demo-express', 'EXPRESS', 'Express delivery (demo)', 'توصيل سريع (تجريبي)', 'Next day', 'اليوم التالي', 120, true, 2)
on conflict (code) do nothing;
insert into delivery_option_governorates (delivery_option_id, governorate_id)
select o.id, g.id from delivery_options o, governorates g where o.code = 'demo-express' and g.id in (1, 2)
on conflict do nothing;

-- Cash on delivery is switched on locally only; everywhere else the owner enables it.
update site_settings set value = jsonb_set(value, '{COD}', 'true') where key = 'payment_methods';
-- Manual InstaPay with a made-up address, so the transfer flow can be tried locally. Not a real account.
update site_settings
set value = value || '{"INSTAPAY_MANUAL": true, "instapayHandle": "demo-not-real@instapay",
                       "instapayInstructionsEn": "Demo only. Do not send money to this address.",
                       "instapayInstructionsAr": "للتجربة فقط. لا ترسل أموالًا إلى هذا العنوان."}'::jsonb
where key = 'payment_methods';

do $$
declare
    demo record;
    colour record;
    sz record;
    dep_id int := (select id from departments where slug = 'men');
    product_id bigint;
    colour_id bigint;
    variant_id bigint;
    n int := 0;
begin
    for demo in
        select * from (values
            ('demo-harbour-stand-collar-jacket', 'Harbour Stand-Collar Jacket', 'جاكيت هاربور بياقة مرتفعة', 'lightweight', 2450.00, null::numeric, 'BESTSELLER', true),
            ('demo-nightfall-bomber', 'Nightfall Bomber', 'بومبر نايتفول', 'bombers', 2750.00, null, 'NEW', true),
            ('demo-field-utility-jacket', 'Field Utility Jacket', 'جاكيت فيلد العملي', 'utility', 2600.00, null, null, false),
            ('demo-dune-light-jacket', 'Dune Light Jacket', 'جاكيت ديون الخفيف', 'lightweight', 2300.00, 2070.00, null, false),
            ('demo-ember-windbreaker', 'Ember Windbreaker', 'واقي الرياح إمبر', 'windbreakers', 2200.00, 1760.00, null, false),
            ('demo-slate-shell-jacket', 'Slate Shell Jacket', 'جاكيت سليت شل', 'windbreakers', 2550.00, 2040.00, null, false)
        ) as t(slug, name_en, name_ar, cat, price, sale_price, badge, featured)
    loop
        if exists (select 1 from products where slug = demo.slug) then
            continue;
        end if;
        insert into products (slug, department_id, category_id, name_en, name_ar, description_en, description_ar,
                              fabric_en, fabric_ar, fit_en, fit_ar, badge, price, sale_price, status, featured, published_at)
        values (demo.slug, dep_id, (select id from categories where department_id = dep_id and slug = demo.cat),
                demo.name_en, demo.name_ar,
                'Demo product for local development. Replace with the real description.',
                'منتج تجريبي للتطوير المحلي. يُستبدل بالوصف الحقيقي.',
                'Demo fabric text', 'نص تجريبي للخامة', 'Regular — true to size', 'قصّة عادية — مطابق للمقاس',
                demo.badge, demo.price, demo.sale_price, 'ACTIVE', demo.featured, now() - (n || ' hours')::interval)
        returning id into product_id;
        n := n + 1;

        for colour in
            select * from (values ('Black', 'أسود', '#0B0B0C', true, 0), ('Slate', 'رمادي', '#55585C', false, 1),
                                  ('Navy', 'كحلي', '#16213A', false, 2)) as c(name_en, name_ar, hex, is_main, ord)
        loop
            insert into product_colors (product_id, name_en, name_ar, hex, is_main, sort_order)
            values (product_id, colour.name_en, colour.name_ar, colour.hex, colour.is_main, colour.ord)
            returning id into colour_id;

            for sz in select id, code from sizes where size_group = 'ADULT' and code in ('S', 'M', 'L', 'XL', 'XXL')
            loop
                insert into product_variants (product_id, color_id, size_id, sku)
                values (product_id, colour_id, sz.id, 'DEMO-' || product_id || '-' || colour_id || '-' || sz.code)
                returning id into variant_id;
                -- XXL is sold out so the crossed-out size state is visible.
                insert into inventory (variant_id, on_hand) values (variant_id, case when sz.code = 'XXL' then 0 else 8 end);
            end loop;
        end loop;
    end loop;
end $$;

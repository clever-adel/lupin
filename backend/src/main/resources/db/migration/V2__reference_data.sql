-- Reference data only: roles, permissions, Egypt's 27 governorates, standard sizes,
-- the three initial departments, policy slots (empty drafts) and settings keys.
-- No prices, fees, products or policy wording are seeded here: those are the owner's to enter.

insert into roles (id, code) values (1, 'CUSTOMER'), (2, 'ADMIN'), (3, 'OWNER');

insert into permissions (id, code) values
    (1, 'catalog:write'), (2, 'inventory:write'), (3, 'orders:read'), (4, 'orders:write'),
    (5, 'payments:verify'), (6, 'payments:refund'), (7, 'promotions:write'), (8, 'delivery:write'),
    (9, 'content:write'), (10, 'policies:publish'), (11, 'customers:read'), (12, 'reviews:moderate'),
    (13, 'reports:read'), (14, 'staff:manage'), (15, 'settings:payment');

-- ADMIN: day-to-day operations. OWNER: everything, incl. refunds, publishing policies, staff, payment settings.
insert into role_permissions (role_id, permission_id)
select 2, id from permissions where code not in ('payments:refund', 'policies:publish', 'staff:manage', 'settings:payment');
insert into role_permissions (role_id, permission_id) select 3, id from permissions;

insert into governorates (id, code, name_en, name_ar) values
    (1, 'cairo', 'Cairo', 'القاهرة'),
    (2, 'giza', 'Giza', 'الجيزة'),
    (3, 'alexandria', 'Alexandria', 'الإسكندرية'),
    (4, 'qalyubia', 'Qalyubia', 'القليوبية'),
    (5, 'dakahlia', 'Dakahlia', 'الدقهلية'),
    (6, 'sharqia', 'Sharqia', 'الشرقية'),
    (7, 'gharbia', 'Gharbia', 'الغربية'),
    (8, 'monufia', 'Monufia', 'المنوفية'),
    (9, 'beheira', 'Beheira', 'البحيرة'),
    (10, 'kafr-el-sheikh', 'Kafr El Sheikh', 'كفر الشيخ'),
    (11, 'damietta', 'Damietta', 'دمياط'),
    (12, 'port-said', 'Port Said', 'بورسعيد'),
    (13, 'ismailia', 'Ismailia', 'الإسماعيلية'),
    (14, 'suez', 'Suez', 'السويس'),
    (15, 'north-sinai', 'North Sinai', 'شمال سيناء'),
    (16, 'south-sinai', 'South Sinai', 'جنوب سيناء'),
    (17, 'fayoum', 'Fayoum', 'الفيوم'),
    (18, 'beni-suef', 'Beni Suef', 'بني سويف'),
    (19, 'minya', 'Minya', 'المنيا'),
    (20, 'assiut', 'Assiut', 'أسيوط'),
    (21, 'sohag', 'Sohag', 'سوهاج'),
    (22, 'qena', 'Qena', 'قنا'),
    (23, 'luxor', 'Luxor', 'الأقصر'),
    (24, 'aswan', 'Aswan', 'أسوان'),
    (25, 'red-sea', 'Red Sea', 'البحر الأحمر'),
    (26, 'new-valley', 'New Valley', 'الوادي الجديد'),
    (27, 'matrouh', 'Matrouh', 'مطروح');

insert into sizes (size_group, code, sort_order) values
    ('ADULT', 'XS', 1), ('ADULT', 'S', 2), ('ADULT', 'M', 3), ('ADULT', 'L', 4),
    ('ADULT', 'XL', 5), ('ADULT', 'XXL', 6), ('ADULT', '3XL', 7), ('ADULT', 'ONE', 20),
    ('KIDS', '2-3Y', 1), ('KIDS', '4-5Y', 2), ('KIDS', '6-7Y', 3), ('KIDS', '8-9Y', 4),
    ('KIDS', '10-11Y', 5), ('KIDS', '12-13Y', 6);

insert into departments (slug, name_en, name_ar, status, sort_order) values
    ('men', 'Men', 'رجالي', 'COMING_SOON', 1),
    ('women', 'Women', 'حريمي', 'COMING_SOON', 2),
    ('kids', 'Kids', 'أطفال', 'COMING_SOON', 3);

insert into policies (slug, title_en, title_ar, sort_order) values
    ('delivery', 'Delivery policy', 'سياسة التوصيل', 1),
    ('exchange-returns', 'Exchange & returns', 'الاستبدال والاسترجاع', 2),
    ('cancellation', 'Cancelling an order', 'إلغاء الطلب', 3),
    ('payments', 'Payments', 'الدفع', 4),
    ('privacy', 'Privacy', 'الخصوصية', 5),
    ('terms', 'Terms of sale', 'شروط البيع', 6),
    ('promo-codes', 'Promo code terms', 'شروط أكواد الخصم', 7);

insert into site_settings (key, value) values
    ('brand', '{"storeName":"LUPIN.","sloganEn":"Steal the look.","sloganAr":"اسرق الأنظار.","supportingEn":"Beyond the visible.","supportingAr":"ما وراء المرئي."}'),
    ('hero', '{"labelEn":"","labelAr":"","headlineEn":"","headlineAr":"","textEn":"","textAr":"","productSlug":null}'),
    ('announcement', '{"itemsEn":[],"itemsAr":[]}'),
    ('contact', '{"email":"","phone":"","whatsappNumber":"","hoursEn":"","hoursAr":"","addressEn":"","addressAr":"","instagram":"","facebook":"","tiktok":""}'),
    ('home_sections', '{"departments":true,"offers":true,"collection":true,"howToOrder":true,"reviews":false}'),
    ('checkout', '{"orderReferencePrefix":"LP","freeDeliveryThreshold":null,"cancelUndoMinutes":30,"maxQuantityPerLine":10}'),
    ('payment_methods', '{"COD":false,"CARD":false,"WALLET":false,"FAWRY":false,"INSTAPAY_MANUAL":false,"instapayHandle":"","instapayInstructionsEn":"","instapayInstructionsAr":""}');

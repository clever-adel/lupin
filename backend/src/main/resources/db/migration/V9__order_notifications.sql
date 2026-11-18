-- Where the owner hears about each new order. Filled in the dashboard (Settings), never in code.
insert into site_settings (key, value)
values ('notifications', '{"orderEmail": "", "whatsappTo": ""}')
on conflict (key) do nothing;

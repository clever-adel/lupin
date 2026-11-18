-- Meta (Facebook / Instagram) Pixel: the owner pastes the Pixel ID in the dashboard. Empty = no tracking.
insert into site_settings (key, value)
values ('tracking', '{"metaPixelId": ""}')
on conflict (key) do nothing;

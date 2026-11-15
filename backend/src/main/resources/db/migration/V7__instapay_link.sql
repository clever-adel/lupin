-- Optional InstaPay payment link (https://ipn.eg/S/...) and InstaPay QR image (uploaded in the
-- dashboard). The order page shows an "Open InstaPay" button and the QR, so customers do not type it.
update site_settings
set value = '{"instapayLink": "", "instapayQrUrl": "", "instapayQrPublicId": ""}'::jsonb || value
where key = 'payment_methods';

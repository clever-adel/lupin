-- Manual Vodafone Cash transfer, the same flow as manual InstaPay: the customer sends the money to the
-- store's Vodafone Cash number, enters the transfer reference, and staff confirm it arrived.
-- Off until the owner switches it on and enters the number. Existing settings are kept as they are.
update site_settings
set value = '{"VODAFONE_CASH_MANUAL": false, "vodafoneCashNumber": "",
              "vodafoneCashInstructionsEn": "", "vodafoneCashInstructionsAr": ""}'::jsonb || value
where key = 'payment_methods';

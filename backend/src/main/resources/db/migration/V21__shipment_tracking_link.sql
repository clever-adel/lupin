-- Any courier: staff can paste the courier's own tracking page so the customer can follow the parcel.
alter table shipments add column tracking_url varchar(300);

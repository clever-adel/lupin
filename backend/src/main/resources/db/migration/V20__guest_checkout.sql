-- Guest checkout: a shopper can buy without making an account. The store quietly makes a guest
-- account for that browser (no email, no phone, no password) so the bag, the order page, payments and
-- cancelling work exactly as for members. Contact details live on each order, as they always have.
alter table users add column is_guest boolean not null default false;

alter table users drop constraint users_contact_present;
alter table users add constraint users_contact_present
    check (is_guest or email is not null or phone is not null);
alter table users add constraint users_guest_has_no_login
    check (not is_guest or (email is null and phone is null and password_hash is null));

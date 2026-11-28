-- A photo the owner uploads for a department's card on the home page. While it is empty the card shows the
-- main photo of the department's first piece.
alter table departments
    add column image_url varchar(300),
    add column image_public_id varchar(200);

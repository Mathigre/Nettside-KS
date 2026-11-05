alter table public.orders add column discount_code text;
alter table public.orders add column discount_ore integer not null default 0 check(discount_ore>=0);
alter table public.order_items add column variant_id uuid references product_variants(id) on delete set null;
alter table public.order_items add column variant_name text;
drop function public.create_pending_order(text,text,text,jsonb,integer,text,jsonb);
create function public.create_pending_order(p_customer_name text,p_customer_email text,p_customer_phone text,p_shipping_address jsonb,p_shipping_ore integer,p_payment_provider text,p_items jsonb,p_coupon_code text default null) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare oid uuid; line jsonb; p products%rowtype; v product_variants%rowtype; q integer; price integer; subtotal integer:=0; discount integer:=0; coupon discount_codes%rowtype;
begin
 if p_customer_name is null or length(trim(p_customer_name)) not between 1 and 120 or p_customer_email is null or p_customer_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(p_customer_email)>254 or p_shipping_ore is null or p_shipping_ore<0 or p_payment_provider not in ('stripe','vipps') or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 40 then raise exception 'Invalid checkout'; end if;
 insert into orders(customer_name,customer_email,customer_phone,shipping_address,subtotal_ore,shipping_ore,total_ore,payment_provider) values(trim(p_customer_name),lower(trim(p_customer_email)),p_customer_phone,p_shipping_address,0,p_shipping_ore,p_shipping_ore,p_payment_provider) returning id into oid;
 for line in select value from jsonb_array_elements(p_items) loop
 q:=(line->>'quantity')::integer;if q is null or q not between 1 and 99 then raise exception 'Invalid quantity';end if;
 select * into p from products where id=(line->>'product_id')::uuid and is_published for update;if not found then raise exception 'Product unavailable';end if;
 price:=p.price_ore;v:=null;
 if nullif(line->>'variant_id','') is not null then
 select * into v from product_variants where id=(line->>'variant_id')::uuid and product_id=p.id and is_active for update;
 if not found or v.stock_quantity<q then raise exception 'Variant unavailable';end if;
 price:=coalesce(v.price_ore,p.price_ore);update product_variants set stock_quantity=stock_quantity-q where id=v.id;
 elsif exists(select 1 from product_variants where product_id=p.id and is_active) then raise exception 'Choose variant';
 end if;
 if p.stock_quantity is not null then if p.stock_quantity<q then raise exception 'Not enough stock';end if;update products set stock_quantity=stock_quantity-q,updated_at=now() where id=p.id;end if;
 subtotal:=subtotal+price*q;
 insert into order_items(order_id,product_id,product_name,unit_price_ore,quantity,line_total_ore,variant_id,variant_name) values(oid,p.id,p.name,price,q,price*q,v.id,v.name);
 end loop;
 if nullif(trim(p_coupon_code),'') is not null then
 select * into coupon from discount_codes where code=upper(trim(p_coupon_code)) and is_active and starts_at<=now() and (ends_at is null or ends_at>now());
 if not found then raise exception 'Invalid or expired discount code';end if;
 discount:=floor(subtotal::numeric*coupon.percent_off/100)::integer;
 end if;
 update orders set subtotal_ore=subtotal-discount,total_ore=subtotal-discount+p_shipping_ore,discount_code=coupon.code,discount_ore=discount where id=oid;
 return oid;
end $$;
revoke all on function public.create_pending_order(text,text,text,jsonb,integer,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.create_pending_order(text,text,text,jsonb,integer,text,jsonb,text) to service_role;
create or replace function public.release_pending_order(p_order_id uuid,p_status text default 'failed') returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare o orders%rowtype;
begin
 if p_status not in ('failed','cancelled') then raise exception 'Invalid status';end if;
 select * into o from orders where id=p_order_id for update;if not found or o.payment_status<>'pending' then return false;end if;
 update products p set stock_quantity=p.stock_quantity+x.q from(select product_id,sum(quantity)::integer q from order_items where order_id=p_order_id group by product_id)x where p.id=x.product_id and p.stock_quantity is not null;
 update product_variants v set stock_quantity=v.stock_quantity+x.q from(select variant_id,sum(quantity)::integer q from order_items where order_id=p_order_id and variant_id is not null group by variant_id)x where v.id=x.variant_id;
 update orders set payment_status='failed',fulfillment_status=case when p_status='cancelled' then 'cancelled' else fulfillment_status end,updated_at=now() where id=p_order_id;return true;
end $$;


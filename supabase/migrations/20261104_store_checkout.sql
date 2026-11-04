-- Checkout helpers. Only Supabase's service role can call these functions.
alter table public.orders drop constraint if exists orders_payment_status_check;
alter table public.orders add constraint orders_payment_status_check
  check (payment_status in ('pending', 'authorized', 'paid', 'failed', 'refunded'));

create or replace function public.create_pending_order(
  p_customer_name text,
  p_customer_email text,
  p_customer_phone text,
  p_shipping_address jsonb,
  p_shipping_ore integer,
  p_payment_provider text,
  p_items jsonb
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order_id uuid;
  v_line jsonb;
  v_product public.products%rowtype;
  v_product_id uuid;
  v_quantity integer;
  v_subtotal integer := 0;
begin
  if char_length(trim(p_customer_name)) not between 1 and 120
     or char_length(p_customer_email) > 254
     or p_customer_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or p_shipping_ore < 0
     or p_payment_provider not in ('stripe', 'vipps')
     or jsonb_typeof(p_shipping_address) <> 'object'
     or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) not between 1 and 40 then
    raise exception 'Invalid checkout details';
  end if;
  for v_line in select value from jsonb_array_elements(p_items) loop
    v_product_id := (v_line->>'product_id')::uuid;
    v_quantity := (v_line->>'quantity')::integer;
    if v_quantity not between 1 and 99 then raise exception 'Invalid quantity'; end if;
    select * into v_product from public.products
      where id = v_product_id and is_published = true for update;
    if not found then raise exception 'Product is unavailable'; end if;
    if v_product.stock_quantity is not null and v_product.stock_quantity < v_quantity then
      raise exception 'Not enough stock';
    end if;
    if v_product.stock_quantity is not null then
      update public.products set stock_quantity = stock_quantity - v_quantity, updated_at = now()
        where id = v_product.id;
    end if;
    v_subtotal := v_subtotal + v_product.price_ore * v_quantity;
  end loop;
  insert into public.orders(customer_name, customer_email, customer_phone, shipping_address,
    subtotal_ore, shipping_ore, total_ore, payment_provider)
  values (trim(p_customer_name), lower(trim(p_customer_email)), nullif(trim(p_customer_phone), ''),
    p_shipping_address, v_subtotal, p_shipping_ore, v_subtotal + p_shipping_ore, p_payment_provider)
  returning id into v_order_id;
  insert into public.order_items(order_id, product_id, product_name, unit_price_ore, quantity, line_total_ore)
  select v_order_id, p.id, p.name, p.price_ore, (line->>'quantity')::integer,
    p.price_ore * (line->>'quantity')::integer
  from jsonb_array_elements(p_items) line
  join public.products p on p.id = (line->>'product_id')::uuid;
  return v_order_id;
end;
$$;

create or replace function public.release_pending_order(p_order_id uuid, p_status text default 'failed')
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_order public.orders%rowtype;
begin
  if p_status not in ('failed', 'cancelled') then raise exception 'Invalid release status'; end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.payment_status <> 'pending' then return false; end if;
  update public.products p set stock_quantity = p.stock_quantity + sums.quantity, updated_at = now()
  from (select product_id, sum(quantity)::integer quantity from public.order_items
        where order_id = p_order_id and product_id is not null group by product_id) sums
  where p.id = sums.product_id and p.stock_quantity is not null;
  update public.orders set payment_status = 'failed',
    fulfillment_status = case when p_status = 'cancelled' then 'cancelled' else 'new' end,
    updated_at = now()
    where id = p_order_id;
  return true;
end;
$$;

create or replace function public.set_order_payment_status(p_order_id uuid, p_status text, p_reference text default null)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_order public.orders%rowtype;
begin
  if p_status not in ('authorized', 'paid', 'failed', 'refunded') then raise exception 'Invalid payment status'; end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then return false; end if;
  if v_order.payment_status in ('paid', 'refunded') and p_status in ('authorized', 'failed') then return false; end if;
  if p_status = 'failed' then
    return public.release_pending_order(p_order_id, 'failed');
  end if;
  update public.orders set payment_status = p_status,
    provider_reference = coalesce(p_reference, provider_reference), updated_at = now()
    where id = p_order_id;
  return true;
end;
$$;

revoke all on function public.create_pending_order(text,text,text,jsonb,integer,text,jsonb) from public, anon, authenticated;
revoke all on function public.release_pending_order(uuid,text) from public, anon, authenticated;
revoke all on function public.set_order_payment_status(uuid,text,text) from public, anon, authenticated;
grant execute on function public.create_pending_order(text,text,text,jsonb,integer,text,jsonb) to service_role;
grant execute on function public.release_pending_order(uuid,text) to service_role;
grant execute on function public.set_order_payment_status(uuid,text,text) to service_role;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('store-products', 'store-products', true, 5242880, array['image/jpeg','image/png','image/webp','image/avif'])
on conflict (id) do update set public = true, file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg','image/png','image/webp','image/avif'];
drop policy if exists "Public product image read" on storage.objects;
create policy "Public product image read" on storage.objects for select to anon, authenticated
  using (bucket_id = 'store-products');
drop policy if exists "Store admins upload product images" on storage.objects;
create policy "Store admins upload product images" on storage.objects for insert to authenticated
  with check (bucket_id = 'store-products' and ((select auth.jwt())->'app_metadata'->>'store_admin') = 'true');
drop policy if exists "Store admins update product images" on storage.objects;
create policy "Store admins update product images" on storage.objects for update to authenticated
  using (bucket_id = 'store-products' and ((select auth.jwt())->'app_metadata'->>'store_admin') = 'true')
  with check (bucket_id = 'store-products' and ((select auth.jwt())->'app_metadata'->>'store_admin') = 'true');
drop policy if exists "Store admins delete product images" on storage.objects;
create policy "Store admins delete product images" on storage.objects for delete to authenticated
  using (bucket_id = 'store-products' and ((select auth.jwt())->'app_metadata'->>'store_admin') = 'true');


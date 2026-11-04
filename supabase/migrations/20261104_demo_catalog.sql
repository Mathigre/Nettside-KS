alter table public.products add column if not exists is_demo boolean not null default false;

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
    if not found or v_product.is_demo then raise exception 'Product is unavailable for purchase'; end if;
    if v_product.stock_quantity is not null and v_product.stock_quantity < v_quantity then raise exception 'Not enough stock'; end if;
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

insert into public.categories(name, slug, description, sort_order) values
  ('Til hjemmet', 'til-hjemmet', 'Eksempel på en produktkategori.', 1),
  ('Små gleder', 'sma-gleder', 'Eksempel på en produktkategori.', 2),
  ('Gaver', 'gaver', 'Eksempel på en produktkategori.', 3)
on conflict (slug) do update set name = excluded.name, description = excluded.description, sort_order = excluded.sort_order;

insert into public.products(category_id, name, slug, short_description, description, price_ore, stock_quantity, is_featured, is_published, is_demo)
select c.id, v.name, v.slug, v.short_description, 'Demovare for å vise hvordan produktkort, pris og handlekurv kan se ut. Dette er ikke et reelt produkt.', v.price_ore, v.stock_quantity, v.is_featured, true, true
from (values
  ('Til hjemmet', 'Fargerik vase', 'demo-vase', 'Demovare · plass til sesongens blomster', 49000, 8, true),
  ('Til hjemmet', 'Keramikkopp', 'demo-kopp', 'Demovare · en liten hverdagsfavoritt', 34000, 12, false),
  ('Små gleder', 'Kort med omtanke', 'demo-kort', 'Demovare · en hilsen som får bli', 8500, 25, false),
  ('Gaver', 'Gavekort', 'demo-gavekort', 'Demovare · la mottakeren velge', 25000, null, true)
) as v(category_name, name, slug, short_description, price_ore, stock_quantity, is_featured)
join public.categories c on c.name = v.category_name
on conflict (slug) do update set category_id = excluded.category_id, name = excluded.name,
  short_description = excluded.short_description, description = excluded.description,
  price_ore = excluded.price_ore, stock_quantity = excluded.stock_quantity,
  is_featured = excluded.is_featured, is_published = true, is_demo = true, updated_at = now();

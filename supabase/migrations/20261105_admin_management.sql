alter table public.orders add column if not exists tracking_number text not null default '';
alter table public.orders add column if not exists shipping_carrier text not null default '';
alter table public.orders add column if not exists admin_notes text not null default '';
create table public.product_variants (
 id uuid primary key default gen_random_uuid(), product_id uuid not null references public.products(id) on delete cascade,
 name text not null check(length(trim(name)) between 1 and 100), sku text unique,
 size text not null default '', color text not null default '', stock_quantity integer not null default 0 check(stock_quantity>=0),
 price_ore integer check(price_ore>=0), is_active boolean not null default true, created_at timestamptz not null default now()
);
create index on public.product_variants(product_id);
create table public.order_history (
 id uuid primary key default gen_random_uuid(), order_id uuid not null references public.orders(id) on delete cascade,
 actor_id uuid, event text not null, details jsonb not null default '{}', created_at timestamptz not null default now()
);
create index on public.order_history(order_id,created_at);
create table public.order_returns (
 id uuid primary key default gen_random_uuid(), order_id uuid not null references public.orders(id),
 reason text not null check(length(trim(reason)) between 1 and 2000), status text not null default 'requested' check(status in ('requested','approved','received','rejected','closed')),
 amount_ore integer not null check(amount_ore>0), provider_refund_id text unique, refund_status text not null default 'not_started' check(refund_status in ('not_started','processing','succeeded','failed')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index on public.order_returns(order_id);
create table public.site_content (
 key text primary key, title text not null default '', body text not null default '', updated_at timestamptz not null default now()
);
insert into public.site_content(key,title,body) values
 ('home','Små ting. Stor omtanke.','Velkommen til Hjertekraft – en nettbutikkdemo med rom for gode ideer.'),
 ('about','Begynnelsen på noe fint.','Vi bygger et nytt konsept. Sortiment og virksomhetsopplysninger er foreløpig ikke avklart.'),
 ('contact','Si hei.','Bruk kontaktskjemaet for å sende en melding.'),
 ('terms','Vilkår for demoen','Dette er en testbutikk. Ingen varer leveres og ingen ekte betalinger gjennomføres. Bruk bare testkort.');
create table public.discount_codes (
 id uuid primary key default gen_random_uuid(), code text not null unique check(code=upper(code) and code ~ '^[A-Z0-9_-]{3,40}$'),
 percent_off integer not null check(percent_off between 1 and 100), starts_at timestamptz not null default now(), ends_at timestamptz,
 is_active boolean not null default true, created_at timestamptz not null default now(), check(ends_at is null or ends_at>starts_at)
);
create table public.assistant_knowledge (
 id uuid primary key default gen_random_uuid(), question text not null check(length(trim(question)) between 3 and 250),
 answer text not null check(length(trim(answer)) between 1 and 4000), is_published boolean not null default true, updated_at timestamptz not null default now()
);
do $$ declare t text; begin
 foreach t in array array['product_variants','order_history','order_returns','site_content','discount_codes','assistant_knowledge'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('create policy "Store admin management" on public.%I for all to authenticated using (((select auth.jwt())->''app_metadata''->>''store_admin'')=''true'') with check (((select auth.jwt())->''app_metadata''->>''store_admin'')=''true'')',t);
 execute format('grant all on public.%I to authenticated',t);
 end loop;
end $$;
create policy "Public active variants" on public.product_variants for select to anon,authenticated using(is_active and exists(select 1 from public.products p where p.id=product_id and p.is_published));
create policy "Public content" on public.site_content for select to anon,authenticated using(true);
create policy "Published AI knowledge" on public.assistant_knowledge for select to anon,authenticated using(is_published);
grant select on public.product_variants,public.site_content,public.assistant_knowledge to anon;
create or replace function public.log_order_change() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if tg_op='INSERT' then
 insert into order_history(order_id,actor_id,event,details) values(new.id,auth.uid(),'Ordre opprettet',jsonb_build_object('payment_status',new.payment_status));
 elsif row(new.payment_status,new.fulfillment_status,new.tracking_number,new.shipping_carrier,new.admin_notes) is distinct from row(old.payment_status,old.fulfillment_status,old.tracking_number,old.shipping_carrier,old.admin_notes) then
 insert into order_history(order_id,actor_id,event,details) values(new.id,auth.uid(),'Ordre oppdatert',jsonb_build_object('payment_status',new.payment_status,'fulfillment_status',new.fulfillment_status,'tracking_number',new.tracking_number,'shipping_carrier',new.shipping_carrier));
 end if;
 return new;
end $$;
create trigger order_change_history after insert or update on public.orders for each row execute function public.log_order_change();


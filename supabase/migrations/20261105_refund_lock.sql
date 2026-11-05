create function public.claim_test_refund(p_return_id uuid) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare r order_returns%rowtype; o orders%rowtype; reserved integer;
begin
 select * into r from order_returns where id=p_return_id;if not found then return false;end if;
 select * into o from orders where id=r.order_id for update;
 select * into r from order_returns where id=p_return_id for update;
 if o.payment_status<>'paid' or r.refund_status not in ('not_started','failed') then return false;end if;
 select coalesce(sum(amount_ore),0) into reserved from order_returns where order_id=o.id and id<>r.id and refund_status in ('processing','succeeded');
 if reserved+r.amount_ore>o.total_ore then raise exception 'Refund exceeds paid amount';end if;
 update order_returns set refund_status='processing',updated_at=now() where id=r.id;return true;
end $$;
revoke all on function public.claim_test_refund(uuid) from public,anon,authenticated;
grant execute on function public.claim_test_refund(uuid) to service_role;


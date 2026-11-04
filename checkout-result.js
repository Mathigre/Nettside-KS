import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { STORE_CONFIG } from './config.js';
const db = createClient(STORE_CONFIG.supabaseUrl, STORE_CONFIG.supabasePublishableKey);
const title = document.querySelector('[data-result-title]');
const copy = document.querySelector('[data-result-copy]');
const order = new URLSearchParams(location.search).get('order');
if (!order) { title.textContent = 'Ingen bestilling funnet'; copy.textContent = 'Du kan gå tilbake til butikken når du vil.'; }
else {
  let result;
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data, error } = await db.functions.invoke('payment-status', { body: { order_id: order } });
    if (!error && data) { result = data; if (data.status === 'paid' || data.status === 'authorized' || data.status === 'failed') break; }
    await new Promise(resolve => setTimeout(resolve, 1800));
  }
  if (result?.status === 'paid') { title.textContent = 'Takk for bestillingen!'; copy.textContent = `Betalingen er bekreftet. Ordrenummer #${result.order_number}.`; localStorage.removeItem('hjertekraft-cart-v1'); }
  else if (result?.status === 'authorized') { title.textContent = 'Betalingen er reservert'; copy.textContent = `Vipps har reservert beløpet. Butikken fullfører betalingen når ordren behandles. Ordre #${result.order_number}.`; }
  else if (result?.status === 'failed') { title.textContent = 'Betalingen ble ikke fullført'; copy.textContent = 'Ingen betaling er registrert. Du kan prøve igjen fra handlekurven.'; }
  else { title.textContent = 'Vi venter på bekreftelse'; copy.textContent = 'Betalingsstatusen kan ta litt tid. Ordrenummer vises i admin så snart betalingen er oppdatert.'; }
}


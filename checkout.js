import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { STORE_CONFIG } from './config.js';

const db = createClient(STORE_CONFIG.supabaseUrl, STORE_CONFIG.supabasePublishableKey);
const cartKey = 'hjertekraft-cart-v1';
const demo = {
  'demo-vase': { name: 'Fargerik vase', price_ore: 49000 },
  'demo-cup': { name: 'Keramikkopp', price_ore: 34000 },
  'demo-card': { name: 'Kort med omtanke', price_ore: 8500 },
  'demo-gift': { name: 'Gavekort', price_ore: 25000 },
};
const form = document.querySelector('[data-checkout-form]');
const status = document.querySelector('[data-checkout-status]');
const button = document.querySelector('[data-pay-button]');
const money = value => new Intl.NumberFormat('nb-NO', { style: 'currency', currency: 'NOK', maximumFractionDigits: 0 }).format(value / 100);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
let rows = [];
let demoMode = true;

async function loadCart() {
  const lines = JSON.parse(localStorage.getItem(cartKey) || '[]').filter(line => line && typeof line.id === 'string' && Number.isInteger(line.quantity) && line.quantity > 0 && line.quantity <= 99);
  const items = document.querySelector('[data-checkout-items]');
  if (!lines.length) { items.innerHTML = '<p>Handlekurven er tom. <a href="shop.html">Gå til butikken</a>.</p>'; button.disabled = true; document.querySelector('[data-checkout-total]').textContent = money(0); return; }
  demoMode = lines.some(line => line.id.startsWith('demo-'));
  if (demoMode) rows = lines.filter(line => demo[line.id]).map(line => ({ ...line, ...demo[line.id] }));
  else {
    const { data, error } = await db.from('products').select('id,name,price_ore,is_published,is_demo').in('id', lines.map(line => line.id));
    if (error || !data || data.length !== lines.length || data.some(item => !item.is_published)) throw new Error('Kunne ikke hente produktene i handlekurven.');
    demoMode = data.some(item => item.is_demo);
    rows = lines.map(line => ({ ...line, ...data.find(item => item.id === line.id) }));
  }
  const total = rows.reduce((sum, row) => sum + row.price_ore * row.quantity, 0);
  items.innerHTML = rows.map(row => `<div class="summary-item"><span>${escapeHtml(row.name)} <small>× ${row.quantity}</small></span><strong>${money(row.price_ore * row.quantity)}</strong></div>`).join('');
  document.querySelector('[data-checkout-total]').textContent = money(total);
  if (demoMode) { document.querySelector('[data-demo-notice]').hidden = false; button.textContent = 'Demo: ingen betaling'; }
  else document.querySelector('[data-demo-notice]').hidden = true;
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!form.reportValidity() || button.disabled) return;
  if (demoMode) { status.textContent = 'Dette er eksempelvarer. Bytt dem ut med ekte varer i admin før testbetaling aktiveres.'; return; }
  button.disabled = true; status.textContent = 'Oppretter sikker betaling …';
  const values = new FormData(form);
  const { data, error } = await db.functions.invoke('create-checkout', {
    body: {
      provider: values.get('provider'),
      customer: { name: values.get('name'), email: values.get('email'), phone: values.get('phone') || null },
      shipping: { address: values.get('address'), postal_code: values.get('postal_code'), city: values.get('city'), country: 'NO' },
      items: rows.map(row => ({ product_id: row.id, quantity: row.quantity })),
    },
  });
  if (error || !data?.url) { button.disabled = false; status.textContent = data?.error || 'Betaling er ikke aktivert ennå. Kontakt oss hvis dette er en testbestilling.'; return; }
  location.assign(data.url);
});
loadCart().catch(error => { document.querySelector('[data-checkout-items]').textContent = error.message; button.disabled = true; });

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { STORE_CONFIG } from '../config.js';

const db = createClient(STORE_CONFIG.supabaseUrl, STORE_CONFIG.supabasePublishableKey);
const loginView = document.querySelector('[data-login-view]');
const adminView = document.querySelector('[data-admin-view]');
const loginForm = document.querySelector('[data-login-form]');
const signoutButton = document.querySelector('[data-signout]');
const loginStatus = document.querySelector('[data-login-status]');
const productForm = document.querySelector('[data-product-form]');
const productStatus = document.querySelector('[data-product-status]');

function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }
function isStoreAdmin(user) { return user?.app_metadata?.store_admin === true || user?.app_metadata?.store_admin === 'true'; }
function slugify(value) { return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/æ/g,'ae').replace(/ø/g,'o').replace(/å/g,'a').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''); }
async function showSession(session) {
  const user = session?.user;
  if (!user) { loginView.hidden = false; adminView.hidden = true; signoutButton.hidden = true; return; }
  if (!isStoreAdmin(user)) { loginView.hidden = false; adminView.hidden = true; signoutButton.hidden = false; loginStatus.textContent = 'Denne kontoen har ikke administratortilgang. Be prosjektansvarlig gi kontoen store_admin-tilgang i Supabase Auth app_metadata.'; return; }
  loginView.hidden = true; adminView.hidden = false; signoutButton.hidden = false;
  adminView.querySelector('[data-admin-email]').textContent = user.email || '';
  await Promise.all([loadProducts(), loadCategories(), loadMessages(), loadOrders()]);
}
async function loadCategories() {
  const { data, error } = await db.from('categories').select('id,name,slug,sort_order').order('sort_order');
  if (error) return;
  const options = '<option value="">Ingen kategori</option>' + data.map(row => `<option value="${row.id}">${escapeHtml(row.name)}</option>`).join('');
  productForm.elements.category_id.innerHTML = options;
  document.querySelector('[data-category-list]').innerHTML = data.length ? data.map(row => `<div class="admin-row"><div><strong>${escapeHtml(row.name)}</strong><small>/${escapeHtml(row.slug)}</small></div></div>`).join('') : '<p>Ingen kategorier lagt til ennå.</p>';
}
async function loadProducts() {
  const list = document.querySelector('[data-product-list]');
  const { data, error } = await db.from('products').select('id,name,price_ore,is_published,stock_quantity').order('created_at', { ascending: false });
  if (error) { list.innerHTML = '<p>Kunne ikke hente produkter.</p>'; return; }
  list.innerHTML = data.length ? data.map(row => `<div class="admin-row"><div><strong>${escapeHtml(row.name)}</strong><small>${new Intl.NumberFormat('nb-NO').format(row.price_ore / 100)} kr · ${row.is_published ? 'Synlig' : 'Skjult'} · ${row.stock_quantity === null ? 'Lager ikke angitt' : `${row.stock_quantity} på lager`}</small></div><span class="admin-row-actions"><button data-edit-product="${row.id}">Rediger</button><button data-delete-product="${row.id}">Slett</button></span></div>`).join('') : '<p>Ingen produkter ennå. Legg til det første når dere har valgt hva som skal selges.</p>';
}
async function openProduct(id = '') {
  productForm.hidden = false; productStatus.textContent = ''; productForm.reset(); productForm.elements.id.value = id;
  if (!id) { productForm.elements.is_published.checked = false; return; }
  const { data, error } = await db.from('products').select('*').eq('id', id).single();
  if (error || !data) { productStatus.textContent = 'Kunne ikke åpne produktet.'; return; }
  for (const field of ['name','short_description','description','category_id']) productForm.elements[field].value = data[field] || '';
  productForm.elements.price.value = (data.price_ore / 100).toFixed(0);
  productForm.elements.stock.value = data.stock_quantity ?? '';
  productForm.elements.images.value = (data.images || []).join('\n');
  productForm.elements.is_featured.checked = data.is_featured;
  productForm.elements.is_published.checked = data.is_published;
}
async function loadMessages() {
  const list = document.querySelector('[data-message-list]');
  const { data, error } = await db.from('contact_messages').select('id,name,email,phone,message,status,created_at').order('created_at', { ascending: false }).limit(100);
  if (error) { list.innerHTML = '<p>Kunne ikke hente meldingene.</p>'; return; }
  list.innerHTML = data.length ? data.map(row => `<article class="admin-row"><div><strong>${escapeHtml(row.name)} · ${escapeHtml(row.email)}</strong><small>${new Date(row.created_at).toLocaleString('nb-NO')} · ${escapeHtml(row.phone || 'Telefon ikke oppgitt')}</small><p>${escapeHtml(row.message)}</p></div><select data-message-status="${row.id}" aria-label="Meldingsstatus"><option value="new" ${row.status==='new'?'selected':''}>Ny</option><option value="read" ${row.status==='read'?'selected':''}>Lest</option><option value="replied" ${row.status==='replied'?'selected':''}>Besvart</option><option value="archived" ${row.status==='archived'?'selected':''}>Arkivert</option></select></article>`).join('') : '<p>Ingen meldinger ennå.</p>';
}
async function loadOrders() {
  const list = document.querySelector('[data-order-list]');
  const { data, error } = await db.from('orders').select('id,order_number,customer_name,customer_email,total_ore,payment_provider,payment_status,fulfillment_status,created_at').order('created_at', { ascending: false }).limit(100);
  if (error) { list.innerHTML = '<p>Betaling og bestillinger aktiveres i neste steg.</p>'; return; }
  const paymentLabel = { pending: 'Venter på betaling', authorized: 'Reservert', paid: 'Betalt', failed: 'Feilet', refunded: 'Refundert' };
  list.innerHTML = data.length ? data.map(row => `<div class="admin-row"><div><strong>#${row.order_number} · ${escapeHtml(row.customer_name)}</strong><small>${escapeHtml(row.customer_email)} · ${new Intl.NumberFormat('nb-NO').format(row.total_ore / 100)} kr · ${paymentLabel[row.payment_status] || escapeHtml(row.payment_status)} · ${new Date(row.created_at).toLocaleDateString('nb-NO')}</small></div><span class="admin-row-actions">${row.payment_provider === 'vipps' && row.payment_status === 'authorized' ? `<button data-capture-vipps="${row.id}">Trekk Vipps-beløp</button>` : ''}<select data-order-status="${row.id}" aria-label="Bestillingsstatus"><option value="new" ${row.fulfillment_status==='new'?'selected':''}>Ny</option><option value="processing" ${row.fulfillment_status==='processing'?'selected':''}>Behandles</option><option value="sent" ${row.fulfillment_status==='sent'?'selected':''}>Sendt</option><option value="completed" ${row.fulfillment_status==='completed'?'selected':''}>Fullført</option><option value="cancelled" ${row.fulfillment_status==='cancelled'?'selected':''}>Avbrutt</option></select></span></div>`).join('') : '<p>Ingen bestillinger ennå.</p>';
}

loginForm.addEventListener('submit', async event => {
  event.preventDefault(); loginStatus.textContent = 'Logger inn …';
  const values = new FormData(loginForm);
  const { data, error } = await db.auth.signInWithPassword({ email: values.get('email'), password: values.get('password') });
  if (error) { loginStatus.textContent = 'Innloggingen gikk ikke. Kontroller e-post og passord.'; return; }
  await showSession(data.session);
});
signoutButton.addEventListener('click', async () => { await db.auth.signOut(); loginStatus.textContent = ''; await showSession(null); });
document.querySelector('[data-new-product]').addEventListener('click', () => openProduct());
document.querySelector('[data-cancel-product]').addEventListener('click', () => { productForm.hidden = true; });
document.querySelector('[data-product-list]').addEventListener('click', async event => {
  const edit = event.target.closest('[data-edit-product]');
  if (edit) { await openProduct(edit.dataset.editProduct); return; }
  const remove = event.target.closest('[data-delete-product]');
  if (!remove || !confirm('Slette produktet fra butikken?')) return;
  const { error } = await db.from('products').delete().eq('id', remove.dataset.deleteProduct);
  if (error) { alert('Produktet kunne ikke slettes. Det kan være knyttet til en bestilling.'); return; }
  await loadProducts();
});
productForm.addEventListener('submit', async event => {
  event.preventDefault(); const values = new FormData(productForm); productStatus.textContent = 'Lagrer …';
  const name = String(values.get('name')).trim();
  const slugBase = slugify(name);
  if (!slugBase) { productStatus.textContent = 'Skriv inn et produktnavn.'; return; }
  const stockText = String(values.get('stock') || '').trim();
  const price = Number(values.get('price'));
  const stock = stockText ? Number(stockText) : null;
  if (!Number.isFinite(price) || price < 0 || (stock !== null && (!Number.isInteger(stock) || stock < 0))) { productStatus.textContent = 'Sjekk pris og lagerantall.'; return; }
  const imageUrls = String(values.get('images') || '').split(/\r?\n/).map(url => url.trim()).filter(Boolean);
  const file = values.get('image_file');
  if (file instanceof File && file.size) {
    if (!['image/jpeg','image/png','image/webp','image/avif'].includes(file.type) || file.size > 5 * 1024 * 1024) { productStatus.textContent = 'Bildet må være JPG, PNG, WebP eller AVIF og maks 5 MB.'; return; }
    productStatus.textContent = 'Laster opp bilde …';
    const extension = file.type === 'image/jpeg' ? 'jpg' : file.type.split('/')[1];
    const path = `${crypto.randomUUID()}.${extension}`;
    const { error: uploadError } = await db.storage.from('store-products').upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type });
    if (uploadError) { productStatus.textContent = 'Bildet kunne ikke lastes opp. Kontroller at Storage er satt opp.'; return; }
    imageUrls.unshift(db.storage.from('store-products').getPublicUrl(path).data.publicUrl);
  }
  const record = { name, slug: slugBase, short_description: String(values.get('short_description') || '').trim(), description: String(values.get('description') || '').trim(), category_id: values.get('category_id') || null, price_ore: Math.round(price * 100), stock_quantity: stock, images: imageUrls, is_featured: values.has('is_featured'), is_published: values.has('is_published'), updated_at: new Date().toISOString() };
  const id = String(values.get('id') || '');
  const result = id ? await db.from('products').update(record).eq('id', id) : await db.from('products').insert(record);
  if (result.error) { productStatus.textContent = result.error.code === '23505' ? 'Det finnes allerede et produkt med dette navnet.' : 'Produktet kunne ikke lagres. Kontroller feltene og prøv igjen.'; return; }
  productStatus.textContent = 'Produktet er lagret.'; await loadProducts(); setTimeout(() => { productForm.hidden = true; }, 700);
});
document.querySelector('[data-category-form]').addEventListener('submit', async event => {
  event.preventDefault(); const form = event.currentTarget; const name = String(new FormData(form).get('name')).trim();
  const { error } = await db.from('categories').insert({ name, slug: slugify(name) });
  if (error) { alert('Kategorien kunne ikke lagres. Sjekk at navnet ikke finnes fra før.'); return; }
  form.reset(); await loadCategories();
});
document.querySelector('[data-message-list]').addEventListener('change', async event => {
  const select = event.target.closest('[data-message-status]'); if (!select) return;
  await db.from('contact_messages').update({ status: select.value }).eq('id', select.dataset.messageStatus);
});
document.querySelector('[data-order-list]').addEventListener('change', async event => {
  const select = event.target.closest('[data-order-status]'); if (!select) return;
  await db.from('orders').update({ fulfillment_status: select.value, updated_at: new Date().toISOString() }).eq('id', select.dataset.orderStatus);
});
document.querySelector('[data-order-list]').addEventListener('click', async event => {
  const button = event.target.closest('[data-capture-vipps]'); if (!button) return;
  button.disabled = true; button.textContent = 'Trekker …';
  const { data, error } = await db.functions.invoke('capture-vipps-payment', { body: { order_id: button.dataset.captureVipps } });
  if (error || !data?.ok) { alert(data?.error || 'Vipps-betalingen kunne ikke trekkes.'); button.disabled = false; button.textContent = 'Trekk Vipps-beløp'; return; }
  await loadOrders();
});
document.querySelector('.admin-tabs').addEventListener('click', event => {
  const tab = event.target.closest('[data-tab]'); if (!tab) return;
  document.querySelectorAll('.admin-tab').forEach(item => item.classList.toggle('is-selected', item === tab));
  document.querySelectorAll('[data-panel]').forEach(panel => { panel.hidden = panel.dataset.panel !== tab.dataset.tab; });
});
document.querySelectorAll('[data-refresh]').forEach(button => button.addEventListener('click', () => button.dataset.refresh === 'orders' ? loadOrders() : loadMessages()));
db.auth.getSession().then(({ data }) => showSession(data.session));
db.auth.onAuthStateChange((_event, session) => { if (!session) showSession(null); });


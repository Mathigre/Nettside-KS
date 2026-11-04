import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { STORE_CONFIG } from './config.js';

const form = document.querySelector('#contact-form');
if (form) {
  const db = createClient(STORE_CONFIG.supabaseUrl, STORE_CONFIG.supabasePublishableKey);
  const status = form.querySelector('[data-form-status]');
  const button = form.querySelector('button[type="submit"]');
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!form.reportValidity() || button.disabled) return;
    const values = new FormData(form);
    if (String(values.get('website') || '').trim()) { status.textContent = 'Takk! Meldingen er mottatt.'; form.reset(); return; }
    button.disabled = true; status.textContent = 'Sender meldingen …';
    const { error } = await db.from('contact_messages').insert({
      name: String(values.get('name')).trim(), email: String(values.get('email')).trim(),
      phone: String(values.get('phone') || '').trim() || null, message: String(values.get('message')).trim(), consent: true,
    });
    button.disabled = false;
    if (error) { status.textContent = 'Meldingen kunne ikke sendes akkurat nå. Prøv igjen senere.'; return; }
    form.reset(); status.textContent = 'Takk — meldingen er sendt. Vi tar kontakt så snart vi kan.';
  });
}

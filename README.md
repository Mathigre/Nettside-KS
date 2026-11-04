# Hjertekraft nettbutikkdemo

Responsiv nettbutikkdemo for konseptet Hjertekraft. Sortiment og priser som vises når produktkatalogen er tom, er eksempler og kan ikke kjøpes. Virksomhetens endelige navn, produkter, vilkår og kontaktinformasjon må fylles inn før salg.

## Sider

- Forside, butikk med søk og kategorifilter, om oss, kontakt og personvern.
- Handlekurv, kasse og betalingsstatus.
- Admin for produkter, bildeopplasting, kategorier, kontaktmeldinger og ordre.
- Chat-widget koblet til en Supabase Edge Function.

## Teknologi

Statisk HTML/CSS/JavaScript er publisert på Sites: https://hjertekraft-nettbutikk.minsten-mg.chatgpt.site. Kildekoden vedlikeholdes på GitHub. Supabase leverer Auth, Postgres, Storage og Edge Functions. `config.js` inneholder bare den offentlige Supabase URL-en og publishable key. Ingen servernøkler skal legges i repoet eller nettleseren.

## Supabase-oppsett

Databasen `Nettside KS` har RLS aktivert på katalog, ordre og kontaktmeldinger. Migrasjonene finnes under `supabase/migrations/` og Edge Function-koden under `supabase/functions/`.

Sett Supabase Authentication → URL Configuration til nettbutikkens publiserte adresse (`https://hjertekraft-nettbutikk.minsten-mg.chatgpt.site`) og legg til samme URL som tillatt redirect før passordtilbakestilling eller e-postbasert innlogging tas i bruk. Adminpassord opprettes og beholdes i Supabase Auth.

Legg inn secrets i Supabase Dashboard → Project Settings → Edge Functions → Secrets:

| Secret | Bruk |
| --- | --- |
| `STORE_BASE_URL` | Offentlig butikk-URL uten avsluttende skråstrek |
| `CHECKOUT_ENABLED` | `true` kun når testkontoer og vilkår er klare; ellers `false` |
| `CHECKOUT_MODE` | `test` for denne demoen |
| `SHIPPING_FLAT_ORE` | Fast frakt i øre; `0` betyr gratis testfrakt |
| `STRIPE_SECRET_KEY` | Stripe test secret key (`sk_test_…`) |
| `STRIPE_WEBHOOK_SECRET` | Signeringshemmelighet fra Stripe webhook |
| `VIPPS_CLIENT_ID` | Vipps test Client ID |
| `VIPPS_CLIENT_SECRET` | Vipps test Client secret |
| `VIPPS_SUBSCRIPTION_KEY` | Vipps test subscription key |
| `VIPPS_MSN` | Vipps test Merchant Serial Number |
| `VIPPS_API_URL` | `https://apitest.vipps.no` i test |
| `OPENAI_API_KEY` | Nøkkel for butikkassistenten |
| `OPENAI_MODEL` | Valgfritt; standard er `gpt-6-luna` |

Supabase gir Edge Functions `SUPABASE_URL` og `SUPABASE_SERVICE_ROLE_KEY` automatisk. Ikke opprett egne verdier eller del dem.

### Stripe webhook

Webhook URL: `https://wbaimqglirrtlhfehgev.supabase.co/functions/v1/payment-webhook`

Abonner på `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_succeeded` og `checkout.session.async_payment_failed`. Legg webhookens `whsec_…` i `STRIPE_WEBHOOK_SECRET`.

### Første adminbruker

1. Opprett butikkens bruker under Supabase Dashboard → Authentication → Users.
2. I SQL Editor, gi adminrollen kun til brukerens e-postadresse:

```sql
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"store_admin": true}'::jsonb
where email = 'ADMINENS-EPOST';
```

3. Logg ut og inn på `/admin/` igjen slik at den nye rollen kommer med i tokenet.

### Stripe testmodus

Bruk bare Stripe-nøkler med `sk_test_` i denne demoen. Kassen oppretter ordren på serversiden, beregner pris fra Supabase-katalogen, og Stripe webhook bekrefter betaling. Vipps godkjenner først beløpet; admin kan deretter trekke reservasjonen fra ordrelisten. Eksempelvarer merket «Demovare» kan aldri kjøpes.

## Publisering

Den offentlige demoen er publisert på Sites. GitHub Pages-workflowen ligger også i repoet, men krever at Pages er aktivert i GitHub-innstillingene. Aktiv demo-URL er `https://hjertekraft-nettbutikk.minsten-mg.chatgpt.site`.


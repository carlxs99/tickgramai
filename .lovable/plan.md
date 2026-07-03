# Ultra Gram Miner — Plan

Clone funcional del bot tipo CakeMinerBot, adaptado como **Telegram Mini App** con backend real en Lovable Cloud. Nombre: **Ultra Gram Miner**, token: **Gram**.

## Alcance de esta versión

5 pantallas con navegación inferior fija (Mining / Tasks / Friends / Deposit / Withdraw), autenticación por Telegram `initData`, balance y velocidad de minado persistentes, referidos y tareas diarias funcionales. **Sin pagos TON reales** en esta iteración (los depósitos/retiros se registran como solicitudes pendientes; se puede añadir TON Connect después).

## Pantallas

1. **Mining** — Ingreso acumulado (se incrementa en vivo según `mining_rate`), botón "Collect income" (mín 0.1 Gram), botones Increase speed / Withdraw income, ranking Top miners.
2. **Tasks** — Daily tasks (Just check in, Share with Friends, Check for Updates, Deposit X+ Gram) con estado Completed/Pending y Partner Tasks (placeholder, sin creación real de tasks pagados en v1).
3. **Friends** — Contador de referidos, botones Invite / Copy (usa `t.me/<bot>?start=ref_<user_id>`), Friends Rewards con Claim (mín 1 Gram), lista de bonuses por # de amigos.
4. **Deposit** — Estado "TON Wallet: Not connected" + botón Connect (stub), formulario Deposit amount con cálculo "+X Gram per day", sección Reinvest que consume balance para subir mining rate.
5. **Withdraw** — Formulario con Amount, Address (Gram~Ton), Tag/memo, muestra Amount to be received (15% + 0.1 Gram fee), Payment history.

Header sticky con logo Ultra Gram Miner, chip de balance (0.0140 💎) y avatar. Tab bar inferior fija con 5 iconos (lucide-react).

## Diseño

Tema **dark premium**, tipografía Inter (bold para títulos), acentos:
- Background `oklch(0.14 0.02 265)` casi negro
- Cards `oklch(0.19 0.02 265)` con borde sutil `oklch(1 0 0 / 6%)`
- Primary púrpura suave `oklch(0.68 0.14 275)` (botones Deposit/Withdraw)
- Success verde `oklch(0.72 0.17 155)` (Increase speed / Completed)
- Token accent cian `oklch(0.72 0.14 230)` para el diamante 💎
- Radios grandes (rounded-2xl / rounded-full para botones)

Animaciones sutiles con framer-motion: contador de ingreso tickeando, tap feedback en botones.

## Backend (Lovable Cloud)

Tablas:
- `profiles` (user_id PK → auth.users, telegram_id, username, first_name, avatar_url, balance numeric, mining_rate numeric default 0, deposit_total numeric, last_collect_at timestamptz, referred_by uuid, referral_code text, created_at)
- `user_roles` (id, user_id, role enum: admin/user) + `has_role()` security definer
- `tasks` (id, code text unique, title, reward numeric, kind enum: daily/one_off, is_active) — seed con las 4 daily tasks
- `user_tasks` (id, user_id, task_id, completed_at) — unique (user_id, task_id, date) para daily
- `deposits` (id, user_id, amount_ton numeric, gram_per_day numeric, status enum: pending/confirmed, tx_hash, created_at)
- `withdrawals` (id, user_id, amount_gram, address, memo, fee, net_amount, status enum: pending/completed, created_at)
- `referrals` (id, referrer_id, referred_id unique, bonus_paid numeric)

RLS: cada usuario solo ve/edita lo suyo. `GRANT`s explícitos a `authenticated` y `service_role` en cada tabla del schema public.

Server functions (`createServerFn`, `.middleware([requireSupabaseAuth])`):
- `getMe` — perfil + balance calculado (balance + mining_rate * horas desde last_collect_at)
- `collectIncome` — mueve ingreso acumulado a balance
- `completeTask({ code })` — marca daily task y suma reward al balance
- `submitDeposit({ amount_ton })` — crea deposit pending y aumenta mining_rate (v1: aprobación instantánea simulada; después TON Connect real)
- `reinvest({ amount_gram })` — resta del balance y sube mining_rate
- `submitWithdrawal({ amount, address, memo })` — valida balance, crea withdrawal pending
- `getTopMiners` — top 10 por profit_24h
- `getFriends` — lista de referidos + total ganado
- `claimReferralRewards`

Server route público:
- `/api/public/telegram/webhook` — recibe updates del bot (comando `/start ref_<id>` para atribuir referidos, `/start` para enlace a la Mini App).

## Integración Telegram

- Cargar `https://telegram.org/js/telegram-web-app.js` en `__root.tsx` (link tag).
- Al montar, leer `window.Telegram.WebApp.initData` y llamar `serverFn: telegramLogin({ initData })` que:
  1. Valida HMAC-SHA256 con `TELEGRAM_BOT_TOKEN` (secreto).
  2. Extrae `user.id`, `first_name`, `username`, `photo_url`, `start_param` (para ref).
  3. Con `supabaseAdmin` hace upsert en `profiles` y crea/obtiene un usuario en `auth.users` (email sintético `tg_<id>@ultragram.local`), devuelve un access token vía `admin.generateLink` o `signInWithPassword` con contraseña derivada — usaremos `admin.createUser` + `signInWithPassword` con password determinística basada en HMAC del bot token + telegram_id (secreto server-side).
  4. Devuelve `{ access_token, refresh_token }` al cliente, que llama `supabase.auth.setSession(...)`.
- Si `window.Telegram` no existe (navegador normal), mostrar un modal "Abrir en Telegram" con QR/link al bot.

Telegram como connector: preferimos conectar el bot vía `standard_connectors--connect` (conector Telegram) para obtener `TELEGRAM_API_KEY` en el gateway y usarlo para `setWebhook`, `sendMessage`, `answerCallbackQuery`. El **bot token crudo** para validar `initData` se guarda aparte como secreto `TELEGRAM_BOT_TOKEN` (no lo maneja el gateway).

## Secretos necesarios

- `TELEGRAM_BOT_TOKEN` — te pido pegarlo con `add_secret` (lo obtienes de @BotFather → `/newbot`, luego "API Token").
- `TELEGRAM_API_KEY` — se linkea automáticamente al conectar el conector Telegram (para llamadas al gateway).
- `LOVABLE_API_KEY` — ya provisionado.

## Detalles técnicos

- Botón "Connect TON Wallet" queda como stub (abre modal "Próximamente"). Depósitos v1 suman `mining_rate` inmediatamente al enviar el form (para poder demostrar el flujo); marcado como MOCK en el código para reemplazar con verificación TON Connect después.
- Cálculo de ingreso acumulado en cliente con `setInterval` + `last_collect_at`; el servidor recalcula al hacer collect para prevenir cheating.
- Fee de retiro: `max(amount * 0.15 + 0.1, 0.1)`, coincidiendo con la captura.
- Referral bonus: 10% del `amount_ton` del depósito del referido, se acredita a `referrer.balance` (via server fn en `submitDeposit`).

## Fuera de alcance (siguiente iteración)

- TON Connect real (@tonconnect/ui-react) y verificación on-chain de depósitos/retiros.
- Panel admin para aprobar retiros manualmente.
- Partner Tasks reales pagados en TON.
- i18n (por ahora inglés como el bot original; te pregunto al final si quieres español).

## Orden de implementación

1. Habilitar Lovable Cloud.
2. Conectar conector Telegram + pedirte el `TELEGRAM_BOT_TOKEN`.
3. Migración DB (tablas + RLS + grants + seed de tasks) + design tokens en `styles.css`.
4. Server functions + `/api/public/telegram/webhook` + `telegramLogin`.
5. Layout con tab bar + 5 rutas bajo `_authenticated/`.
6. Ruta pública `/` = pantalla "Abrir en Telegram" cuando no hay initData.
7. Registrar webhook con `setWebhook` desde el sandbox.
8. Verificar flujo end-to-end (login por initData mockeado en dev + un colector real).

¿Apruebas el plan? Si quieres cambiar algo (ej. incluir TON Connect real ya, cambiar el nombre del token, idioma español), dime antes de empezar.
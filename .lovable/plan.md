# Dynamic Mining v2 — Presupuesto de pagos dinámico (una sola moneda: GRAM)

Sustituye el ROI fijo del 3.3% diario por un reparto diario proporcional al **hashrate** de cada usuario, financiado únicamente por los ingresos reales del día más una reserva estabilizadora. Con esto el sistema nunca puede quedarse sin fondos: si un día entra menos, todos cobran menos, pero todos cobran.

## Cómo lo vive el usuario

- Su depósito ya no compra "3.3% diario", compra **mining power (hashrate)** que dura 180 días y decae poco a poco.
- En la pantalla principal ve: su hashrate, su cuota de la red (%), lo que ganó ayer y un **APY estimado (media 7 días)** — nunca una promesa fija.
- Cada día, a una hora fija, se reparte el pool y su balance sube automáticamente.

## Fórmula

```
Pool_diario = Ingresos_reales_del_día × payout_ratio  +  Reserva_liberada
Pago_usuario = Pool_diario × (hashrate_usuario / hashrate_total_activo)
```

- `payout_ratio` por defecto 0.65 (20% a reserva, 15% beneficio de la banca).
- Suavizado: el pool nunca baja del 70% ni sube del 130% de la media de los últimos 7 días; la diferencia sale de / entra en la reserva.
- Freno de solvencia: si `Tesoro / Deuda_retirable < 1.2`, el `payout_ratio` se recorta automáticamente al 40%.

## Fuentes de ingreso que alimentan el pool

Todo evento de ingreso se registra en una tabla única `revenue_events`:

| Fuente | Cómo entra |
|---|---|
| Publicidad (AdSense/interstitial) | importe diario introducido por el admin o vía cron |
| Fees de retiro | automático al procesar un retiro |
| Partner tasks pagadas | automático al activarse la task |
| Rake de ruleta / cofres de pago | automático |
| Subastas de hashrate | automático |
| Rendimiento on-chain del tesoro (staking TON) | entrada manual/cron |
| Aporte del operador (bootstrap) | entrada manual del admin |

## Sinks (lo que vuelve al tesoro)

- Ruleta y cofres extra comprados con balance (rake 10%).
- Subastas de hashrate: se puja con balance, el GRAM pujado va íntegro al tesoro.
- Boosts temporales y slots de referido premium.
- Fee de retiro escalonado.

## Hashrate

- Comprado con depósito: `hashrate = usd_depositado × 100` puntos, `expires_at = +180 días`, decaimiento lineal 1/180 diario.
- Otros orígenes (ruleta, cofres, bonus de referido $0.10) generan grants de hashrate con la misma mecánica y su propia duración.
- El hashrate total activo se recalcula en el cron diario.

## Cambios técnicos

Tablas nuevas:
- `revenue_events` (source, amount_usd, occurred_at, note, created_by) — registro de ingresos.
- `hashrate_grants` (user_id, points, source, source_ref_id, starts_at, expires_at, decay_per_day, active) — reemplaza conceptualmente `mining_rate_usd`.
- `payout_pool_daily` (day, revenue_usd, payout_ratio, pool_usd, reserve_delta, total_hashrate, paid_usd, status) — un registro por día.
- `payout_entries` (day, user_id, hashrate, share, amount_gram, amount_usd) — auditoría por usuario.
- `treasury_ledger` (direction, amount_usd, reason, ref) — saldo del tesoro y reserva.

Funciones SQL:
- `add_revenue_event(...)`, `grant_hashrate(...)`, `user_active_hashrate(uuid)`, `network_active_hashrate()`.
- `run_daily_payout(_day date, _gram_price numeric)` — idempotente por día: calcula el pool, aplica suavizado y freno de solvencia, inserta `payout_entries` por lotes y acredita balances de forma atómica.

Endpoint y cron:
- `src/routes/api/public/hooks/daily-payout.ts` — worker resumable (mismo patrón que los broadcasts, por lotes con `progress`) protegido por `CRON_SECRET`, invocado por pg_cron una vez al día.
- Los fees de retiro y el rake de la ruleta insertan automáticamente en `revenue_events`.

Frontend:
- Nueva tarjeta "Network Mining" en la home: hashrate propio, cuota de la red, pago de ayer, APY estimado 7 días.
- Deposit muestra "≈ X pts de hashrate · duración 180 días" en vez de "3.3% diario".
- Admin panel: pestaña **Economy** con ingresos del día, pool, ratio de solvencia, historial de pagos y formulario para registrar ingresos manuales (publicidad, staking, aporte del operador).

## Migración desde el modelo actual

1. Convertir el `mining_rate_usd` actual de cada usuario en hashrate equivalente: `points = mining_rate_usd / 0.033 × 100`, con `expires_at` a 180 días desde hoy.
2. Mantener `mining_rate_usd` en la base de datos como campo legado (solo lectura) durante la transición para no romper nada.
3. Feature flag `ECONOMY_V2`: mientras esté apagado, todo sigue igual; al encenderlo, el cron diario pasa a ser la única fuente de ingresos del usuario y el acumulador en vivo del 3.3% se apaga.
4. Broadcast en inglés anunciando "Dynamic Mining v2" con explicación y bonus de hashrate de cortesía para los usuarios existentes.

## Orden de implementación

1. Migración SQL (tablas + grants + RLS + funciones).
2. Backfill de hashrate desde `mining_rate_usd` + `treasury_ledger` inicial.
3. Endpoint de payout diario + cron + hooks de ingresos automáticos.
4. Admin: pestaña Economy.
5. Frontend usuario: tarjeta Network Mining + textos del depósito.
6. Encender el flag y broadcast.

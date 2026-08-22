# Dynamic Mining v2 — Presupuesto de pagos dinámico (versión reducida)

Sustituye el ROI fijo del 3.3% diario por un reparto diario proporcional al **hashrate** de cada usuario, financiado solo por los ingresos reales que hoy sí existen en Tickgram, más una reserva estabilizadora.

Fuera de esta versión (no se implementa): subastas, publicidad AdSense como ingreso contable, staking TON, boosts temporales y slots de referido premium.

## Sobre el saldo de la wallet — sí, se tiene en cuenta

El saldo real de la hot wallet TON es el **Tesoro**. Se usa de dos formas:

- Se lee on-chain una vez al día (mismo endpoint que ya usamos para verificar depósitos) y se guarda como `treasury_balance_ton` del día.
- **Freno de solvencia:** si `Tesoro / Deuda_retirable (suma de balances de usuarios) < 1.2`, el `payout_ratio` baja automáticamente al 40%; si baja de 1.0, al 20%. Así nunca se paga más de lo que la wallet puede respaldar.

El saldo de la wallet **no** se reparte como pool: el pool sale de los ingresos del día. La wallet solo actúa como respaldo y límite.

## Fórmula

```
Pool_diario = Ingresos_reales_del_día × payout_ratio + Reserva_liberada
Pago_usuario = Pool_diario × (hashrate_usuario / hashrate_total_activo)
```

- `payout_ratio` por defecto 0.65 (20% reserva, 15% beneficio de la banca).
- Suavizado: el pool nunca baja del 70% ni sube del 130% de la media de 7 días; la diferencia sale de / entra en la reserva.
- Freno de solvencia según el saldo real de la wallet (arriba).

## Ingresos que alimentan el pool (solo lo ya configurado)

| Fuente | Cómo entra |
|---|---|
| Depósitos de usuarios (parte destinada a rendimiento) | automático al confirmar el depósito |
| Fees de retiro | automático al procesar un retiro |
| Partner tasks pagadas | automático al activarse la task |
| Aporte manual del operador | formulario en el admin panel |

Todos se registran en `revenue_events`.

## Hashrate

- Depósito: `hashrate = usd_depositado × 100` puntos, duración 180 días, decaimiento lineal 1/180 diario.
- Ruleta, cofres y bonus de referido ($0.10) también generan grants de hashrate con la misma mecánica.
- El hashrate total activo se recalcula en el cron diario.

## Cambios técnicos

Tablas nuevas:
- `revenue_events` (source, amount_usd, occurred_at, note, created_by)
- `hashrate_grants` (user_id, points, source, source_ref_id, starts_at, expires_at, decay_per_day, active)
- `payout_pool_daily` (day, revenue_usd, payout_ratio, pool_usd, reserve_delta, total_hashrate, treasury_ton, solvency_ratio, paid_usd, status)
- `payout_entries` (day, user_id, hashrate, share, amount_gram, amount_usd)
- `treasury_ledger` (direction, amount_usd, reason, ref)

Funciones SQL: `add_revenue_event`, `grant_hashrate`, `user_active_hashrate`, `network_active_hashrate`, `run_daily_payout(_day, _gram_price, _treasury_ton)` idempotente por día y por lotes.

Endpoint y cron:
- `src/routes/api/public/hooks/daily-payout.ts` — worker resumable protegido por `CRON_SECRET`, lee el saldo de la wallet, calcula el pool y acredita balances por lotes. pg_cron lo llama una vez al día.
- Fees de retiro, partner tasks y depósitos insertan automáticamente en `revenue_events`.

Frontend:
- Tarjeta "Network Mining" en la home: hashrate propio, cuota de la red, pago de ayer y APY estimado (7 días).
- Depósito: "≈ X pts de hashrate · 180 días" en vez de "3.3% diario".
- Admin: pestaña **Economy** con ingresos del día, pool, saldo de la wallet, ratio de solvencia, historial de pagos y formulario de ingreso manual.

## Migración

1. Convertir el `mining_rate_usd` actual en hashrate: `points = mining_rate_usd / 0.033 × 100`, 180 días desde hoy.
2. `mining_rate_usd` se mantiene como campo legado de solo lectura.
3. Feature flag `ECONOMY_V2`: apagado = todo igual; encendido = el cron diario es la única fuente de ingresos y se apaga el acumulador en vivo del 3.3%.
4. Broadcast en inglés anunciando Dynamic Mining v2 con bonus de hashrate de cortesía.

## Orden de implementación

1. Migración SQL (tablas + grants + RLS + funciones).
2. Backfill de hashrate + tesoro inicial.
3. Endpoint de payout diario + cron + hooks de ingresos.
4. Admin: pestaña Economy.
5. Frontend: tarjeta Network Mining + textos del depósito.
6. Encender el flag y broadcast.

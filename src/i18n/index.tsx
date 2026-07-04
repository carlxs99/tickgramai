import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type Lang = "en" | "es" | "ru" | "hi";

export const LANGS: { code: Lang; label: string; flag: string }[] = [
  { code: "en", label: "English", flag: "🇬🇧" },
  { code: "es", label: "Español", flag: "🇪🇸" },
  { code: "ru", label: "Русский", flag: "🇷🇺" },
  { code: "hi", label: "हिन्दी", flag: "🇮🇳" },
];

type Dict = Record<string, string>;

const en: Dict = {
  "auth.error": "Auth error",
  "auth.telegram_no_identity":
    "Telegram did not send your identity. Open the Mini App from the bot menu button (@Tickgramaibot) or from t.me/Tickgramaibot/app.",
  "auth.failed": "Auth failed",
  "common.loading": "Loading",
  "common.copied": "Copied",
  "common.history": "History",
  "common.disconnect": "Disconnect",
  "common.cancel": "Cancel",
  "common.failed": "Failed",
  "common.error": "Error",
  "common.off": "off",

  "header.welcome": "Welcome",
  "header.admin_panel": "Admin panel",
  "header.language": "Language",

  "mine.uncollected": "Uncollected",
  "mine.per_day": "GRAM/day",
  "mine.per_day_suffix": "/day",
  "mine.deposit_to_start": "Deposit GRAM to start mining",
  "mine.collect": "Collect Gram",
  "mine.collecting": "Collecting…",
  "mine.collected_toast": "collected",
  "mine.balance": "Balance",
  "mine.deposits": "Deposits",
  "mine.gram_price": "1 GRAM ≈ ${price}",

  "gift.title": "Gift Boxes",
  "gift.have_boxes": "You have {count} box!",
  "gift.have_boxes_plural": "You have {count} boxes!",
  "gift.invite_cta": "Invite friends and win boxes",
  "gift.rule": "1 box for every referral who deposits",
  "gift.active_bonus": "Active bonus:",
  "gift.active_bonus_suffix": "on your next deposit",
  "gift.opening": "Opening…",
  "gift.open": "Open box",
  "gift.no_boxes_yet": "No boxes yet",
  "gift.prize_title": "Prize!",
  "gift.prize_gram_sub": "Added to your daily mining",
  "gift.prize_bonus_sub": "Bonus on next deposit (24h)",
  "gift.cool": "Awesome!",
  "gift.per_day": "/day",

  "leaderboard.title": "Leaderboard",
  "leaderboard.subtitle": "Top miners by GRAM mined per day.",
  "leaderboard.live_ranking": "Live ranking",
  "leaderboard.active": "ACTIVE",
  "leaderboard.only_podium": "Only the podium is set — invite miners to fill the ranks.",
  "leaderboard.anon": "Anon",

  "tasks.title": "Tasks",
  "tasks.subtitle": "Complete tasks to earn GRAM.",
  "tasks.done": "Done",
  "tasks.join": "Join",
  "tasks.share": "Share",
  "tasks.verify": "Verify",
  "tasks.claim": "Claim",
  "tasks.share_default": "Join me on Tickgram AI and start mining GRAM!",
  "partner.title": "Partner Tasks",
  "partner.add": "Add A Task",
  "partner.empty": "No partner tasks yet.",
  "partner.clicks": "clicks",
  "partner.open": "Open",
  "partner.my_tasks": "My tasks",
  "partner.help_title": "How Partner Tasks work",
  "partner.help_body": "Promote your Telegram channel, group or bot link.\n\n• Cost: 0.001 GRAM per click\n• Minimum 250 clicks (0.25 GRAM)\n• Task auto-closes when the target is reached\n• Each user earns +0.001 GRAM for completing it",
  "partner.modal_title": "Add a Partner Task",
  "partner.form_title": "Title",
  "partner.form_title_ph": "Join my channel",
  "partner.form_link": "Link",
  "partner.form_kind": "Type",
  "partner.form_clicks": "Clicks (min 250 = 0.2500 GRAM)",
  "partner.form_clicks_help": "1 click = 0.001 GRAM · reward: +0.001 GRAM",
  "partner.cost_label": "Cost:",
  "partner.pay_and_create": "Pay & create",
  "partner.created": "Partner task created. It will activate once the payment is confirmed on-chain.",
  "partner.kind_channel": "Channel",
  "partner.kind_group": "Group",
  "partner.kind_bot": "Bot",
  "partner.kind_link": "Link",

  "friends.title": "Friends",
  "friends.subtitle": "Invite friends and earn 10% of their mining forever.",
  "friends.your_invite": "Your invite link",
  "friends.your_friends": "Your friends ({count})",
  "friends.no_referrals": "No referrals yet.",

  "deposit.title": "Deposit",
  "deposit.subtitle":
    "Connect your GRAM wallet and pay directly. Your unique memo is added automatically so we can detect your deposit.",
  "deposit.your_balance": "Your balance",
  "deposit.current_rate": "Current rate",
  "deposit.your_memo": "Your memo",
  "deposit.memo_copied": "Memo copied",
  "deposit.wallet": "GRAM Wallet",
  "deposit.connect_wallet": "Connect Wallet",
  "deposit.amount": "Amount (GRAM)",
  "deposit.amount_helper": "≈ ${usdt} USDT · earns {daily} GRAM/day",
  "deposit.waiting": "Waiting for wallet…",
  "deposit.pay": "Pay & start earning",
  "deposit.connect_to_deposit": "Connect wallet to deposit",
  "deposit.tx_sent": "Transaction sent. It will be credited automatically once confirmed on-chain.",
  "deposit.err_connect": "Connect your wallet first",
  "deposit.err_amount": "Enter an amount",
  "deposit.err_memo": "Missing memo",
  "deposit.err_failed": "Transaction failed",
  "deposit.reinvest_title": "Reinvest",
  "deposit.reinvest_subtitle": "Reinvest your GRAM balance and boost your mining",
  "deposit.reinvest_amount": "Reinvestment amount",
  "deposit.reinvest_cta": "Reinvest",
  "deposit.reinvest_min": "Minimum 0.1 GRAM",
  "deposit.reinvest_insufficient": "Insufficient balance",
  "deposit.balance_label": "Balance: {n} GRAM",
  "deposit.max": "Max",

  "withdraw.title": "Withdraw",
  "withdraw.subtitle": "Min {amount} GRAM ($3 value). 5% network fee.",
  "withdraw.available": "Available",
  "withdraw.amount": "Amount (GRAM)",
  "withdraw.min_error": "Minimum withdrawal is {amount} GRAM",
  "withdraw.address": "GRAM address",
  "withdraw.request": "Request withdrawal",
  "withdraw.submitting": "Submitting…",
  "withdraw.none": "No withdrawals yet.",
  "withdraw.requested_net": "Requested. Net {amount} GRAM",
  "withdraw.min_label": "Minimum withdrawal",
  "withdraw.fee_label": "Network fee",
  "withdraw.net_label": "You will receive",

  "nav.mine": "Mine",
  "nav.tasks": "Tasks",
  "nav.top": "Top",
  "nav.friends": "Friends",
  "nav.deposit": "Deposit",
  "nav.cash": "Cash",

  "admin.title": "Admin",
  "admin.users": "Users",
  "admin.tasks_today": "{n} tasks today",
  "admin.deposits": "Deposits",
  "admin.confirmed": "{n} confirmed",
  "admin.withdrawals": "Withdrawals",
  "admin.pending": "{n} pending",
  "admin.mining_rate": "Mining rate",
  "admin.balances": "{n} balances",
  "admin.new_task": "New task",
  "admin.edit_task": "Edit task",
  "admin.title_ph": "Title",
  "admin.code_ph": "Unique code (e.g. sub_channel_1)",
  "admin.kind.daily": "Daily",
  "admin.kind.once": "Once",
  "admin.kind.channel": "Channel (verify subscription)",
  "admin.kind.group": "Group (verify member)",
  "admin.reward_ph": "GRAM reward",
  "admin.min_deposit_ph": "Minimum deposit",
  "admin.desc_ph": "Description (optional)",
  "admin.target_chat_ph": "@channel_or_group (chat_id)",
  "admin.link_ph": "https://t.me/... (link for the user)",
  "admin.active": "Active",
  "admin.bot_note":
    "The bot @Tickgramaibot must be an admin of the channel/group to verify the user's subscription.",
  "admin.saving": "Saving…",
  "admin.save_changes": "Save changes",
  "admin.create_task": "Create task",
  "admin.tasks_count": "Tasks ({count})",
  "admin.no_tasks": "No tasks yet.",
  "admin.delete_confirm": "Delete task?",
  "admin.deleted": "Deleted",
  "admin.task_updated": "Task updated",
  "admin.task_created": "Task created",
};

const es: Dict = {
  "auth.error": "Error de autenticación",
  "auth.telegram_no_identity":
    "Telegram no envió tu identidad. Abre la Mini App desde el botón del menú del bot (@Tickgramaibot) o desde t.me/Tickgramaibot/app.",
  "auth.failed": "Autenticación fallida",
  "common.loading": "Cargando",
  "common.copied": "Copiado",
  "common.history": "Historial",
  "common.disconnect": "Desconectar",
  "common.cancel": "Cancelar",
  "common.failed": "Falló",
  "common.error": "Error",
  "common.off": "off",

  "header.welcome": "Bienvenido",
  "header.admin_panel": "Panel de admin",
  "header.language": "Idioma",

  "mine.uncollected": "Sin recoger",
  "mine.per_day": "GRAM/día",
  "mine.per_day_suffix": "/día",
  "mine.deposit_to_start": "Deposita GRAM para empezar a minar",
  "mine.collect": "Recoger Gram",
  "mine.collecting": "Recogiendo…",
  "mine.collected_toast": "recogido",
  "mine.balance": "Balance",
  "mine.deposits": "Depósitos",
  "mine.gram_price": "1 GRAM ≈ ${price}",

  "gift.title": "Cajas de Regalo",
  "gift.have_boxes": "¡Tienes {count} caja!",
  "gift.have_boxes_plural": "¡Tienes {count} cajas!",
  "gift.invite_cta": "Invita amigos y gana cajas",
  "gift.rule": "1 caja por cada referido que deposite",
  "gift.active_bonus": "Bonus activo:",
  "gift.active_bonus_suffix": "a tu próximo depósito",
  "gift.opening": "Abriendo…",
  "gift.open": "Abrir caja",
  "gift.no_boxes_yet": "Sin cajas aún",
  "gift.prize_title": "¡Premio!",
  "gift.prize_gram_sub": "Añadido a tu minería diaria",
  "gift.prize_bonus_sub": "Bonus al próximo depósito (24h)",
  "gift.cool": "¡Genial!",
  "gift.per_day": "/día",

  "leaderboard.title": "Clasificación",
  "leaderboard.subtitle": "Los mejores mineros por GRAM minado al día.",
  "leaderboard.live_ranking": "Ranking en vivo",
  "leaderboard.active": "ACTIVO",
  "leaderboard.only_podium": "Solo el podio está definido — invita mineros para llenar los puestos.",
  "leaderboard.anon": "Anónimo",

  "tasks.title": "Tareas",
  "tasks.subtitle": "Completa tareas para ganar GRAM.",
  "tasks.done": "Hecho",
  "tasks.join": "Unirse",
  "tasks.share": "Compartir",
  "tasks.verify": "Verificar",
  "tasks.claim": "Reclamar",
  "tasks.share_default": "¡Únete a Tickgram AI y empieza a minar GRAM!",
  "partner.title": "Tareas de Partners",
  "partner.add": "Añadir tarea",
  "partner.empty": "Aún no hay tareas de partners.",
  "partner.clicks": "clics",
  "partner.open": "Abrir",
  "partner.my_tasks": "Mis tareas",
  "partner.help_title": "Cómo funcionan las tareas de partners",
  "partner.help_body": "Promociona el enlace de tu canal, grupo o bot de Telegram.\n\n• Coste: 0.001 GRAM por clic\n• Mínimo 250 clics (0.25 GRAM)\n• La tarea se cierra automáticamente al llegar al objetivo\n• Cada usuario recibe +0.001 GRAM por completarla",
  "partner.modal_title": "Añadir Partner Task",
  "partner.form_title": "Título",
  "partner.form_title_ph": "Únete a mi canal",
  "partner.form_link": "Enlace",
  "partner.form_kind": "Tipo",
  "partner.form_clicks": "Clics (mín 250 = 0.2500 GRAM)",
  "partner.form_clicks_help": "1 clic = 0.001 GRAM · recompensa: +0.001 GRAM",
  "partner.cost_label": "Coste:",
  "partner.pay_and_create": "Pagar y crear",
  "partner.created": "Tarea creada. Se activará cuando se confirme el pago.",
  "partner.kind_channel": "Canal",
  "partner.kind_group": "Grupo",
  "partner.kind_bot": "Bot",
  "partner.kind_link": "Enlace",

  "friends.title": "Amigos",
  "friends.subtitle": "Invita amigos y gana el 10% de su minado para siempre.",
  "friends.your_invite": "Tu enlace de invitación",
  "friends.your_friends": "Tus amigos ({count})",
  "friends.no_referrals": "Aún no tienes referidos.",

  "deposit.title": "Depósito",
  "deposit.subtitle":
    "Conecta tu wallet GRAM y paga directamente. Se añade tu memo único automáticamente para detectar tu depósito.",
  "deposit.your_balance": "Tu balance",
  "deposit.current_rate": "Tasa actual",
  "deposit.your_memo": "Tu memo",
  "deposit.memo_copied": "Memo copiado",
  "deposit.wallet": "Wallet GRAM",
  "deposit.connect_wallet": "Conectar Wallet",
  "deposit.amount": "Cantidad (GRAM)",
  "deposit.amount_helper": "≈ ${usdt} USDT · gana {daily} GRAM/día",
  "deposit.waiting": "Esperando la wallet…",
  "deposit.pay": "Pagar y empezar a ganar",
  "deposit.connect_to_deposit": "Conecta la wallet para depositar",
  "deposit.tx_sent": "Transacción enviada. Se acreditará automáticamente al confirmarse en la red.",
  "deposit.err_connect": "Conecta tu wallet primero",
  "deposit.err_amount": "Introduce una cantidad",
  "deposit.err_memo": "Falta el memo",
  "deposit.err_failed": "Transacción fallida",
  "deposit.reinvest_title": "Reinvertir",
  "deposit.reinvest_subtitle": "Reinvierte tu balance de GRAM y aumenta tu minería",
  "deposit.reinvest_amount": "Cantidad a reinvertir",
  "deposit.reinvest_cta": "Reinvertir",
  "deposit.reinvest_min": "Mínimo 0.1 GRAM",
  "deposit.reinvest_insufficient": "Balance insuficiente",
  "deposit.balance_label": "Balance: {n} GRAM",
  "deposit.max": "Máx",

  "withdraw.title": "Retirar",
  "withdraw.subtitle": "Mínimo {amount} GRAM (valor $3). Comisión de red del 5%.",
  "withdraw.available": "Disponible",
  "withdraw.amount": "Cantidad (GRAM)",
  "withdraw.min_error": "El retiro mínimo es {amount} GRAM",
  "withdraw.address": "Dirección GRAM",
  "withdraw.request": "Solicitar retiro",
  "withdraw.submitting": "Enviando…",
  "withdraw.none": "Sin retiros aún.",
  "withdraw.requested_net": "Solicitado. Neto {amount} GRAM",
  "withdraw.min_label": "Retiro mínimo",
  "withdraw.fee_label": "Comisión de red",
  "withdraw.net_label": "Recibirás",

  "nav.mine": "Minar",
  "nav.tasks": "Tareas",
  "nav.top": "Top",
  "nav.friends": "Amigos",
  "nav.deposit": "Depósito",
  "nav.cash": "Retirar",

  "admin.title": "Admin",
  "admin.users": "Usuarios",
  "admin.tasks_today": "{n} tareas hoy",
  "admin.deposits": "Depósitos",
  "admin.confirmed": "{n} confirmados",
  "admin.withdrawals": "Retiros",
  "admin.pending": "{n} pendientes",
  "admin.mining_rate": "Tasa minado",
  "admin.balances": "{n} balances",
  "admin.new_task": "Nueva tarea",
  "admin.edit_task": "Editar tarea",
  "admin.title_ph": "Título",
  "admin.code_ph": "Código único (ej: sub_canal_1)",
  "admin.kind.daily": "Diaria",
  "admin.kind.once": "Única",
  "admin.kind.channel": "Canal (verificar suscripción)",
  "admin.kind.group": "Grupo (verificar miembro)",
  "admin.reward_ph": "Recompensa GRAM",
  "admin.min_deposit_ph": "Depósito mínimo",
  "admin.desc_ph": "Descripción (opcional)",
  "admin.target_chat_ph": "@canal_o_grupo (chat_id)",
  "admin.link_ph": "https://t.me/... (link para el usuario)",
  "admin.active": "Activa",
  "admin.bot_note":
    "El bot @Tickgramaibot debe ser administrador del canal/grupo para verificar la suscripción del usuario.",
  "admin.saving": "Guardando…",
  "admin.save_changes": "Guardar cambios",
  "admin.create_task": "Crear tarea",
  "admin.tasks_count": "Tareas ({count})",
  "admin.no_tasks": "Sin tareas todavía.",
  "admin.delete_confirm": "¿Eliminar tarea?",
  "admin.deleted": "Eliminada",
  "admin.task_updated": "Tarea actualizada",
  "admin.task_created": "Tarea creada",
};

const ru: Dict = {
  "auth.error": "Ошибка авторизации",
  "auth.telegram_no_identity":
    "Telegram не передал ваши данные. Откройте Mini App через кнопку меню бота (@Tickgramaibot) или через t.me/Tickgramaibot/app.",
  "auth.failed": "Ошибка входа",
  "common.loading": "Загрузка",
  "common.copied": "Скопировано",
  "common.history": "История",
  "common.disconnect": "Отключить",
  "common.cancel": "Отмена",
  "common.failed": "Ошибка",
  "common.error": "Ошибка",
  "common.off": "выкл",

  "header.welcome": "Добро пожаловать",
  "header.admin_panel": "Панель админа",
  "header.language": "Язык",

  "mine.uncollected": "Не собрано",
  "mine.per_day": "GRAM/день",
  "mine.per_day_suffix": "/день",
  "mine.deposit_to_start": "Внесите GRAM, чтобы начать майнить",
  "mine.collect": "Собрать Gram",
  "mine.collecting": "Собираем…",
  "mine.collected_toast": "собрано",
  "mine.balance": "Баланс",
  "mine.deposits": "Депозиты",
  "mine.gram_price": "1 GRAM ≈ ${price}",

  "gift.title": "Подарочные боксы",
  "gift.have_boxes": "У вас {count} бокс!",
  "gift.have_boxes_plural": "У вас {count} боксов!",
  "gift.invite_cta": "Приглашай друзей и получай боксы",
  "gift.rule": "1 бокс за каждого реферала, сделавшего депозит",
  "gift.active_bonus": "Активный бонус:",
  "gift.active_bonus_suffix": "к следующему депозиту",
  "gift.opening": "Открываем…",
  "gift.open": "Открыть бокс",
  "gift.no_boxes_yet": "Пока нет боксов",
  "gift.prize_title": "Приз!",
  "gift.prize_gram_sub": "Добавлено к дневному майнингу",
  "gift.prize_bonus_sub": "Бонус к следующему депозиту (24ч)",
  "gift.cool": "Отлично!",
  "gift.per_day": "/день",

  "leaderboard.title": "Таблица лидеров",
  "leaderboard.subtitle": "Топ майнеров по GRAM в день.",
  "leaderboard.live_ranking": "Живой рейтинг",
  "leaderboard.active": "АКТИВНО",
  "leaderboard.only_podium": "Только пьедестал заполнен — пригласите майнеров.",
  "leaderboard.anon": "Аноним",

  "tasks.title": "Задания",
  "tasks.subtitle": "Выполняйте задания и получайте GRAM.",
  "tasks.done": "Готово",
  "tasks.join": "Вступить",
  "tasks.share": "Поделиться",
  "tasks.verify": "Проверить",
  "tasks.claim": "Забрать",
  "tasks.share_default": "Присоединяйся к Tickgram AI и начни майнить GRAM!",
  "partner.title": "Партнёрские задания",
  "partner.add": "Добавить",
  "partner.empty": "Пока нет партнёрских заданий.",
  "partner.clicks": "клики",
  "partner.open": "Открыть",
  "partner.my_tasks": "Мои задания",
  "partner.help_title": "Как работают партнёрские задания",
  "partner.help_body": "Продвигай свой Telegram-канал, группу или бот.\n\n• Стоимость: 0.001 GRAM за клик\n• Минимум 250 кликов (0.25 GRAM)\n• Задание автоматически закрывается при достижении цели\n• Каждый пользователь получает +0.001 GRAM",
  "partner.modal_title": "Добавить Partner Task",
  "partner.form_title": "Заголовок",
  "partner.form_title_ph": "Подпишись на канал",
  "partner.form_link": "Ссылка",
  "partner.form_kind": "Тип",
  "partner.form_clicks": "Клики (мин 250 = 0.2500 GRAM)",
  "partner.form_clicks_help": "1 клик = 0.001 GRAM · награда: +0.001 GRAM",
  "partner.cost_label": "Стоимость:",
  "partner.pay_and_create": "Оплатить и создать",
  "partner.created": "Задание создано. Активируется после подтверждения оплаты.",
  "partner.kind_channel": "Канал",
  "partner.kind_group": "Группа",
  "partner.kind_bot": "Бот",
  "partner.kind_link": "Ссылка",

  "friends.title": "Друзья",
  "friends.subtitle": "Приглашайте друзей и получайте 10% с их майнинга навсегда.",
  "friends.your_invite": "Ваша ссылка-приглашение",
  "friends.your_friends": "Ваши друзья ({count})",
  "friends.no_referrals": "Пока нет рефералов.",

  "deposit.title": "Депозит",
  "deposit.subtitle":
    "Подключите GRAM-кошелёк и оплатите. Уникальное memo добавляется автоматически для распознавания депозита.",
  "deposit.your_balance": "Ваш баланс",
  "deposit.current_rate": "Текущая ставка",
  "deposit.your_memo": "Ваше memo",
  "deposit.memo_copied": "Memo скопировано",
  "deposit.wallet": "GRAM-кошелёк",
  "deposit.connect_wallet": "Подключить кошелёк",
  "deposit.amount": "Сумма (GRAM)",
  "deposit.amount_helper": "≈ ${usdt} USDT · доход {daily} GRAM/день",
  "deposit.waiting": "Ожидаем кошелёк…",
  "deposit.pay": "Оплатить и начать зарабатывать",
  "deposit.connect_to_deposit": "Подключите кошелёк для депозита",
  "deposit.tx_sent": "Транзакция отправлена. Она зачислится автоматически после подтверждения в сети.",
  "deposit.err_connect": "Сначала подключите кошелёк",
  "deposit.err_amount": "Введите сумму",
  "deposit.err_memo": "Нет memo",
  "deposit.err_failed": "Транзакция не удалась",
  "deposit.reinvest_title": "Реинвест",
  "deposit.reinvest_subtitle": "Реинвестируйте баланс GRAM и увеличьте свой доход",
  "deposit.reinvest_amount": "Сумма реинвеста",
  "deposit.reinvest_cta": "Реинвестировать",
  "deposit.reinvest_min": "Минимум 0.1 GRAM",
  "deposit.reinvest_insufficient": "Недостаточно средств",
  "deposit.balance_label": "Баланс: {n} GRAM",
  "deposit.max": "Макс",

  "withdraw.title": "Вывод",
  "withdraw.subtitle": "Минимум {amount} GRAM (эквивалент $3). Комиссия сети 5%.",
  "withdraw.available": "Доступно",
  "withdraw.amount": "Сумма (GRAM)",
  "withdraw.min_error": "Минимальный вывод — {amount} GRAM",
  "withdraw.address": "Адрес GRAM",
  "withdraw.request": "Запросить вывод",
  "withdraw.submitting": "Отправляем…",
  "withdraw.none": "Выводов пока нет.",
  "withdraw.requested_net": "Запрошено. Нетто {amount} GRAM",
  "withdraw.min_label": "Минимальный вывод",
  "withdraw.fee_label": "Комиссия сети",
  "withdraw.net_label": "Вы получите",

  "nav.mine": "Майнинг",
  "nav.tasks": "Задания",
  "nav.top": "Топ",
  "nav.friends": "Друзья",
  "nav.deposit": "Депозит",
  "nav.cash": "Вывод",

  "admin.title": "Админ",
  "admin.users": "Пользователи",
  "admin.tasks_today": "{n} заданий сегодня",
  "admin.deposits": "Депозиты",
  "admin.confirmed": "{n} подтверждено",
  "admin.withdrawals": "Выводы",
  "admin.pending": "{n} в ожидании",
  "admin.mining_rate": "Ставка майнинга",
  "admin.balances": "{n} балансов",
  "admin.new_task": "Новое задание",
  "admin.edit_task": "Редактировать задание",
  "admin.title_ph": "Заголовок",
  "admin.code_ph": "Уникальный код (напр. sub_channel_1)",
  "admin.kind.daily": "Ежедневное",
  "admin.kind.once": "Разовое",
  "admin.kind.channel": "Канал (проверка подписки)",
  "admin.kind.group": "Группа (проверка участника)",
  "admin.reward_ph": "Награда GRAM",
  "admin.min_deposit_ph": "Мин. депозит",
  "admin.desc_ph": "Описание (необязательно)",
  "admin.target_chat_ph": "@канал_или_группа (chat_id)",
  "admin.link_ph": "https://t.me/... (ссылка для пользователя)",
  "admin.active": "Активно",
  "admin.bot_note":
    "Бот @Tickgramaibot должен быть админом канала/группы для проверки подписки.",
  "admin.saving": "Сохраняем…",
  "admin.save_changes": "Сохранить",
  "admin.create_task": "Создать задание",
  "admin.tasks_count": "Задания ({count})",
  "admin.no_tasks": "Заданий пока нет.",
  "admin.delete_confirm": "Удалить задание?",
  "admin.deleted": "Удалено",
  "admin.task_updated": "Задание обновлено",
  "admin.task_created": "Задание создано",
};

const hi: Dict = {
  "auth.error": "प्रमाणीकरण त्रुटि",
  "auth.telegram_no_identity":
    "Telegram ने आपकी पहचान नहीं भेजी। बॉट के मेनू बटन (@Tickgramaibot) से या t.me/Tickgramaibot/app से Mini App खोलें।",
  "auth.failed": "प्रमाणीकरण विफल",
  "common.loading": "लोड हो रहा है",
  "common.copied": "कॉपी किया गया",
  "common.history": "इतिहास",
  "common.disconnect": "डिस्कनेक्ट",
  "common.cancel": "रद्द करें",
  "common.failed": "विफल",
  "common.error": "त्रुटि",
  "common.off": "बंद",

  "header.welcome": "स्वागत है",
  "header.admin_panel": "एडमिन पैनल",
  "header.language": "भाषा",

  "mine.uncollected": "अनसंग्रहित",
  "mine.per_day": "GRAM/दिन",
  "mine.per_day_suffix": "/दिन",
  "mine.deposit_to_start": "माइनिंग शुरू करने के लिए GRAM जमा करें",
  "mine.collect": "GRAM लें",
  "mine.collecting": "एकत्र कर रहे हैं…",
  "mine.collected_toast": "एकत्रित",
  "mine.balance": "बैलेंस",
  "mine.deposits": "जमा",
  "mine.gram_price": "1 GRAM ≈ ${price}",

  "gift.title": "Gift Boxes",
  "gift.have_boxes": "You have {count} box!",
  "gift.have_boxes_plural": "You have {count} boxes!",
  "gift.invite_cta": "Invite friends and win boxes",
  "gift.rule": "1 box for every referral who deposits",
  "gift.active_bonus": "Active bonus:",
  "gift.active_bonus_suffix": "on your next deposit",
  "gift.opening": "Opening…",
  "gift.open": "Open box",
  "gift.no_boxes_yet": "No boxes yet",
  "gift.prize_title": "Prize!",
  "gift.prize_gram_sub": "Added to your daily mining",
  "gift.prize_bonus_sub": "Bonus on next deposit (24h)",
  "gift.cool": "Awesome!",
  "gift.per_day": "/day",

  "leaderboard.title": "लीडरबोर्ड",
  "leaderboard.subtitle": "प्रति दिन GRAM के हिसाब से टॉप माइनर्स।",
  "leaderboard.live_ranking": "लाइव रैंकिंग",
  "leaderboard.active": "सक्रिय",
  "leaderboard.only_podium": "केवल पोडियम सेट है — रैंक भरने के लिए माइनर्स को आमंत्रित करें।",
  "leaderboard.anon": "अज्ञात",

  "tasks.title": "कार्य",
  "tasks.subtitle": "GRAM कमाने के लिए कार्य पूरे करें।",
  "tasks.done": "पूरा",
  "tasks.join": "जुड़ें",
  "tasks.share": "शेयर",
  "tasks.verify": "जांचें",
  "tasks.claim": "प्राप्त करें",
  "tasks.share_default": "Tickgram AI से जुड़ें और GRAM माइन करना शुरू करें!",
  "partner.title": "पार्टनर टास्क",
  "partner.add": "टास्क जोड़ें",
  "partner.empty": "अभी कोई पार्टनर टास्क नहीं।",
  "partner.clicks": "क्लिक्स",
  "partner.open": "खोलें",
  "partner.my_tasks": "मेरे टास्क",
  "partner.help_title": "पार्टनर टास्क कैसे काम करते हैं",
  "partner.help_body": "अपनी टेलीग्राम चैनल, ग्रुप या बॉट का लिंक प्रमोट करें।\n\n• लागत: 0.001 GRAM प्रति क्लिक\n• न्यूनतम 250 क्लिक (0.25 GRAM)\n• लक्ष्य पूरा होने पर टास्क अपने आप बंद हो जाता है\n• प्रत्येक उपयोगकर्ता को +0.001 GRAM मिलता है",
  "partner.modal_title": "पार्टनर टास्क जोड़ें",
  "partner.form_title": "शीर्षक",
  "partner.form_title_ph": "मेरे चैनल में शामिल हों",
  "partner.form_link": "लिंक",
  "partner.form_kind": "प्रकार",
  "partner.form_clicks": "क्लिक्स (न्यूनतम 250 = 0.2500 GRAM)",
  "partner.form_clicks_help": "1 क्लिक = 0.001 GRAM · पुरस्कार: +0.001 GRAM",
  "partner.cost_label": "लागत:",
  "partner.pay_and_create": "भुगतान करें और बनाएं",
  "partner.created": "पार्टनर टास्क बनाया गया। भुगतान की पुष्टि होने पर सक्रिय हो जाएगा।",
  "partner.kind_channel": "चैनल",
  "partner.kind_group": "ग्रुप",
  "partner.kind_bot": "बॉट",
  "partner.kind_link": "लिंक",

  "friends.title": "मित्र",
  "friends.subtitle": "दोस्तों को आमंत्रित करें और उनकी माइनिंग का 10% हमेशा के लिए कमाएँ।",
  "friends.your_invite": "आपका आमंत्रण लिंक",
  "friends.your_friends": "आपके मित्र ({count})",
  "friends.no_referrals": "अभी कोई रेफरल नहीं।",

  "deposit.title": "जमा",
  "deposit.subtitle":
    "अपना GRAM वॉलेट जोड़ें और सीधे भुगतान करें। आपका यूनीक memo अपने-आप जुड़ जाता है।",
  "deposit.your_balance": "आपका बैलेंस",
  "deposit.current_rate": "वर्तमान दर",
  "deposit.your_memo": "आपका memo",
  "deposit.memo_copied": "Memo कॉपी हुआ",
  "deposit.wallet": "GRAM वॉलेट",
  "deposit.connect_wallet": "वॉलेट जोड़ें",
  "deposit.amount": "राशि (GRAM)",
  "deposit.amount_helper": "≈ ${usdt} USDT · कमाई {daily} GRAM/दिन",
  "deposit.waiting": "वॉलेट का इंतज़ार…",
  "deposit.pay": "भुगतान करें और कमाना शुरू करें",
  "deposit.connect_to_deposit": "जमा के लिए वॉलेट जोड़ें",
  "deposit.tx_sent": "लेनदेन भेजा गया। पुष्टि होने पर अपने-आप क्रेडिट होगा।",
  "deposit.err_connect": "पहले अपना वॉलेट जोड़ें",
  "deposit.err_amount": "राशि दर्ज करें",
  "deposit.err_memo": "Memo गुम है",
  "deposit.err_failed": "लेनदेन विफल",
  "deposit.reinvest_title": "पुनर्निवेश",
  "deposit.reinvest_subtitle": "अपने GRAM बैलेंस को पुनर्निवेश करें और अधिक कमाई शुरू करें",
  "deposit.reinvest_amount": "पुनर्निवेश राशि",
  "deposit.reinvest_cta": "पुनर्निवेश करें",
  "deposit.reinvest_min": "न्यूनतम 0.1 GRAM",
  "deposit.reinvest_insufficient": "अपर्याप्त बैलेंस",
  "deposit.balance_label": "बैलेंस: {n} GRAM",
  "deposit.max": "अधिकतम",

  "withdraw.title": "निकालें",
  "withdraw.subtitle": "न्यूनतम {amount} GRAM ($3 मूल्य). 5% नेटवर्क शुल्क।",
  "withdraw.available": "उपलब्ध",
  "withdraw.amount": "राशि (GRAM)",
  "withdraw.min_error": "न्यूनतम निकासी {amount} GRAM है",
  "withdraw.address": "GRAM पता",
  "withdraw.request": "निकासी अनुरोध",
  "withdraw.submitting": "भेजा जा रहा है…",
  "withdraw.none": "अभी कोई निकासी नहीं।",
  "withdraw.requested_net": "अनुरोधित। नेट {amount} GRAM",
  "withdraw.min_label": "न्यूनतम निकासी",
  "withdraw.fee_label": "नेटवर्क शुल्क",
  "withdraw.net_label": "आपको मिलेगा",

  "nav.mine": "माइन",
  "nav.tasks": "कार्य",
  "nav.top": "टॉप",
  "nav.friends": "मित्र",
  "nav.deposit": "जमा",
  "nav.cash": "निकासी",

  "admin.title": "एडमिन",
  "admin.users": "उपयोगकर्ता",
  "admin.tasks_today": "{n} कार्य आज",
  "admin.deposits": "जमा",
  "admin.confirmed": "{n} पुष्टि",
  "admin.withdrawals": "निकासी",
  "admin.pending": "{n} लंबित",
  "admin.mining_rate": "माइनिंग दर",
  "admin.balances": "{n} बैलेंस",
  "admin.new_task": "नया कार्य",
  "admin.edit_task": "कार्य संपादित करें",
  "admin.title_ph": "शीर्षक",
  "admin.code_ph": "यूनीक कोड (जैसे sub_channel_1)",
  "admin.kind.daily": "दैनिक",
  "admin.kind.once": "एक बार",
  "admin.kind.channel": "चैनल (सदस्यता जांच)",
  "admin.kind.group": "समूह (सदस्य जांच)",
  "admin.reward_ph": "GRAM पुरस्कार",
  "admin.min_deposit_ph": "न्यूनतम जमा",
  "admin.desc_ph": "विवरण (वैकल्पिक)",
  "admin.target_chat_ph": "@चैनल_या_समूह (chat_id)",
  "admin.link_ph": "https://t.me/... (उपयोगकर्ता के लिए लिंक)",
  "admin.active": "सक्रिय",
  "admin.bot_note":
    "सदस्यता जांचने के लिए बॉट @Tickgramaibot को चैनल/समूह का एडमिन होना चाहिए।",
  "admin.saving": "सहेज रहे हैं…",
  "admin.save_changes": "बदलाव सहेजें",
  "admin.create_task": "कार्य बनाएँ",
  "admin.tasks_count": "कार्य ({count})",
  "admin.no_tasks": "अभी कोई कार्य नहीं।",
  "admin.delete_confirm": "कार्य हटाएँ?",
  "admin.deleted": "हटाया गया",
  "admin.task_updated": "कार्य अपडेट किया",
  "admin.task_created": "कार्य बनाया",
};

const DICTS: Record<Lang, Dict> = { en, es, ru, hi };

function detectDefault(): Lang {
  if (typeof window === "undefined") return "en";
  const saved = window.localStorage.getItem("app-lang") as Lang | null;
  if (saved && DICTS[saved]) return saved;
  // No saved preference → default to English. We don't auto-detect the
  // browser language so users always start in a known language and pick
  // theirs explicitly from the switcher.
  return "en";
}

type Ctx = { lang: Lang; setLang: (l: Lang) => void; t: (key: string, vars?: Record<string, string | number>) => string };
const I18nContext = createContext<Ctx | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("en");
  useEffect(() => { setLangState(detectDefault()); }, []);
  const value = useMemo<Ctx>(() => ({
    lang,
    setLang: (l) => {
      setLangState(l);
      if (typeof window !== "undefined") window.localStorage.setItem("app-lang", l);
    },
    t: (key, vars) => {
      const dict = DICTS[lang] ?? en;
      let s = dict[key] ?? en[key] ?? key;
      if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
      return s;
    },
  }), [lang]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useT() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useT must be used inside LanguageProvider");
  return ctx;
}

export function LanguageSwitcher() {
  const { lang, setLang, t } = useT();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const modal = open && mounted
    ? createPortal(
        <div className="fixed inset-0 z-[100] flex items-end justify-center">
          <button
            aria-label="Close"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
          />
          <div
            role="dialog"
            aria-modal="true"
            className="relative w-full max-w-md max-h-[85vh] overflow-y-auto rounded-t-3xl px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] shadow-2xl animate-in slide-in-from-bottom-4 bg-card text-card-foreground border-t border-border"
          >
            <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-muted-foreground/40" />
            <p className="text-center text-base font-semibold mb-3">{t("header.language")}</p>
            <div className="space-y-1.5">
              {LANGS.map((l) => (
                <button
                  key={l.code}
                  onClick={() => { setLang(l.code); setOpen(false); }}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm transition ${
                    lang === l.code
                      ? "bg-primary/15 text-primary font-semibold"
                      : "bg-muted/60 text-card-foreground"
                  }`}
                >
                  <span className="text-lg leading-none w-6 text-center shrink-0" aria-hidden>{l.flag}</span>
                  <span className="flex-1 text-left truncate">{l.label}</span>
                  {lang === l.code && <span className="shrink-0" aria-hidden>✓</span>}
                </button>
              ))}
            </div>
          </div>
        </div>,
        document.body
      )
    : null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label={t("header.language")}
        className="shrink-0 h-9 w-9 rounded-xl card-glass text-base leading-none flex items-center justify-center"
      >
        <span aria-hidden>{LANGS.find((l) => l.code === lang)?.flag ?? "🌐"}</span>
      </button>
      {modal}
    </>
  );
}

-- Enum for roles
create type public.app_role as enum ('admin', 'user');

-- Profiles
create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  telegram_id bigint unique,
  username text,
  first_name text,
  last_name text,
  avatar_url text,
  balance numeric(20,6) not null default 0,
  mining_rate numeric(20,6) not null default 0,
  deposit_total numeric(20,6) not null default 0,
  last_collect_at timestamptz not null default now(),
  referred_by uuid references public.profiles(id) on delete set null,
  referral_code text unique default encode(gen_random_bytes(6), 'hex'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;
create policy "own profile select" on public.profiles for select to authenticated using (auth.uid() = user_id);
create policy "own profile update" on public.profiles for update to authenticated using (auth.uid() = user_id);
create policy "own profile insert" on public.profiles for insert to authenticated with check (auth.uid() = user_id);

-- Roles
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;
create policy "own roles select" on public.user_roles for select to authenticated using (auth.uid() = user_id);

create or replace function public.has_role(_user_id uuid, _role app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

-- Tasks
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  title text not null,
  description text,
  reward numeric(20,6) not null default 0,
  kind text not null default 'daily',
  min_deposit numeric(20,6) not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select on public.tasks to authenticated, anon;
grant all on public.tasks to service_role;
alter table public.tasks enable row level security;
create policy "tasks public read" on public.tasks for select using (is_active = true);

-- User tasks (completion log)
create table public.user_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  completed_on date not null default (now() at time zone 'utc')::date,
  reward numeric(20,6) not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, task_id, completed_on)
);
grant select, insert on public.user_tasks to authenticated;
grant all on public.user_tasks to service_role;
alter table public.user_tasks enable row level security;
create policy "own user_tasks select" on public.user_tasks for select to authenticated using (auth.uid() = user_id);
create policy "own user_tasks insert" on public.user_tasks for insert to authenticated with check (auth.uid() = user_id);

-- Deposits
create table public.deposits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  amount_ton numeric(20,6) not null,
  gram_per_day numeric(20,6) not null default 0,
  tx_hash text,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert on public.deposits to authenticated;
grant all on public.deposits to service_role;
alter table public.deposits enable row level security;
create policy "own deposits select" on public.deposits for select to authenticated using (auth.uid() = user_id);
create policy "own deposits insert" on public.deposits for insert to authenticated with check (auth.uid() = user_id);

-- Withdrawals
create table public.withdrawals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  amount numeric(20,6) not null,
  address text not null,
  memo text,
  fee numeric(20,6) not null default 0,
  net_amount numeric(20,6) not null default 0,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert on public.withdrawals to authenticated;
grant all on public.withdrawals to service_role;
alter table public.withdrawals enable row level security;
create policy "own withdrawals select" on public.withdrawals for select to authenticated using (auth.uid() = user_id);
create policy "own withdrawals insert" on public.withdrawals for insert to authenticated with check (auth.uid() = user_id);

-- Referrals
create table public.referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references auth.users(id) on delete cascade,
  referred_id uuid not null references auth.users(id) on delete cascade,
  bonus_earned numeric(20,6) not null default 0,
  created_at timestamptz not null default now(),
  unique (referrer_id, referred_id)
);
grant select, insert, update on public.referrals to authenticated;
grant all on public.referrals to service_role;
alter table public.referrals enable row level security;
create policy "own referrals select" on public.referrals for select to authenticated using (auth.uid() = referrer_id or auth.uid() = referred_id);

-- updated_at trigger
create or replace function public.update_updated_at_column()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end; $$;

create trigger t_profiles_upd before update on public.profiles for each row execute function public.update_updated_at_column();
create trigger t_tasks_upd before update on public.tasks for each row execute function public.update_updated_at_column();
create trigger t_deposits_upd before update on public.deposits for each row execute function public.update_updated_at_column();
create trigger t_withdrawals_upd before update on public.withdrawals for each row execute function public.update_updated_at_column();

-- Top miners function (safe public projection)
create or replace function public.get_top_miners(_limit int default 20)
returns table(username text, first_name text, avatar_url text, mining_rate numeric, balance numeric)
language sql stable security definer set search_path = public as $$
  select username, first_name, avatar_url, mining_rate, balance
  from public.profiles
  order by mining_rate desc, balance desc
  limit least(_limit, 100)
$$;

-- Seed tasks
insert into public.tasks (code, title, description, reward, kind, min_deposit) values
  ('daily_checkin', 'Just check in', 'Open the app today', 10, 'daily', 0),
  ('share_friends', 'Share with Friends', 'Invite a friend to Ultra Gram Miner', 50, 'referral', 0),
  ('join_channel', 'Join our Channel', 'Join the official Telegram channel', 25, 'social', 0),
  ('first_deposit', 'Make your first deposit', 'Deposit any amount of TON', 100, 'deposit', 0.1);

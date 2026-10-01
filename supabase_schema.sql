-- MedShelf production database schema for Supabase/Postgres.
-- Run this once in Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  checkout_attempt_id text not null unique,
  order_number text not null unique,
  gateway_order_id text unique,
  gateway_payment_id text unique,
  gateway_signature text,
  amount bigint not null check (amount > 0),
  currency text not null default 'INR',
  payment_status text not null default 'created',
  order_status text not null default 'pending',
  customer_name text not null,
  customer_email text not null,
  customer_phone text not null,
  address text not null,
  city text not null,
  state text not null,
  pin text not null,
  college text not null,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  confirmation_email_sent_at timestamptz
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id integer not null,
  title text not null,
  unit_price bigint not null check (unit_price > 0),
  quantity integer not null check (quantity between 1 and 20)
);

create table if not exists public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  event_id text not null unique,
  payload jsonb not null,
  received_at timestamptz not null default now()
);

create index if not exists orders_gateway_order_idx on public.orders(gateway_order_id);
create index if not exists orders_payment_status_idx on public.orders(payment_status);
create index if not exists orders_created_at_idx on public.orders(created_at desc);

-- Backend uses the Supabase service-role key, so browser access is not needed.
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.webhook_events enable row level security;

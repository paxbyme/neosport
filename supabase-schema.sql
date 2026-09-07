create table if not exists public.products (
  id text primary key,
  name text not null,
  brand text not null,
  category text not null,
  price bigint not null check (price >= 1000),
  discount_percent smallint not null default 0 check (discount_percent between 0 and 90),
  description text not null,
  sizes text[] not null,
  colors jsonb not null,
  -- images[0] is the main photo; image_url mirrors it so the column stays
  -- meaningful for anything reading the table directly.
  images jsonb not null default '[]'::jsonb,
  image_url text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

-- Existing installations: add the columns introduced with discounts and editing.
alter table public.products
  add column if not exists discount_percent smallint not null default 0,
  add column if not exists updated_at timestamptz,
  add column if not exists images jsonb not null default '[]'::jsonb;

-- Products saved before the gallery existed keep their single photo as the first.
update public.products
   set images = jsonb_build_array(image_url)
 where jsonb_array_length(images) = 0 and image_url is not null and image_url <> '';

create table if not exists public.orders (
  id text primary key,
  created_at timestamptz not null default now(),
  customer_name text not null,
  customer_phone text not null,
  -- Null for guest checkout: signing in is optional for customers.
  user_id text,
  user_email text,
  items jsonb not null,
  total bigint not null
);

-- Existing installations: link orders to the Google account that placed them.
alter table public.orders
  add column if not exists user_id text,
  add column if not exists user_email text;

-- A customer's order history is looked up by account.
create index if not exists orders_user_id_idx on public.orders (user_id);

-- Statistics read the newest orders first.
create index if not exists orders_created_at_idx on public.orders (created_at desc);

-- One row per Telegram sign-in attempt. The browser holds the token in an
-- HttpOnly cookie; the bot fills in who verified it.
create table if not exists public.login_tokens (
  token text primary key,
  created_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'verified', 'used')),
  chat_id text,
  phone text,
  full_name text,
  next_path text not null default '/'
);

create index if not exists login_tokens_created_at_idx on public.login_tokens (created_at);

alter table public.login_tokens enable row level security;

alter table public.products enable row level security;
alter table public.orders enable row level security;

-- Product and order reads and writes go through the server with the
-- service-role key; no anon policy is defined on purpose, so the orders table
-- (which holds customer names and phone numbers) is unreachable from browsers.
-- Create a public Storage bucket named "product-images" in the Supabase dashboard.

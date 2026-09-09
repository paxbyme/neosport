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

-- The category list the admin panel manages. Products keep the category name
-- as text, so renaming a row here rewrites every product wearing the old name.
create table if not exists public.categories (
  id text primary key,
  name text not null,
  -- Decides which size set the product form offers: letters or EU numbers.
  size_type text not null default 'clothing' check (size_type in ('clothing', 'shoes')),
  -- The order the panel and the category select show them in.
  position integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

-- Two categories with the same name would make the product select ambiguous.
create unique index if not exists categories_name_idx on public.categories (lower(name));

alter table public.categories enable row level security;

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

-- Existing installations: link orders to the account that placed them. A
-- Google account is known by its email, a Telegram one by its phone number, so
-- both columns are optional and an order may carry either.
alter table public.orders
  add column if not exists user_id text,
  add column if not exists user_email text,
  add column if not exists user_phone text;

-- A customer's order history is looked up by account.
create index if not exists orders_user_id_idx on public.orders (user_id);

-- Statistics read the newest orders first.
create index if not exists orders_created_at_idx on public.orders (created_at desc);

-- One row per registered customer. Sharing a contact with the bot is both the
-- sign-up and the sign-in, so this table is written the moment a phone number
-- is verified. The session cookie is proof of identity on its own; this row is
-- what makes a returning customer recognisable and countable.
create table if not exists public.users (
  -- "tg:<chat_id>", the same value orders.user_id carries.
  id text primary key,
  phone text not null,
  full_name text not null default '',
  telegram_chat_id text,
  created_at timestamptz not null default now(),
  last_login_at timestamptz not null default now()
);

-- Deliberately not unique: one person may hold two Telegram accounts on the
-- same number, and a unique index would turn their second sign-in into an error.
create index if not exists users_phone_idx on public.users (phone);

create index if not exists users_created_at_idx on public.users (created_at desc);

alter table public.users enable row level security;

-- Admins the panel itself manages, alongside ADMIN_EMAILS and ADMIN_PHONES.
-- The environment lists stay the recovery path: they need no database, they
-- are recomputed on every request, and the panel cannot remove them, so a bad
-- row here can never lock everyone out of the shop.
create table if not exists public.admins (
  -- "email:<address>" or "phone:<digits>" — the identifier a session matches on.
  id text primary key,
  -- Exactly one of these is set; the other stays empty. A session is matched
  -- only on the identifier it actually carries, never on an empty string.
  email text not null default '',
  phone text not null default '',
  name text not null default '',
  created_at timestamptz not null default now(),
  -- Who granted the access, for the panel to show.
  created_by text not null default ''
);

create index if not exists admins_email_idx on public.admins (email);
create index if not exists admins_phone_idx on public.admins (phone);

alter table public.admins enable row level security;

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

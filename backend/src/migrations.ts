// Schema migrations, applied in order at boot and recorded in konnect.schema_migrations.
// Never edit one that has shipped; add a new one.
//
// Money is integer KES throughout. Ad spend is kept in thousandths of a shilling so a
// single CPM impression (KES 0.32) is exact.

export const MIGRATIONS: { id: string; sql: string }[] = [
  {
    id: "001_core",
    sql: `
create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(email)),
  phone text not null unique,                       -- E.164, +2547XXXXXXXX
  password_hash text not null,
  full_name text not null,
  date_of_birth date not null,
  gender text not null check (gender in ('woman','man','nonbinary')),
  bio text not null default '',
  photo_url text,
  city text not null default 'Nairobi',
  neighbourhood text,
  phone_verified_at timestamptz,
  id_verified_at timestamptz,
  income_verified_at timestamptz,
  background_checked_at timestamptz,
  status text not null default 'active' check (status in ('active','suspended','deleted')),
  suspended_reason text,
  token_version integer not null default 0,
  referral_code text not null unique,
  referred_by uuid references users(id) on delete set null,
  referral_rewarded_at timestamptz,
  trusted_contact_name text,
  trusted_contact_phone text,
  prefs jsonb not null default '{}'::jsonb,
  is_sample boolean not null default false,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table otp_codes (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  purpose text not null check (purpose in ('verify','reset','login')),
  code_hash text not null,
  attempts integer not null default 0,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index otp_codes_phone on otp_codes(phone, purpose, created_at desc);

-- Append-only plan history. The latest ACTIVE row with a future expiry is the current plan.
create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  plan text not null default 'PREMIUM' check (plan in ('PREMIUM')),
  period text not null check (period in ('monthly','annual','gift')),
  status text not null check (status in ('PENDING','ACTIVE','EXPIRED','CANCELLED','FAILED')),
  starts_at timestamptz,
  expires_at timestamptz,
  amount_kes integer not null default 0,
  source text not null check (source in ('mpesa','referral','admin')),
  payment_id uuid,
  created_at timestamptz not null default now()
);
create index subscriptions_user on subscriptions(user_id, created_at desc);

create table media (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references users(id) on delete cascade,
  mime text not null,
  bytes bytea not null,
  width integer,
  height integer,
  private boolean not null default false,
  created_at timestamptz not null default now()
);

create table listings (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references users(id) on delete cascade,
  type text not null check (type in ('STAY','WELLNESS')),
  title text not null,
  summary text not null default '',
  description text not null default '',
  city text not null,
  neighbourhood text not null,
  price_kes integer not null check (price_kes > 0),
  -- Stays
  bedrooms integer,
  bathrooms integer,
  max_guests integer,
  min_nights integer not null default 1,
  check_in_time text,
  check_out_time text,
  house_rules text not null default '',
  -- Wellness
  category text check (category in ('massage','physiotherapy','beauty','spa','fitness')),
  duration_min integer,
  service_modes text[] not null default '{}',     -- home, studio
  deposit_pct integer check (deposit_pct between 0 and 100),
  hours jsonb,                                     -- {"1":["09:00","18:00"], ...} keyed by ISO weekday
  amenities text[] not null default '{}',
  photos text[] not null default '{}',
  status text not null default 'DRAFT' check (status in ('DRAFT','PENDING','APPROVED','REJECTED','PAUSED')),
  rejection_reason text,
  featured_until timestamptz,
  rating_avg numeric(3,2) not null default 0,
  rating_count integer not null default 0,
  is_sample boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index listings_browse on listings(type, status, city, neighbourhood);
create index listings_host on listings(host_id);

-- Dates a host has closed on a stay.
create table listing_blocks (
  listing_id uuid not null references listings(id) on delete cascade,
  day date not null,
  primary key (listing_id, day)
);

create table bookings (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique,                         -- short code shown to people, e.g. KB7Q2M
  listing_id uuid not null references listings(id),
  user_id uuid not null references users(id),
  host_id uuid not null references users(id),
  kind text not null check (kind in ('STAY','WELLNESS')),
  check_in date,
  check_out date,
  starts_at timestamptz,
  ends_at timestamptz,
  guests integer not null default 1,
  service_mode text check (service_mode in ('home','studio')),
  visit_address text,
  nights integer,
  unit_price_kes integer not null,
  subtotal_kes integer not null,
  platform_fee_kes integer not null,
  total_kes integer not null,
  pay_mode text not null default 'full' check (pay_mode in ('full','deposit')),
  due_now_kes integer not null,
  status text not null default 'PENDING_PAYMENT' check (status in ('PENDING_PAYMENT','CONFIRMED','CANCELLED','COMPLETED','EXPIRED')),
  notes text not null default '',
  payment_id uuid,
  cancel_reason text,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  completed_at timestamptz
);
create index bookings_user on bookings(user_id, created_at desc);
create index bookings_host on bookings(host_id, created_at desc);
create index bookings_listing on bookings(listing_id, status);

create table payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id),
  purpose text not null check (purpose in ('BOOKING','SUBSCRIPTION','AD_CAMPAIGN','PROMOTION')),
  ref_id uuid,
  phone text not null,
  amount_kes integer not null check (amount_kes > 0),
  account_ref text not null,
  description text not null,
  status text not null default 'PENDING' check (status in ('PENDING','SUCCESS','FAILED','CANCELLED')),
  driver text not null,
  mpesa_checkout_id text unique,
  merchant_request_id text,
  mpesa_receipt text,
  result_code text,
  result_desc text,
  raw_callback jsonb,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index payments_user on payments(user_id, created_at desc);
create index payments_status on payments(status, created_at);

create table reviews (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references bookings(id),
  listing_id uuid not null references listings(id) on delete cascade,
  author_id uuid not null references users(id) on delete cascade,
  rating integer not null check (rating between 1 and 5),
  body text not null default '',
  host_reply text,
  flagged boolean not null default false,
  created_at timestamptz not null default now()
);
create index reviews_listing on reviews(listing_id, created_at desc);

create table payouts (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references users(id),
  booking_id uuid not null unique references bookings(id),
  amount_kes integer not null,
  phone text not null,
  status text not null default 'SCHEDULED' check (status in ('SCHEDULED','PAID','FAILED','HELD')),
  due_at timestamptz not null,
  paid_at timestamptz,
  reference text,
  created_at timestamptz not null default now()
);
create index payouts_host on payouts(host_id, created_at desc);

create table connect_profiles (
  user_id uuid primary key references users(id) on delete cascade,
  headline text not null default '',
  intent text not null default 'dating' check (intent in ('relationship','dating','friendship','arrangement')),
  arrangement_role text check (arrangement_role in ('benefactor','seeking')),
  interested_in text[] not null default '{}',
  age_min integer not null default 21 check (age_min >= 18),
  age_max integer not null default 45 check (age_max <= 99),
  interests text[] not null default '{}',
  photos text[] not null default '{}',
  occupation text not null default '',
  visible boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table likes (
  from_user uuid not null references users(id) on delete cascade,
  to_user uuid not null references users(id) on delete cascade,
  kind text not null default 'like' check (kind in ('like','pass')),
  created_at timestamptz not null default now(),
  primary key (from_user, to_user)
);
create index likes_to on likes(to_user, kind);

-- user_a < user_b, so a pair has exactly one row.
create table matches (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references users(id) on delete cascade,
  user_b uuid not null references users(id) on delete cascade,
  status text not null default 'active' check (status in ('active','ended')),
  created_at timestamptz not null default now(),
  last_message_at timestamptz,
  unique (user_a, user_b),
  check (user_a < user_b)
);

create table messages (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references matches(id) on delete cascade,
  sender_id uuid not null references users(id) on delete cascade,
  receiver_id uuid not null references users(id) on delete cascade,
  content text not null check (length(content) between 1 and 4000),
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);
create index messages_match on messages(match_id, created_at);
create index messages_unread on messages(receiver_id) where not is_read;

create table blocks (
  blocker_id uuid not null references users(id) on delete cascade,
  blocked_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id)
);

create table reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references users(id) on delete cascade,
  target_user_id uuid references users(id) on delete cascade,
  target_listing_id uuid references listings(id) on delete cascade,
  reason text not null,
  details text not null default '',
  status text not null default 'OPEN' check (status in ('OPEN','ACTIONED','DISMISSED')),
  resolution text,
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create table safety_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  kind text not null check (kind in ('checkin','sos')),
  with_user_id uuid references users(id) on delete set null,
  place text,
  meet_at timestamptz,
  lat double precision,
  lng double precision,
  notified_contact boolean not null default false,
  status text not null default 'OPEN' check (status in ('OPEN','SAFE','HANDLED')),
  created_at timestamptz not null default now()
);

create table verifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  kind text not null check (kind in ('ID','INCOME','BACKGROUND')),
  status text not null default 'PENDING' check (status in ('PENDING','APPROVED','REJECTED')),
  documents uuid[] not null default '{}',
  note text not null default '',
  reviewer_note text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index verifications_status on verifications(status, created_at);

create table ads (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references users(id) on delete set null,   -- null for campaigns the team runs
  advertiser text not null,
  headline text not null,
  ad_text text not null default '',
  image_url text,
  cta_label text not null default 'Learn more',
  target_url text not null,
  billing text not null default 'CPM' check (billing in ('CPM','CPC')),
  budget_kes integer not null default 0,
  spent_mkes bigint not null default 0,
  impressions integer not null default 0,
  clicks integer not null default 0,
  status text not null default 'DRAFT' check (status in ('DRAFT','PENDING_PAYMENT','PENDING_REVIEW','ACTIVE','PAUSED','ENDED','REJECTED')),
  is_house boolean not null default false,
  review_note text,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now()
);

create table ad_events (
  id bigserial primary key,
  ad_id uuid not null references ads(id) on delete cascade,
  user_id uuid,
  kind text not null check (kind in ('impression','click')),
  cost_mkes integer not null default 0,
  created_at timestamptz not null default now()
);
create index ad_events_ad on ad_events(ad_id, created_at);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  kind text not null,
  title text not null,
  body text not null default '',
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user on notifications(user_id, created_at desc);

create table admin_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(email)),
  name text not null,
  role text not null default 'admin' check (role in ('owner','admin','moderator','finance')),
  password_hash text not null,
  totp_secret text,               -- encrypted with MASTER_KEY
  totp_enabled boolean not null default false,
  token_version integer not null default 0,
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);

create table audit_log (
  id bigserial primary key,
  admin_id uuid references admin_users(id) on delete set null,
  action text not null,
  target_type text,
  target_id text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
`,
  },
];

// Row level security on, no policies: konnect_api owns the tables and bypasses it, and
// every other role (including Supabase's anon and authenticated) sees nothing.
MIGRATIONS.push({
  id: "002_rls",
  sql: `
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = current_schema() loop
    execute format('alter table %I enable row level security', t.tablename);
  end loop;
end $$;
`,
});

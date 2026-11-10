-- Supabase > SQL Editor mein ye poora paste karke Run karein.

create table if not exists public.qaza_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.qaza_data enable row level security;

create policy "apna data dekhein" on public.qaza_data
  for select using (auth.uid() = user_id);

create policy "apna data banayein" on public.qaza_data
  for insert with check (auth.uid() = user_id);

create policy "apna data badlein" on public.qaza_data
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "apna data hatayein" on public.qaza_data
  for delete using (auth.uid() = user_id);

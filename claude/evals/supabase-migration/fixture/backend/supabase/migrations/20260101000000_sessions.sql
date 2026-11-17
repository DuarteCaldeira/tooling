create table public.sessions (id uuid primary key, user_id uuid not null, weight numeric);
alter table public.sessions enable row level security;
create policy "own sessions" on public.sessions using (auth.uid() = user_id);

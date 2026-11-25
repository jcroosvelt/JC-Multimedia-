-- Marche arrière : retour aux anciennes règles (déconseillé, elles sont trop ouvertes).
drop policy if exists "public upload order files" on storage.objects;
create policy "public upload order files" on storage.objects for insert to public
  with check (bucket_id = 'order-uploads');
drop policy if exists "public insert order_uploads" on public.order_uploads;
create policy "public insert order_uploads" on public.order_uploads for insert to public with check (true);
drop policy if exists "public log page views" on public.page_views;
create policy "public log page views" on public.page_views for insert to public with check (true);

-- Audit sécurité 25/11/2026 — envois de fichiers : fin des écritures publiques ouvertes.
-- Avant : n'importe qui pouvait déposer des fichiers dans le stockage privé et ajouter
-- des lignes order_uploads sur n'importe quelle commande (condition « true »).
-- Après : uniquement dans le dossier « <id commande>/ » d'une commande créée il y a moins
-- de 2 h (order_accepts_uploads), chemin cohérent, fichier ≤ 5 Mo.
-- Testé dans une transaction annulée : envoi légitime accepté, 5 cas abusifs refusés.

drop policy if exists "public upload order files" on storage.objects;
create policy "public upload order files" on storage.objects for insert to public
  with check (bucket_id = 'order-uploads'
    and (storage.foldername(name))[1] ~ '^[0-9]{1,18}$'
    and public.order_accepts_uploads(((storage.foldername(name))[1])::bigint));

drop policy if exists "public insert order_uploads" on public.order_uploads;
create policy "public insert order_uploads" on public.order_uploads for insert to public
  with check (public.order_accepts_uploads(order_id)
    and storage_path like (order_id::text || '/%')
    and (size_bytes is null or size_bytes between 0 and 5242880)
    and (original_filename is null or length(original_filename) <= 255));

-- Journal des visites : empêche l'envoi de valeurs démesurées.
drop policy if exists "public log page views" on public.page_views;
create policy "public log page views" on public.page_views for insert to public
  with check (length(page) between 1 and 200);

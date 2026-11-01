-- Verrouillage de la base JC Multimedia (projet tkwrklboqspkzxtlvnzh)
-- À coller dans Supabase → SQL Editor, puis « Run ».

-- 1) Plus personne ne peut écrire directement dans les commandes,
--    lignes, paiements et historique (le site passe par place_public_order)
drop policy if exists "public insert orders" on public.orders;
drop policy if exists "public insert order_items" on public.order_items;
drop policy if exists "public insert payments" on public.payments;
drop policy if exists "public insert initial status" on public.order_status_history;

-- L'admin garde ses droits (commandes WhatsApp / lien de paiement)
create policy "admin insert orders" on public.orders for insert to authenticated
  with check ((select auth.uid()) = '61ae6870-e56e-40b0-a502-3e72444dc688'::uuid);
create policy "admin insert order_items" on public.order_items for insert to authenticated
  with check ((select auth.uid()) = '61ae6870-e56e-40b0-a502-3e72444dc688'::uuid);
create policy "admin insert payments" on public.payments for insert to authenticated
  with check ((select auth.uid()) = '61ae6870-e56e-40b0-a502-3e72444dc688'::uuid);

-- 2) Ancienne fonction de commande désactivée
revoke execute on function public.create_public_order(jsonb) from anon, authenticated, public;

-- 3) Avis publics toujours « non approuvés »
drop policy if exists "public insert reviews" on public.reviews;
create policy "public insert reviews" on public.reviews for insert to anon, authenticated
  with check (is_approved = false and (rating is null or rating between 1 and 5)
              and length(customer_name) between 1 and 120 and (comment is null or length(comment) <= 3000));

-- 4) Le public ne voit que les codes promo actifs (l'admin voit tout)
drop policy if exists "public read active promo codes" on public.promo_codes;
create policy "public read active promo codes" on public.promo_codes for select using (active = true);
create policy "admin read promo codes" on public.promo_codes for select to authenticated
  using ((select auth.uid()) = '61ae6870-e56e-40b0-a502-3e72444dc688'::uuid);

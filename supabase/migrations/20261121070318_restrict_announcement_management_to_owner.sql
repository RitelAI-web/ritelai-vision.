DROP POLICY IF EXISTS "announcements staff insert" ON public.announcements;
CREATE POLICY "announcements owner insert" ON public.announcements
  FOR INSERT TO authenticated
  WITH CHECK (private.is_owner());

DROP POLICY IF EXISTS "announcements staff update" ON public.announcements;
CREATE POLICY "announcements owner update" ON public.announcements
  FOR UPDATE TO authenticated
  USING (private.is_owner())
  WITH CHECK (private.is_owner());

DROP POLICY IF EXISTS "announcements staff delete" ON public.announcements;
CREATE POLICY "announcements owner delete" ON public.announcements
  FOR DELETE TO authenticated
  USING (private.is_owner());
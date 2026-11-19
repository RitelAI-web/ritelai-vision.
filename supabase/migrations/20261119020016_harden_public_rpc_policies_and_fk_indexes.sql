-- RitelAI security hardening: keep public read paths public, staff paths authenticated-only.
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_staff() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_staff() TO authenticated;

DROP POLICY IF EXISTS "announcements published read" ON public.announcements;
CREATE POLICY "announcements published read"
  ON public.announcements FOR SELECT TO anon, authenticated
  USING (is_published = true);
DROP POLICY IF EXISTS "announcements staff manage" ON public.announcements;
CREATE POLICY "announcements staff manage"
  ON public.announcements FOR ALL TO authenticated
  USING (public.is_staff()) WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "plans visible active" ON public.plans;
CREATE POLICY "plans visible active"
  ON public.plans FOR SELECT TO anon, authenticated
  USING (is_active = true);
DROP POLICY IF EXISTS "plans staff manage" ON public.plans;
CREATE POLICY "plans staff manage"
  ON public.plans FOR ALL TO authenticated
  USING (public.is_staff()) WITH CHECK (public.is_staff());

CREATE INDEX IF NOT EXISTS analysis_history_user_id_idx ON public.analysis_history(user_id);
CREATE INDEX IF NOT EXISTS announcements_created_by_idx ON public.announcements(created_by);
CREATE INDEX IF NOT EXISTS audit_logs_actor_id_idx ON public.audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS mt5_signal_queue_device_id_idx ON public.mt5_signal_queue(device_id);
CREATE INDEX IF NOT EXISTS payment_proofs_plan_id_idx ON public.payment_proofs(plan_id);
CREATE INDEX IF NOT EXISTS payment_proofs_reviewed_by_idx ON public.payment_proofs(reviewed_by);
CREATE INDEX IF NOT EXISTS payment_proofs_user_id_idx ON public.payment_proofs(user_id);
CREATE INDEX IF NOT EXISTS promo_redemptions_plan_id_idx ON public.promo_redemptions(plan_id);
CREATE INDEX IF NOT EXISTS subscriptions_plan_id_idx ON public.subscriptions(plan_id);
CREATE INDEX IF NOT EXISTS subscriptions_user_id_idx ON public.subscriptions(user_id);

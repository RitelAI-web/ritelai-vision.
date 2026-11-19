-- Avoid duplicate permissive SELECT policies while preserving public catalogue reads.
DROP POLICY IF EXISTS "announcements published read" ON public.announcements;
DROP POLICY IF EXISTS "announcements staff manage" ON public.announcements;
CREATE POLICY "announcements public published read" ON public.announcements FOR SELECT TO anon USING (is_published = true);
CREATE POLICY "announcements authenticated read" ON public.announcements FOR SELECT TO authenticated USING (is_published = true OR private.is_staff());
CREATE POLICY "announcements staff insert" ON public.announcements FOR INSERT TO authenticated WITH CHECK (private.is_staff());
CREATE POLICY "announcements staff update" ON public.announcements FOR UPDATE TO authenticated USING (private.is_staff()) WITH CHECK (private.is_staff());
CREATE POLICY "announcements staff delete" ON public.announcements FOR DELETE TO authenticated USING (private.is_staff());

DROP POLICY IF EXISTS "plans visible active" ON public.plans;
DROP POLICY IF EXISTS "plans staff manage" ON public.plans;
CREATE POLICY "plans public active read" ON public.plans FOR SELECT TO anon USING (is_active = true);
CREATE POLICY "plans authenticated read" ON public.plans FOR SELECT TO authenticated USING (is_active = true OR private.is_staff());
CREATE POLICY "plans staff insert" ON public.plans FOR INSERT TO authenticated WITH CHECK (private.is_staff());
CREATE POLICY "plans staff update" ON public.plans FOR UPDATE TO authenticated USING (private.is_staff()) WITH CHECK (private.is_staff());
CREATE POLICY "plans staff delete" ON public.plans FOR DELETE TO authenticated USING (private.is_staff());

DROP POLICY IF EXISTS "profile read self or staff" ON public.profiles;
CREATE POLICY "profile read self or staff" ON public.profiles FOR SELECT TO authenticated USING (id = (SELECT auth.uid()) OR private.is_staff());
DROP POLICY IF EXISTS "subscriptions own or staff" ON public.subscriptions;
CREATE POLICY "subscriptions own or staff" ON public.subscriptions FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()) OR private.is_staff());
DROP POLICY IF EXISTS "payment proofs own read" ON public.payment_proofs;
CREATE POLICY "payment proofs own read" ON public.payment_proofs FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()) OR private.is_staff());
DROP POLICY IF EXISTS "payment proofs own insert" ON public.payment_proofs;
CREATE POLICY "payment proofs own insert" ON public.payment_proofs FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()) AND status = 'pending');
DROP POLICY IF EXISTS "payment proofs staff update" ON public.payment_proofs;
CREATE POLICY "payment proofs staff update" ON public.payment_proofs FOR UPDATE TO authenticated USING (private.is_staff()) WITH CHECK (private.is_staff());
DROP POLICY IF EXISTS "analysis own or staff read" ON public.analysis_history;
CREATE POLICY "analysis own or staff read" ON public.analysis_history FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()) OR private.is_staff());
DROP POLICY IF EXISTS "analysis own insert" ON public.analysis_history;
CREATE POLICY "analysis own insert" ON public.analysis_history FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "Users manage their own push subscriptions" ON public.push_subscriptions;
CREATE POLICY "Users manage their own push subscriptions" ON public.push_subscriptions FOR ALL TO authenticated USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);
DROP POLICY IF EXISTS "Users can read own backtests" ON public.backtest_runs;
CREATE POLICY "Users can read own backtests" ON public.backtest_runs FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
DROP POLICY IF EXISTS "Users can insert own backtests" ON public.backtest_runs;
CREATE POLICY "Users can insert own backtests" ON public.backtest_runs FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);

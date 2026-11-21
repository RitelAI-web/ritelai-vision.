ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role = ANY (ARRAY['customer'::text, 'admin'::text, 'owner'::text, 'super_admin'::text]));

CREATE OR REPLACE FUNCTION private.is_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role IN ('admin','owner','super_admin')
  );
$function$;

CREATE OR REPLACE FUNCTION private.is_owner()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role = 'owner'
  );
$function$;

REVOKE ALL ON FUNCTION private.is_owner() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.is_owner() TO authenticated;

DROP POLICY IF EXISTS "plans staff insert" ON public.plans;
CREATE POLICY "plans owner insert" ON public.plans
  FOR INSERT TO authenticated
  WITH CHECK (private.is_owner());

DROP POLICY IF EXISTS "plans staff update" ON public.plans;
CREATE POLICY "plans owner update" ON public.plans
  FOR UPDATE TO authenticated
  USING (private.is_owner())
  WITH CHECK (private.is_owner());

DROP POLICY IF EXISTS "plans staff delete" ON public.plans;
CREATE POLICY "plans owner delete" ON public.plans
  FOR DELETE TO authenticated
  USING (private.is_owner());

DROP POLICY IF EXISTS "payment proofs staff update" ON public.payment_proofs;
CREATE POLICY "payment proofs owner update" ON public.payment_proofs
  FOR UPDATE TO authenticated
  USING (private.is_owner())
  WITH CHECK (private.is_owner());
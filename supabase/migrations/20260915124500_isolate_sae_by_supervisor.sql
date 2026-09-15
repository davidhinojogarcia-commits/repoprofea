-- Isolate SAE data by supervisor while preserving module-level permissions.
-- Child rows without owner_id inherit access from their parent need.

DROP POLICY IF EXISTS sae_needs_read ON public.sae_needs;
DROP POLICY IF EXISTS sae_needs_insert ON public.sae_needs;
DROP POLICY IF EXISTS sae_needs_update ON public.sae_needs;
DROP POLICY IF EXISTS sae_needs_delete ON public.sae_needs;

CREATE POLICY sae_needs_read ON public.sae_needs FOR SELECT TO authenticated
USING (public.sae_has_permission('read') AND owner_id = (SELECT auth.uid()));
CREATE POLICY sae_needs_insert ON public.sae_needs FOR INSERT TO authenticated
WITH CHECK (public.sae_has_permission('create') AND owner_id = (SELECT auth.uid()) AND created_by = (SELECT auth.uid()));
CREATE POLICY sae_needs_update ON public.sae_needs FOR UPDATE TO authenticated
USING (public.sae_has_permission('update') AND owner_id = (SELECT auth.uid()))
WITH CHECK (public.sae_has_permission('update') AND owner_id = (SELECT auth.uid()));
CREATE POLICY sae_needs_delete ON public.sae_needs FOR DELETE TO authenticated
USING (public.sae_has_permission('delete') AND owner_id = (SELECT auth.uid()));

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sae_reports','sae_candidates','sae_registration_drafts','sae_generated_documents'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_read ON public.%I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_insert ON public.%I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_update ON public.%I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_delete ON public.%I', t, t);
    EXECUTE format('CREATE POLICY %I_read ON public.%I FOR SELECT TO authenticated USING (public.sae_has_permission(''read'') AND owner_id = (SELECT auth.uid()))', t, t);
    EXECUTE format('CREATE POLICY %I_insert ON public.%I FOR INSERT TO authenticated WITH CHECK (public.sae_has_permission(''create'') AND owner_id = (SELECT auth.uid()) AND created_by = (SELECT auth.uid()))', t, t);
    EXECUTE format('CREATE POLICY %I_update ON public.%I FOR UPDATE TO authenticated USING (public.sae_has_permission(''update'') AND owner_id = (SELECT auth.uid())) WITH CHECK (public.sae_has_permission(''update'') AND owner_id = (SELECT auth.uid()))', t, t);
    EXECUTE format('CREATE POLICY %I_delete ON public.%I FOR DELETE TO authenticated USING (public.sae_has_permission(''delete'') AND owner_id = (SELECT auth.uid()))', t, t);
  END LOOP;
END $$;

DROP POLICY IF EXISTS sae_need_categories_read ON public.sae_need_categories;
DROP POLICY IF EXISTS sae_need_categories_insert ON public.sae_need_categories;
DROP POLICY IF EXISTS sae_need_categories_update ON public.sae_need_categories;
DROP POLICY IF EXISTS sae_need_categories_delete ON public.sae_need_categories;
CREATE POLICY sae_need_categories_read ON public.sae_need_categories FOR SELECT TO authenticated
USING (public.sae_has_permission('read') AND EXISTS (SELECT 1 FROM public.sae_needs n WHERE n.id = need_id AND n.owner_id = (SELECT auth.uid())));
CREATE POLICY sae_need_categories_insert ON public.sae_need_categories FOR INSERT TO authenticated
WITH CHECK (public.sae_has_permission('create') AND created_by = (SELECT auth.uid()) AND EXISTS (SELECT 1 FROM public.sae_needs n WHERE n.id = need_id AND n.owner_id = (SELECT auth.uid())));
CREATE POLICY sae_need_categories_update ON public.sae_need_categories FOR UPDATE TO authenticated
USING (public.sae_has_permission('update') AND EXISTS (SELECT 1 FROM public.sae_needs n WHERE n.id = need_id AND n.owner_id = (SELECT auth.uid())))
WITH CHECK (public.sae_has_permission('update') AND EXISTS (SELECT 1 FROM public.sae_needs n WHERE n.id = need_id AND n.owner_id = (SELECT auth.uid())));
CREATE POLICY sae_need_categories_delete ON public.sae_need_categories FOR DELETE TO authenticated
USING (public.sae_has_permission('delete') AND EXISTS (SELECT 1 FROM public.sae_needs n WHERE n.id = need_id AND n.owner_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS sae_candidate_allocations_read ON public.sae_candidate_allocations;
DROP POLICY IF EXISTS sae_candidate_allocations_insert ON public.sae_candidate_allocations;
DROP POLICY IF EXISTS sae_candidate_allocations_update ON public.sae_candidate_allocations;
DROP POLICY IF EXISTS sae_candidate_allocations_delete ON public.sae_candidate_allocations;
CREATE POLICY sae_candidate_allocations_read ON public.sae_candidate_allocations FOR SELECT TO authenticated
USING (public.sae_has_permission('read') AND EXISTS (SELECT 1 FROM public.sae_needs n WHERE n.id = need_id AND n.owner_id = (SELECT auth.uid())));
CREATE POLICY sae_candidate_allocations_insert ON public.sae_candidate_allocations FOR INSERT TO authenticated
WITH CHECK (public.sae_has_permission('create') AND EXISTS (SELECT 1 FROM public.sae_needs n WHERE n.id = need_id AND n.owner_id = (SELECT auth.uid())));
CREATE POLICY sae_candidate_allocations_update ON public.sae_candidate_allocations FOR UPDATE TO authenticated
USING (public.sae_has_permission('update') AND EXISTS (SELECT 1 FROM public.sae_needs n WHERE n.id = need_id AND n.owner_id = (SELECT auth.uid())))
WITH CHECK (public.sae_has_permission('update') AND EXISTS (SELECT 1 FROM public.sae_needs n WHERE n.id = need_id AND n.owner_id = (SELECT auth.uid())));
CREATE POLICY sae_candidate_allocations_delete ON public.sae_candidate_allocations FOR DELETE TO authenticated
USING (public.sae_has_permission('delete') AND EXISTS (SELECT 1 FROM public.sae_needs n WHERE n.id = need_id AND n.owner_id = (SELECT auth.uid())));

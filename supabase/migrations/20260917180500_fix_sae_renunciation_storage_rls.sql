-- Fix SAE renunciation PDF uploads after supervisor isolation.
-- Renunciation files are stored under: <sae_need_id>/renuncias/<candidate_id>/...
-- Keep storage isolated per supervisor and allow inserts only for needs owned by the current user.

DROP POLICY IF EXISTS sae_documents_insert ON storage.objects;
DROP POLICY IF EXISTS sae_documents_read ON storage.objects;
DROP POLICY IF EXISTS sae_documents_update ON storage.objects;
DROP POLICY IF EXISTS sae_documents_delete ON storage.objects;

CREATE POLICY sae_documents_insert
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'sae-documents'
  AND public.sae_has_permission('create')
  AND EXISTS (
    SELECT 1
    FROM public.sae_needs n
    WHERE n.id::text = (storage.foldername(name))[1]
      AND n.owner_id = (SELECT auth.uid())
  )
);

CREATE POLICY sae_documents_read
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'sae-documents'
  AND owner_id = ((SELECT auth.uid()))::text
  AND public.sae_has_permission('read')
);

CREATE POLICY sae_documents_update
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'sae-documents'
  AND owner_id = ((SELECT auth.uid()))::text
  AND public.sae_has_permission('update')
)
WITH CHECK (
  bucket_id = 'sae-documents'
  AND owner_id = ((SELECT auth.uid()))::text
  AND public.sae_has_permission('update')
);

CREATE POLICY sae_documents_delete
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'sae-documents'
  AND owner_id = ((SELECT auth.uid()))::text
  AND public.sae_has_permission('delete')
);

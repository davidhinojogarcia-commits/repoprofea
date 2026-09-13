-- Cover every SAE foreign key used by joins, deletes and audit attribution.
create index if not exists sae_allocations_need_idx on public.sae_candidate_allocations (need_id);
create index if not exists sae_allocations_assigned_by_idx on public.sae_candidate_allocations (assigned_by);

create index if not exists sae_candidates_owner_idx on public.sae_candidates (owner_id);
create index if not exists sae_candidates_existing_worker_idx on public.sae_candidates (existing_worker_owner_id, existing_worker_id);
create index if not exists sae_candidates_created_by_idx on public.sae_candidates (created_by);
create index if not exists sae_candidates_updated_by_idx on public.sae_candidates (updated_by);

create index if not exists sae_generated_source_report_idx on public.sae_generated_documents (source_report_id);
create index if not exists sae_generated_owner_idx on public.sae_generated_documents (owner_id);
create index if not exists sae_generated_created_by_idx on public.sae_generated_documents (created_by);

create index if not exists sae_need_categories_created_by_idx on public.sae_need_categories (created_by);
create index if not exists sae_needs_owner_idx on public.sae_needs (owner_id);
create index if not exists sae_needs_created_by_idx on public.sae_needs (created_by);
create index if not exists sae_needs_updated_by_idx on public.sae_needs (updated_by);

create index if not exists sae_drafts_owner_idx on public.sae_registration_drafts (owner_id);
create index if not exists sae_drafts_existing_worker_idx on public.sae_registration_drafts (existing_worker_owner_id, existing_worker_id);
create index if not exists sae_drafts_created_by_idx on public.sae_registration_drafts (created_by);
create index if not exists sae_drafts_updated_by_idx on public.sae_registration_drafts (updated_by);

create index if not exists sae_reports_owner_idx on public.sae_reports (owner_id);
create index if not exists sae_reports_created_by_idx on public.sae_reports (created_by);
create index if not exists sae_reports_updated_by_idx on public.sae_reports (updated_by);
create index if not exists sae_result_codes_updated_by_idx on public.sae_result_codes (updated_by);

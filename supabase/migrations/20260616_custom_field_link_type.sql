-- Add 'link' as a valid custom field type.
-- Allows master_admin to add URL-type columns to the Clients mega-table.
-- The value is stored as plain text (same as 'text'); the portal renders it
-- as a sanitized anchor rather than editable text.

ALTER TABLE public.client_custom_fields
  DROP CONSTRAINT IF EXISTS client_custom_fields_field_type_check;

ALTER TABLE public.client_custom_fields
  ADD CONSTRAINT client_custom_fields_field_type_check
  CHECK (field_type IN ('text', 'checkbox', 'droplist', 'link'));

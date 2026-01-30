-- =====================================================
-- Vestpod - Create Exports Storage Bucket
-- =====================================================
-- Creates storage bucket for data exports
-- Requirements: 11

-- Create exports bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('exports', 'exports', true)
ON CONFLICT (id) DO NOTHING;

-- Set up RLS policies for exports bucket
CREATE POLICY "Users can upload own exports"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'exports' AND
  auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can view own exports"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'exports' AND
  auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can delete own exports"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'exports' AND
  auth.uid()::text = (storage.foldername(name))[1]
);

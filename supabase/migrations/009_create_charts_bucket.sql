-- =====================================================
-- Vestpod - Create Charts Storage Bucket
-- =====================================================
-- Creates storage bucket for AI-generated portfolio charts
-- Requirements: 1.1, 1.2, 1.3

-- Create charts bucket (private - only accessible via signed URLs)
INSERT INTO storage.buckets (id, name, public)
VALUES ('charts', 'charts', false)
ON CONFLICT (id) DO NOTHING;

-- Set up RLS policies for charts bucket
CREATE POLICY "Users can upload own charts"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'charts' AND
  auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can view own charts"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'charts' AND
  auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can update own charts"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'charts' AND
  auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can delete own charts"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'charts' AND
  auth.uid()::text = (storage.foldername(name))[1]
);

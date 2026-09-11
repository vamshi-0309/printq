import { createServiceRoleClient } from "@/lib/supabase/server";

const BUCKET = "print-files";

/**
 * Upload a file to Supabase Storage. Uses the service-role client
 * because customers are unauthenticated — access control happens
 * at the API route level, not via storage RLS.
 */
export async function uploadFile(
  shopId: string,
  orderId: string,
  filename: string,
  fileBuffer: Buffer,
  contentType: string
): Promise<string> {
  const supabase = createServiceRoleClient();
  const storagePath = `${shopId}/${orderId}/${filename}`;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, fileBuffer, {
      contentType,
      upsert: false,
    });

  if (error) throw new Error(`Storage upload failed: ${error.message}`);
  return storagePath;
}

/**
 * Generate a short-lived signed URL for downloading a file.
 * Used by the Windows agent to fetch print jobs.
 */
export async function getSignedDownloadUrl(
  storagePath: string,
  expiresIn = 300
): Promise<string> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, expiresIn);

  if (error || !data?.signedUrl) {
    throw new Error(`Failed to create signed URL: ${error?.message}`);
  }
  return data.signedUrl;
}

/**
 * Delete a file from storage. Called by the retention cleanup job
 * and after successful printing.
 */
export async function deleteFile(storagePath: string): Promise<void> {
  const supabase = createServiceRoleClient();
  const { error } = await supabase.storage.from(BUCKET).remove([storagePath]);
  if (error) throw new Error(`Storage delete failed: ${error.message}`);
}

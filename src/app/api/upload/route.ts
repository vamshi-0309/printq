import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { validateFile } from "@/lib/fileValidation";
import { countDocumentPages, EncryptedPdfError } from "@/lib/documentPages";

const BUCKET = "print-files";

/**
 * Accepts a customer's document, works out how many pages it will print, and
 * stores it in the shop's private bucket.
 *
 * Page counting happens BEFORE the upload so an unreadable or password-locked
 * file is rejected without leaving bytes in storage, and so the customer finds
 * out immediately rather than after paying.
 */
export async function POST(req: NextRequest) {
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Could not read the upload." }, { status: 400 });
  }

  const file = formData.get("file") as File | null;
  const shopId = formData.get("shopId") as string | null;

  if (!file || !shopId) {
    return NextResponse.json({ error: "Missing file or shopId." }, { status: 400 });
  }

  const validation = validateFile(file.name, file.type, file.size);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const supabase = createServiceRoleClient();

  const { data: shop } = await supabase
    .from("shops")
    .select("id, status")
    .eq("id", shopId)
    .single();

  if (!shop || shop.status !== "active") {
    return NextResponse.json({ error: "Shop not found or inactive." }, { status: 404 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  // Count first: a file we cannot read is a file we should not store.
  let pageCount: number | null = null;
  let pageCountSource: string | null = null;
  let pageCountNote: string | null = null;
  try {
    const result = await countDocumentPages(bytes, file.name);
    if (result.known) {
      pageCount = result.pages;
      pageCountSource = result.source;
    } else {
      pageCountNote = result.reason;
    }
  } catch (err) {
    if (err instanceof EncryptedPdfError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "This file could not be read." },
      { status: 400 }
    );
  }

  const uniqueDir = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  // Strip any path segments a client might smuggle in the filename.
  const safeName = file.name.replace(/[\\/]/g, "_");
  const storagePath = `${shopId}/${uniqueDir}/${safeName}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, bytes, { contentType: file.type, upsert: false });

  if (uploadError) {
    return NextResponse.json({ error: "Upload failed. Please try again." }, { status: 500 });
  }

  return NextResponse.json({
    storagePath,
    originalFilename: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
    // `pageCount` is null when the format carries no reliable count — the UI
    // must ask rather than assume, because this number sets the price.
    pageCount,
    pageCountKnown: pageCount !== null,
    pageCountSource,
    pageCountNote,
  });
}

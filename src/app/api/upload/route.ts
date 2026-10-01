import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { MAX_PAGE_COUNT, validateFile } from "@/lib/fileValidation";
import { countDocumentPages, EncryptedPdfError } from "@/lib/documentPages";
import { allowRequest, clientIp, RATE_LIMITED_MESSAGE, UPLOAD_RATE_LIMIT } from "@/lib/rateLimit";
import { controlsFrom, uploadBlock } from "@/lib/shopControls";

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
    .select("id, status, shop_settings(shop_open, accepting_orders, printing_mode)")
    .eq("id", shopId)
    .single();

  if (!shop || shop.status !== "active") {
    return NextResponse.json({ error: "Shop not found or inactive." }, { status: 404 });
  }

  // A closed shop takes no files at all. A paused one still does, so
  // customers can preview and price their document before it reopens.
  const closed = uploadBlock(
    controlsFrom(shop.shop_settings as unknown as Parameters<typeof controlsFrom>[0])
  );
  if (closed) {
    return NextResponse.json({ error: closed.message, code: closed.code }, { status: 403 });
  }

  // Before the file is counted or stored: a flood of uploads should cost us
  // a row increment, not CPU and storage.
  if (!(await allowRequest(supabase, UPLOAD_RATE_LIMIT, shopId, clientIp(req.headers)))) {
    return NextResponse.json({ error: RATE_LIMITED_MESSAGE, code: "rate_limited" }, { status: 429 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  // Count first: a file we cannot read is a file we should not store.
  let pageCount: number | null = null;
  let pageCountSource: string | null = null;
  let pageCountNote: string | null = null;
  try {
    const result = await countDocumentPages(bytes, file.name);
    if (result.known) {
      // Checked here as well as at order time so the customer is told before
      // they spend time choosing options for a job that can't be accepted.
      if (result.pages > MAX_PAGE_COUNT) {
        return NextResponse.json(
          {
            error: `That document has ${result.pages} pages. The most one order can print is ${MAX_PAGE_COUNT}.`,
          },
          { status: 400 }
        );
      }
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

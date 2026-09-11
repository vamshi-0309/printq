import { NextRequest, NextResponse } from "next/server";
import { requireShop } from "@/lib/shopAuth";
import { getSignedDownloadUrl } from "@/lib/storage";

/**
 * A short-lived link to the customer's document, for the shop that owns it.
 *
 * Customer files live in a private bucket and are never public. This route is
 * the only way a shop owner reaches one, and it:
 *
 *   - proves membership before looking anything up;
 *   - scopes the order lookup by shop_id, so another shop's order UUID is a
 *     404 rather than a document;
 *   - refuses files retention has already removed;
 *   - mints a URL that expires in two minutes — long enough to open, too
 *     short to be worth passing around;
 *   - records the access in audit_logs, because this is somebody's personal
 *     paperwork and reading it should leave a trace.
 *
 * It is a POST because it has a side effect (minting a credential and writing
 * an audit row), and because a URL like this should never end up in a browser
 * history or a prefetch.
 */

export const dynamic = "force-dynamic";

const SIGNED_URL_TTL_SECONDS = 120;

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const auth = await requireShop();
  if (!auth.ok) return auth.response;
  const { shopId, userId, db } = auth.ctx;
  const { orderId } = await params;

  const { data: order } = await db
    .from("orders")
    .select("id, public_order_id")
    .eq("id", orderId)
    .eq("shop_id", shopId)
    .maybeSingle();

  if (!order) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }

  const { data: file } = await db
    .from("order_files")
    .select("id, storage_path, converted_storage_path, original_filename, deleted_at")
    .eq("order_id", orderId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!file) {
    return NextResponse.json({ error: "No file is attached to this order." }, { status: 404 });
  }

  if (file.deleted_at) {
    return NextResponse.json(
      {
        error:
          "This file has already been deleted under your retention setting. Ask the customer to upload it again.",
      },
      { status: 410 }
    );
  }

  // Prefer the converted PDF when one exists — that is what actually prints.
  const path = file.converted_storage_path || file.storage_path;

  let url: string;
  try {
    url = await getSignedDownloadUrl(path, SIGNED_URL_TTL_SECONDS);
  } catch (err) {
    // A missing object and an unreachable storage service are different
    // problems and the owner can act on only one of them. Storage reports the
    // first as "Object not found"; anything else is a fault on our side.
    const message = err instanceof Error ? err.message : "";
    const missing = /not.?found/i.test(message);
    return NextResponse.json(
      {
        error: missing
          ? "The document is no longer in storage, so it can't be opened. Ask the customer to upload it again."
          : "The document couldn't be opened just now. Try again in a moment.",
      },
      { status: missing ? 410 : 502 }
    );
  }

  await db.from("audit_logs").insert({
    actor_type: "shop_owner",
    actor_id: userId,
    shop_id: shopId,
    action: "order_file.viewed",
    target_table: "order_files",
    target_id: file.id,
    metadata: { order_id: orderId, public_order_id: order.public_order_id },
  });

  return NextResponse.json({
    url,
    filename: file.original_filename,
    expiresInSeconds: SIGNED_URL_TTL_SECONDS,
  });
}

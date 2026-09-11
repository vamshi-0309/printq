import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceRoleClient } from "@/lib/supabase/server";

const contactSchema = z.object({
  shopName: z.string().min(1).max(200),
  city: z.string().min(1).max(100),
  phone: z.string().min(5).max(20),
  message: z.string().max(2000).optional(),
});

export async function POST(req: NextRequest) {
  const parsed = contactSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid form data." }, { status: 400 });
  }

  const supabase = createServiceRoleClient();

  // Store in audit_logs as a contact inquiry
  await supabase.from("audit_logs").insert({
    actor_type: "system",
    action: "contact_inquiry",
    metadata: parsed.data,
  });

  return NextResponse.json({ ok: true });
}

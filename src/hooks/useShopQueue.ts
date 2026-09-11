"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";

interface QueueOrder {
  id: string;
  publicOrderId: string;
  tokenNumber: string | null;
  printStatus: string;
  paymentStatus: string;
  paperSize: string;
  colorMode: string;
  sides: string;
  copies: number;
  pageCount: number | null;
  amount: number;
  createdAt: string;
}

/**
 * Subscribe to a shop's active order queue via Supabase Realtime.
 * Returns the list of orders in active states, sorted by creation time.
 */
export function useShopQueue(shopId: string | null) {
  const [orders, setOrders] = useState<QueueOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const channelRef = useRef<RealtimeChannel | null>(null);

  useEffect(() => {
    if (!shopId) return;

    const supabase = createClient();

    const activeStatuses = [
      "payment_pending", "paid", "queued", "claimed",
      "print_attempted", "printing",
    ];

    // Initial fetch
    const fetchOrders = async () => {
      const { data } = await supabase
        .from("orders")
        .select("id, public_order_id, token_number, print_status, payment_status, paper_size, color_mode, sides, copies, page_count, amount, created_at")
        .eq("shop_id", shopId)
        .in("print_status", activeStatuses)
        .order("created_at", { ascending: true });

      if (data) {
        setOrders(data.map(mapRow));
      }
      setLoading(false);
    };

    fetchOrders();

    // Subscribe to all order changes for this shop
    const channel = supabase
      .channel(`shop-queue-${shopId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "orders",
          filter: `shop_id=eq.${shopId}`,
        },
        (payload) => {
          const row = payload.new as Record<string, unknown>;
          const eventType = payload.eventType;

          if (eventType === "INSERT") {
            setOrders((prev) => [...prev, mapRow(row)]);
          } else if (eventType === "UPDATE") {
            const status = row.print_status as string;
            if (activeStatuses.includes(status)) {
              setOrders((prev) =>
                prev.map((o) => (o.id === row.id ? mapRow(row) : o))
              );
            } else {
              // Order left active states — remove from queue
              setOrders((prev) => prev.filter((o) => o.id !== row.id));
            }
          } else if (eventType === "DELETE") {
            setOrders((prev) => prev.filter((o) => o.id !== (payload.old as { id: string }).id));
          }
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      channel.unsubscribe();
    };
  }, [shopId]);

  return { orders, loading };
}

function mapRow(row: Record<string, unknown>): QueueOrder {
  return {
    id: row.id as string,
    publicOrderId: row.public_order_id as string,
    tokenNumber: (row.token_number as string) ?? null,
    printStatus: row.print_status as string,
    paymentStatus: row.payment_status as string,
    paperSize: row.paper_size as string,
    colorMode: row.color_mode as string,
    sides: row.sides as string,
    copies: row.copies as number,
    pageCount: (row.page_count as number) ?? null,
    amount: Number(row.amount),
    createdAt: row.created_at as string,
  };
}

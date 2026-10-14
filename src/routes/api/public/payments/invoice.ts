import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { rest } from "@/lib/nowpayments.server";

const Body = z.object({ fundingRequestId: z.string().uuid() });

export const Route = createFileRoute("/api/public/payments/invoice")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
        if (!token) return new Response("Unauthorized", { status: 401 });
        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return new Response("Bad request", { status: 400 });

        // Verify the caller is signed in.
        const u = await rest("/auth/v1/user", { token });
        if (!u.ok) return new Response("Unauthorized", { status: 401 });
        const user = (await u.json()) as { id: string };

        // RLS makes this return only the caller's own request.
        const r = await rest(
          `/rest/v1/pf_funding_requests?id=eq.${parsed.data.fundingRequestId}&user_id=eq.${user.id}&select=*`,
          { token },
        );
        const rows = r.ok ? ((await r.json()) as Record<string, unknown>[]) : [];
        const fr = rows[0];
        if (!fr) return new Response("Not found", { status: 404 });
        const amount = Number(fr.fee_usd ?? fr.price_usd ?? fr.fee ?? 0);
        if (!(amount > 0)) return new Response("No fee on request", { status: 422 });

        const apiKey = process.env.NOWPAYMENTS_API_KEY;
        if (!apiKey) return new Response("Payments not configured", { status: 503 });
        const origin = new URL(request.url).origin;
        const inv = await fetch("https://api.nowpayments.io/v1/invoice", {
          method: "POST",
          headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
          body: JSON.stringify({
            price_amount: amount,
            price_currency: "usd",
            order_id: parsed.data.fundingRequestId,
            order_description: "PLOTOS FUND simulated program fee",
            ipn_callback_url: `${origin}/api/public/payments/webhook`,
            success_url: `${origin}/?payment=success`,
            cancel_url: `${origin}/?payment=cancel`,
          }),
        });
        if (!inv.ok) return new Response("Invoice failed", { status: 502 });
        const invoice = (await inv.json()) as { id: string; invoice_url: string };

        await rest("/rest/v1/pf_payments", {
          admin: true,
          method: "POST",
          body: JSON.stringify({
            user_id: user.id,
            funding_request_id: parsed.data.fundingRequestId,
            provider_invoice_id: String(invoice.id),
            amount_usd: amount,
          }),
        });
        return Response.json({ url: invoice.invoice_url });
      },
    },
  },
});

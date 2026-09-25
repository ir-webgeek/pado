import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { walletTransactions } from "@shopino/db";
import type { Ctx } from "../../lib/context";
import { requireShop } from "../../lib/auth";
import { startWalletTopup } from "../payments/service";
import { walletBalance } from "./service";

const params = z.object({ shopId: z.string().uuid() });

export const walletRoutes =
  (ctx: Ctx): FastifyPluginAsyncZod =>
  async (app) => {
    app.get("/:shopId/wallet", { preHandler: requireShop(ctx, "admin"), schema: { params } }, async (req) => {
      const [balance, txs] = await Promise.all([
        walletBalance(ctx.db, req.shop.id),
        ctx.db.select().from(walletTransactions).where(eq(walletTransactions.shopId, req.shop.id)).orderBy(desc(walletTransactions.createdAt)).limit(100),
      ]);
      return { balance, transactions: txs };
    });
    app.post(
      "/:shopId/wallet/topup",
      { preHandler: requireShop(ctx, "admin"), schema: { params, body: z.object({ amount: z.number().int().min(50_000).max(500_000_000) }) } },
      async (req) => startWalletTopup(ctx.db, req.shop.id, req.body.amount),
    );
  };

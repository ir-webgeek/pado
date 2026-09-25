import { auditLogs, type DbOrTx } from "@shopino/db";

export interface Actor {
  type: "user" | "agent" | "system" | "customer";
  id?: string | null;
}

export const SYSTEM: Actor = { type: "system" };

export async function audit(db: DbOrTx, shopId: string, actor: Actor, action: string, entity: string, entityId?: string, data?: unknown) {
  await db.insert(auditLogs).values({ shopId, actorType: actor.type, actorId: actor.id ?? null, action, entity, entityId, data: data ?? null });
}

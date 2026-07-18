import { prisma } from "@/lib/db";

export type AuditSource = "ui" | "system" | "watchdog" | "agent";

export interface AuditInput {
  targetType?: string;
  targetId?: string;
  source?: AuditSource;
  metadata?: Record<string, unknown>;
}

// Fire-and-forget: audit must never break the main flow.
export function audit(userId: string, action: string, input: AuditInput = {}): void {
  void prisma.auditLog
    .create({
      data: {
        userId,
        action,
        targetType: input.targetType ?? "",
        targetId: input.targetId ?? "",
        source: input.source ?? "ui",
        metadata: (input.metadata ?? {}) as object,
      },
    })
    .catch((err) => {
      console.error("[audit] write failed", { action, err: String(err) });
    });
}

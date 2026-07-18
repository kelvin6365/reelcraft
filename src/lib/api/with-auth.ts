// Route wrapper: session → userId injection + uniform error envelope + optional audit.
// Every /api route must use this or carry an explicit `// PUBLIC:` marker
// (enforced by guard route-auth-check).
import { headers } from "next/headers";
import type { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { audit, type AuditInput } from "@/lib/audit";
import { ApiError, fail } from "@/lib/api/errors";
import { checkRateLimit } from "@/lib/api/rate-limit";

export interface AuthedContext {
  userId: string;
  req: NextRequest;
  params: Record<string, string>;
}

export type AuthedHandler = (ctx: AuthedContext) => Promise<NextResponse>;

interface WithAuthOptions {
  auditAction?: string; // when set, a success writes an AuditLog row
}

export function withAuth(handler: AuthedHandler, opts: WithAuthOptions = {}) {
  return async (req: NextRequest, routeCtx: { params: Promise<Record<string, string>> }): Promise<NextResponse> => {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return fail("UNAUTHORIZED", 401);
    const userId = session.user.id;

    // Per-user sliding-window rate limit (distributed via Redis). The SSE stream at
    // GET /api/sse is long-lived and doesn't route through withAuth, so it's exempt.
    if (!(await checkRateLimit(userId))) return fail("RATE_LIMITED", 429);

    try {
      const params = (await routeCtx?.params) ?? {};
      const res = await handler({ userId, req, params });
      if (opts.auditAction && res.status < 400) {
        const input: AuditInput = { source: "ui", metadata: { path: req.nextUrl.pathname, method: req.method } };
        const id = params.id;
        if (id) input.targetId = id;
        audit(userId, opts.auditAction, input);
      }
      return res;
    } catch (err) {
      if (err instanceof ApiError) return fail(err.code, err.status, err.message);
      console.error(`[api] ${req.method} ${req.nextUrl.pathname}`, err);
      return fail("INTERNAL", 500, "internal error");
    }
  };
}

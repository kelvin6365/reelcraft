// SSE progress stream per project. Live events via Redis pub/sub (or the
// in-process bus in DEPLOY_MODE=local); missed events replayed from task_events
// using Last-Event-ID (docs/tech/02-task-system.md).
import type { NextRequest } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { subscribeProjectEvents, type ProjectEventSubscription } from "@/lib/task/events";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return new Response("unauthorized", { status: 401 });
  const userId = session.user.id;

  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId) return new Response("projectId required", { status: 400 });
  const project = await prisma.project.findFirst({ where: { id: projectId, userId }, select: { id: true } });
  if (!project) return new Response("not found", { status: 404 });

  const lastEventId = req.headers.get("last-event-id");
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (id: string, data: string) => {
        try {
          controller.enqueue(encoder.encode(`id: ${id}\ndata: ${data}\n\n`));
        } catch {
          /* stream closed */
        }
      };

      // Register cleanup IMMEDIATELY — before any await — so a disconnect during
      // replay or subscribe still closes the live-event subscription (no leak).
      let keepalive: ReturnType<typeof setInterval> | undefined;
      let subscription: ProjectEventSubscription | undefined;
      let closed = false;
      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (keepalive) clearInterval(keepalive);
        subscription?.close();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      req.signal.addEventListener("abort", cleanup);

      try {
        // Replay missed events
        if (lastEventId) {
          const missed = await prisma.taskEvent.findMany({
            where: { id: { gt: BigInt(lastEventId) }, task: { projectId, userId } },
            orderBy: { id: "asc" },
            take: 500,
            include: { task: { select: { type: true } } },
          });
          for (const ev of missed) {
            send(
              String(ev.id),
              JSON.stringify({ taskId: ev.taskId, taskType: ev.task.type, eventType: ev.eventType, ...(ev.payload as object) }),
            );
          }
        }

        subscription = await subscribeProjectEvents(projectId, (message) => {
          try {
            const parsed = JSON.parse(message) as { id?: string };
            send(parsed.id ?? "0", message);
          } catch {
            /* skip malformed */
          }
        });
        // Disconnect can land while the subscribe above is in flight — cleanup
        // already ran with `subscription` still undefined, so close it here or
        // the dedicated connection leaks.
        if (closed) {
          subscription.close();
          return;
        }

        keepalive = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(`: keepalive\n\n`));
          } catch {
            cleanup();
          }
        }, 25_000);
      } catch {
        cleanup(); // subscribe blip during setup — don't leak the connection
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

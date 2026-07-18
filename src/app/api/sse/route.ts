// SSE progress stream per project. Live events via Redis pub/sub; missed events
// replayed from task_events using Last-Event-ID (docs/tech/02-task-system.md).
import type { NextRequest } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { createSubscriber, projectChannel } from "@/lib/redis";

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
  const subscriber = createSubscriber();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (id: string, data: string) => {
        try {
          controller.enqueue(encoder.encode(`id: ${id}\ndata: ${data}\n\n`));
        } catch {
          /* stream closed */
        }
      };

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

      await subscriber.subscribe(projectChannel(projectId));
      subscriber.on("message", (_ch, message) => {
        try {
          const parsed = JSON.parse(message) as { id?: string };
          send(parsed.id ?? "0", message);
        } catch {
          /* skip malformed */
        }
      });

      const keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: keepalive\n\n`));
        } catch {
          clearInterval(keepalive);
        }
      }, 25_000);

      req.signal.addEventListener("abort", () => {
        clearInterval(keepalive);
        void subscriber.quit().catch(() => {});
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
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

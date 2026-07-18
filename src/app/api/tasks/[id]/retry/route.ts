// One-click retry from the failure drawer.
import { withAuth } from "@/lib/api/with-auth";
import { ApiError, ok } from "@/lib/api/errors";
import { retryTask } from "@/lib/task/submit";

export const POST = withAuth(
  async ({ userId, params }) => {
    try {
      await retryTask(userId, params.id);
    } catch (err) {
      throw new ApiError("RETRY_FAILED", 400, String(err instanceof Error ? err.message : err));
    }
    return ok({ retried: true });
  },
  { auditAction: "task.retry" },
);

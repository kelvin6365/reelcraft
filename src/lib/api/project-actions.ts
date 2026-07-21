// Shared ownership helper for routes that accept an optional projectId and
// must confirm it belongs to the calling user before writing anything tagged
// with it (mirrors getOwnedEpisode in episode-actions.ts).
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/api/errors";
import type { Project } from "@prisma/client";

export async function getOwnedProject(userId: string, projectId: string): Promise<Project> {
  const project = await prisma.project.findFirst({ where: { id: projectId, userId } });
  if (!project) throw new ApiError("FORBIDDEN", 403, "project not found or not owned by this user");
  return project;
}

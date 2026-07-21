-- AlterTable
ALTER TABLE "ai_call_logs" ADD COLUMN     "promptSource" TEXT,
ADD COLUMN     "renderedPrompt" TEXT;

-- CreateTable
CREATE TABLE "prompt_overrides" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL DEFAULT '',
    "promptId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "baseVersion" TEXT NOT NULL,
    "baseContent" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prompt_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_preferences" (
    "userId" TEXT NOT NULL,
    "advancedMode" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE INDEX "prompt_overrides_userId_promptId_idx" ON "prompt_overrides"("userId", "promptId");

-- CreateIndex
CREATE UNIQUE INDEX "prompt_overrides_userId_projectId_promptId_key" ON "prompt_overrides"("userId", "projectId", "promptId");

-- CreateIndex
CREATE INDEX "ai_call_logs_episodeId_promptId_at_idx" ON "ai_call_logs"("episodeId", "promptId", "at");

-- AddForeignKey
ALTER TABLE "prompt_overrides" ADD CONSTRAINT "prompt_overrides_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

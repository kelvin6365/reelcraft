-- CreateTable
CREATE TABLE "provider_requests" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "stepKey" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "apiType" TEXT NOT NULL,
    "modelKey" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "mediaId" TEXT,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "provider_requests_taskId_status_idx" ON "provider_requests"("taskId", "status");

-- CreateIndex
CREATE INDEX "provider_requests_status_createdAt_idx" ON "provider_requests"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "provider_requests_taskId_stepKey_key" ON "provider_requests"("taskId", "stepKey");

-- AddForeignKey
ALTER TABLE "provider_requests" ADD CONSTRAINT "provider_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

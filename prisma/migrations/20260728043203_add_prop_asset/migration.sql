-- CreateTable
CREATE TABLE "props" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tier" TEXT NOT NULL DEFAULT 'key',
    "summary" TEXT NOT NULL DEFAULT '',
    "prompt" TEXT NOT NULL DEFAULT '',
    "material" TEXT NOT NULL DEFAULT '',
    "dimensions" TEXT NOT NULL DEFAULT '',
    "lockedImageMediaId" TEXT,
    "candidates" JSONB NOT NULL DEFAULT '[]',
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "views" JSONB NOT NULL DEFAULT '[]',
    "locationId" TEXT,
    "physicalParams" TEXT NOT NULL DEFAULT '',
    "refVideoMediaId" TEXT,

    CONSTRAINT "props_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "props_projectId_idx" ON "props"("projectId");

-- CreateIndex
CREATE INDEX "props_locationId_idx" ON "props"("locationId");

-- AddForeignKey
ALTER TABLE "props" ADD CONSTRAINT "props_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "props" ADD CONSTRAINT "props_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "props" ADD CONSTRAINT "props_lockedImageMediaId_fkey" FOREIGN KEY ("lockedImageMediaId") REFERENCES "media_objects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "props" ADD CONSTRAINT "props_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "props" ADD CONSTRAINT "props_refVideoMediaId_fkey" FOREIGN KEY ("refVideoMediaId") REFERENCES "media_objects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

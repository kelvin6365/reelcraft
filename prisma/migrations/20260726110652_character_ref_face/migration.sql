-- AlterTable
ALTER TABLE "characters" ADD COLUMN     "refFaceMediaId" TEXT,
ADD COLUMN     "refFaceNote" TEXT NOT NULL DEFAULT '';

-- AddForeignKey
ALTER TABLE "characters" ADD CONSTRAINT "characters_refFaceMediaId_fkey" FOREIGN KEY ("refFaceMediaId") REFERENCES "media_objects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

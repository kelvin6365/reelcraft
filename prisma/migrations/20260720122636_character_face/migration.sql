-- AlterTable
ALTER TABLE "characters" ADD COLUMN     "faceImageMediaId" TEXT;

-- AddForeignKey
ALTER TABLE "characters" ADD CONSTRAINT "characters_faceImageMediaId_fkey" FOREIGN KEY ("faceImageMediaId") REFERENCES "media_objects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

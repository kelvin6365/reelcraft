-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "planConfig" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "planResult" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "planStatus" TEXT NOT NULL DEFAULT 'none',
ADD COLUMN     "sourceText" TEXT NOT NULL DEFAULT '';

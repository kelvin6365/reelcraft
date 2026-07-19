-- AlterTable
ALTER TABLE "episodes" ADD COLUMN     "autorun" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "autorunConfig" JSONB NOT NULL DEFAULT '{}';

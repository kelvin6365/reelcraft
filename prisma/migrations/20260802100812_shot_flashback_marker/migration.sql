-- AlterTable
ALTER TABLE "shots" ADD COLUMN     "flashback" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "locationOverride" TEXT NOT NULL DEFAULT '';

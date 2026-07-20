/*
  Warnings:

  - You are about to drop the `usage_costs` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "usage_costs" DROP CONSTRAINT "usage_costs_userId_fkey";

-- AlterTable
ALTER TABLE "ai_call_logs" ADD COLUMN     "cachedInputTokens" INTEGER,
ADD COLUMN     "inputPerMTokSnapshot" DECIMAL(18,8),
ADD COLUMN     "outputPerMTokSnapshot" DECIMAL(18,8),
ADD COLUMN     "providerCostUsd" DECIMAL(18,8),
ADD COLUMN     "reasoningTokens" INTEGER;

-- DropTable
DROP TABLE "usage_costs";

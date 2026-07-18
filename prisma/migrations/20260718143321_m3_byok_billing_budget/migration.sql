-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "budgetUsd" DECIMAL(18,6);

-- CreateTable
CREATE TABLE "user_provider_keys" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "encryptedKey" TEXT NOT NULL,
    "last4" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_provider_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_balances" (
    "userId" TEXT NOT NULL,
    "balanceUsd" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "frozenUsd" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "totalSpentUsd" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_balances_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "balance_freezes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amountUsd" DECIMAL(18,6) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "taskId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "balance_freezes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "balance_transactions" (
    "id" BIGSERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amountUsd" DECIMAL(18,6) NOT NULL,
    "balanceAfterUsd" DECIMAL(18,6) NOT NULL,
    "freezeId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "balance_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_provider_keys_userId_provider_key" ON "user_provider_keys"("userId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "balance_freezes_idempotencyKey_key" ON "balance_freezes"("idempotencyKey");

-- CreateIndex
CREATE INDEX "balance_freezes_userId_status_idx" ON "balance_freezes"("userId", "status");

-- CreateIndex
CREATE INDEX "balance_transactions_userId_createdAt_idx" ON "balance_transactions"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "balance_transactions_userId_type_idempotencyKey_key" ON "balance_transactions"("userId", "type", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "user_provider_keys" ADD CONSTRAINT "user_provider_keys_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_balances" ADD CONSTRAINT "user_balances_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "balance_freezes" ADD CONSTRAINT "balance_freezes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "balance_transactions" ADD CONSTRAINT "balance_transactions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

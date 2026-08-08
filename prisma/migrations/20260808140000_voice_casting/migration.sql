-- CreateTable
CREATE TABLE "voices" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "audioMediaId" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "voices_projectId_idx" ON "voices"("projectId");

-- AddForeignKey
ALTER TABLE "voices" ADD CONSTRAINT "voices_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voices" ADD CONSTRAINT "voices_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voices" ADD CONSTRAINT "voices_audioMediaId_fkey" FOREIGN KEY ("audioMediaId") REFERENCES "media_objects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable: 角色音色綁定。舊 voiceId 欄位由頭到尾冇任何 code path 寫入過
-- （只有 ttsLineHandler 讀），所以直接 drop，唔會有資料流失。
ALTER TABLE "characters" DROP COLUMN "voiceId";
ALTER TABLE "characters" ADD COLUMN "voicePresetId" TEXT;
ALTER TABLE "characters" ADD COLUMN "voiceRefId" TEXT;
ALTER TABLE "characters" ADD COLUMN "voiceCastNote" TEXT NOT NULL DEFAULT '';

-- CreateIndex
CREATE INDEX "characters_voiceRefId_idx" ON "characters"("voiceRefId");

-- AddForeignKey
ALTER TABLE "characters" ADD CONSTRAINT "characters_voiceRefId_fkey" FOREIGN KEY ("voiceRefId") REFERENCES "voices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: 非角色 speaker（旁白／機械音／未知）嘅集級音色綁定
ALTER TABLE "episodes" ADD COLUMN "speakerVoices" JSONB NOT NULL DEFAULT '{}';

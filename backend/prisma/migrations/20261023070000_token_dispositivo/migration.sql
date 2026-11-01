
-- AlterTable
ALTER TABLE "Dispositivo" ADD COLUMN     "hashAnterior" TEXT,
ADD COLUMN     "hashToken" TEXT,
ADD COLUMN     "revocado" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "Dispositivo_hashToken_key" ON "Dispositivo"("hashToken");

-- CreateIndex
CREATE UNIQUE INDEX "Dispositivo_hashAnterior_key" ON "Dispositivo"("hashAnterior");


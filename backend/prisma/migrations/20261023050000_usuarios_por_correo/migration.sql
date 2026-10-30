-- AlterTable
ALTER TABLE "Usuario" ADD COLUMN     "subAuth" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_subAuth_key" ON "Usuario"("subAuth");


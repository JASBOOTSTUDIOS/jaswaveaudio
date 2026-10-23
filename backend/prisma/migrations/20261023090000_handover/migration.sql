-- CreateTable
CREATE TABLE "TokenHandover" (
    "hash" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "cifrado" BYTEA NOT NULL,
    "caducaEn" TIMESTAMP(3) NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TokenHandover_pkey" PRIMARY KEY ("hash")
);

-- CreateIndex
CREATE INDEX "TokenHandover_caducaEn_idx" ON "TokenHandover"("caducaEn");


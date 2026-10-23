-- CreateEnum
CREATE TYPE "RolSala" AS ENUM ('owner', 'editor', 'viewer');

-- CreateTable
CREATE TABLE "Sala" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "creadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Sala_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MiembroSala" (
    "salaId" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "rol" "RolSala" NOT NULL,

    CONSTRAINT "MiembroSala_pkey" PRIMARY KEY ("salaId","usuarioId")
);

-- CreateTable
CREATE TABLE "ComandoSala" (
    "id" TEXT NOT NULL,
    "salaId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "autorId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "vclock" JSONB NOT NULL DEFAULT '{}',
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComandoSala_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ComandoSala_salaId_seq_key" ON "ComandoSala"("salaId", "seq");

-- AddForeignKey
ALTER TABLE "MiembroSala" ADD CONSTRAINT "MiembroSala_salaId_fkey" FOREIGN KEY ("salaId") REFERENCES "Sala"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MiembroSala" ADD CONSTRAINT "MiembroSala_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComandoSala" ADD CONSTRAINT "ComandoSala_salaId_fkey" FOREIGN KEY ("salaId") REFERENCES "Sala"("id") ON DELETE CASCADE ON UPDATE CASCADE;


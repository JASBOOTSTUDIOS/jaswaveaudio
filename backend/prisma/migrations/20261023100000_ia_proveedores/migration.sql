
-- CreateEnum
CREATE TYPE "EjecucionIA" AS ENUM ('servidor', 'local');

-- CreateTable
CREATE TABLE "ProveedorIA" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "claveCifrada" BYTEA,
    "versionClave" INTEGER NOT NULL DEFAULT 1,
    "custom" JSONB,
    "modelos" TEXT[],
    "modeloPorDefecto" TEXT NOT NULL,
    "maxTokens" INTEGER NOT NULL DEFAULT 4096,
    "peticionesPorMinuto" INTEGER NOT NULL DEFAULT 30,
    "herramientas" BOOLEAN,
    "propietarioId" TEXT,
    "ejecucion" "EjecucionIA" NOT NULL DEFAULT 'servidor',
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProveedorIA_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProveedorIA_slug_key" ON "ProveedorIA"("slug");

-- CreateIndex
CREATE INDEX "ProveedorIA_propietarioId_idx" ON "ProveedorIA"("propietarioId");

-- AddForeignKey
ALTER TABLE "ProveedorIA" ADD CONSTRAINT "ProveedorIA_propietarioId_fkey" FOREIGN KEY ("propietarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AlterTable
ALTER TABLE "Licencia" ADD COLUMN     "planIAId" TEXT;

-- CreateTable
CREATE TABLE "ClaveProveedorIA" (
    "id" TEXT NOT NULL,
    "proveedorId" TEXT NOT NULL,
    "etiqueta" TEXT NOT NULL DEFAULT '',
    "claveCifrada" BYTEA NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "creadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClaveProveedorIA_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModeloJasWave" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL DEFAULT '',
    "orden" INTEGER NOT NULL DEFAULT 0,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "cadena" JSONB NOT NULL DEFAULT '[]',
    "creditosPorMil" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "maxTokens" INTEGER NOT NULL DEFAULT 8192,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModeloJasWave_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanIA" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL DEFAULT '',
    "creditosDia" INTEGER,
    "creditosMes" INTEGER,
    "peticionesMinuto" INTEGER NOT NULL DEFAULT 20,
    "modelos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "porDefecto" BOOLEAN NOT NULL DEFAULT false,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanIA_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsumoIA" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "modelo" TEXT NOT NULL,
    "modeloReal" TEXT NOT NULL DEFAULT '',
    "proveedorId" TEXT,
    "proposito" TEXT NOT NULL DEFAULT '',
    "tokensEntrada" INTEGER NOT NULL DEFAULT 0,
    "tokensSalida" INTEGER NOT NULL DEFAULT 0,
    "creditos" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ms" INTEGER NOT NULL DEFAULT 0,
    "ok" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsumoIA_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClaveProveedorIA_proveedorId_idx" ON "ClaveProveedorIA"("proveedorId");

-- CreateIndex
CREATE UNIQUE INDEX "PlanIA_nombre_key" ON "PlanIA"("nombre");

-- CreateIndex
CREATE INDEX "ConsumoIA_usuarioId_creadoEn_idx" ON "ConsumoIA"("usuarioId", "creadoEn");

-- CreateIndex
CREATE INDEX "ConsumoIA_creadoEn_idx" ON "ConsumoIA"("creadoEn");

-- AddForeignKey
ALTER TABLE "Licencia" ADD CONSTRAINT "Licencia_planIAId_fkey" FOREIGN KEY ("planIAId") REFERENCES "PlanIA"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaveProveedorIA" ADD CONSTRAINT "ClaveProveedorIA_proveedorId_fkey" FOREIGN KEY ("proveedorId") REFERENCES "ProveedorIA"("id") ON DELETE CASCADE ON UPDATE CASCADE;

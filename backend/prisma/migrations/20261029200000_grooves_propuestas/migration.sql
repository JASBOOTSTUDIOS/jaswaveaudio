-- CreateTable
CREATE TABLE "PropuestaGroove" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "usuarios" TEXT[],
    "nombre" TEXT NOT NULL,
    "estilo" TEXT NOT NULL,
    "tipo" TEXT NOT NULL DEFAULT 'groove',
    "compas" TEXT NOT NULL DEFAULT '4/4',
    "tempo" INTEGER NOT NULL DEFAULT 100,
    "compases" INTEGER NOT NULL DEFAULT 1,
    "intensidad" INTEGER NOT NULL DEFAULT 3,
    "etiquetas" TEXT[],
    "autor" TEXT NOT NULL DEFAULT '',
    "licencia" TEXT NOT NULL DEFAULT 'CC0-1.0',
    "contenido" BYTEA NOT NULL,
    "sha256" TEXT NOT NULL,
    "huellaHash" TEXT NOT NULL,
    "huella" JSONB NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'pendiente',
    "vecesPropuesto" INTEGER NOT NULL DEFAULT 1,
    "similares" JSONB NOT NULL DEFAULT '[]',
    "notaAdmin" TEXT NOT NULL DEFAULT '',
    "grooveId" TEXT,
    "consentimientoVersion" TEXT NOT NULL,
    "consentimientoEn" TIMESTAMP(3) NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    "resueltaEn" TIMESTAMP(3),

    CONSTRAINT "PropuestaGroove_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PropuestaGroove_estado_idx" ON "PropuestaGroove"("estado");

-- CreateIndex
CREATE INDEX "PropuestaGroove_huellaHash_idx" ON "PropuestaGroove"("huellaHash");

-- CreateIndex
CREATE INDEX "PropuestaGroove_usuarioId_creadoEn_idx" ON "PropuestaGroove"("usuarioId", "creadoEn");

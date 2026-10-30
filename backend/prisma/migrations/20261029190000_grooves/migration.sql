-- CreateTable
CREATE TABLE "GrooveCatalogo" (
    "id" TEXT NOT NULL,
    "ruta" TEXT NOT NULL,
    "estilo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "tipo" TEXT NOT NULL DEFAULT 'groove',
    "compas" TEXT NOT NULL DEFAULT '4/4',
    "tempo" INTEGER NOT NULL DEFAULT 100,
    "compases" INTEGER NOT NULL DEFAULT 1,
    "intensidad" INTEGER NOT NULL DEFAULT 3,
    "etiquetas" TEXT[],
    "autor" TEXT NOT NULL DEFAULT '',
    "licencia" TEXT NOT NULL DEFAULT '',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "sha256" TEXT NOT NULL,
    "tamano" INTEGER NOT NULL,
    "contenido" BYTEA NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GrooveCatalogo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GrooveCatalogoEstado" (
    "id" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "GrooveCatalogoEstado_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GrooveCatalogo_ruta_key" ON "GrooveCatalogo"("ruta");

-- CreateIndex
CREATE INDEX "GrooveCatalogo_estilo_idx" ON "GrooveCatalogo"("estilo");

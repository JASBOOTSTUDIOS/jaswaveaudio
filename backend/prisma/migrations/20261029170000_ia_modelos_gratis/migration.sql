-- CreateTable
CREATE TABLE "ModeloGratisIA" (
    "modelo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL DEFAULT '',
    "contexto" INTEGER NOT NULL DEFAULT 0,
    "razonamiento" TEXT NOT NULL DEFAULT 'apagable',
    "nivel" TEXT NOT NULL DEFAULT 'creativo',
    "estado" TEXT NOT NULL DEFAULT 'nuevo',
    "puntuacion" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "latenciaMs" INTEGER,
    "fallosSeguidos" INTEGER NOT NULL DEFAULT 0,
    "limitesSeguidos" INTEGER NOT NULL DEFAULT 0,
    "motivo" TEXT NOT NULL DEFAULT '',
    "nivelFijado" BOOLEAN NOT NULL DEFAULT false,
    "excluidoManual" BOOLEAN NOT NULL DEFAULT false,
    "detectadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vistoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultimaPrueba" TIMESTAMP(3),
    "ultimoOk" TIMESTAMP(3),
    "proximaPrueba" TIMESTAMP(3),
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModeloGratisIA_pkey" PRIMARY KEY ("modelo")
);

-- CreateTable
CREATE TABLE "AjusteIA" (
    "clave" TEXT NOT NULL,
    "valor" JSONB NOT NULL,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AjusteIA_pkey" PRIMARY KEY ("clave")
);

-- CreateIndex
CREATE INDEX "ModeloGratisIA_estado_idx" ON "ModeloGratisIA"("estado");

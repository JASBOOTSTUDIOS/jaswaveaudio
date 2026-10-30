
-- AlterTable
ALTER TABLE "PaquetePlugin" ADD COLUMN     "categoria" TEXT NOT NULL DEFAULT 'audio-effect',
ADD COLUMN     "descripcion" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "entradaEstilos" TEXT,
ADD COLUMN     "entradaUi" TEXT,
ADD COLUMN     "plataformas" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "ArchivoModulo" (
    "paqueteId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "ruta" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "contenido" BYTEA NOT NULL,

    CONSTRAINT "ArchivoModulo_pkey" PRIMARY KEY ("paqueteId","version","ruta")
);

-- AddForeignKey
ALTER TABLE "ArchivoModulo" ADD CONSTRAINT "ArchivoModulo_paqueteId_version_fkey" FOREIGN KEY ("paqueteId", "version") REFERENCES "PaquetePlugin"("id", "version") ON DELETE CASCADE ON UPDATE CASCADE;


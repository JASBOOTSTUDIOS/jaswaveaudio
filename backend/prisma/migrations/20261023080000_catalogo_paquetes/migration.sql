-- CreateTable
CREATE TABLE "PaquetePlugin" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "publicadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaquetePlugin_pkey" PRIMARY KEY ("id","version")
);


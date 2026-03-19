-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN "autoCreatePR" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN "notepad" TEXT;

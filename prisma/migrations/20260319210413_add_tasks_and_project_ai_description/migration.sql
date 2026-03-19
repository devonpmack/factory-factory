-- AlterTable
ALTER TABLE "Project" ADD COLUMN "aiDescription" TEXT;

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT,
    "prompt" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "routingStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "routingSummary" TEXT,
    "planningNotes" TEXT,
    "confirmedAt" DATETIME,
    "rootPath" TEXT,
    "primarySessionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "TaskProject" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "selectionSource" TEXT NOT NULL DEFAULT 'AUTO',
    "confidenceScore" REAL,
    "reasonSummary" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskProject_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskProject_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TaskRepo" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "mountPath" TEXT,
    "branchName" TEXT,
    "materializationMode" TEXT NOT NULL DEFAULT 'WORKTREE',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TaskRepo_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Task_status_idx" ON "Task"("status");

-- CreateIndex
CREATE INDEX "Task_createdAt_idx" ON "Task"("createdAt");

-- CreateIndex
CREATE INDEX "TaskProject_taskId_idx" ON "TaskProject"("taskId");

-- CreateIndex
CREATE INDEX "TaskProject_projectId_idx" ON "TaskProject"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskProject_taskId_projectId_key" ON "TaskProject"("taskId", "projectId");

-- CreateIndex
CREATE INDEX "TaskRepo_taskId_idx" ON "TaskRepo"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskRepo_taskId_projectId_key" ON "TaskRepo"("taskId", "projectId");

-- CreateIndex
CREATE INDEX "Project_githubOwner_idx" ON "Project"("githubOwner");

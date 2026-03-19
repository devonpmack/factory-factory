-- CreateTable
CREATE TABLE "TaskRepoPullRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskRepoId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'github',
    "repoOwner" TEXT NOT NULL,
    "repoName" TEXT NOT NULL,
    "prNumber" INTEGER NOT NULL,
    "prUrl" TEXT NOT NULL,
    "prState" TEXT NOT NULL DEFAULT 'NONE',
    "prCiStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "prReviewState" TEXT,
    "lastReviewCommentId" TEXT,
    "lastCiRunId" TEXT,
    "ratchetState" TEXT NOT NULL DEFAULT 'IDLE',
    "ratchetLastCheckedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TaskRepoPullRequest_taskRepoId_fkey" FOREIGN KEY ("taskRepoId") REFERENCES "TaskRepo" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Task" (
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
    "ratchetEnabled" BOOLEAN NOT NULL DEFAULT false,
    "ratchetActiveSessionId" TEXT,
    "ratchetCurrentActivity" TEXT,
    "ratchetStateUpdatedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Task" ("confirmedAt", "createdAt", "id", "planningNotes", "primarySessionId", "prompt", "rootPath", "routingStatus", "routingSummary", "status", "title", "updatedAt") SELECT "confirmedAt", "createdAt", "id", "planningNotes", "primarySessionId", "prompt", "rootPath", "routingStatus", "routingSummary", "status", "title", "updatedAt" FROM "Task";
DROP TABLE "Task";
ALTER TABLE "new_Task" RENAME TO "Task";
CREATE INDEX "Task_status_idx" ON "Task"("status");
CREATE INDEX "Task_createdAt_idx" ON "Task"("createdAt");
CREATE TABLE "new_TaskRepo" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "mountPath" TEXT,
    "branchName" TEXT,
    "materializationMode" TEXT NOT NULL DEFAULT 'WORKTREE',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "prNumber" INTEGER,
    "prUrl" TEXT,
    "prState" TEXT NOT NULL DEFAULT 'NONE',
    "prCiStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "prReviewState" TEXT,
    "prLastCheckedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TaskRepo_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_TaskRepo" ("branchName", "createdAt", "errorMessage", "id", "materializationMode", "mountPath", "projectId", "status", "taskId", "updatedAt") SELECT "branchName", "createdAt", "errorMessage", "id", "materializationMode", "mountPath", "projectId", "status", "taskId", "updatedAt" FROM "TaskRepo";
DROP TABLE "TaskRepo";
ALTER TABLE "new_TaskRepo" RENAME TO "TaskRepo";
CREATE INDEX "TaskRepo_taskId_idx" ON "TaskRepo"("taskId");
CREATE UNIQUE INDEX "TaskRepo_taskId_projectId_key" ON "TaskRepo"("taskId", "projectId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "TaskRepoPullRequest_taskRepoId_idx" ON "TaskRepoPullRequest"("taskRepoId");

-- CreateIndex
CREATE INDEX "TaskRepoPullRequest_ratchetState_idx" ON "TaskRepoPullRequest"("ratchetState");

-- CreateIndex
CREATE UNIQUE INDEX "TaskRepoPullRequest_taskRepoId_prNumber_key" ON "TaskRepoPullRequest"("taskRepoId", "prNumber");

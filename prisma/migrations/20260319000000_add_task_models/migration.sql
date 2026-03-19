-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_CONFIRMATION',
    "errorMessage" TEXT,
    "ratchetEnabled" BOOLEAN NOT NULL DEFAULT false,
    "ratchetState" TEXT NOT NULL DEFAULT 'IDLE',
    "ratchetActiveSessionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "TaskRepo" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "inferenceScore" REAL NOT NULL DEFAULT 0,
    "worktreePath" TEXT,
    "branchName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PROVISIONING',
    "prUrl" TEXT,
    "prNumber" INTEGER,
    "prState" TEXT NOT NULL DEFAULT 'NONE',
    "prCiStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "prUpdatedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TaskRepo_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskRepo_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TaskWorkspace" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "taskRoot" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TaskWorkspace_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "repoPath" TEXT NOT NULL,
    "worktreeBasePath" TEXT NOT NULL,
    "defaultBranch" TEXT NOT NULL DEFAULT 'main',
    "githubOwner" TEXT,
    "githubRepo" TEXT,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "issueProvider" TEXT NOT NULL DEFAULT 'GITHUB',
    "issueTrackerConfig" JSONB,
    "startupScriptCommand" TEXT,
    "startupScriptPath" TEXT,
    "startupScriptTimeout" INTEGER NOT NULL DEFAULT 300,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false
);
INSERT INTO "new_Project" ("createdAt", "defaultBranch", "githubOwner", "githubRepo", "id", "isArchived", "issueProvider", "issueTrackerConfig", "name", "repoPath", "slug", "startupScriptCommand", "startupScriptPath", "startupScriptTimeout", "updatedAt", "worktreeBasePath") SELECT "createdAt", "defaultBranch", "githubOwner", "githubRepo", "id", "isArchived", "issueProvider", "issueTrackerConfig", "name", "repoPath", "slug", "startupScriptCommand", "startupScriptPath", "startupScriptTimeout", "updatedAt", "worktreeBasePath" FROM "Project";
DROP TABLE "Project";
ALTER TABLE "new_Project" RENAME TO "Project";
CREATE UNIQUE INDEX "Project_slug_key" ON "Project"("slug");
CREATE INDEX "Project_slug_idx" ON "Project"("slug");
CREATE INDEX "Project_isArchived_idx" ON "Project"("isArchived");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Task_status_idx" ON "Task"("status");

-- CreateIndex
CREATE INDEX "TaskRepo_taskId_idx" ON "TaskRepo"("taskId");

-- CreateIndex
CREATE INDEX "TaskRepo_projectId_idx" ON "TaskRepo"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskRepo_taskId_projectId_key" ON "TaskRepo"("taskId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskWorkspace_taskId_key" ON "TaskWorkspace"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskWorkspace_workspaceId_key" ON "TaskWorkspace"("workspaceId");

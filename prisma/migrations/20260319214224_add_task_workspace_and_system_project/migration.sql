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
    "aiDescription" TEXT,
    "issueProvider" TEXT NOT NULL DEFAULT 'GITHUB',
    "issueTrackerConfig" JSONB,
    "startupScriptCommand" TEXT,
    "startupScriptPath" TEXT,
    "startupScriptTimeout" INTEGER NOT NULL DEFAULT 300,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false
);
INSERT INTO "new_Project" ("aiDescription", "createdAt", "defaultBranch", "githubOwner", "githubRepo", "id", "isArchived", "issueProvider", "issueTrackerConfig", "name", "repoPath", "slug", "startupScriptCommand", "startupScriptPath", "startupScriptTimeout", "updatedAt", "worktreeBasePath") SELECT "aiDescription", "createdAt", "defaultBranch", "githubOwner", "githubRepo", "id", "isArchived", "issueProvider", "issueTrackerConfig", "name", "repoPath", "slug", "startupScriptCommand", "startupScriptPath", "startupScriptTimeout", "updatedAt", "worktreeBasePath" FROM "Project";
DROP TABLE "Project";
ALTER TABLE "new_Project" RENAME TO "Project";
CREATE UNIQUE INDEX "Project_slug_key" ON "Project"("slug");
CREATE INDEX "Project_slug_idx" ON "Project"("slug");
CREATE INDEX "Project_isArchived_idx" ON "Project"("isArchived");
CREATE INDEX "Project_githubOwner_idx" ON "Project"("githubOwner");
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
    CONSTRAINT "TaskRepo_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskRepo_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_TaskRepo" ("branchName", "createdAt", "errorMessage", "id", "materializationMode", "mountPath", "prCiStatus", "prLastCheckedAt", "prNumber", "prReviewState", "prState", "prUrl", "projectId", "status", "taskId", "updatedAt") SELECT "branchName", "createdAt", "errorMessage", "id", "materializationMode", "mountPath", "prCiStatus", "prLastCheckedAt", "prNumber", "prReviewState", "prState", "prUrl", "projectId", "status", "taskId", "updatedAt" FROM "TaskRepo";
DROP TABLE "TaskRepo";
ALTER TABLE "new_TaskRepo" RENAME TO "TaskRepo";
CREATE INDEX "TaskRepo_taskId_idx" ON "TaskRepo"("taskId");
CREATE UNIQUE INDEX "TaskRepo_taskId_projectId_key" ON "TaskRepo"("taskId", "projectId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "TaskWorkspace_taskId_key" ON "TaskWorkspace"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskWorkspace_workspaceId_key" ON "TaskWorkspace"("workspaceId");

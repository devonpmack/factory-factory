import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { SessionProvider } from '@prisma-gen/client';
import { writeFileAtomic } from '@/backend/lib/atomic-file';
import { createLogger } from '@/backend/services/logger.service';
import { closedSessionAccessor } from '@/backend/services/session/resources/closed-session.accessor';
import { workspaceAccessor } from '@/backend/services/workspace';
import type { ChatMessage } from '@/shared/acp-protocol';

const execFileAsync = promisify(execFile);

const logger = createLogger('closed-session-persistence');

export interface ClosedSessionTranscript {
  version: 1;
  sessionId: string;
  workspaceId: string;
  metadata: {
    name: string | null;
    workflow: string;
    provider: SessionProvider;
    model: string;
    startedAt: string; // ISO timestamp
    completedAt: string; // ISO timestamp
  };
  messages: ChatMessage[];
}

export interface PersistClosedSessionInput {
  sessionId: string;
  workspaceId: string;
  worktreePath: string;
  name: string | null;
  workflow: string;
  provider: SessionProvider;
  model: string;
  startedAt: Date;
  messages: ChatMessage[];
}

class ClosedSessionPersistenceService {
  private readonly contextDirName = '.context';
  private readonly closedSessionsDir = 'closed-sessions';

  private async maybeCreatePR(workspaceId: string, worktreePath: string): Promise<void> {
    try {
      const workspace = await workspaceAccessor.findRawById(workspaceId);
      if (!workspace) {
        logger.debug('Workspace not found for auto-PR creation', { workspaceId });
        return;
      }

      if (!workspace.autoCreatePR) {
        return;
      }

      if (workspace.prUrl) {
        logger.debug('Workspace already has a PR, skipping auto-create', { workspaceId });
        return;
      }

      logger.info('Auto-creating PR for workspace', { workspaceId, worktreePath });

      const { stdout } = await execFileAsync('gh', ['pr', 'create', '--fill'], {
        cwd: worktreePath,
      });

      const prUrl = stdout.trim();
      if (prUrl) {
        await workspaceAccessor.update(workspaceId, { prUrl });
        logger.info('Auto-created PR', { workspaceId, prUrl });
      }
    } catch (error) {
      logger.warn('Failed to auto-create PR', {
        workspaceId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async persistClosedSession(input: PersistClosedSessionInput): Promise<void> {
    const {
      sessionId,
      workspaceId,
      worktreePath,
      name,
      workflow,
      provider,
      model,
      startedAt,
      messages,
    } = input;

    try {
      // Skip if no messages (nothing to save)
      if (messages.length === 0) {
        logger.debug('Skipping closed session persistence: no messages', { sessionId });
        return;
      }

      // Create transcript file path
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const safeSessionId = sessionId.replace(/[^a-zA-Z0-9-]/g, '_');
      const filename = `${safeSessionId}_${timestamp}.json`;

      // Full directory path: <worktreePath>/.context/closed-sessions/
      const fullDirPath = join(worktreePath, this.contextDirName, this.closedSessionsDir);

      // Ensure directory exists
      await mkdir(fullDirPath, { recursive: true });

      // Full file path
      const fullFilePath = join(fullDirPath, filename);

      // Relative path for database (from worktree root)
      const relativePath = join(this.contextDirName, this.closedSessionsDir, filename);

      // Build transcript object
      const transcript: ClosedSessionTranscript = {
        version: 1,
        sessionId,
        workspaceId,
        metadata: {
          name,
          workflow,
          provider,
          model,
          startedAt: startedAt.toISOString(),
          completedAt: new Date().toISOString(),
        },
        messages,
      };

      // Write transcript file atomically
      await writeFileAtomic(fullFilePath, JSON.stringify(transcript, null, 2), {
        encoding: 'utf-8',
      });

      logger.debug('Wrote closed session transcript to file', {
        sessionId,
        path: fullFilePath,
        messageCount: messages.length,
      });

      // Store metadata in database
      await closedSessionAccessor.create({
        workspaceId,
        sessionId,
        name,
        workflow,
        provider,
        model,
        transcriptPath: relativePath,
        startedAt,
        completedAt: new Date(),
      });

      logger.info('Persisted closed session', {
        sessionId,
        workspaceId,
        workflow,
        messageCount: messages.length,
      });

      await this.maybeCreatePR(workspaceId, worktreePath);
    } catch (error) {
      logger.error('Failed to persist closed session', error as Error, {
        sessionId,
        workspaceId,
        workflow,
      });
      throw error;
    }
  }
}

export const closedSessionPersistenceService = new ClosedSessionPersistenceService();

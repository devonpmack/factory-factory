/**
 * Database Backup Service
 *
 * Periodically backs up the SQLite database using VACUUM INTO, which creates
 * a consistent snapshot safe to run while the database is live.
 *
 * Backups are stored in {baseDir}/backups/ and the most recent N are kept.
 */

import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { toError } from '@/backend/lib/error-utils';
import { prisma } from '../db';
import { configService } from './config.service';
import { createLogger } from './logger.service';

const logger = createLogger('db-backup');

const MAX_BACKUPS = 5;

export class DbBackupService {
  private backupDir: string;

  constructor() {
    this.backupDir = join(configService.getBaseDir(), 'backups');
  }

  async backup(): Promise<void> {
    if (!existsSync(this.backupDir)) {
      mkdirSync(this.backupDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const destPath = join(this.backupDir, `data-${timestamp}.db`);

    try {
      // VACUUM INTO creates a consistent copy of the live SQLite database
      await prisma.$executeRawUnsafe(`VACUUM INTO '${destPath}'`);
      logger.info('Database backup created', { destPath });
      this.pruneOldBackups();
    } catch (error) {
      logger.error('Database backup failed', toError(error));
    }
  }

  private pruneOldBackups(): void {
    try {
      const files = readdirSync(this.backupDir)
        .filter((f) => f.startsWith('data-') && f.endsWith('.db'))
        .sort(); // ISO timestamps sort lexicographically = chronologically

      const toDelete = files.slice(0, Math.max(0, files.length - MAX_BACKUPS));
      for (const file of toDelete) {
        rmSync(join(this.backupDir, file));
        logger.debug('Pruned old backup', { file });
      }
    } catch (error) {
      logger.warn('Failed to prune old backups', { error: toError(error).message });
    }
  }
}

export const dbBackupService = new DbBackupService();

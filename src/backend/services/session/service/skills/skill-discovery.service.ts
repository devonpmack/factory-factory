import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createLogger } from '@/backend/services/logger.service';
import type { CommandInfo } from '@/shared/acp-protocol';

const logger = createLogger('skill-discovery');

export interface DiscoveredSkill {
  name: string;
  description: string;
  filePath: string;
}

const SKILL_DIRS = ['.claude/skills', '.cursor/skills'] as const;

function getUserHome(): string {
  return process.env.HOME ?? process.env.USERPROFILE ?? '';
}

/**
 * Scan a single directory for immediate child directories containing SKILL.md.
 * Returns discovered skills. Silently skips directories that don't exist.
 */
async function scanSkillsDir(baseDir: string): Promise<DiscoveredSkill[]> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(baseDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const skills: DiscoveredSkill[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const skillPath = path.join(baseDir, entry.name, 'SKILL.md');
    try {
      const content = await fs.readFile(skillPath, 'utf-8');
      const description = extractDescription(content);
      skills.push({
        name: entry.name,
        description,
        filePath: skillPath,
      });
    } catch {
      // No SKILL.md in this directory — skip
    }
  }

  return skills;
}

/**
 * Extract a one-line description from SKILL.md content.
 * Uses the first non-empty, non-heading line.
 */
function extractDescription(content: string): string {
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) {
      continue;
    }
    return trimmed.length > 120 ? `${trimmed.slice(0, 117)}...` : trimmed;
  }
  return 'Custom skill';
}

export function toCommandInfo(skills: DiscoveredSkill[]): CommandInfo[] {
  return skills.map((skill) => ({
    name: skill.name,
    description: skill.description,
    source: 'skill' as const,
  }));
}

class SkillDiscoveryService {
  private cache = new Map<string, { skills: DiscoveredSkill[]; discoveredAt: number }>();
  private readonly cacheTtlMs = 60_000;

  async discoverSkills(workingDir: string): Promise<DiscoveredSkill[]> {
    const cached = this.cache.get(workingDir);
    if (cached && Date.now() - cached.discoveredAt < this.cacheTtlMs) {
      return cached.skills;
    }

    const home = getUserHome();
    const searchDirs: string[] = [];

    if (home) {
      for (const rel of SKILL_DIRS) {
        searchDirs.push(path.join(home, rel));
      }
    }

    for (const rel of SKILL_DIRS) {
      searchDirs.push(path.join(workingDir, rel));
    }

    const results = await Promise.all(searchDirs.map(scanSkillsDir));
    const allSkills = results.flat();

    // Deduplicate by name (project-level skills override user-level)
    const seen = new Map<string, DiscoveredSkill>();
    for (const skill of allSkills) {
      seen.set(skill.name, skill);
    }
    const skills = [...seen.values()];

    this.cache.set(workingDir, { skills, discoveredAt: Date.now() });

    if (skills.length > 0) {
      logger.debug('Discovered skills', {
        workingDir,
        count: skills.length,
        names: skills.map((s) => s.name),
      });
    }

    return skills;
  }

  async getSkillContent(filePath: string): Promise<string | null> {
    try {
      return await fs.readFile(filePath, 'utf-8');
    } catch {
      logger.warn('Failed to read skill file', { filePath });
      return null;
    }
  }

  /**
   * Look up a discovered skill by name for a given working directory.
   * Returns the skill if found in cache, or re-discovers.
   */
  async findSkillByName(workingDir: string, name: string): Promise<DiscoveredSkill | null> {
    const skills = await this.discoverSkills(workingDir);
    return skills.find((s) => s.name === name) ?? null;
  }

  invalidateCache(workingDir?: string): void {
    if (workingDir) {
      this.cache.delete(workingDir);
    } else {
      this.cache.clear();
    }
  }
}

export const skillDiscoveryService = new SkillDiscoveryService();

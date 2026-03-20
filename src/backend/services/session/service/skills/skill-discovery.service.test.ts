import * as fs from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { skillDiscoveryService, toCommandInfo } from './skill-discovery.service';

vi.mock('node:fs/promises');

const mockedFs = vi.mocked(fs);

describe('skillDiscoveryService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    skillDiscoveryService.invalidateCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('discovers skills from directories containing SKILL.md', async () => {
    mockedFs.readdir.mockImplementation((dirPath) => {
      const dir = String(dirPath);
      if (dir.endsWith('.claude/skills')) {
        return Promise.resolve([
          { name: 'my-skill', isDirectory: () => true },
          { name: 'another', isDirectory: () => true },
          { name: 'not-a-dir.txt', isDirectory: () => false },
        ] as never);
      }
      return Promise.resolve([]);
    });

    mockedFs.readFile.mockImplementation((filePath) => {
      const p = String(filePath);
      if (p.includes('my-skill/SKILL.md')) {
        return Promise.resolve('# My Skill\nDoes something useful for testing.');
      }
      if (p.includes('another/SKILL.md')) {
        return Promise.resolve('A simple skill with no heading.');
      }
      return Promise.reject(new Error('ENOENT'));
    });

    const skills = await skillDiscoveryService.discoverSkills('/project');

    expect(skills).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'my-skill',
          description: 'Does something useful for testing.',
        }),
        expect.objectContaining({
          name: 'another',
          description: 'A simple skill with no heading.',
        }),
      ])
    );
  });

  it('deduplicates by name with later entries winning', async () => {
    mockedFs.readdir.mockImplementation((dirPath) => {
      const dir = String(dirPath);
      if (dir.includes('skills')) {
        return Promise.resolve([{ name: 'shared', isDirectory: () => true }] as never);
      }
      return Promise.resolve([]);
    });

    mockedFs.readFile.mockImplementation((filePath) => {
      const p = String(filePath);
      if (p.includes('/project/.claude/skills/shared/SKILL.md')) {
        return Promise.resolve('Project-level version.');
      }
      if (p.includes('/project/.cursor/skills/shared/SKILL.md')) {
        return Promise.resolve('Project cursor version.');
      }
      if (p.includes('shared/SKILL.md')) {
        return Promise.resolve('User-level version.');
      }
      return Promise.reject(new Error('ENOENT'));
    });

    const skills = await skillDiscoveryService.discoverSkills('/project');
    const shared = skills.find((s) => s.name === 'shared');
    expect(shared).toBeDefined();
    // Project-level directories are scanned after user-level, so project wins
    expect(shared!.filePath).toContain('/project/');
  });

  it('returns empty array when no skills directories exist', async () => {
    mockedFs.readdir.mockRejectedValue(new Error('ENOENT'));
    const skills = await skillDiscoveryService.discoverSkills('/empty-project');
    expect(skills).toEqual([]);
  });

  it('caches results for the same working directory', async () => {
    mockedFs.readdir.mockResolvedValue([]);

    await skillDiscoveryService.discoverSkills('/cached');
    await skillDiscoveryService.discoverSkills('/cached');

    // readdir is called once per search directory (4 dirs total), but only on first call
    const firstCallCount = mockedFs.readdir.mock.calls.length;
    expect(firstCallCount).toBe(4);
  });

  it('reads skill content', async () => {
    mockedFs.readFile.mockResolvedValue('# Instructions\nDo the thing.');
    const content = await skillDiscoveryService.getSkillContent('/path/to/SKILL.md');
    expect(content).toBe('# Instructions\nDo the thing.');
  });

  it('returns null when skill content cannot be read', async () => {
    mockedFs.readFile.mockRejectedValue(new Error('ENOENT'));
    const content = await skillDiscoveryService.getSkillContent('/missing/SKILL.md');
    expect(content).toBeNull();
  });

  it('truncates long descriptions', async () => {
    mockedFs.readdir.mockImplementation((dirPath) => {
      if (String(dirPath).includes('skills')) {
        return Promise.resolve([{ name: 'verbose', isDirectory: () => true }] as never);
      }
      return Promise.resolve([]);
    });

    const longLine = 'A'.repeat(200);
    mockedFs.readFile.mockResolvedValue(longLine);

    const skills = await skillDiscoveryService.discoverSkills('/truncate-test');
    const verbose = skills.find((s) => s.name === 'verbose');
    expect(verbose).toBeDefined();
    expect(verbose!.description.length).toBeLessThanOrEqual(120);
    expect(verbose!.description.endsWith('...')).toBe(true);
  });
});

describe('toCommandInfo', () => {
  it('converts discovered skills to CommandInfo with source=skill', () => {
    const skills = [
      { name: 'test-skill', description: 'A test skill', filePath: '/path/to/SKILL.md' },
    ];
    const commands = toCommandInfo(skills);
    expect(commands).toEqual([
      { name: 'test-skill', description: 'A test skill', source: 'skill' },
    ]);
  });

  it('returns empty array for empty input', () => {
    expect(toCommandInfo([])).toEqual([]);
  });
});

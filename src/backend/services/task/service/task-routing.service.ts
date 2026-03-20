import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createLogger } from '@/backend/services/logger.service';
import { projectAccessor } from '@/backend/services/workspace';

const logger = createLogger('task-routing-service');
const execFileAsync = promisify(execFile);

export interface ProjectCandidate {
  projectId: string;
  name: string;
  slug: string;
  repoPath: string;
  githubOwner: string | null;
  githubRepo: string | null;
  aiDescription: string | null;
  confidenceScore: number;
  reasonSummary: string;
}

export interface RoutingResult {
  candidates: ProjectCandidate[];
  summary: string;
}

export interface OrgGroup {
  org: string;
  projects: Array<{
    id: string;
    name: string;
    slug: string;
    githubRepo: string | null;
    aiDescription: string | null;
  }>;
}

interface LlmRoutingResponse {
  selections: Array<{
    slug: string;
    confidence: number;
    reason: string;
  }>;
  summary: string;
}

const LLM_ROUTING_SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    selections: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          slug: { type: 'string' },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          reason: { type: 'string' },
        },
        required: ['slug', 'confidence', 'reason'],
      },
    },
    summary: { type: 'string' },
  },
  required: ['selections', 'summary'],
});

async function callClaudeCli(prompt: string): Promise<LlmRoutingResponse | null> {
  try {
    const { stdout } = await execFileAsync(
      'claude',
      [
        '-p',
        prompt,
        '--output-format',
        'json',
        '--json-schema',
        LLM_ROUTING_SCHEMA,
        '--model',
        'haiku',
        '--allowedTools',
        '',
      ],
      { timeout: 30_000, maxBuffer: 1024 * 1024 }
    );

    const parsed = JSON.parse(stdout);
    const result = parsed.result ?? parsed;
    if (result.selections && Array.isArray(result.selections)) {
      return result as LlmRoutingResponse;
    }
    logger.warn('LLM routing returned unexpected shape', { result });
    return null;
  } catch (error) {
    logger.warn('LLM routing failed, falling back to keyword matching', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function buildRoutingPrompt(
  taskPrompt: string,
  projects: Array<{
    slug: string;
    name: string;
    githubOwner: string | null;
    githubRepo: string | null;
    aiDescription: string | null;
    repoPath: string;
  }>
): string {
  const projectList = projects
    .map((p) => {
      const parts = [`- **${p.slug}** (${p.name})`];
      if (p.githubOwner && p.githubRepo) {
        parts.push(`  GitHub: ${p.githubOwner}/${p.githubRepo}`);
      }
      if (p.aiDescription) {
        parts.push(`  Description: ${p.aiDescription}`);
      }
      parts.push(`  Path: ${p.repoPath}`);
      return parts.join('\n');
    })
    .join('\n');

  return `You are a project routing assistant. Given a user's task prompt and a list of available repositories, determine which repositories are relevant to the task.

For each relevant repository, assign a confidence score (0.0 to 1.0) and a brief reason.
Only include repositories that are genuinely relevant. A confidence of 0.8+ means very likely needed, 0.5-0.8 means probably needed, 0.2-0.5 means possibly needed.
Provide a one-sentence summary of why these repos were selected.

## Available repositories

${projectList}

## User's task

${taskPrompt}`;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-_]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

function computeKeywordOverlap(promptTokens: Set<string>, target: string): number {
  const targetTokens = tokenize(target);
  if (targetTokens.length === 0) {
    return 0;
  }
  let hits = 0;
  for (const token of targetTokens) {
    if (promptTokens.has(token)) {
      hits++;
    }
  }
  return hits / targetTokens.length;
}

class TaskRoutingService {
  async routePrompt(prompt: string): Promise<RoutingResult> {
    const projects = await projectAccessor.list({ isArchived: false, isSystem: false });
    if (projects.length === 0) {
      return { candidates: [], summary: 'No active projects found.' };
    }

    const llmResult = await callClaudeCli(
      buildRoutingPrompt(
        prompt,
        projects.map((p) => ({
          slug: p.slug,
          name: p.name,
          githubOwner: p.githubOwner,
          githubRepo: p.githubRepo,
          aiDescription: p.aiDescription,
          repoPath: p.repoPath,
        }))
      )
    );

    if (llmResult) {
      return this.buildFromLlmResult(llmResult, projects);
    }

    return this.buildFromKeywords(prompt, projects);
  }

  async getProjectsByOrg(): Promise<OrgGroup[]> {
    const projects = await projectAccessor.list({ isArchived: false, isSystem: false });
    const orgMap = new Map<string, OrgGroup['projects']>();

    for (const project of projects) {
      const org = project.githubOwner ?? 'local';
      const existing = orgMap.get(org);
      const entry = {
        id: project.id,
        name: project.name,
        slug: project.slug,
        githubRepo: project.githubRepo,
        aiDescription: project.aiDescription,
      };

      if (existing) {
        existing.push(entry);
      } else {
        orgMap.set(org, [entry]);
      }
    }

    return Array.from(orgMap.entries())
      .sort(([a], [b]) => {
        if (a === 'local') {
          return 1;
        }
        if (b === 'local') {
          return -1;
        }
        return a.localeCompare(b);
      })
      .map(([org, projects]) => ({ org, projects }));
  }

  private buildFromLlmResult(
    llmResult: LlmRoutingResponse,
    projects: Array<{
      id: string;
      name: string;
      slug: string;
      repoPath: string;
      githubOwner: string | null;
      githubRepo: string | null;
      aiDescription: string | null;
    }>
  ): RoutingResult {
    const slugToProject = new Map(projects.map((p) => [p.slug, p]));
    const candidates: ProjectCandidate[] = [];

    for (const selection of llmResult.selections) {
      const project = slugToProject.get(selection.slug);
      if (!project) {
        logger.warn('LLM selected unknown project slug', { slug: selection.slug });
        continue;
      }

      candidates.push({
        projectId: project.id,
        name: project.name,
        slug: project.slug,
        repoPath: project.repoPath,
        githubOwner: project.githubOwner,
        githubRepo: project.githubRepo,
        aiDescription: project.aiDescription,
        confidenceScore: Math.min(Math.max(selection.confidence, 0), 1),
        reasonSummary: selection.reason,
      });
    }

    for (const project of projects) {
      if (!candidates.some((c) => c.projectId === project.id)) {
        candidates.push({
          projectId: project.id,
          name: project.name,
          slug: project.slug,
          repoPath: project.repoPath,
          githubOwner: project.githubOwner,
          githubRepo: project.githubRepo,
          aiDescription: project.aiDescription,
          confidenceScore: 0,
          reasonSummary: 'Not selected by routing',
        });
      }
    }

    candidates.sort((a, b) => b.confidenceScore - a.confidenceScore);

    logger.info('LLM routing completed', {
      selectedCount: llmResult.selections.length,
      totalProjects: projects.length,
    });

    return {
      candidates,
      summary: llmResult.summary,
    };
  }

  private buildFromKeywords(
    prompt: string,
    projects: Array<{
      id: string;
      name: string;
      slug: string;
      repoPath: string;
      githubOwner: string | null;
      githubRepo: string | null;
      aiDescription: string | null;
    }>
  ): RoutingResult {
    const promptTokens = new Set(tokenize(prompt));
    const candidates: ProjectCandidate[] = [];

    for (const project of projects) {
      const { score, reasons } = this.scoreProjectByKeywords(project, promptTokens);
      candidates.push({
        projectId: project.id,
        name: project.name,
        slug: project.slug,
        repoPath: project.repoPath,
        githubOwner: project.githubOwner,
        githubRepo: project.githubRepo,
        aiDescription: project.aiDescription,
        confidenceScore: Math.min(score, 1.0),
        reasonSummary: reasons.join('; '),
      });
    }

    candidates.sort((a, b) => b.confidenceScore - a.confidenceScore);

    const threshold = 0.2;
    const included = candidates.filter((c) => c.confidenceScore >= threshold);
    const excluded = candidates.filter((c) => c.confidenceScore < threshold);

    const summaryParts: string[] = ['(keyword fallback)'];
    if (included.length > 0) {
      summaryParts.push(
        `Proposed ${included.length} repo(s): ${included.map((c) => c.slug).join(', ')}`
      );
    }
    if (excluded.length > 0) {
      summaryParts.push(
        `Excluded ${excluded.length} repo(s): ${excluded.map((c) => c.slug).join(', ')}`
      );
    }

    logger.info('Keyword routing completed (LLM unavailable)', {
      promptLength: prompt.length,
      totalProjects: projects.length,
      includedCount: included.length,
    });

    return {
      candidates,
      summary: summaryParts.join('. '),
    };
  }

  private scoreProjectByKeywords(
    project: {
      name: string;
      slug: string;
      repoPath: string;
      githubOwner: string | null;
      githubRepo: string | null;
      aiDescription: string | null;
    },
    promptTokens: Set<string>
  ): { score: number; reasons: string[] } {
    let score = 0;
    const reasons: string[] = [];

    const nameOverlap = computeKeywordOverlap(promptTokens, project.name);
    if (nameOverlap > 0.5) {
      score += 0.4;
      reasons.push(`Name match (${project.name})`);
    }

    const slugOverlap = computeKeywordOverlap(promptTokens, project.slug.replace(/-/g, ' '));
    if (slugOverlap > 0.3) {
      score += 0.3;
      reasons.push(`Slug match (${project.slug})`);
    }

    if (project.githubRepo) {
      const repoOverlap = computeKeywordOverlap(
        promptTokens,
        project.githubRepo.replace(/-/g, ' ')
      );
      if (repoOverlap > 0.3) {
        score += 0.3;
        reasons.push(`Repo name match (${project.githubRepo})`);
      }
    }

    if (project.aiDescription) {
      const descOverlap = computeKeywordOverlap(promptTokens, project.aiDescription);
      if (descOverlap > 0) {
        score += descOverlap * 0.5;
        reasons.push('Description keyword match');
      }
    }

    const pathBasename = project.repoPath.split('/').pop() ?? '';
    const pathOverlap = computeKeywordOverlap(promptTokens, pathBasename.replace(/-/g, ' '));
    if (pathOverlap > 0.3) {
      score += 0.2;
      reasons.push(`Path match (${pathBasename})`);
    }

    if (reasons.length === 0) {
      reasons.push('No strong signal');
    }

    return { score, reasons };
  }
}

export const taskRoutingService = new TaskRoutingService();

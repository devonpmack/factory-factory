import { createLogger } from '@/backend/services/logger.service';
import { projectAccessor } from '@/backend/services/workspace';

const logger = createLogger('task-routing-service');

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
    const projects = await projectAccessor.list({ isArchived: false });
    if (projects.length === 0) {
      return { candidates: [], summary: 'No active projects found.' };
    }

    const promptTokens = new Set(tokenize(prompt));
    const candidates: ProjectCandidate[] = [];

    for (const project of projects) {
      const { score, reasons } = this.scoreProject(project, promptTokens);

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

    const summaryParts: string[] = [];
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

    logger.info('Routing completed', {
      promptLength: prompt.length,
      totalProjects: projects.length,
      includedCount: included.length,
      excludedCount: excluded.length,
    });

    return {
      candidates,
      summary: summaryParts.join('. '),
    };
  }

  /**
   * Group all active projects by GitHub organization.
   * Projects without a githubOwner are grouped under "local".
   */
  async getProjectsByOrg(): Promise<OrgGroup[]> {
    const projects = await projectAccessor.list({ isArchived: false });
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

  private scoreProject(
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

    // Exact name/slug match
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

    // GitHub repo name match
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

    // AI description keyword match
    if (project.aiDescription) {
      const descOverlap = computeKeywordOverlap(promptTokens, project.aiDescription);
      if (descOverlap > 0) {
        score += descOverlap * 0.5;
        reasons.push('Description keyword match');
      }
    }

    // Repo path hints
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

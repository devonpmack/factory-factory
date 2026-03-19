import { basename } from 'node:path';
import type { Project } from '@prisma-gen/client';

export interface ProjectScore {
  projectId: string;
  projectSlug: string;
  projectName: string;
  score: number;
  reasons: string[];
}

/** Minimum score for a project to appear in inference results. */
const SCORE_THRESHOLD = 0.1;

/** Tokenize a string into lowercase words, splitting on common separators. */
function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .split(/[-_\s/\\.,]+/)
      .filter((t) => t.length >= 2)
  );
}

/** Jaccard similarity between two token sets. */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const t of a) {
    if (b.has(t)) {
      intersection++;
    }
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Check if any prompt token contains or is contained by a project token (min 4 chars). */
function hasSubstringMatch(promptTokens: Set<string>, projectTokens: Set<string>): boolean {
  for (const pt of projectTokens) {
    if (pt.length < 4) {
      continue;
    }
    for (const wt of promptTokens) {
      if (wt.length < 4) {
        continue;
      }
      if (wt.includes(pt) || pt.includes(wt)) {
        return true;
      }
    }
  }
  return false;
}

class TaskInferenceService {
  scoreProjectsForPrompt(prompt: string, projects: Project[]): ProjectScore[] {
    const promptTokens = tokenize(prompt);
    const scores: ProjectScore[] = [];

    for (const project of projects) {
      const reasons: string[] = [];
      let score = 0;

      // Build a combined token set from all project metadata
      const nameTokens = tokenize(project.name);
      const slugTokens = tokenize(project.slug);
      const repoTokens = tokenize(basename(project.repoPath));
      const githubTokens = tokenize(
        [project.githubOwner, project.githubRepo].filter(Boolean).join('/')
      );

      const allProjectTokens = new Set([
        ...nameTokens,
        ...slugTokens,
        ...repoTokens,
        ...githubTokens,
      ]);

      // Jaccard score over merged token sets
      const jaccardScore = jaccard(promptTokens, allProjectTokens);
      if (jaccardScore > 0) {
        score += jaccardScore;
        reasons.push(`token overlap (${(jaccardScore * 100).toFixed(0)}%)`);
      }

      // Substring match bonus
      if (hasSubstringMatch(promptTokens, allProjectTokens)) {
        score += 0.3;
        reasons.push('partial name match');
      }

      // Exact slug match bonus
      for (const t of promptTokens) {
        if (t === project.slug || t === project.githubRepo?.toLowerCase()) {
          score += 0.5;
          reasons.push('exact name match');
          break;
        }
      }

      if (score >= SCORE_THRESHOLD) {
        scores.push({
          projectId: project.id,
          projectSlug: project.slug,
          projectName: project.name,
          score,
          reasons,
        });
      }
    }

    return scores.sort((a, b) => b.score - a.score);
  }
}

export const taskInferenceService = new TaskInferenceService();

import { ExternalLink, GitBranch } from 'lucide-react';
import { useNavigate, useParams } from 'react-router';
import { useAppHeader } from '@/client/components/app-header-context';
import { trpc } from '@/client/lib/trpc';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'RUNNING':
      return 'default';
    case 'DONE':
    case 'READY':
      return 'secondary';
    case 'FAILED':
      return 'destructive';
    default:
      return 'outline';
  }
}

function repoStatusColor(status: string): string {
  switch (status) {
    case 'READY':
      return 'text-green-600';
    case 'FAILED':
      return 'text-red-600';
    case 'MATERIALIZING':
      return 'text-blue-600';
    default:
      return 'text-muted-foreground';
  }
}

type TaskProject = {
  id: string;
  projectId: string;
  confidenceScore: number | null;
  project: { name: string; aiDescription: string | null; githubOwner: string | null };
};

type TaskRepo = {
  projectId: string;
  status: string;
  prUrl: string | null;
  prNumber: number | null;
};

type GitSummary = {
  projectId: string;
  branchName: string | null;
  gitStats: { total: number; additions: number; deletions: number; hasUncommitted: boolean } | null;
};

function RepoCard({
  tp,
  repo,
  git,
}: {
  tp: TaskProject;
  repo: TaskRepo | undefined;
  git: GitSummary | undefined;
}) {
  return (
    <div className="border rounded-md px-3 py-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">{tp.project.name}</span>
          {tp.confidenceScore != null && (
            <Badge variant="outline" className="text-xs">
              {Math.round(tp.confidenceScore * 100)}%
            </Badge>
          )}
        </div>
        {repo && (
          <span className={`text-xs font-medium ${repoStatusColor(repo.status)}`}>
            {repo.status}
          </span>
        )}
      </div>
      {tp.project.aiDescription && (
        <p className="text-xs text-muted-foreground mt-1 italic">{tp.project.aiDescription}</p>
      )}
      {git?.branchName && (
        <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground">
          <GitBranch className="h-3 w-3" />
          {git.branchName}
        </div>
      )}
      {git?.gitStats && (
        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
          <span>
            {git.gitStats.total} file{git.gitStats.total !== 1 ? 's' : ''} changed
          </span>
          <span className="text-green-600">+{git.gitStats.additions}</span>
          <span className="text-red-600">-{git.gitStats.deletions}</span>
          {git.gitStats.hasUncommitted && <span className="text-yellow-600">uncommitted</span>}
        </div>
      )}
      {repo?.prUrl && (
        <div className="mt-1">
          <a
            href={repo.prUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-600 hover:underline"
          >
            PR #{repo.prNumber}
          </a>
        </div>
      )}
    </div>
  );
}

function sortOrgKeys(a: string, b: string): number {
  if (a === 'local') {
    return 1;
  }
  if (b === 'local') {
    return -1;
  }
  return a.localeCompare(b);
}

function groupByOrg(taskProjects: TaskProject[]): Map<string, TaskProject[]> {
  const groups = new Map<string, TaskProject[]>();
  for (const tp of taskProjects) {
    const org = tp.project.githubOwner ?? 'local';
    const existing = groups.get(org);
    if (existing) {
      existing.push(tp);
    } else {
      groups.set(org, [tp]);
    }
  }
  return groups;
}

function TaskActions({
  taskStatus,
  sentinelWorkspaceId,
}: {
  taskStatus: string;
  sentinelWorkspaceId: string | null;
}) {
  const navigate = useNavigate();
  const isSessionReady =
    (taskStatus === 'READY' || taskStatus === 'RUNNING') && sentinelWorkspaceId;
  return (
    <div className="flex gap-3">
      <Button variant="outline" onClick={() => navigate('/tasks')}>
        Back to Tasks
      </Button>
      {isSessionReady && (
        <Button onClick={() => navigate(`/projects/__tasks__/workspaces/${sentinelWorkspaceId}`)}>
          <ExternalLink className="mr-2 h-4 w-4" />
          View Session
        </Button>
      )}
    </div>
  );
}

function TaskRepoList({
  taskProjects,
  taskRepos,
  gitSummaries,
}: {
  taskProjects: TaskProject[];
  taskRepos: TaskRepo[];
  gitSummaries: GitSummary[];
}) {
  if (taskProjects.length === 0) {
    return null;
  }

  const orgGroups = groupByOrg(taskProjects);
  const gitSummaryMap = new Map(gitSummaries.map((s) => [s.projectId, s]));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Repositories ({taskProjects.length})</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {Array.from(orgGroups.entries())
          .sort(([a], [b]) => sortOrgKeys(a, b))
          .map(([org, projects]) => (
            <div key={org}>
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                {org}
              </h4>
              <div className="space-y-2">
                {projects.map((tp) => (
                  <RepoCard
                    key={tp.id}
                    tp={tp}
                    repo={taskRepos.find((r) => r.projectId === tp.projectId)}
                    git={gitSummaryMap.get(tp.projectId)}
                  />
                ))}
              </div>
            </div>
          ))}
      </CardContent>
    </Card>
  );
}

export default function TaskDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: task, isLoading } = trpc.task.get.useQuery(
    { id: id ?? '' },
    { enabled: !!id, refetchInterval: 5000 }
  );
  const { data: gitSummaries } = trpc.task.repoGitSummaries.useQuery(
    { id: id ?? '' },
    {
      enabled: !!id && (task?.status === 'READY' || task?.status === 'RUNNING'),
      refetchInterval: 10_000,
    }
  );
  const { data: taskWorkspace } = trpc.task.getTaskWorkspace.useQuery(
    { id: id ?? '' },
    { enabled: !!id }
  );

  useAppHeader({ title: task?.title ?? 'Task' });

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (!task) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">Task not found</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold truncate">{task.title ?? 'Untitled Task'}</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Created {new Date(task.createdAt).toLocaleString()}
          </p>
        </div>
        <Badge variant={statusVariant(task.status)}>{task.status}</Badge>
      </div>

      {task.ratchetCurrentActivity && (
        <div className="rounded-md bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 px-4 py-2">
          <p className="text-sm text-blue-700 dark:text-blue-300">{task.ratchetCurrentActivity}</p>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Prompt</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm whitespace-pre-wrap">{task.prompt}</p>
        </CardContent>
      </Card>

      {task.routingSummary && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Routing Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{task.routingSummary}</p>
          </CardContent>
        </Card>
      )}

      <TaskRepoList
        taskProjects={task.taskProjects}
        taskRepos={task.taskRepos}
        gitSummaries={gitSummaries ?? []}
      />

      <TaskActions
        taskStatus={task.status}
        sentinelWorkspaceId={taskWorkspace?.workspaceId ?? null}
      />
    </div>
  );
}

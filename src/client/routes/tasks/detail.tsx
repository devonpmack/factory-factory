import { Suspense } from 'react';
import { Link, useParams } from 'react-router';
import { useAppHeader } from '@/client/components/app-header-context';
import { Loading } from '@/client/components/loading';
import { trpc } from '@/client/lib/trpc';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { WorkspacePanelProvider } from '@/components/workspace';
import { WorkspaceDetailContainer } from '../projects/workspaces/workspace-detail-container';

function TaskStatusBadge({ status }: { status: string }) {
  const variantMap: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
    PENDING_CONFIRMATION: 'outline',
    PROVISIONING: 'secondary',
    READY: 'default',
    FAILED: 'destructive',
    ARCHIVED: 'outline',
  };
  return <Badge variant={variantMap[status] ?? 'secondary'}>{status.replace('_', ' ')}</Badge>;
}

function TaskRepoList({
  repos,
}: {
  repos: Array<{
    id: string;
    project: { name: string; slug: string };
    status: string;
    branchName: string | null;
    prState: string;
  }>;
}) {
  if (repos.length === 0) {
    return null;
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Repositories</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {repos.map((repo) => (
          <div key={repo.id} className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
                repos/{repo.project.slug}
              </span>
              <span className="text-muted-foreground">{repo.project.name}</span>
            </div>
            <div className="flex items-center gap-2">
              {repo.branchName && (
                <span className="text-muted-foreground text-xs font-mono">{repo.branchName}</span>
              )}
              <Badge
                variant={
                  repo.status === 'READY'
                    ? 'default'
                    : repo.status === 'FAILED'
                      ? 'destructive'
                      : 'secondary'
                }
                className="text-xs"
              >
                {repo.status}
              </Badge>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function TaskDetailContent({ taskId }: { taskId: string }) {
  useAppHeader({ title: 'Task' });

  const { data: task, isLoading } = trpc.task.get.useQuery({ id: taskId });

  if (isLoading) {
    return <Loading message="Loading task..." />;
  }
  if (!task) {
    return (
      <div className="p-6 text-center text-muted-foreground">
        Task not found.{' '}
        <Link to="/projects" className="underline">
          Go home
        </Link>
      </div>
    );
  }

  const sentinelWorkspaceId = task.workspace?.workspaceId;

  return (
    <div className="flex h-full flex-col">
      {/* Task header strip */}
      <div className="flex items-start justify-between gap-4 border-b p-3 shrink-0">
        <div className="min-w-0 space-y-0.5">
          <div className="flex items-center gap-2">
            <h2 className="truncate font-semibold">{task.name}</h2>
            <TaskStatusBadge status={task.status} />
          </div>
          <p className="text-muted-foreground line-clamp-2 text-xs">{task.prompt}</p>
        </div>
      </div>

      {/* Repo list */}
      {task.repos.length > 0 && (
        <div className="shrink-0 px-3 pt-3">
          <TaskRepoList repos={task.repos} />
        </div>
      )}

      {/* Session panel — reuse workspace chat if sentinel workspace exists */}
      {sentinelWorkspaceId && task.status !== 'PENDING_CONFIRMATION' ? (
        <div className="min-h-0 flex-1">
          <WorkspacePanelProvider workspaceId={sentinelWorkspaceId}>
            <Suspense fallback={<Loading message="Loading session..." />}>
              <WorkspaceDetailContainer key={sentinelWorkspaceId} />
            </Suspense>
          </WorkspacePanelProvider>
        </div>
      ) : task.status === 'PROVISIONING' ? (
        <div className="flex flex-1 items-center justify-center p-6 text-muted-foreground">
          <Loading message="Setting up repositories..." />
        </div>
      ) : task.status === 'FAILED' ? (
        <div className="p-6 text-center">
          <p className="text-destructive text-sm">
            {task.errorMessage ?? 'Task initialization failed.'}
          </p>
        </div>
      ) : null}
    </div>
  );
}

export default function TaskDetailPage() {
  const { id: taskId = '' } = useParams<{ id: string }>();
  return <TaskDetailContent taskId={taskId} />;
}

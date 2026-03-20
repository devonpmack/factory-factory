import { Link, useNavigate } from 'react-router';
import { useAppHeader } from '@/client/components/app-header-context';
import { trpc } from '@/client/lib/trpc';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

function statusColor(status: string): string {
  switch (status) {
    case 'RUNNING':
      return 'bg-blue-500';
    case 'DONE':
      return 'bg-green-500';
    case 'FAILED':
      return 'bg-red-500';
    case 'AWAITING_CONFIRMATION':
      return 'bg-yellow-500';
    case 'READY':
      return 'bg-emerald-500';
    default:
      return 'bg-muted-foreground';
  }
}

export default function TasksListPage() {
  const navigate = useNavigate();
  useAppHeader({ title: 'Tasks' });
  const { data: tasks, isLoading } = trpc.task.list.useQuery({ limit: 50 });

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Tasks</h1>
          <p className="text-muted-foreground text-sm">
            Cross-project tasks that span multiple repositories
          </p>
        </div>
        <Button onClick={() => navigate('/tasks/new')}>New Task</Button>
      </div>

      {!tasks || tasks.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <p className="text-muted-foreground mb-4">No tasks yet</p>
            <Button variant="outline" onClick={() => navigate('/tasks/new')}>
              Create your first task
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {tasks.map((task) => (
            <Link key={task.id} to={`/tasks/${task.id}`} className="block">
              <Card className="hover:bg-accent/50 transition-colors cursor-pointer">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">
                      {task.title ?? task.prompt.slice(0, 80)}
                    </CardTitle>
                    <Badge variant="outline" className="ml-2 shrink-0">
                      <span
                        className={`inline-block w-2 h-2 rounded-full mr-1.5 ${statusColor(task.status)}`}
                      />
                      {task.status}
                    </Badge>
                  </div>
                  <CardDescription className="line-clamp-2">{task.prompt}</CardDescription>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="flex gap-2 text-xs text-muted-foreground">
                    <span>
                      {task.taskProjects.length} repo
                      {task.taskProjects.length !== 1 ? 's' : ''}
                    </span>
                    <span>·</span>
                    <span>{new Date(task.createdAt).toLocaleDateString()}</span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

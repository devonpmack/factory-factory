import { useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { useAppHeader } from '@/client/components/app-header-context';
import { trpc } from '@/client/lib/trpc';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';

type TaskPhase = 'compose' | 'routing' | 'confirm' | 'launching';

interface RoutedCandidate {
  projectId: string;
  slug: string;
  name: string;
  confidenceScore: number;
  reasonSummary: string;
  githubOwner: string | null;
  githubRepo: string | null;
  aiDescription: string | null;
}

export default function NewTaskPage() {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<TaskPhase>('compose');
  const [prompt, setPrompt] = useState('');
  const [taskId, setTaskId] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<RoutedCandidate[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const createTask = trpc.task.create.useMutation();
  const routeTask = trpc.task.route.useMutation();
  const confirmProjects = trpc.task.confirmProjects.useMutation();
  const launchTask = trpc.task.launch.useMutation();

  useAppHeader({ title: 'New Task' });

  const handleSubmitPrompt = async () => {
    if (!prompt.trim()) {
      return;
    }

    try {
      const task = await createTask.mutateAsync({ prompt: prompt.trim() });
      setTaskId(task.id);
      setPhase('routing');

      const result = await routeTask.mutateAsync({ id: task.id });

      const mapped: RoutedCandidate[] = result.candidates.map((c) => ({
        projectId: c.projectId,
        slug: c.slug,
        name: c.name,
        confidenceScore: c.confidenceScore,
        reasonSummary: c.reasonSummary,
        githubOwner: c.githubOwner,
        githubRepo: c.githubRepo,
        aiDescription: c.aiDescription,
      }));
      setCandidates(mapped);

      // Auto-select repos with confidence >= 0.2
      const autoSelected = new Set(
        mapped.filter((c) => c.confidenceScore >= 0.2).map((c) => c.projectId)
      );
      setSelectedIds(autoSelected);
      setPhase('confirm');
    } catch (_error) {
      toast.error('Failed to route task');
      setPhase('compose');
    }
  };

  const handleConfirm = async () => {
    if (!taskId || selectedIds.size === 0) {
      return;
    }

    try {
      await confirmProjects.mutateAsync({
        id: taskId,
        projectIds: Array.from(selectedIds),
      });

      setPhase('launching');
      await launchTask.mutateAsync({ id: taskId });

      toast.success('Task launched');
      await navigate(`/tasks/${taskId}`);
    } catch (_error) {
      toast.error('Failed to launch task');
      setPhase('confirm');
    }
  };

  const toggleProject = (projectId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
  };

  // Group candidates by org
  const grouped = new Map<string, RoutedCandidate[]>();
  for (const c of candidates) {
    const org = c.githubOwner ?? 'local';
    const existing = grouped.get(org);
    if (existing) {
      existing.push(c);
    } else {
      grouped.set(org, [c]);
    }
  }

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      {phase === 'compose' && (
        <>
          <div>
            <h1 className="text-2xl font-semibold">New Task</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Describe what you want to do. The system will figure out which repos are involved.
            </p>
          </div>
          <div className="space-y-3">
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g., Rename the billing feature flag to billing-v2 everywhere..."
              rows={5}
              className="resize-none"
              autoFocus
            />
            <Button
              onClick={handleSubmitPrompt}
              disabled={!prompt.trim() || createTask.isPending}
              className="w-full"
            >
              {createTask.isPending ? 'Creating...' : 'Route Task'}
            </Button>
          </div>
        </>
      )}

      {phase === 'routing' && (
        <div className="flex flex-col items-center justify-center py-16 space-y-4">
          <Spinner className="h-8 w-8" />
          <p className="text-muted-foreground">Analyzing prompt and finding affected repos...</p>
        </div>
      )}

      {phase === 'confirm' && (
        <>
          <div>
            <h1 className="text-2xl font-semibold">Confirm Repositories</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Select which repositories this task should affect.
            </p>
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription className="line-clamp-3">{prompt}</CardDescription>
            </CardHeader>
          </Card>

          {Array.from(grouped.entries())
            .sort(([a], [b]) => {
              if (a === 'local') {
                return 1;
              }
              if (b === 'local') {
                return -1;
              }
              return a.localeCompare(b);
            })
            .map(([org, repos]) => (
              <div key={org} className="space-y-2">
                <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                  {org}
                </h3>
                <div className="space-y-2">
                  {repos.map((repo) => (
                    <Card
                      key={repo.projectId}
                      className={`cursor-pointer transition-colors ${
                        selectedIds.has(repo.projectId) ? 'border-primary' : ''
                      }`}
                      onClick={() => toggleProject(repo.projectId)}
                    >
                      <CardContent className="flex items-start gap-3 py-3">
                        <Checkbox
                          checked={selectedIds.has(repo.projectId)}
                          onCheckedChange={() => toggleProject(repo.projectId)}
                          className="mt-0.5"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm">{repo.name}</span>
                            <Badge variant="outline" className="text-xs">
                              {Math.round(repo.confidenceScore * 100)}%
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {repo.reasonSummary}
                          </p>
                          {repo.aiDescription && (
                            <p className="text-xs text-muted-foreground/70 mt-1 italic">
                              {repo.aiDescription}
                            </p>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            ))}

          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setPhase('compose')} className="flex-1">
              Back
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={selectedIds.size === 0 || confirmProjects.isPending}
              className="flex-1"
            >
              Confirm {selectedIds.size} repo{selectedIds.size !== 1 ? 's' : ''} & Launch
            </Button>
          </div>
        </>
      )}

      {phase === 'launching' && (
        <div className="flex flex-col items-center justify-center py-16 space-y-4">
          <Spinner className="h-8 w-8" />
          <p className="text-muted-foreground">Materializing repositories...</p>
        </div>
      )}
    </div>
  );
}

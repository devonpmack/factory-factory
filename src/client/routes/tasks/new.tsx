import { ArrowLeft, Check, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useAppHeader } from '@/client/components/app-header-context';
import { trpc } from '@/client/lib/trpc';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

type Step = 'compose' | 'confirm';

interface InferredProject {
  projectId: string;
  projectSlug: string;
  projectName: string;
  score: number;
  reasons: string[];
}

export default function NewTaskPage() {
  useAppHeader({ title: 'New Task' });

  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('compose');
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [taskId, setTaskId] = useState<string | null>(null);
  const [inferredProjects, setInferredProjects] = useState<InferredProject[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');

  const createTask = trpc.task.create.useMutation({
    onSuccess: ({ task, inferredProjects: inferred }) => {
      setTaskId(task.id);
      setInferredProjects(inferred);
      // Pre-select projects with a score above the threshold
      setSelectedIds(new Set(inferred.filter((p) => p.score >= 0.1).map((p) => p.projectId)));
      setStep('confirm');
      setError('');
    },
    onError: (err) => setError(err.message),
  });

  const confirmTask = trpc.task.confirm.useMutation({
    onSuccess: (task) => {
      void navigate(`/tasks/${task.id}`);
    },
    onError: (err) => setError(err.message),
  });

  const handleComposeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!name.trim()) {
      setError('Task name is required');
      return;
    }
    if (!prompt.trim()) {
      setError('Prompt is required');
      return;
    }
    createTask.mutate({ name: name.trim(), prompt: prompt.trim() });
  };

  const toggleProject = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleConfirmSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!taskId) {
      return;
    }
    if (selectedIds.size === 0) {
      setError('Select at least one project');
      return;
    }
    confirmTask.mutate({ taskId, confirmedProjectIds: Array.from(selectedIds) });
  };

  if (step === 'compose') {
    return (
      <div className="mx-auto max-w-2xl space-y-4 p-3 md:p-6">
        <div className="flex items-center gap-2 md:gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link to="/projects">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold">New Task</h1>
            <p className="text-muted-foreground mt-1">
              Describe your cross-project task. Factory Factory will suggest the relevant
              repositories.
            </p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Task Details</CardTitle>
            <CardDescription>
              Enter a name and a detailed prompt describing what you want to accomplish.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleComposeSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="task-name">Task name</Label>
                <Input
                  id="task-name"
                  placeholder="e.g. Rename billing-v1 flag to billing-v2"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={createTask.isPending}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="task-prompt">Prompt</Label>
                <Textarea
                  id="task-prompt"
                  placeholder="Describe the task in detail. Mention specific feature names, file patterns, or service names to improve project inference."
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={6}
                  disabled={createTask.isPending}
                />
              </div>

              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <div className="flex gap-2">
                <Button type="submit" disabled={createTask.isPending} className="flex-1">
                  {createTask.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Inferring repositories...
                    </>
                  ) : (
                    'Continue'
                  )}
                </Button>
                <Button variant="secondary" asChild>
                  <Link to="/projects">Cancel</Link>
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-3 md:p-6">
      <div className="flex items-center gap-2 md:gap-4">
        <Button variant="ghost" size="icon" onClick={() => setStep('compose')}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold">Confirm Repositories</h1>
          <p className="text-muted-foreground mt-1">
            Review and confirm which repositories this task should work across.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Inferred Repositories</CardTitle>
          <CardDescription>
            Factory Factory scored each repository based on your prompt. You can adjust the
            selection before launching.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleConfirmSubmit} className="space-y-4">
            {inferredProjects.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No repositories matched the prompt. You may add them manually.
              </p>
            ) : (
              <div className="space-y-2">
                {inferredProjects.map((p) => (
                  <label
                    key={p.projectId}
                    className="flex cursor-pointer items-start gap-3 rounded-md border p-3 hover:bg-muted/50"
                  >
                    <Checkbox
                      checked={selectedIds.has(p.projectId)}
                      onCheckedChange={() => toggleProject(p.projectId)}
                      className="mt-0.5"
                    />
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{p.projectName}</span>
                        <Badge variant="secondary" className="text-xs">
                          {Math.round(p.score * 100)}%
                        </Badge>
                      </div>
                      <p className="text-muted-foreground text-xs">{p.reasons.join(' · ')}</p>
                    </div>
                    {selectedIds.has(p.projectId) && (
                      <Check className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
                    )}
                  </label>
                ))}
              </div>
            )}

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="flex gap-2">
              <Button
                type="submit"
                disabled={confirmTask.isPending || selectedIds.size === 0}
                className="flex-1"
              >
                {confirmTask.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Launching task...
                  </>
                ) : (
                  `Launch task (${selectedIds.size} repo${selectedIds.size !== 1 ? 's' : ''})`
                )}
              </Button>
              <Button variant="secondary" onClick={() => setStep('compose')}>
                Back
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

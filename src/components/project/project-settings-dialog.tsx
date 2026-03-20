import { Settings } from 'lucide-react';
import { useEffect, useState } from 'react';
import { trpc } from '@/client/lib/trpc';
import { type ScriptType, StartupScriptForm } from '@/components/project/startup-script-form';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface ProjectSettingsDialogProps {
  projectId: string;
  projectName: string;
  currentStartupScriptCommand?: string | null;
  currentStartupScriptPath?: string | null;
  currentAiDescription?: string | null;
}

export function ProjectSettingsDialog({
  projectId,
  projectName,
  currentStartupScriptCommand,
  currentStartupScriptPath,
  currentAiDescription,
}: ProjectSettingsDialogProps) {
  const [open, setOpen] = useState(false);
  const [startupScript, setStartupScript] = useState('');
  const [scriptType, setScriptType] = useState<ScriptType>('command');
  const [aiDescription, setAiDescription] = useState('');
  const [error, setError] = useState('');

  const utils = trpc.useUtils();

  const updateProject = trpc.project.update.useMutation({
    onSuccess: () => {
      utils.project.list.invalidate();
      utils.project.getById.invalidate({ id: projectId });
      setOpen(false);
    },
    onError: (err) => {
      setError(err.message);
    },
  });

  useEffect(() => {
    if (open) {
      const hasPath = Boolean(currentStartupScriptPath);
      setScriptType(hasPath ? 'path' : 'command');
      setStartupScript(currentStartupScriptPath ?? currentStartupScriptCommand ?? '');
      setAiDescription(currentAiDescription ?? '');
      setError('');
    }
  }, [open, currentStartupScriptCommand, currentStartupScriptPath, currentAiDescription]);

  const handleSave = () => {
    setError('');
    const trimmedScript = startupScript.trim();
    const trimmedDescription = aiDescription.trim();

    updateProject.mutate({
      id: projectId,
      startupScriptCommand: scriptType === 'command' ? trimmedScript || null : null,
      startupScriptPath: scriptType === 'path' ? trimmedScript || null : null,
      aiDescription: trimmedDescription || null,
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            <Button variant="ghost" size="icon">
              <Settings className="h-4 w-4" />
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent>Settings</TooltipContent>
      </Tooltip>
      <DialogContent className="px-3 py-4 sm:max-w-[500px] sm:p-4">
        <DialogHeader>
          <DialogTitle>Project Settings</DialogTitle>
          <DialogDescription>{projectName}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-3">
            <Label>Repo Description (AI Index)</Label>
            <p className="text-xs text-muted-foreground">
              Describe what this repo does. Used by the task routing system to match prompts to
              repos.
            </p>
            <Textarea
              value={aiDescription}
              onChange={(e) => setAiDescription(e.target.value)}
              placeholder="e.g., React frontend for the billing dashboard. Contains payment UI, subscription management, and invoice views."
              rows={3}
              className="resize-none"
            />
          </div>

          <div className="space-y-3">
            <Label>Startup Script</Label>
            <p className="text-xs text-muted-foreground">
              Runs automatically when a new workspace is created to set up the environment.
            </p>

            <StartupScriptForm
              scriptType={scriptType}
              onScriptTypeChange={setScriptType}
              startupScript={startupScript}
              onStartupScriptChange={setStartupScript}
              idPrefix="settings"
              hideHeader
            />

            <p className="text-xs text-muted-foreground">
              {scriptType === 'command'
                ? 'Enter a shell command to run (e.g., npm install)'
                : 'Enter a path to a script file relative to the repository root'}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={updateProject.isPending}>
            {updateProject.isPending && <Spinner className="mr-2" />}
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

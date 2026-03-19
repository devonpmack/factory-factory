import { useCallback, useEffect, useState } from 'react';
import { trpc } from '@/client/lib/trpc';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

interface NotepadPanelProps {
  workspaceId: string;
  className?: string;
}

export function NotepadPanel({ workspaceId, className }: NotepadPanelProps) {
  const [notepad, setNotepad] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);

  // Fetch workspace to get initial notepad value
  const { data: workspace } = trpc.workspace.get.useQuery({ id: workspaceId });

  // Update mutation
  const updateNotepadMutation = trpc.workspace.updateNotepad.useMutation();

  // Sync local state with fetched workspace data
  useEffect(() => {
    if (workspace?.notepad !== undefined) {
      setNotepad(workspace.notepad ?? '');
    }
  }, [workspace?.notepad]);

  // Auto-save after 1 second of inactivity
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (workspace && notepad !== (workspace.notepad ?? '')) {
        setIsSaving(true);
        updateNotepadMutation
          .mutateAsync({
            workspaceId,
            notepad: notepad || null,
          })
          .then(() => {
            setIsSaving(false);
          })
          .catch(() => {
            setIsSaving(false);
          });
      }
    }, 1000);

    return () => clearTimeout(timeoutId);
  }, [notepad, workspace, workspaceId, updateNotepadMutation]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setNotepad(e.target.value);
  }, []);

  return (
    <div className={cn('flex flex-col h-full', className)}>
      <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30">
        <span className="text-sm font-medium">Notes</span>
        {isSaving && <span className="text-xs text-muted-foreground">Saving...</span>}
      </div>
      <div className="flex-1 p-3 overflow-auto">
        <Textarea
          value={notepad}
          onChange={handleChange}
          placeholder="Add notes about this workspace..."
          className="min-h-[200px] resize-none border-0 focus-visible:ring-0 focus-visible:ring-offset-0 p-0 font-mono text-sm"
        />
      </div>
    </div>
  );
}

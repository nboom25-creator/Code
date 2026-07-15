"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { NotebookPen, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/states";
import { useAppStore } from "@/lib/store/store";
import { noteSchema, type NoteFormValues } from "@/lib/validation";
import type { UserNote } from "@/lib/types";

/**
 * Add and manage personal notes for a project. Note bodies are stored and
 * rendered as plain text — React escapes the content, so user input can never
 * inject markup.
 */
export function NoteEditor({ projectId }: { projectId: string }) {
  const { data, addNote, updateNote, deleteNote } = useAppStore();
  const notes = data.notes.filter((n) => n.projectId === projectId);
  const [editingId, setEditingId] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<NoteFormValues>({
    resolver: zodResolver(noteSchema),
    defaultValues: { projectId, body: "" },
  });

  const onSubmit = (values: NoteFormValues) => {
    addNote(projectId, values.body);
    reset({ projectId, body: "" });
  };

  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-2">
        <label htmlFor="note-body" className="text-sm font-medium">
          Add a personal note
        </label>
        <Textarea
          id="note-body"
          placeholder="What went well? What would you do differently next time?"
          aria-invalid={Boolean(errors.body)}
          aria-describedby={errors.body ? "note-error" : undefined}
          {...register("body")}
        />
        {errors.body ? (
          <p id="note-error" className="text-sm text-destructive">
            {errors.body.message}
          </p>
        ) : null}
        <Button type="submit" size="sm" disabled={isSubmitting}>
          <NotebookPen className="h-4 w-4" aria-hidden="true" /> Save note
        </Button>
      </form>

      {notes.length === 0 ? (
        <EmptyState
          icon={<NotebookPen className="h-8 w-8" />}
          title="No notes yet"
          description="Jot down anything you want to remember for next time."
        />
      ) : (
        <ul className="space-y-3">
          {notes.map((note) => (
            <NoteItem
              key={note.id}
              note={note}
              isEditing={editingId === note.id}
              onEdit={() => setEditingId(note.id)}
              onCancel={() => setEditingId(null)}
              onSave={(body) => {
                updateNote(note.id, body);
                setEditingId(null);
              }}
              onDelete={() => deleteNote(note.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function NoteItem({
  note,
  isEditing,
  onEdit,
  onCancel,
  onSave,
  onDelete,
}: {
  note: UserNote;
  isEditing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (body: string) => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState(note.body);

  if (isEditing) {
    return (
      <li className="rounded-lg border p-3">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          aria-label="Edit note"
        />
        <div className="mt-2 flex gap-2">
          <Button size="sm" onClick={() => onSave(draft.trim())} disabled={!draft.trim()}>
            Save
          </Button>
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </li>
    );
  }

  return (
    <li className="rounded-lg border p-3">
      <p className="whitespace-pre-wrap text-sm">{note.body}</p>
      <div className="mt-2 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {new Date(note.updatedAt).toLocaleDateString()}
        </span>
        <div className="flex gap-1">
          <Button size="icon" variant="ghost" onClick={onEdit} aria-label="Edit note">
            <Pencil className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={onDelete}
            aria-label="Delete note"
          >
            <Trash2 className="h-4 w-4 text-destructive" aria-hidden="true" />
          </Button>
        </div>
      </div>
    </li>
  );
}

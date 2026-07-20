import { useState } from "react";
import { EditInput, EditSelect } from "./lead-edit-form";
import { datePart } from "../lib/lead-draft";
import type { LeadTaskInput } from "../data/orm-gateway-contract";
import { TASK_STATUS_VALUES, type LeadTaskRecord, type TaskStatus } from "../types/core";

/**
 * Task list editor for the Lead CRM view (ADR-0013, Phase 5.3). Unlike the meeting/offer/value editors
 * (single keyed records), tasks are a genuine list, so this renders one row per task plus an add-row.
 * The list is lazily loaded (`useLeadTasks`); a completed/cancelled/skipped status drops the task out of
 * the CRM open-count / next-due date (recomputed on refresh). `due_at` is a timestamptz shown as a
 * civil date. Each row seeds its own local state and is keyed by task id.
 */

const STATUS_LABEL: Record<TaskStatus, string> = {
  planned: "Planned",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
  skipped: "Skipped",
};

function TaskRow({ task, readOnly, saving, onSave }: {
  task: LeadTaskRecord;
  readOnly?: boolean;
  saving?: boolean;
  onSave: (patch: LeadTaskInput) => void;
}) {
  const seedTitle = task.title;
  const seedDue = datePart(task.due_at) ?? "";
  const seedStatus = task.status;

  const [title, setTitle] = useState(seedTitle);
  const [dueAt, setDueAt] = useState(seedDue);
  const [status, setStatus] = useState<TaskStatus>(seedStatus);

  const dirty = title !== seedTitle || dueAt !== seedDue || status !== seedStatus;
  const canSave = dirty && title.trim().length > 0 && !saving;

  return (
    <div className="grid gap-2 rounded-2xl border border-white/10 bg-black/20 p-3 md:grid-cols-[1fr_140px_150px_auto]">
      <EditInput value={title} onChange={setTitle} disabled={readOnly} placeholder="Task title" />
      <EditInput value={dueAt} onChange={setDueAt} disabled={readOnly} type="date" />
      <EditSelect value={status} options={TASK_STATUS_VALUES} labels={STATUS_LABEL} disabled={readOnly} onChange={(v) => setStatus(v as TaskStatus)} />
      {!readOnly ? (
        <button
          onClick={() => onSave({ title: title.trim(), due_at: dueAt || null, status })}
          disabled={!canSave}
          className="rounded-full border border-sky-400/30 bg-sky-500/10 px-3 py-2 text-sm text-sky-100 transition hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? "…" : "Save"}
        </button>
      ) : null}
    </div>
  );
}

function AddTaskRow({ readOnly, saving, onAdd }: { readOnly?: boolean; saving?: boolean; onAdd: (patch: LeadTaskInput) => Promise<boolean> }) {
  const [title, setTitle] = useState("");
  const [dueAt, setDueAt] = useState("");
  const canAdd = title.trim().length > 0 && !saving;

  return (
    <div className="grid gap-2 rounded-2xl border border-dashed border-white/15 bg-black/10 p-3 md:grid-cols-[1fr_140px_auto]">
      <EditInput value={title} onChange={setTitle} disabled={readOnly} placeholder="New task title" />
      <EditInput value={dueAt} onChange={setDueAt} disabled={readOnly} type="date" />
      <button
        onClick={async () => {
          // Clear only on success — a failed save keeps the typed task so it isn't lost.
          if (await onAdd({ title: title.trim(), due_at: dueAt || null, status: "planned" })) { setTitle(""); setDueAt(""); }
        }}
        disabled={!canAdd}
        className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200 transition hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {saving ? "…" : "Add task"}
      </button>
    </div>
  );
}

export function LeadTasksEditor({ tasks, loading, readOnly, savingId, onSave }: {
  tasks: LeadTaskRecord[];
  loading?: boolean;
  readOnly?: boolean;
  /** id of the task being saved, or "new" for the add-row. */
  savingId?: string | null;
  /** Resolves true on success — the add-row clears its inputs only then. */
  onSave: (id: string | undefined, patch: LeadTaskInput) => Promise<boolean>;
}) {
  return (
    <section className="space-y-3">
      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Tasks</p>
      {loading ? <p className="text-xs text-muted-foreground">Loading tasks…</p> : null}
      {tasks.map((task) => (
        <TaskRow key={task.id} task={task} readOnly={readOnly} saving={savingId === task.id} onSave={(patch) => onSave(task.id, patch)} />
      ))}
      {!loading && tasks.length === 0 ? <p className="text-xs text-muted-foreground">No tasks yet.</p> : null}
      {!readOnly ? <AddTaskRow readOnly={readOnly} saving={savingId === "new"} onAdd={(patch) => onSave(undefined, patch)} /> : null}
    </section>
  );
}

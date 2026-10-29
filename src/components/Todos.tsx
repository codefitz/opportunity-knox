import { useState, type FormEvent } from "react";
import {
  ArrowUpRight,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronRight,
  Circle,
  ClipboardList,
  LoaderCircle,
  Pencil,
  Plus,
  RotateCcw,
  X,
} from "lucide-react";
import { api, ApiError, formatDate, json } from "../api";
import type { Opportunity, Task } from "../types";
import {
  buildActionQueue,
  calendarDay,
  dayDifference,
  sortTasks,
  type ActionItem,
} from "../lib/dashboard";
import "../dashboard.css";

type Props = {
  tasks: Task[];
  opportunities: Opportunity[];
  timezone: string;
  onChanged: () => void;
  onError: (error: unknown) => void;
  onOpenOpportunity: (id: string) => void;
};
type TaskDraft = {
  title: string;
  notes: string;
  dueDate: string;
  opportunityId: string;
};
const emptyDraft = (): TaskDraft => ({
  title: "",
  notes: "",
  dueDate: "",
  opportunityId: "",
});
const draftFor = (task: Task): TaskDraft => ({
  title: task.title,
  notes: task.notes,
  dueDate: task.dueDate,
  opportunityId: task.opportunityId,
});
const errorText = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Could not save this task. Please try again.";

function DueDate({ value, today }: { value: string; today: string }) {
  const diff = dayDifference(value, today);
  return (
    <span
      className={`knox-task-due ${diff !== null && diff < 0 ? "is-overdue" : diff === 0 ? "is-today" : ""}`}
    >
      <CalendarDays size={13} />
      {diff === null
        ? "No due date"
        : diff === 0
          ? "Due today"
          : diff === 1
            ? "Due tomorrow"
            : `${formatDate(value)}${diff < 0 ? ` · ${Math.abs(diff)}d overdue` : ""}`}
    </span>
  );
}

export default function Todos({
  tasks,
  opportunities,
  timezone,
  onChanged,
  onError,
  onOpenOpportunity,
}: Props) {
  const [view, setView] = useState<"open" | "completed">("open");
  const [includeActions, setIncludeActions] = useState(true);
  const [editor, setEditor] = useState<Task | "new" | null>(null);
  const [draft, setDraft] = useState<TaskDraft>(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [formError, setFormError] = useState("");
  const [conflict, setConflict] = useState(false);
  const today = calendarDay(new Date(), timezone);
  const openTasks = tasks.filter((task) => !task.completed);
  const completedTasks = sortTasks(tasks.filter((task) => task.completed));
  const queue = buildActionQueue(tasks, opportunities, includeActions);
  const derivedCount = buildActionQueue([], opportunities).length;
  const overdueItems = queue.filter(
    (item) => item.dueDate && item.dueDate < today,
  ).length;
  const byOpportunity = new Map(opportunities.map((item) => [item.id, item]));

  const openEditor = (task?: Task) => {
    setEditor(task || "new");
    setDraft(task ? draftFor(task) : emptyDraft());
    setFormError("");
    setConflict(false);
  };
  const closeEditor = () => {
    if (!saving) {
      setEditor(null);
      setFormError("");
      setConflict(false);
    }
  };
  const saveTask = async (event: FormEvent) => {
    event.preventDefault();
    if (!editor || saving) return;
    setSaving(true);
    setFormError("");
    setConflict(false);
    try {
      const body = {
        ...draft,
        title: draft.title.trim(),
        ...(editor !== "new" ? { revision: editor.revision } : {}),
      };
      await api(
        editor === "new" ? "/tasks" : `/tasks/${editor.id}`,
        json(body, editor === "new" ? "POST" : "PATCH"),
      );
      setEditor(null);
      onChanged();
    } catch (error) {
      setFormError(errorText(error));
      if (error instanceof ApiError && error.status === 409) {
        setConflict(true);
        onChanged();
      }
      onError(error);
    } finally {
      setSaving(false);
    }
  };
  const reloadTask = async () => {
    if (!editor || editor === "new") return;
    setSaving(true);
    try {
      const result = await api<{ tasks: Task[] }>("/tasks");
      const latest = result.tasks.find((task) => task.id === editor.id);
      if (!latest)
        throw new Error(
          "This task could not be found. Refresh the page to load the current task list.",
        );
      setEditor(latest);
      setDraft(draftFor(latest));
      setConflict(false);
      setFormError("");
      onChanged();
    } catch (error) {
      setFormError(errorText(error));
      onError(error);
    } finally {
      setSaving(false);
    }
  };
  const changeCompletion = async (task: Task) => {
    if (busyId) return;
    setBusyId(task.id);
    try {
      await api(
        `/tasks/${task.id}`,
        json({ revision: task.revision, completed: !task.completed }, "PATCH"),
      );
      onChanged();
    } catch (error) {
      onError(error);
      if (error instanceof ApiError && error.status === 409) onChanged();
    } finally {
      setBusyId("");
    }
  };

  const manualRow = (task: Task) => {
    const opportunity = byOpportunity.get(task.opportunityId);
    return (
      <article
        className={`knox-task-row ${task.completed ? "is-completed" : ""}`}
        key={`task:${task.id}`}
      >
        <button
          className={`knox-task-check ${task.completed ? "is-checked" : ""}`}
          onClick={() => changeCompletion(task)}
          disabled={!!busyId}
          aria-label={`${task.completed ? "Reopen" : "Complete"} task: ${task.title}`}
          title={task.completed ? "Reopen task" : "Complete task"}
        >
          {busyId === task.id ? (
            <LoaderCircle size={18} className="knox-spin" />
          ) : task.completed ? (
            <Check size={18} />
          ) : (
            <Circle size={19} />
          )}
        </button>
        <div className="knox-task-copy">
          <button className="knox-task-title" onClick={() => openEditor(task)}>
            {task.title}
          </button>
          {task.notes && <p>{task.notes}</p>}
          <div className="knox-task-meta">
            <span className="knox-source-label">Task</span>
            {opportunity && (
              <button
                className="knox-linked-opportunity"
                onClick={() => onOpenOpportunity(opportunity.id)}
              >
                {opportunity.company} · {opportunity.role}
                <ArrowUpRight size={12} />
              </button>
            )}
            {task.completed && task.completedAt && (
              <span>Completed {formatDate(task.completedAt, timezone)}</span>
            )}
          </div>
        </div>
        <div className="knox-task-row-end">
          <DueDate value={task.dueDate} today={today} />
          <button
            className="knox-task-edit"
            aria-label={`Edit task: ${task.title}`}
            onClick={() => openEditor(task)}
          >
            <Pencil size={15} />
          </button>
        </div>
      </article>
    );
  };
  const derivedRow = (action: ActionItem) => (
    <article className="knox-task-row knox-task-derived" key={action.id}>
      <span className="knox-derived-icon" aria-hidden="true">
        <ArrowUpRight size={18} />
      </span>
      <div className="knox-task-copy">
        <button
          className="knox-task-title"
          onClick={() => onOpenOpportunity(action.opportunityId)}
        >
          {action.title}
        </button>
        <div className="knox-task-meta">
          <span className="knox-source-label is-derived">
            {action.source === "activity"
              ? "Activity follow-up"
              : action.source === "offer"
                ? "Offer response"
                : "Opportunity action"}
          </span>
          <span>{action.opportunityLabel}</span>
        </div>
      </div>
      <div className="knox-task-row-end">
        <DueDate value={action.dueDate} today={today} />
        <button
          className="knox-task-edit"
          onClick={() => onOpenOpportunity(action.opportunityId)}
          aria-label={`Open opportunity for ${action.title}`}
        >
          <ChevronRight size={17} />
        </button>
      </div>
    </article>
  );

  return (
    <section className="knox-todos" aria-label="To-do list">
      <header className="knox-page-heading">
        <div>
          <p className="knox-eyebrow">YOUR NEXT STEPS</p>
          <h1>A little progress, every day.</h1>
          <p>Keep follow-ups, preparation and everything in between moving.</p>
        </div>
        <button
          className="knox-button knox-button-primary"
          onClick={() => openEditor()}
        >
          <Plus size={17} />
          Add task
        </button>
      </header>
      <div className="knox-task-overview">
        <span>
          <strong>{openTasks.length}</strong> open tasks
        </span>
        <span>
          <strong>{completedTasks.length}</strong> completed
        </span>
        <span>
          <strong>{derivedCount}</strong> opportunity actions, follow-ups and
          offer deadlines
        </span>
      </div>

      {editor && (
        <section className="knox-panel knox-task-editor">
          <div className="knox-panel-heading">
            <div>
              <h2>{editor === "new" ? "Add a task" : "Edit task"}</h2>
              <p>
                Save a next step with an optional date and linked opportunity.
              </p>
            </div>
            <button
              className="knox-task-edit"
              onClick={closeEditor}
              disabled={saving}
              aria-label="Close task editor"
            >
              <X size={18} />
            </button>
          </div>
          <form onSubmit={saveTask} data-editing="true">
            <div className="knox-task-form-grid">
              <label className="knox-task-field is-wide">
                <span>Task title</span>
                <input
                  autoFocus
                  required
                  maxLength={300}
                  value={draft.title}
                  onChange={(event) =>
                    setDraft({ ...draft, title: event.target.value })
                  }
                  placeholder="For example, prepare questions for the interview"
                />
              </label>
              <label className="knox-task-field">
                <span>
                  Due date <small>optional</small>
                </span>
                <input
                  type="date"
                  value={draft.dueDate}
                  onChange={(event) =>
                    setDraft({ ...draft, dueDate: event.target.value })
                  }
                />
              </label>
              <label className="knox-task-field">
                <span>
                  Linked opportunity <small>optional</small>
                </span>
                <select
                  value={draft.opportunityId}
                  onChange={(event) =>
                    setDraft({ ...draft, opportunityId: event.target.value })
                  }
                >
                  <option value="">No linked opportunity</option>
                  {opportunities.map((opportunity) => (
                    <option key={opportunity.id} value={opportunity.id}>
                      {opportunity.company} · {opportunity.role}
                    </option>
                  ))}
                </select>
              </label>
              <label className="knox-task-field is-wide">
                <span>
                  Notes <small>optional</small>
                </span>
                <textarea
                  rows={3}
                  maxLength={10000}
                  value={draft.notes}
                  onChange={(event) =>
                    setDraft({ ...draft, notes: event.target.value })
                  }
                  placeholder="Anything useful for when you come back to this."
                />
              </label>
            </div>
            {formError && (
              <div className="knox-task-form-error" role="alert">
                <p>{formError}</p>
                {conflict && (
                  <>
                    <p>
                      Your draft is still here. Load the latest saved task
                      before editing again; this replaces the unsaved draft.
                    </p>
                    <button
                      type="button"
                      className="knox-text-button"
                      onClick={reloadTask}
                      disabled={saving}
                    >
                      <RotateCcw size={14} />
                      Load latest task
                    </button>
                  </>
                )}
              </div>
            )}
            <div className="knox-task-form-actions">
              <button
                type="button"
                className="knox-button knox-button-quiet"
                onClick={closeEditor}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                className="knox-button knox-button-primary"
                type="submit"
                disabled={saving || !draft.title.trim() || conflict}
              >
                {saving && <LoaderCircle size={15} className="knox-spin" />}
                {saving ? "Saving…" : "Save task"}
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="knox-panel knox-task-list-panel">
        <div className="knox-task-toolbar">
          <div className="knox-task-tabs" aria-label="Task view">
            <button
              aria-pressed={view === "open"}
              onClick={() => setView("open")}
            >
              <ClipboardList size={15} />
              Open <span>{openTasks.length}</span>
            </button>
            <button
              aria-pressed={view === "completed"}
              onClick={() => setView("completed")}
            >
              <CheckCheck size={15} />
              Completed <span>{completedTasks.length}</span>
            </button>
          </div>
          {view === "open" && (
            <label className="knox-actions-toggle">
              <input
                type="checkbox"
                checked={includeActions}
                onChange={(event) => setIncludeActions(event.target.checked)}
              />
              Show opportunity actions, follow-ups and offer deadlines
            </label>
          )}
        </div>
        <div className="knox-task-list-heading">
          <span>
            {view === "open"
              ? `${queue.length} ${queue.length === 1 ? "item" : "items"} in this view`
              : `${completedTasks.length} completed ${completedTasks.length === 1 ? "task" : "tasks"}`}
          </span>
          <span>
            Oldest due first · undated last
            {view === "open" && overdueItems > 0
              ? ` · ${overdueItems} overdue`
              : ""}
          </span>
        </div>
        <div className="knox-task-list">
          {view === "completed" ? (
            completedTasks.length ? (
              completedTasks.map(manualRow)
            ) : (
              <div className="knox-card-empty knox-task-empty">
                <CheckCheck size={32} />
                <h3>Completed tasks will live here</h3>
                <p>
                  Tick a task when it is done. You can reopen it at any time.
                </p>
              </div>
            )
          ) : queue.length ? (
            queue.map((item) =>
              item.source === "task" && item.task
                ? manualRow(item.task)
                : derivedRow(item),
            )
          ) : (
            <div className="knox-card-empty knox-task-empty">
              <ClipboardList size={32} />
              <h3>Your next step starts here</h3>
              <p>
                Add a task with a due date, or set the next action on an
                opportunity.
              </p>
              <button
                className="knox-button knox-button-primary"
                onClick={() => openEditor()}
              >
                <Plus size={16} />
                Add your first task
              </button>
            </div>
          )}
        </div>
        <p className="knox-definition knox-task-list-foot">
          Due dates use your {timezone} workspace calendar. Opportunity actions,
          follow-ups and offer deadlines open their source record. Record
          responses in Offers, and mark follow-ups completed in the activity.
          Task completion controls apply to saved tasks.
        </p>
      </section>
    </section>
  );
}

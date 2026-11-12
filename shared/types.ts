// The schedule discriminant also defines the task category: free study, dated plan, weekly habit.
// Keep one source of truth so existing schemaVersion 1 tasks need no migration.
export type Schedule =
  | { type: "none" }
  | { type: "once"; at: string }
  | { type: "weekly"; days: number[]; time: string };
export type MaterialType = "paper" | "web" | "file" | "other";
export interface TaskInput {
  name: string;
  category: string;
  materialType: MaterialType;
  material: string;
  goal: string;
  minutes: number;
  schedule: Schedule;
  enabled: boolean;
}
export interface Task extends TaskInput {
  id: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  progress: string;
  nextStep: string;
}
export interface Reminder {
  id: string;
  taskId: string;
  scheduledAt: string;
  dueAt: string;
  status: "pending" | "snoozed" | "started" | "skipped";
  shown: boolean;
}
export interface Session {
  id: string;
  taskId: string;
  taskName: string;
  category: string;
  reminderId?: string;
  startedAt: string;
  endedAt?: string;
  state: "running" | "paused" | "ended";
  targetMs: number;
  elapsedMs: number;
  pausedMs: number;
  dailyMs: Record<string, number>;
  reached: boolean;
  stage: number;
  progress: string;
  nextStep: string;
  endReason?: "target" | "early";
}
export interface Settings {
  sound: boolean;
  stages: boolean;
  autostart: boolean;
  trayExplained: boolean;
}
export interface Data {
  schemaVersion: 1;
  tasks: Task[];
  reminders: Reminder[];
  sessions: Session[];
  settings: Settings;
}
export interface Island {
  eventId?: string;
  kind: "due" | "summary" | "stage" | "complete" | "preview";
  title: string;
  message: string;
  reminderId?: string;
  taskId?: string;
}
export interface Snapshot extends Data {
  now: string;
  active?: Session;
  island: Island | null;
  saveError: string | null;
  notice: string | null;
}
export type Command =
  | { type: "task.save"; task: TaskInput; id?: string }
  | { type: "task.archive"; id: string }
  | {
      type: "session.start";
      taskId: string;
      minutes?: number;
      reminderId?: string;
    }
  | { type: "session.pause" | "session.resume" | "session.extend"; id: string }
  | { type: "session.end"; id: string; progress: string; nextStep: string }
  | { type: "reminder.snooze"; id: string }
  | { type: "settings.update"; settings: Partial<Settings> }
  | {
      type:
        | "window.show"
        | "window.hide"
        | "window.finish"
        | "app.quit"
        | "island.dismiss"
        | "store.retry"
        | "notice.dismiss";
    }
  | { type: "island.preview"; kind?: "due" | "stage" | "complete" }
  | { type: "material.open"; taskId: string };
export type Result = { ok: true } | { ok: false; error: string };
export interface StudyAPI {
  snapshot(): Promise<Snapshot>;
  command(command: Command): Promise<Result>;
  subscribe(listener: (snapshot: Snapshot) => void): () => void;
  pickFile(): Promise<string | null>;
  onFinish(listener: () => void): () => void;
}

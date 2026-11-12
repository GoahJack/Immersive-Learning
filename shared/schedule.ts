import type { Task } from "./types";

export function recentOccurrence(task: Task, now: Date): Date | null {
  if (!task.enabled || task.archived || task.schedule.type === "none")
    return null;
  if (task.schedule.type === "once") {
    const d = new Date(task.schedule.at);
    return d <= now ? d : null;
  }
  const [hour, minute] = task.schedule.time.split(":").map(Number);
  for (let back = 0; back <= 7; back++) {
    const date = new Date(now);
    date.setDate(date.getDate() - back);
    date.setHours(hour, minute, 0, 0);
    if (
      date <= now &&
      date.getTime() >= Date.parse(task.createdAt) &&
      task.schedule.days.includes(date.getDay())
    )
      return date;
  }
  return null;
}
export function nextOccurrence(task: Task, now: Date): Date | null {
  if (!task.enabled || task.archived || task.schedule.type === "none")
    return null;
  if (task.schedule.type === "once") {
    const d = new Date(task.schedule.at);
    return d > now ? d : null;
  }
  for (let ahead = 0; ahead <= 7; ahead++) {
    const d = new Date(now);
    d.setDate(d.getDate() + ahead);
    const [h, m] = task.schedule.time.split(":").map(Number);
    d.setHours(h, m, 0, 0);
    if (d > now && task.schedule.days.includes(d.getDay())) return d;
  }
  return null;
}

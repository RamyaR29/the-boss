// Fake data for reminders and to-dos. Canvas (canvas.ts) and the Mac Calendar
// (calendar.ts) are real now; real Check tools replace the rest in a later slice.

export type Source = "canvas" | "calendar" | "reminder" | "todo";

export interface TodayItem {
  id: string;
  source: Source;
  title: string;
  at: Date;
}

export interface NeedsYouItem {
  id: string;
  kind: "approval" | "question" | "alert";
  text: string;
  primary: string;
  secondary: string;
  /** Set for alerts made from a real Canvas deadline. */
  canvasUid?: string;
}

export interface RecentItem {
  id: string;
  at: Date;
  text: string;
}

function todayAt(hours: number, minutes = 0): Date {
  const d = new Date();
  d.setHours(hours, minutes, 0, 0);
  return d;
}

export const mockNeedsYou: NeedsYouItem[] = [
  {
    id: "n1",
    kind: "approval",
    text: 'Add a reminder: "Submit algorithms assignment", tomorrow at 9:00 am?',
    primary: "Approve",
    secondary: "Cancel",
  },
];

export const mockToday: TodayItem[] = [
  { id: "t2", source: "reminder", title: "Call Amma", at: todayAt(13, 30) },
  { id: "t3", source: "todo", title: "Buy printer paper", at: todayAt(15, 0) },
];

export const mockRecently: RecentItem[] = [
];

export const sourceLabel: Record<Source, string> = {
  canvas: "Canvas",
  calendar: "Calendar",
  reminder: "Reminder",
  todo: "To-do",
};

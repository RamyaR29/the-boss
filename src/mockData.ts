// Fake data for the first slice. Nothing here talks to Canvas, calendar,
// mail or reminders yet; real Check tools replace this in a later slice.

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
  {
    id: "n2",
    kind: "question",
    text: "Study group at 6:00 pm overlaps your quiz window. Keep both?",
    primary: "Keep both",
    secondary: "Move study group",
  },
  {
    id: "n3",
    kind: "alert",
    text: "Databases quiz closes tonight at 11:59 pm and isn't started.",
    primary: "Block 1 hour",
    secondary: "Dismiss",
  },
];

export const mockToday: TodayItem[] = [
  { id: "t1", source: "calendar", title: "Data Structures lecture", at: todayAt(10, 0) },
  { id: "t2", source: "reminder", title: "Call Amma", at: todayAt(13, 30) },
  { id: "t3", source: "todo", title: "Buy printer paper", at: todayAt(15, 0) },
  { id: "t4", source: "calendar", title: "Study group", at: todayAt(18, 0) },
  { id: "t5", source: "canvas", title: "Lab report draft due", at: todayAt(20, 0) },
  { id: "t6", source: "canvas", title: "Databases quiz closes", at: todayAt(23, 59) },
];

export const mockRecently: RecentItem[] = [
  { id: "r1", at: todayAt(8, 30), text: "Checked Canvas: 2 new assignments" },
  { id: "r2", at: todayAt(9, 2), text: "Reminded you: lab report draft due tonight" },
  { id: "r3", at: todayAt(9, 15), text: "Noticed a calendar overlap at 6:00 pm" },
];

export const sourceLabel: Record<Source, string> = {
  canvas: "Canvas",
  calendar: "Calendar",
  reminder: "Reminder",
  todo: "To-do",
};

/** A card in the "Needs you" section, counted on the elephant's badge. */
export interface NeedsYouItem {
  id: string;
  kind: "approval" | "question" | "alert";
  text: string;
  primary: string;
  secondary: string;
  /** Set for alerts made from a real Canvas deadline. */
  canvasUid?: string;
}

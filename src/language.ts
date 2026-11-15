export type Language = "English" | "Tamil" | "Tanglish";

const TAMIL_SCRIPT = /[஀-௿]/;

// Common Tamil words as written in English letters. Rough, but good enough to
// tell Tanglish from English for the language label and the voice choice.
const TANGLISH_WORDS =
  /\b(pannu|pannanum|panren|pannren|pannunga|naalaiku|naalaikku|innaiku|innikku|enna|ennaku|enakku|illa|illai|irukku|irukka|iruku|seri|sari|venum|vendam|romba|epdi|eppadi|inga|anga|sollu|sollunga|paaru|paru|ungaluku|unakku|un|nee|naan|naa|nalla|aama|aamaa|ponga|vaa|vanga|theriyum|theriyala|mudiyum|mudiyala|ready\s+aa|da|di|machan|kanna|chellam|appo|ippo|adhu|idhu|yaaru|enga|eppo|kandippa|seekiram|konjam|neraya|saapadu|vela|velai|padikanum|padi)\b/i;

export function detectLanguage(text: string): Language | "" {
  if (!text.trim()) return "";
  if (TAMIL_SCRIPT.test(text)) return "Tamil";
  if (TANGLISH_WORDS.test(text)) return "Tanglish";
  return "English";
}

/** Which macOS voice reads a reply: Samantha for English, Vani for Tamil and Tanglish. */
export function voiceFor(reply: string): "Samantha" | "Vani" {
  return detectLanguage(reply) === "English" ? "Samantha" : "Vani";
}

export type AiResult = { status: "ok"; text: string } | { status: "no-key" } | { status: "error" };

// Gemini text model. Source: https://ai.google.dev/gemini-api/docs/models (-> aistudio.google.com/docs/models)
export const MODEL = "gemini-3.5-flash-lite";
const API = "https://generativelanguage.googleapis.com/v1beta/models";
const KEY_NAME = "ol-gemini-key";

const SHORTEN_SYS =
  "你是日記縮句器。把使用者的一段話縮成一句關鍵短句。規則：使用使用者原本的語言與語氣；只能使用原文已有的資訊，不得加入任何原文沒有的內容；不要加引號、不要加句號以外的修飾、不要解釋。只回傳那一句純文字。";
const DIARY_SYS =
  "你是日記整理者。使用者會依序給你當天的幾則記錄原文。請依給定順序，把它們統整成一段流暢的日記：保持第一人稱與原本的語氣與語言，不得杜撰原文沒有的細節，不要加標題、不要條列、不要加評論。只回傳純文字。";

export function getKey(): string {
  try {
    return (localStorage.getItem(KEY_NAME) ?? "").trim();
  } catch {
    return "";
  }
}
/** Empty string removes the key. */
export function setKey(k: string): void {
  try {
    const v = k.trim();
    if (v) localStorage.setItem(KEY_NAME, v);
    else localStorage.removeItem(KEY_NAME);
  } catch {
    /* storage unavailable */
  }
}

async function callGemini(key: string, system: string, user: string, maxOut: number): Promise<AiResult> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 30000);
  try {
    const r = await fetch(`${API}/${encodeURIComponent(MODEL)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: { maxOutputTokens: maxOut },
      }),
      signal: ctl.signal,
    });
    if (!r.ok) return { status: "error" };
    const j: any = await r.json();
    const parts: any[] = j?.candidates?.[0]?.content?.parts ?? [];
    const text = parts
      .filter((p) => typeof p.text === "string" && !p.thought)
      .map((p) => p.text)
      .join("")
      .trim();
    return text ? { status: "ok", text } : { status: "error" };
  } catch {
    return { status: "error" };
  } finally {
    clearTimeout(timer);
  }
}

export async function shorten(text: string): Promise<AiResult> {
  const t = text.trim();
  if (!t) return { status: "error" };
  if ([...t].length <= 20) return { status: "ok", text: t };
  const key = getKey();
  if (!key) return { status: "no-key" };
  return callGemini(key, SHORTEN_SYS, t, 512);
}

export async function diary(entries: string[]): Promise<AiResult> {
  if (!entries.length) return { status: "error" };
  const key = getKey();
  if (!key) return { status: "no-key" };
  return callGemini(key, DIARY_SYS, entries.map((e, i) => `${i + 1}. ${e}`).join("\n"), 1500);
}

// Client-side AI — talks directly to an OpenAI-compatible endpoint (LM Studio's
// local Gemma server by default). Ported from backend/app/ai/*. Because the app is
// now fully static, the browser calls the model endpoint itself; everything
// degrades gracefully when the endpoint is offline.
//
// LM Studio must be running with its local server enabled and CORS allowed
// (it allows all origins by default). The base URL is user-configurable and
// stored in localStorage so it can point at any OpenAI-compatible server.

const LS_BASE_URL = "housescout.lmBaseUrl";
const LS_CHAT_MODEL = "housescout.lmChatModel";
const DEFAULT_BASE_URL = "http://localhost:1234/v1";

export function getBaseUrl(): string {
  if (typeof window === "undefined") return DEFAULT_BASE_URL;
  return localStorage.getItem(LS_BASE_URL) || DEFAULT_BASE_URL;
}

export function setBaseUrl(url: string): void {
  if (typeof window === "undefined") return;
  if (url) localStorage.setItem(LS_BASE_URL, url.replace(/\/$/, ""));
  else localStorage.removeItem(LS_BASE_URL);
}

export function getChatModelOverride(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(LS_CHAT_MODEL) || "";
}

export function setChatModelOverride(model: string): void {
  if (typeof window === "undefined") return;
  if (model) localStorage.setItem(LS_CHAT_MODEL, model);
  else localStorage.removeItem(LS_CHAT_MODEL);
}

export type Health = { available: boolean; models: string[]; error?: string };

export async function health(): Promise<Health> {
  try {
    const res = await fetch(`${getBaseUrl()}/models`, {
      headers: { Authorization: "Bearer lm-studio" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const ids: string[] = (data.data || []).map((m: { id: string }) => m.id);
    return { available: true, models: ids };
  } catch (exc) {
    return { available: false, models: [], error: String(exc) };
  }
}

type Message = { role: "system" | "user" | "assistant"; content: string };
export type ChatResult = { ok: boolean; content: string; model: string | null };

async function chatModel(): Promise<string | null> {
  const override = getChatModelOverride();
  if (override) return override;
  const h = await health();
  return h.available && h.models.length ? h.models[0] : null;
}

export async function chat(
  messages: Message[],
  { temperature = 0.4, maxTokens = 900 }: { temperature?: number; maxTokens?: number } = {},
): Promise<ChatResult> {
  const model = await chatModel();
  if (!model) {
    return {
      ok: false,
      content:
        "Local AI (LM Studio) is not reachable. Start LM Studio and load a Gemma model, " +
        "enable its local server, then set the endpoint in Settings. Everything else in " +
        "HouseScout still works.",
      model: null,
    };
  }
  try {
    const res = await fetch(`${getBaseUrl()}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: "Bearer lm-studio" },
      body: JSON.stringify({ model, messages, temperature, max_tokens: maxTokens }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return { ok: true, content: data.choices?.[0]?.message?.content || "", model };
  } catch (exc) {
    return { ok: false, content: `AI request failed: ${exc}`, model };
  }
}

// --------------------------------------------------------------------------- //
// Prompt builders (ported from backend/app/ai/insights.py)
// --------------------------------------------------------------------------- //
const SYSTEM_ADVISOR =
  "You are HouseScout, a sharp, honest property buying co-pilot for Christchurch, " +
  "New Zealand. The user wants to buy a home under NZ$500k (pre-approved to $480k), " +
  "must have a garage and at least a small backyard, will live in it and rent spare " +
  "rooms to boarders to pay the mortgage off as fast as possible. Townhouses are a " +
  "last resort. Be concrete and numeric. Note NZ specifics: the IRD standard-cost " +
  "method makes up to $245/week per boarder (max 4) effectively tax-free. You are not " +
  "a licensed financial adviser; flag when professional/legal advice is warranted.";

export async function listingInsight(
  listing: Record<string, unknown>,
  finance: Record<string, any>,
  score: Record<string, unknown>,
): Promise<ChatResult> {
  const payload = {
    listing,
    match_score: score.match_score,
    score_components: score.components,
    finance: {
      loan: finance.loan,
      monthly_payment: finance.monthly_payment,
      rentable_rooms: finance.boarder?.rentable_rooms,
      monthly_boarder_income: finance.monthly_boarder_income,
      net_monthly_outlay: finance.net_monthly_outlay,
      gross_yield_pct: finance.gross_yield_pct,
      payoff_years_standard: finance.standard?.payoff_years,
      payoff_years_accelerated: finance.accelerated?.payoff_years,
      years_saved: finance.years_saved,
    },
  };
  const messages: Message[] = [
    { role: "system", content: SYSTEM_ADVISOR },
    {
      role: "user",
      content:
        "Assess this property for my live-in-and-rent-rooms strategy. Use the data " +
        "below. Respond in markdown with sections: **Verdict** (1 line), " +
        "**Pros**, **Cons / red flags**, **Rent-a-room potential**, " +
        "**Negotiation angle**. Be specific about the numbers.\n\n" +
        JSON.stringify(payload, null, 2),
    },
  ];
  return chat(messages, { temperature: 0.5 });
}

export async function chatAssistant(
  question: string,
  contextListings: Record<string, unknown>[],
): Promise<ChatResult> {
  const ctx = JSON.stringify(contextListings, null, 2);
  const messages: Message[] = [
    { role: "system", content: SYSTEM_ADVISOR },
    {
      role: "user",
      content:
        `Question: ${question}\n\n` +
        "Answer using ONLY the candidate listings below (they are the current " +
        "matches in my database). Compare them, cite addresses, and recommend. " +
        "If the data can't answer the question, say so.\n\n" +
        `Candidate listings:\n${ctx}`,
    },
  ];
  return chat(messages, { temperature: 0.4, maxTokens: 1100 });
}

export async function advisor(question: string): Promise<ChatResult> {
  const messages: Message[] = [
    { role: "system", content: SYSTEM_ADVISOR },
    { role: "user", content: question },
  ];
  return chat(messages, { temperature: 0.5, maxTokens: 1100 });
}

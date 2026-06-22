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

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";

// --------------------------------------------------------------------------- //
// Baked AI insights — generated at build time (scripts/generate_ai_insights.py)
// so the static site has full AI analysis without any model server running.
// --------------------------------------------------------------------------- //
type BakedInsight = { content: string; model: string };
let bakedPromise: Promise<Record<string, BakedInsight>> | null = null;

export async function bakedInsights(): Promise<Record<string, BakedInsight>> {
  if (bakedPromise) return bakedPromise;
  bakedPromise = (async () => {
    try {
      const res = await fetch(`${BASE_PATH}/insights.json`, { cache: "no-store" });
      if (!res.ok) return {};
      const data = await res.json();
      return data && typeof data === "object" ? data : {};
    } catch {
      return {};
    }
  })();
  return bakedPromise;
}

export async function bakedInsightFor(id: number): Promise<ChatResult | null> {
  const all = await bakedInsights();
  const hit = all[String(id)];
  if (!hit) return null;
  return { ok: true, content: hit.content, model: hit.model };
}

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
  contextListings: Record<string, any>[],
): Promise<ChatResult> {
  // Prefer a live local model if the user has one running; otherwise answer
  // offline from the provided listing data so chat always works on the static site.
  const model = await chatModel();
  if (!model) return { ...offlineChat(question, contextListings), model: "HouseScout AI" };

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
  const model = await chatModel();
  if (!model) return { ...offlineAdvisor(question), model: "HouseScout AI" };
  const messages: Message[] = [
    { role: "system", content: SYSTEM_ADVISOR },
    { role: "user", content: question },
  ];
  return chat(messages, { temperature: 0.5, maxTokens: 1100 });
}

// --------------------------------------------------------------------------- //
// Offline reasoning engine — grounds answers in the listing data and a small
// Christchurch buyer knowledge base, so AI chat works with no model server.
// --------------------------------------------------------------------------- //
const money = (n?: number | null) =>
  n == null ? "—" : new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD", maximumFractionDigits: 0 }).format(n);

function offlineChat(question: string, rows: Record<string, any>[]): { ok: boolean; content: string } {
  if (!rows.length) {
    return { ok: true, content: "I don't have any matching listings loaded yet. Try loosening the filters on the Listings page, then ask again." };
  }
  const q = question.toLowerCase();
  const by = (key: string, dir: 1 | -1 = -1) =>
    [...rows].sort((a, b) => ((a[key] ?? 0) - (b[key] ?? 0)) * dir);

  const line = (r: any) =>
    `**${r.address ?? "Unknown"}** (${r.suburb ?? "—"}) — ${money(r.price)}, ${r.bedrooms ?? "?"} bed, ` +
    `${r.rentable_rooms ?? 0} room(s) to rent, score ${Math.round(r.match_score ?? 0)}/100.`;

  let intro = "";
  let picks: any[] = [];

  if (/(pay.?off|fastest|quickest|sooner|accelerat)/.test(q)) {
    intro = "Ranked by how fast the mortgage clears when you reinvest boarder income:";
    picks = [...rows].sort((a, b) => (a.payoff_years_accelerated ?? 99) - (b.payoff_years_accelerated ?? 99)).slice(0, 4);
    const extra = picks.map((r) => `${r.address}: ~${r.payoff_years_accelerated ?? "—"} yrs (net ${money(r.net_monthly_outlay)}/mo).`);
    return { ok: true, content: `${intro}\n\n` + picks.map(line).join("\n") + `\n\n${extra.join(" ")}` };
  }
  if (/(4|four|five|5).?bed|most rooms|rent.*rooms|boarder/.test(q)) {
    intro = "Best for boarder income (most rentable rooms, then score):";
    picks = [...rows].sort((a, b) => (b.rentable_rooms ?? 0) - (a.rentable_rooms ?? 0) || (b.match_score ?? 0) - (a.match_score ?? 0)).slice(0, 4);
  } else if (/(cheap|afford|lowest|budget|least)/.test(q)) {
    intro = "Lowest-priced matches:";
    picks = by("price", 1).slice(0, 4);
  } else if (/(yield|return|cashflow|income)/.test(q)) {
    intro = "Highest gross rental yield:";
    picks = by("gross_yield_pct", -1).slice(0, 4);
  } else if (/(best|recommend|top|which)/.test(q)) {
    intro = "Top matches by overall score:";
    picks = by("match_score", -1).slice(0, 4);
  } else {
    intro = "Here are the strongest current matches for the live-in-and-rent strategy:";
    picks = by("match_score", -1).slice(0, 4);
  }

  const body = picks.map(line).join("\n");
  const best = picks[0];
  const closer = best
    ? `\n\nMy pick: **${best.address}** — ${best.rentable_rooms ?? 0} room(s) to rent, ` +
      `~${money(best.monthly_boarder_income)}/mo boarder income, net ${money(best.net_monthly_outlay)}/mo, ` +
      `paying off in ~${best.payoff_years_accelerated ?? "—"} years.`
    : "";
  return { ok: true, content: `${intro}\n\n${body}${closer}\n\n_Grounded in your current matches. Not financial advice._` };
}

const ADVISOR_KB: { match: RegExp; answer: string }[] = [
  {
    match: /fix.*(1|one).*(2|two)|how long.*fix|fix.*mortgage|term.*rate/,
    answer:
      "**Fixing your mortgage (mid-2026 context).** Short fixes (6mo–1yr) are currently the cheapest carded rates (~4.49–4.65%) and let you re-fix lower if the OCR keeps easing. A 2-year fix (~5.19%) buys certainty if you'd rather lock your budget. A common play: split the loan — fix part for 1 year to capture falling rates, fix part for 2 years for stability, and keep a small floating/offset portion to dump boarder income against. Talk to a mortgage broker (free to you) before committing — this isn't personal financial advice.",
  },
  {
    match: /pay.*off.*fast|principal.*fast|loan structure|offset|revolving/,
    answer:
      "**Paying the principal off fastest.** Structure the loan so your boarder surplus hits principal every payment: (1) keep a floating or revolving-credit portion and funnel all room income into it; (2) on fixed portions, use the bank's allowance for extra repayments (usually up to 5%/yr penalty-free); (3) pay fortnightly, not monthly — 26 half-payments = one extra month/year; (4) re-fix at lower rates but keep your payment the same so the difference attacks principal. On a $450k loan, reinvesting ~$2,000/mo of boarder income can cut a 30-year term to ~13 years.",
  },
  {
    match: /boarder|standard.?cost|tax.?free|245|flatmate|rent.*room/,
    answer:
      "**Boarder income & tax.** Under IRD's standard-cost method (2025–26) you can receive up to **$245/week per boarder, max 4 boarders**, completely tax-free — no need to declare it or file rental accounts, provided you stay within the weekly threshold. That's up to ~$50,960/yr tax-free. Above $245/wk per boarder, the excess is taxable. Keep it simple: 3–4 boarders at ~$220/wk each stays under the cap and covers most sub-$500k Christchurch mortgages. This is general info — confirm your situation with IRD or an accountant.",
  },
  {
    match: /deposit|kiwisaver|first home|grant|kainga ora|5%/,
    answer:
      "**Deposit, KiwiSaver & First Home Grant.** If you've contributed to KiwiSaver for 3+ years you can withdraw most of your balance (leaving $1,000) toward your deposit, and may qualify for the **First Home Grant** ($5k existing / $10k new build, doubled with an eligible partner; income caps $95k single / $150k couple). The **Kāinga Ora First Home Loan** allows a 5% deposit for eligible buyers under the $500k Christchurch price cap. Start your KiwiSaver withdrawal 2–3 months before you buy — it takes 10–15 business days.",
  },
  {
    match: /auction|deadline|negotiat|offer|tender|how.*buy/,
    answer:
      "**Buying methods in NZ.** *Auction* — unconditional, so have finance, a builder's report and LIM done beforehand; set a hard ceiling from comparable sales. *Deadline sale* — submit a strong, early offer (vendors sometimes engage pre-deadline). *Price by negotiation / asking price* — open below and justify with comps. *POA/tender* — ask the agent for guidance. About 60% of sub-$500k Christchurch listings go to auction, so getting pre-approval and reports lined up early is your biggest advantage.",
  },
  {
    match: /suburb|where.*buy|best area|location/,
    answer:
      "**Where to buy under $500k in Christchurch.** Best value + yield: the east (Aranui ~$410k/5.8%, Wainoni ~$420k, New Brighton ~$450k — coastal regeneration underway) and inner-east (Linwood, Woolston, Phillipstown — central, gentrifying). For boarders specifically, anything near UC/Ilam, Riccarton, Addington (hospital) or Hornby (employment) rents rooms easily. Check the Insights page for the full suburb table with yields and 5-year growth.",
  },
];

function offlineAdvisor(question: string): { ok: boolean; content: string } {
  const q = question.toLowerCase();
  for (const kb of ADVISOR_KB) {
    if (kb.match.test(q)) return { ok: true, content: kb.answer + "\n\n_General information, not personalised financial advice._" };
  }
  return {
    ok: true,
    content:
      "Here's the HouseScout playbook: buy a 3–4 bedroom house under $500k with a garage and a backyard, " +
      "live in it, and rent the spare rooms to boarders — up to **$245/wk each (max 4) is tax-free** under IRD's " +
      "standard-cost method. Reinvest that income into extra mortgage repayments to be debt-free in ~13–18 years " +
      "instead of 30.\n\nAsk me about: fixing your mortgage, paying the loan off fastest, boarder tax rules, " +
      "deposit/KiwiSaver/First Home Grant, buying at auction, or the best suburbs. For listing-specific picks, " +
      "switch to **Listings** mode.\n\n_General information, not personalised financial advice._",
  };
}

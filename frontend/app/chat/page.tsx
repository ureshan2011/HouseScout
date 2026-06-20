"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { Markdown } from "@/components/Markdown";

type Msg = { role: "user" | "assistant"; content: string };

const SUGGESTIONS = [
  "Which listing pays off fastest if I rent the spare rooms?",
  "Compare the best 4-bedroom homes under $480k for boarder income.",
  "Should I fix my mortgage for 1 or 2 years right now, and why?",
  "What loan structure helps me pay off the principal fastest?",
];

export default function Chat() {
  const [mode, setMode] = useState<"chat" | "advisor">("chat");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [ai, setAi] = useState<any>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.aiHealth().then(setAi).catch(() => setAi({ available: false }));
  }, []);
  useEffect(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), [msgs]);

  async function send(text: string) {
    if (!text.trim() || busy) return;
    setMsgs((m) => [...m, { role: "user", content: text }]);
    setQ("");
    setBusy(true);
    try {
      const r = mode === "chat" ? await api.chat(text) : await api.advisor(text);
      setMsgs((m) => [...m, { role: "assistant", content: r.content }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: "assistant", content: `Error: ${e}` }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">AI assistant</h1>
        <div className="flex items-center gap-2">
          {ai && (
            <span className={`badge ${ai.available ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-600"}`}>
              Gemma {ai.available ? "online" : "offline"}
            </span>
          )}
          <div className="flex rounded-lg border border-slate-300 text-sm">
            <button className={`px-3 py-1.5 ${mode === "chat" ? "bg-brand text-white" : ""}`} onClick={() => setMode("chat")}>
              Listings
            </button>
            <button className={`px-3 py-1.5 ${mode === "advisor" ? "bg-brand text-white" : ""}`} onClick={() => setMode("advisor")}>
              Mortgage/Invest
            </button>
          </div>
        </div>
      </div>

      {!ai?.available && (
        <p className="card bg-amber-50 p-3 text-sm text-amber-800">
          Local AI is offline. Start LM Studio on your PC and load a Gemma model (port 1234). The rest of the app still works.
        </p>
      )}

      <div className="card min-h-[50vh] space-y-4 p-4">
        {msgs.length === 0 && (
          <div className="space-y-2">
            <p className="text-sm text-slate-500">Ask anything — grounded in your matched listings ({mode === "chat" ? "Listings mode" : "general mode"}).</p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="btn-ghost text-left text-xs" onClick={() => send(s)}>{s}</button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={m.role === "user" ? "text-right" : ""}>
            <div className={`inline-block max-w-[85%] rounded-xl px-4 py-2 text-left ${m.role === "user" ? "bg-brand text-white" : "bg-slate-100"}`}>
              {m.role === "assistant" ? <Markdown text={m.content} /> : m.content}
            </div>
          </div>
        ))}
        {busy && <p className="text-sm text-slate-400">Gemma is thinking…</p>}
        <div ref={endRef} />
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); send(q); }}
        className="flex gap-2"
      >
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type your question…" />
        <button className="btn" disabled={busy}>Send</button>
      </form>
    </div>
  );
}

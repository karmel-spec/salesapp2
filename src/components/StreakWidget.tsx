"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, getWho } from "@/lib/client";
import type { Streak } from "@/lib/streak";

/**
 * Sales streaks for the signed-in rep: a sidebar chip (streak · worked today ·
 * best) and a confetti celebration at 1, 5 and 10 leads worked in a day, plus
 * a bigger one for a new personal record. Business days only — weekends and
 * holidays never break a streak. Each milestone celebrates once per day.
 */
type Level = "m1" | "m5" | "m10" | "record" | "week" | "speed" | "allclear" | "won";
type Wins = { month: { count: number; dollars: number; mine: number; label: string }; year: { count: number; dollars: number; mine: number; label: string }; allTime: { count: number; dollars: number; mine: number }; bestMonth: { label: string; count: number } | null; latest: { name: string; value: string; when: string; closedBy: string } | null };
type TeamQ = { open: number; byOwner: { owner: string; n: number; boardLink: string }[]; answeredToday: number; streak: number; streakAlive: boolean; bestStreak: number; tracking: boolean };
type AllClear = { newUncontacted: number; topTenLeft: number; unreadReplies: number; clear: boolean };
type StreakData = Streak & { allClear?: AllClear; teamQuestions?: TeamQ | null; wins?: Wins };
const fmt = (d: string) => new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });

export function StreakWidget() {
  const [who, setWho] = useState("");
  const [data, setData] = useState<StreakData | null>(null);
  const [open, setOpen] = useState(false);
  const [party, setParty] = useState<{ level: Level; title: string; lines: string[]; link?: { href: string; label: string } } | null>(null);
  const lastWins = useRef<number | null>(null);

  const load = useCallback(async (fresh = false) => {
    const w = getWho();
    if (!w || w === "app") { setWho(""); return; }
    setWho(w);
    try {
      const d = await api<StreakData>(`/api/streak?who=${encodeURIComponent(w)}${fresh ? "&fresh=1" : ""}`);
      setData(d);
      // A new Won since the last check → celebrate before anything else.
      const wins = d.wins?.allTime.count ?? null;
      if (wins !== null && lastWins.current !== null && wins > lastWins.current && d.wins) {
        lastWins.current = wins;
        celebrateWin(d.wins, d.who);
      } else {
        if (wins !== null) lastWins.current = wins;
        celebrate(d);
      }
    } catch { /* quiet — the chip just doesn't update */ }
  }, []);

  function celebrateWin(w: Wins, me: string) {
    const usd = (n: number) => (n ? `$${Math.round(n).toLocaleString()}` : "");
    const latest = w.latest;
    const mineLine = latest && latest.closedBy && latest.closedBy.toLowerCase() === me.toLowerCase() ? "You closed it. " : "";
    setParty({
      level: "won",
      title: `WON! 🏆 ${latest ? latest.name : ""}`.trim(),
      lines: [
        `${mineLine}${latest?.value ? `${latest.value} — ` : ""}another piano finding its home.`,
        `${w.month.label}: ${w.month.count} sale${w.month.count === 1 ? "" : "s"}${w.month.dollars ? ` · ${usd(w.month.dollars)}` : ""}${w.month.mine ? ` · ${w.month.mine} yours` : ""}.`,
        `${w.year.label}: ${w.year.count} sale${w.year.count === 1 ? "" : "s"}${w.year.dollars ? ` · ${usd(w.year.dollars)}` : ""}${w.year.mine ? ` · ${w.year.mine} yours` : ""}.`,
        `All-time in the console: ${w.allTime.count} won${w.allTime.dollars ? ` · ${usd(w.allTime.dollars)}` : ""}.${w.bestMonth ? ` Best month: ${w.bestMonth.count} (${w.bestMonth.label})${w.bestMonth.label === w.month.label ? " — that's this month!" : ", within reach?"}` : ""}`,
        "Keep closing. Every win here is a family with music in the house.",
      ],
    });
  }

  function celebrate(d: StreakData) {
    if (typeof window === "undefined") return;
    const key = `blp_streak_seen:${d.who}:${d.today.date}`;
    let seen: Record<string, boolean> = {};
    try { seen = JSON.parse(localStorage.getItem(key) || "{}"); } catch {}
    const n = d.today.count;
    const best = d.bestBeforeToday;
    let level: Level | null = null;
    const bw = d.bestWeek;
    const weekRecord = bw && d.thisWeek.leadsWorked > bw.leadsWorked;
    const lightning = d.speed.today.inbound >= 3 && d.speed.today.fast === d.speed.today.inbound;
    if (best && n > best.count && !seen[`record:${n}`] && !seen.recordToday) level = "record";
    else if (n >= 10 && !seen.m10) level = "m10";
    else if (n >= 5 && !seen.m5) level = "m5";
    else if (n >= 1 && !seen.m1) level = "m1";
    else if (weekRecord && !seen[`week:${d.thisWeek.weekStart}`]) level = "week";
    else if (lightning && !seen.speed) level = "speed";
    // All clear → point him at the team's questions. Also shown once as a kickoff (Brigham asked for it).
    const tq = d.teamQuestions;
    let kickoff = false;
    try { kickoff = !localStorage.getItem("blp_teamq_kickoff") && d.who === "Brigham" && !!tq; } catch {}
    if (!level && tq && ((d.allClear?.clear && !seen.allclear) || kickoff)) level = "allclear";
    if (!level) return;
    if (level === "allclear") {
      if (d.allClear?.clear) seen.allclear = true;
      try { localStorage.setItem("blp_teamq_kickoff", "1"); } catch {}
      const top = tq!.byOwner[0];
      const owners = tq!.byOwner.map((o) => `${o.owner.split(" ")[0]} ${o.n}`).join(" · ");
      const streakLine = tq!.streak > 0
        ? `Team-questions streak: ${tq!.streak} business day${tq!.streak === 1 ? "" : "s"}${tq!.streakAlive ? "" : " — answer one today to keep it alive"}.`
        : "Team-questions streak: 0 — answer one today and it starts.";
      setParty({
        level,
        title: d.allClear?.clear ? "All clear — extraordinary work! 🌟" : "Extraordinary sales work! 🌟",
        lines: [
          d.allClear?.clear
            ? "Every new lead contacted, your Top Ten worked, every client response answered. That's how a pipeline gets closed."
            : `${d.today.count} leads worked today and a ${d.streak}-day streak. The sales side is in great hands.`,
          tq!.open > 0
            ? `Now give the team a few minutes: ${tq!.open} question${tq!.open === 1 ? "" : "s"} for Brigham ${tq!.open === 1 ? "is" : "are"} waiting on the Store Map boards (${owners}).`
            : "No team questions are waiting right now — enjoy it.",
          streakLine,
        ],
        link: top ? { href: top.boardLink, label: `Answer ${top.owner.split(" ")[0]}'s questions →` } : undefined,
      });
      try { localStorage.setItem(key, JSON.stringify(seen)); } catch {}
      return;
    }
    if (level === "week") seen[`week:${d.thisWeek.weekStart}`] = true;
    if (level === "speed") seen.speed = true;
    if (n >= 1) seen.m1 = true;
    if (n >= 5) seen.m5 = true;
    if (n >= 10) seen.m10 = true;
    if (level === "record") { seen.recordToday = true; seen[`record:${n}`] = true; }
    try { localStorage.setItem(key, JSON.stringify(seen)); } catch {}
    const streakLine = `${d.streak}-business-day streak${d.streak >= 5 ? " 🔥" : ""} — weekends and holidays don't count against you.`;
    if (level === "m1") setParty({ level, title: "First lead worked today! 🎉", lines: [streakLine, "Don't break it — one worked lead a day keeps the streak alive."] });
    if (level === "m5") setParty({ level, title: "Five leads worked! 🔥", lines: ["Halfway to a Perfect Ten.", d.tenStreak > 0 ? `Your Perfect-Ten streak is ${d.tenStreak} day${d.tenStreak > 1 ? "s" : ""} — five more keeps it alive.` : "Five more today starts a Perfect-Ten streak.", streakLine] });
    if (level === "m10") setParty({ level, title: "PERFECT TEN! 🏆", lines: [`${n} leads worked today — that's a ${d.tenStreak}-day Perfect-Ten streak.`, best ? `Your best ever is ${best.count} in one day (${fmt(best.date)}). Think you can beat it today?` : "That's your best day yet — keep going.", "Keep up the great work."] });
    if (level === "record") setParty({ level, title: "NEW RECORD! 🚀", lines: [`${n} leads worked in one day — your old best was ${best!.count} (${fmt(best!.date)}).`, "Every one you add today raises the bar. Keep going!"] });
    if (level === "week") setParty({ level, title: "BEST WEEK EVER! 📈", lines: [`${d.thisWeek.leadsWorked} leads worked this week — past your old best week of ${bw!.leadsWorked} (week of ${fmt(bw!.weekStart)}).`, `${d.thisWeek.perfectTens} Perfect Ten${d.thisWeek.perfectTens === 1 ? "" : "s"} this week. Finish strong.`] });
    if (level === "speed") setParty({ level, title: "LIGHTNING DAY! ⚡", lines: [`Every customer who wrote today (${d.speed.today.inbound}) heard back from you within the hour — fastest in ${d.speed.today.fastestMin} min.`, `Reply-within-the-hour streak: ${d.speed.streak} day${d.speed.streak === 1 ? "" : "s"}. Speed closes deals.`] });
  }

  useEffect(() => {
    load();
    const onWrote = () => load(true);
    const onVis = () => { if (document.visibilityState === "visible") load(); };
    const onWho = () => load();
    window.addEventListener("blp:wrote", onWrote);
    window.addEventListener("blp:who", onWho);
    window.addEventListener("storage", onWho);
    document.addEventListener("visibilitychange", onVis);
    const t = setInterval(() => load(), 60_000);
    return () => { window.removeEventListener("blp:wrote", onWrote); window.removeEventListener("blp:who", onWho); window.removeEventListener("storage", onWho); document.removeEventListener("visibilitychange", onVis); clearInterval(t); };
  }, [load]);

  if (!who || !data) return null;
  const n = data.today.count;
  const flame = data.streak >= 10 ? "🔥🔥" : data.streak >= 3 ? "🔥" : "✨";
  return (
    <>
      <button className={`streak-chip${data.streakAlive ? " alive" : ""}`} onClick={() => setOpen((o) => !o)} title="Your sales streak — leads worked per business day">
        <span>{flame} {data.streak}-day streak</span>
        <span className="sep">·</span>
        <span>{n} worked today</span>
        {data.best && <><span className="sep">·</span><span>best {data.best.count}</span></>}
      </button>
      {open && (
        <div className="streak-panel">
          <div className="streak-head">
            <b>{who}&apos;s streak</b>
            <button className="btn ghost small" onClick={() => setOpen(false)}>✕</button>
          </div>
          <div className="streak-stats">
            <div><span className="big">{data.streak}</span><span className="lbl">business days{data.streakAlive ? "" : " (work one lead today to keep it)"}</span></div>
            <div><span className="big">{n}</span><span className="lbl">worked today{n < 10 ? ` · ${10 - n} to a Perfect Ten` : " · Perfect Ten ✓"}</span></div>
            <div><span className="big">{data.best?.count ?? 0}</span><span className="lbl">best day{data.best ? ` · ${fmt(data.best.date)}` : ""}</span></div>
            <div><span className="big">{data.tenStreak}</span><span className="lbl">Perfect-Ten streak</span></div>
            <div><span className="big">🏆 {data.thisWeek.perfectTens}</span><span className="lbl">Perfect Tens this week · {data.perfectTensAllTime} all-time</span></div>
            <div><span className="big">{data.thisWeek.leadsWorked}</span><span className="lbl">worked this week{data.bestWeek ? ` · best week ${data.bestWeek.leadsWorked} (${fmt(data.bestWeek.weekStart)})` : ""}</span></div>
            <div><span className="big">⚡ {data.speed.streak}</span><span className="lbl">reply-within-the-hour streak (days)</span></div>
            {data.teamQuestions && (
              <div><span className="big">💬 {data.teamQuestions.streak}</span><span className="lbl">team-questions streak · {data.teamQuestions.open} waiting · {data.teamQuestions.answeredToday} answered today{data.teamQuestions.bestStreak ? ` · best ${data.teamQuestions.bestStreak}` : ""}</span></div>
            )}
            <div><span className="big">{data.speed.today.fast}/{data.speed.today.inbound}</span><span className="lbl">answered within the hour today{data.speed.today.fastestMin !== null ? ` · fastest ${data.speed.today.fastestMin} min` : ""} · week {data.speed.weekFast}/{data.speed.weekInbound}</span></div>
          </div>
          {data.today.leads.length > 0 && (
            <div className="streak-today">
              <div className="muted">Worked today</div>
              <div>{data.today.leads.join(" · ")}</div>
            </div>
          )}
          <div className="streak-hist">
            {data.history.slice(0, 10).map((h) => (
              <span key={h.date} className={`streak-day${h.count >= 10 ? " ten" : h.count > 0 ? " some" : ""}`} title={`${fmt(h.date)}: ${h.count} worked`}>
                <i style={{ height: `${Math.min(100, h.count * 8)}%` }} />
                <small>{fmt(h.date).replace(/^\w+ /, "")}</small>
              </span>
            ))}
          </div>
          <div className="muted" style={{ fontSize: 12 }}>A lead counts as worked when you text, email, call, note, edit or coach it. Weekends and shop holidays never break a streak. Speed counts customer texts 9–6 on your leads answered by a person within 60 minutes. A recap text arrives Fridays at 5.</div>
        </div>
      )}
      {party && <Celebration level={party.level} title={party.title} lines={party.lines} link={party.link} onDone={() => setParty(null)} />}
    </>
  );
}

function Celebration({ level, title, lines, link, onDone }: { level: Level; title: string; lines: string[]; link?: { href: string; label: string }; onDone: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d")!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const resize = () => { canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr; canvas.style.width = innerWidth + "px"; canvas.style.height = innerHeight + "px"; };
    resize();
    const N = level === "record" || level === "week" || level === "won" ? 700 : level === "m10" || level === "allclear" ? 500 : level === "m5" || level === "speed" ? 240 : 140;
    const ms = level === "record" || level === "m10" || level === "week" || level === "won" ? 12_000 : 8_000;
    const colors = ["#9E2020", "#B43333", "#E8B54D", "#F4E1A6", "#2E7D5B", "#3D6FB6", "#ffffff"];
    const W = canvas.width, H = canvas.height;
    const parts = Array.from({ length: N }, (_, i) => ({
      x: level === "m1" ? W / 2 : Math.random() * W,
      y: level === "m1" ? H * 0.6 : -Math.random() * H * 0.5,
      vx: (Math.random() - 0.5) * (level === "m1" ? 22 : 6) * dpr,
      vy: (level === "m1" ? -(8 + Math.random() * 14) : 2 + Math.random() * 4) * dpr,
      w: (6 + Math.random() * 8) * dpr, h: (4 + Math.random() * 6) * dpr,
      r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3,
      c: colors[i % colors.length], shape: Math.random() < 0.25 ? "circle" : "rect",
    }));
    let raf = 0; const start = performance.now();
    const tick = (t: number) => {
      const el = t - start;
      ctx.clearRect(0, 0, W, H);
      for (const p of parts) {
        p.vy += 0.12 * dpr; p.x += p.vx; p.y += p.vy; p.vx *= 0.995; p.r += p.vr;
        if (p.y > H + 20 && el < ms - 2500) { p.y = -20; p.vy = (2 + Math.random() * 3) * dpr; p.x = Math.random() * W; }
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.globalAlpha = Math.max(0, Math.min(1, (ms - el) / 1500));
        if (p.shape === "circle") { ctx.beginPath(); ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2); ctx.fill(); } else ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      if (el < ms) raf = requestAnimationFrame(tick); else onDone();
    };
    raf = requestAnimationFrame(tick);
    window.addEventListener("resize", resize);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
  }, [level, onDone]);
  return (
    <div className={`celebrate ${level}`} onClick={onDone} role="dialog" aria-live="polite">
      <canvas ref={ref} />
      <div className="celebrate-card" onClick={(e) => e.stopPropagation()}>
        <div className="celebrate-title">{title}</div>
        {lines.map((l) => <div key={l} className="celebrate-line">{l}</div>)}
        {link && <a className="btn" href={link.href} target="_blank" rel="noopener" onClick={onDone}>{link.label}</a>}
        <button className={link ? "btn ghost" : "btn"} onClick={onDone}>{link ? "Later" : level === "won" ? "Next one 🎹" : level === "m10" || level === "record" || level === "week" ? "Let's go 💪" : "Keep going →"}</button>
      </div>
    </div>
  );
}

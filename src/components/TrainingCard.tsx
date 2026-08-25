/**
 * Dashboard card: training materials & guides. Add a new training by
 * appending one line to TRAINING_ITEMS — the card renders the rest.
 */

export interface TrainingItem {
  title: string;
  desc: string;
  href: string;
  /** Optional companion training video (e.g. YouTube link). */
  video?: string;
}

export const TRAINING_ITEMS: TrainingItem[] = [
  {
    title: "Store Map User Guide",
    desc: "How to use the BLP Store Map: signing in, finding pianos, clocking work time, paperwork & photos.",
    href: "https://docs.google.com/document/d/1aq3oTa6pxr6AhquS7pbJakAY4q4iPc_nUJW4yLMXDOM/edit?usp=sharing",
    video: "https://youtu.be/1zDlnks5CC0",
  },
  {
    title: "BLP Restoration Handbook",
    desc: "The complete BLP restoration handbook.",
    href: "https://blpshop.netlify.app/index.html#handbook",
  },
  {
    title: "Professional Standards & Team Culture",
    desc: "BLP professional standards: punctuality, dress code, safety, workplace conduct & cleanliness.",
    href: "https://docs.google.com/document/d/1PYw5R8o9k8iLtCIfRkWVcno2hqqYQcS5-8izyM4Fbsk/edit",
  },
];

export function TrainingCard() {
  if (TRAINING_ITEMS.length === 0) return null;

  return (
    <div className="card">
      <h2>
        🎓 Training{" "}
        <span className="muted" style={{ fontFamily: "var(--sans)", fontWeight: 400, fontSize: 13 }}>
          — guides &amp; handbooks. Links open in a new tab.
        </span>
      </h2>
      {TRAINING_ITEMS.map((item) => (
        <div key={item.href} style={{ padding: "7px 0", borderBottom: "1px solid #f0ece6" }}>
          <a href={item.href} target="_blank" rel="noopener">
            <span className="lead-name">{item.title} ↗</span>{" "}
            <span className="muted">— {item.desc}</span>
          </a>
          {item.video && (
            <>
              {" "}
              <a href={item.video} target="_blank" rel="noopener" style={{ whiteSpace: "nowrap" }}>
                <span className="muted" style={{ color: "var(--crimson)" }}>▶ Watch video</span>
              </a>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

import { stageLabel, type SendProgress } from "../lib/send";
import { txUrl } from "../lib/cookiejar";

/** Narrates a transaction as it happens. The bounty asks for live feedback. */
export function TxToast({ progress }: { progress: SendProgress | null }) {
  if (!progress) return null;

  const failed = progress.stage === "failed";
  const done = progress.stage === "confirmed";
  const tone = failed ? "bad" : done ? "good" : "";

  return (
    <div className={`toast ${tone}`}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span>
          {!failed && !done && <span className="jar">🍪 </span>}
          <b>{stageLabel[progress.stage]}</b>
          {progress.sponsored && progress.stage !== "failed" && (
            <span style={{ opacity: 0.75 }}> · gas on us</span>
          )}
        </span>
        {progress.signature && (
          <a href={txUrl(progress.signature)} target="_blank" rel="noreferrer">
            view
          </a>
        )}
      </div>
      {progress.detail && (
        <div style={{ marginTop: 6, fontSize: 13, opacity: 0.9 }}>{progress.detail}</div>
      )}
    </div>
  );
}

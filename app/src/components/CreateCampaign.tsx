import { useEffect, useRef, useState } from "react";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { bn, connection, findBond, findCircle, findConfig, findMember, findPot, findRoom, formatCook, generateInviteCode, hashInviteCode, readableError, type CookieJarProgram } from "../lib/cookiejar";
import { defaultDraft, depositNote, durationLabels, parseCookInput, restoreDraft, validateDraft, type CampaignDraft } from "../lib/campaign-form";
import type { RentKind } from "../hooks/useCookieJar";
import type { InstructionBuilder } from "../lib/send";
import { Icon, type Navigate } from "./UI";

const labels = ["Campaign details", "Arisan rules", "Post & review"];
export function CreateCampaign({ program, owner, submit, navigate }: {
  program: CookieJarProgram; owner: PublicKey | null;
  submit: (build: InstructionBuilder, rent?: RentKind, instruction?: string) => Promise<{ signature: string; sponsored: boolean }>;
  navigate: Navigate;
}) {
  const [draft, setDraft] = useState<CampaignDraft>(() => {
    try { return restoreDraft(sessionStorage.getItem("arisan-campaign-draft")); } catch { return defaultDraft; }
  });
  const [step, setStep] = useState(0);
  const [error, setError] = useState<ReturnType<typeof validateDraft>>(null);
  const [failure, setFailure] = useState("");
  const [busy, setBusy] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [cost, setCost] = useState<number | null>(null);
  const [result, setResult] = useState<{ circle: string; code: string } | null>(null);
  const [copied, setCopied] = useState("");
  const pending = useRef<{ id: number; code: string } | null>(null);
  useEffect(() => { try { sessionStorage.setItem("arisan-campaign-draft", JSON.stringify(draft)); } catch { /* Form remains usable when storage is unavailable. */ } }, [draft]);
  useEffect(() => {
    let active = true;
    Promise.all([165, 593, 99, 0].map(size => connection.getMinimumBalanceForRentExemption(size))).then(([circle, room, member, vault]) => { if (active) setCost(circle + room + member + vault * 2 + 10000); }).catch(() => {});
    return () => { active = false; };
  }, []);
  const change = (field: keyof CampaignDraft, value: string) => {
    pending.current = null; setDraft(d => ({ ...d, [field]: value })); setError(null); setFailure(""); setAgreed(false);
  };
  const validate = () => {
    const e = validateDraft(draft, step); setError(e);
    if (e) document.getElementById(e.field)?.focus();
    return !e;
  };
  const copy = async (value: string, label: string) => { try { await navigator.clipboard.writeText(value); setCopied(label); } catch { setFailure("Clipboard unavailable. Select the text and copy it manually."); } };
  const create = async () => {
    if (!validate() || !owner || !agreed) return;
    setBusy(true); setFailure("");
    try {
      const attempt = pending.current ?? { id: Date.now(), code: generateInviteCode() };
      pending.current = attempt;
      const circle = findCircle(owner, attempt.id);
      const codeHash = await hashInviteCode(attempt.code);
      // Reuse a pending address after a confirmation timeout; do not create duplicates.
      if (!(await connection.getAccountInfo(circle))) {
        await submit(async payer => {
          const balance = await connection.getBalance(owner);
          const reserve = parseCookInput(draft.collateral) ?? 0;
          if (cost !== null && balance < cost + reserve) throw new Error("Your balance is too low to create the room and lock the creator reserve. Get demo COOK, then return to this draft.");
          const instructions = [];
          if (!(await connection.getAccountInfo(circle))) {
            instructions.push(await program.methods.createCircle(bn(attempt.id), draft.name.trim(), draft.description.trim(), draft.socialUrl.trim(), codeHash,
              bn(parseCookInput(draft.contribution)!), bn(parseCookInput(draft.collateral) ?? 0), Number(draft.seats), bn(draft.duration))
              .accountsPartial({ creator: owner, payer, config: findConfig(), circle, room: findRoom(circle), pot: findPot(circle), bond: findBond(circle), systemProgram: SystemProgram.programId }).instruction());
          }
          if (!(await connection.getAccountInfo(findMember(circle, owner)))) {
            instructions.push(await program.methods.joinCircle(codeHash)
              .accountsPartial({ member: owner, payer, circle, bond: findBond(circle), membership: findMember(circle, owner), room: findRoom(circle), systemProgram: SystemProgram.programId }).instruction());
          }
          return instructions;
        }, "none", "createCircle");
      }
      const made = { circle: circle.toBase58(), code: attempt.code };
      setResult(made);
      try {
        const codes = JSON.parse(localStorage.getItem("arisan-room-codes") ?? "{}");
        localStorage.setItem("arisan-room-codes", JSON.stringify({ ...codes, [made.circle]: made.code }));
        sessionStorage.removeItem("arisan-campaign-draft");
      } catch { /* The success screen still exposes the code for manual saving. */ }
    } catch (e) { setFailure(readableError(e)); } finally { setBusy(false); }
  };
  const field = (key: keyof CampaignDraft, label: string, hint: string, placeholder: string, mode?: "decimal" | "numeric") => <div className="field">
    <label htmlFor={key}>{label} <span>*</span></label>
    <input disabled={busy} id={key} value={draft[key]} onChange={e => change(key, e.target.value)} placeholder={placeholder} autoComplete="off" inputMode={mode} aria-invalid={error?.field === key || undefined} aria-describedby={key + "-hint"} />
    <small id={key + "-hint"} className={error?.field === key ? "field-error" : ""}>{error?.field === key ? error.message : hint}</small>
  </div>;
  const socialText = draft.name + "\n\n" + draft.description + "\n\nContribution: " + draft.contribution + " COOK per round\nReserve: " + draft.collateral + " COOK per member\nMembers: " + draft.seats + "\nRound: " + durationLabels[draft.duration] + "\n\nThe deposit is not a fee: it covers a missed round, and whatever is left returns when all turns are complete. Contact the creator for the room code.\nhttps://arisan-cook.vercel.app";
  if (result) return <section className="success-page">
    <span className="action-icon"><Icon name="check" /></span><h2>Campaign created.</h2><p>You automatically joined as the first member. Save this code and share it with your group.</p>
    <label htmlFor="new-code">Room code</label><div className="code-copy"><input id="new-code" value={result.code} readOnly /><button className="ghost" onClick={() => void copy(result.code, "code")}>{copied === "code" ? "Copied" : "Copy code"}</button></div>
    <p className="muted">Open My campaigns to view the room and share the code with your group.</p>
    {failure && <p role="alert" className="field-error">{failure}</p>}
    <button className="primary" onClick={() => navigate("campaigns")}>Open my campaigns<Icon name="arrow" /></button>
  </section>;
  return <div className="wizard-layout">
    <section className="wizard">
      <ol className="wizard-steps" aria-label="Campaign creation steps">{labels.map((label, i) => <li key={label} aria-current={i === step ? "step" : undefined}><span>{i < step ? <Icon name="check" /> : i + 1}</span>{label}</li>)}</ol>
      <form onSubmit={e => { e.preventDefault(); if (step < 2) { if (validate()) setStep(step + 1); } else void create(); }} noValidate>
        <h2>{["Tell us about your group.", "Agree before you start.", "Post first, then invite."][step]}</h2>
        <p className="form-intro">{["These details will be visible to potential members. Every field marked * is required.", "Every member follows the same rules. The rules are frozen after the campaign is created.", "A public post gives potential members the right context. Publish it yourself, then paste the link here."][step]}</p>
        {step === 0 && <>
          {field("name", "Campaign name", "Maximum 48 bytes.", "Studio friends Arisan")}
          <div className="field"><label htmlFor="description">About the campaign <span>*</span></label><textarea disabled={busy} id="description" value={draft.description} onChange={e => change("description", e.target.value)} rows={4} placeholder="For studio friends who want to save together. The group has 5 members…" aria-invalid={error?.field === "description" || undefined} aria-describedby="description-hint" /><small id="description-hint" className={error?.field === "description" ? "field-error" : ""}>{error?.field === "description" ? error.message : "Explain the purpose and who can join. Maximum 280 bytes."}</small></div>
        </>}
        {step === 1 && <>
          <div className="form-columns">{field("contribution", "Contribution per round (COOK)", "Paid every round, even after you receive a turn.", "0.1", "decimal")}{field("collateral", "Deposit per member (COOK)", "Your group decides this. Not a fee — the unused part comes back.", "0.2", "decimal")}</div>
          <div className="form-columns">{field("seats", "Member count", "Includes the creator if they join. Between 2–100 people.", "3", "numeric")}<div className="field"><label htmlFor="duration">Round duration <span>*</span></label><select disabled={busy} id="duration" value={draft.duration} onChange={e => change("duration", e.target.value)}>{Object.entries(durationLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select><small>Choose 1 minute to try the demo flow.</small></div></div>
          {(() => { const note = depositNote(draft); return note && <p className={note.tone === "thin" ? "deposit-note thin" : "deposit-note"}>{note.message}</p>; })()}
          <p className="notice">The deposit covers <strong>being late</strong>, not somebody leaving. Miss a round and the program takes that round out of your own deposit, so the pot stays whole and nobody else covers you — and your books show it as a miss, not a payment. Two contributions is the usual size: you can be late twice before you are sidelined from taking a turn. Whatever is left comes back when the Arisan ends. It does not cover a member who takes the pot and disappears, which is why you invite people you know.</p>
        </>}
        {step === 2 && <>
          <details className="post-draft" open><summary>Post draft to copy</summary><pre>{socialText}</pre><button type="button" className="ghost" onClick={() => void copy(socialText, "post")}>{copied === "post" ? "Draft copied" : "Copy post draft"}</button></details>
          <div className="field"><label htmlFor="socialUrl">Public post link <span>*</span></label><input disabled={busy} id="socialUrl" type="url" value={draft.socialUrl} onChange={e => change("socialUrl", e.target.value)} placeholder="https://x.com/yourname/status/123…" autoComplete="url" aria-invalid={error?.field === "socialUrl" || undefined} aria-describedby="social-hint" /><small id="social-hint" className={error?.field === "socialUrl" ? "field-error" : ""}>{error?.field === "socialUrl" ? error.message : "X, Instagram, Threads, Facebook, or Telegram. The post content and ownership are not automatically verified."}</small></div>
          <p className="notice">The code opens the room in this app, but blockchain membership authorization is not yet strong enough to guarantee that only invited people can join. Use demo amounts first.</p>
          <label className="checkbox"><input disabled={busy} type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} />I have published the post and understand that campaign rules cannot change after creation.</label>
          {!owner && <div className="wallet-prompt"><p>Your details are ready. Connect a wallet to create the campaign.</p><WalletMultiButton>Connect wallet</WalletMultiButton></div>}
        </>}
        {failure && <div className="banner warn" role="alert">{failure} <a href="#faucet">Get demo COOK</a></div>}
        <div className="form-actions">{step > 0 && <button className="ghost" type="button" disabled={busy} onClick={() => { setError(null); setStep(step - 1); }}>Back</button>}<button className="primary" type="submit" aria-busy={busy} disabled={busy || (step === 2 && (!owner || !agreed))}>{busy ? "Waiting for confirmation…" : step === 2 ? "Create campaign" : "Continue"}<Icon name="arrow" /></button><small>Step {step + 1} of 3</small></div>
      </form>
    </section>
    <aside className="campaign-summary"><span className="step-count">CAMPAIGN SUMMARY</span><h3>{draft.name || "Your campaign"}</h3><dl><div><dt>Contribution per round</dt><dd>{draft.contribution || "—"} COOK</dd></div><div><dt>Deposit per member</dt><dd>{draft.collateral || "—"} COOK / member</dd></div><div><dt>Member count</dt><dd>{draft.seats || "—"}</dd></div><div><dt>Round duration</dt><dd>{durationLabels[draft.duration]}</dd></div></dl><hr /><span className="muted">Pool per round when all seats are filled</span><strong className="summary-pot">{Number.isFinite(Number(draft.seats) * Number(draft.contribution)) ? (Number(draft.seats) * Number(draft.contribution)).toLocaleString("en-US", { maximumFractionDigits: 9 }) : "—"} <small>COOK</small></strong><p className="muted">Creation cost from wallet: {cost === null ? "estimating…" : "about " + formatCook(cost, 6) + " COOK"}. The creator's reserve automatically joins as the first member.</p><a href="#guide">Learn how Arisan works<Icon name="arrow" /></a></aside>
  </div>;
}

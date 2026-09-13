import { useEffect, useRef, useState } from "react";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { bn, connection, findBond, findCircle, findConfig, findPot, findRoom, formatCook, generateInviteCode, hashInviteCode, readableError, type CookieJarProgram } from "../lib/cookiejar";
import { defaultDraft, durationLabels, parseCookInput, restoreDraft, validateDraft, type CampaignDraft } from "../lib/campaign-form";
import type { RentKind } from "../hooks/useCookieJar";
import type { InstructionBuilder } from "../lib/send";
import { Icon, type Navigate } from "./UI";

const labels = ["Detail campaign", "Aturan arisan", "Posting & review"];
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
    Promise.all([165, 593, 0].map(size => connection.getMinimumBalanceForRentExemption(size))).then(([circle, room, vault]) => { if (active) setCost(circle + room + vault * 2 + 10000); }).catch(() => {});
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
  const copy = async (value: string, label: string) => { try { await navigator.clipboard.writeText(value); setCopied(label); } catch { setFailure("Clipboard tidak tersedia. Pilih teks lalu salin secara manual."); } };
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
          if (cost !== null && balance < cost) throw new Error("Saldo belum cukup untuk membuat room. Ambil demo COOK dahulu, lalu kembali ke draft ini.");
          return [await program.methods.createCircle(bn(attempt.id), draft.name.trim(), draft.description.trim(), draft.socialUrl.trim(), codeHash,
            bn(parseCookInput(draft.contribution)!), bn(parseCookInput(draft.collateral)!), Number(draft.seats), bn(draft.duration))
            .accountsPartial({ creator: owner, payer, config: findConfig(), circle, room: findRoom(circle), pot: findPot(circle), bond: findBond(circle), systemProgram: SystemProgram.programId }).instruction()];
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
  const socialText = draft.name + "\n\n" + draft.description + "\n\nIuran: " + draft.contribution + " COOK per putaran\nJaminan: " + draft.collateral + " COOK\nAnggota: " + draft.seats + "\nPutaran: " + durationLabels[draft.duration] + "\n\nSetelah mendapat giliran, anggota tetap membayar sampai arisan selesai. Hubungi creator untuk kode room.\nhttps://arisan-cook.vercel.app";
  if (result) return <section className="success-page">
    <span className="action-icon"><Icon name="check" /></span><h2>Campaign berhasil dibuat.</h2><p>Simpan kode ini dan bagikan ke grupmu. Kamu belum otomatis bergabung sebagai anggota.</p>
    <label htmlFor="new-code">Kode room</label><div className="code-copy"><input id="new-code" value={result.code} readOnly /><button className="ghost" onClick={() => void copy(result.code, "code")}>{copied === "code" ? "Tersalin" : "Salin kode"}</button></div>
    <p className="muted">Buka campaign dari Campaign saya. Jika ingin ikut arisan, pilih Join room dan setor jaminan.</p>
    {failure && <p role="alert" className="field-error">{failure}</p>}
    <button className="primary" onClick={() => navigate("campaigns")}>Buka campaign saya<Icon name="arrow" /></button>
  </section>;
  return <div className="wizard-layout">
    <section className="wizard">
      <ol className="wizard-steps" aria-label="Langkah membuat campaign">{labels.map((label, i) => <li key={label} aria-current={i === step ? "step" : undefined}><span>{i < step ? <Icon name="check" /> : i + 1}</span>{label}</li>)}</ol>
      <form onSubmit={e => { e.preventDefault(); if (step < 2) { if (validate()) setStep(step + 1); } else void create(); }} noValidate>
        <h2>{["Ceritakan tentang grupmu.", "Sepakati sebelum mulai.", "Posting dulu, baru undang."][step]}</h2>
        <p className="form-intro">{["Detail ini akan terlihat oleh calon anggota. Semua kolom bertanda * wajib diisi.", "Setiap anggota mengikuti aturan yang sama. Aturan akan dibekukan setelah campaign dibuat.", "Posting membuat konteks campaign jelas untuk calon anggota. Publikasikan sendiri, lalu tempel linknya."][step]}</p>
        {step === 0 && <>
          {field("name", "Nama campaign", "Maksimal 48 byte.", "Arisan Teman Studio")}
          <div className="field"><label htmlFor="description">Tentang campaign <span>*</span></label><textarea disabled={busy} id="description" value={draft.description} onChange={e => change("description", e.target.value)} rows={4} placeholder="Untuk teman-teman studio yang ingin menabung bersama. Grup berisi 5 anggota…" aria-invalid={error?.field === "description" || undefined} aria-describedby="description-hint" /><small id="description-hint" className={error?.field === "description" ? "field-error" : ""}>{error?.field === "description" ? error.message : "Jelaskan tujuan dan siapa yang boleh ikut. Maksimal 280 byte."}</small></div>
        </>}
        {step === 1 && <>
          <div className="form-columns">{field("contribution", "Iuran per putaran (COOK)", "Dibayar setiap putaran, walau sudah mendapat giliran.", "0.1", "decimal")}{field("collateral", "Jaminan per anggota (COOK)", "Disetor saat join. Minimal satu kali iuran.", "0.1", "decimal")}</div>
          <div className="form-columns">{field("seats", "Jumlah anggota", "Termasuk creator jika ikut. Antara 2–100 orang.", "3", "numeric")}<div className="field"><label htmlFor="duration">Lama setiap putaran <span>*</span></label><select disabled={busy} id="duration" value={draft.duration} onChange={e => change("duration", e.target.value)}>{Object.entries(durationLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select><small>Pilih 1 menit untuk mencoba mekanisme demo.</small></div></div>
          <p className="notice">Jaminan satu iuran hanya menutup satu tunggakan. Sepakati risikonya dengan grup sebelum membuat campaign.</p>
        </>}
        {step === 2 && <>
          <details className="post-draft" open><summary>Draft posting untuk disalin</summary><pre>{socialText}</pre><button type="button" className="ghost" onClick={() => void copy(socialText, "post")}>{copied === "post" ? "Draft tersalin" : "Salin draft posting"}</button></details>
          <div className="field"><label htmlFor="socialUrl">Link posting publik <span>*</span></label><input disabled={busy} id="socialUrl" type="url" value={draft.socialUrl} onChange={e => change("socialUrl", e.target.value)} placeholder="https://x.com/namamu/status/123…" autoComplete="url" aria-invalid={error?.field === "socialUrl" || undefined} aria-describedby="social-hint" /><small id="social-hint" className={error?.field === "socialUrl" ? "field-error" : ""}>{error?.field === "socialUrl" ? error.message : "X, Instagram, Threads, Facebook, atau Telegram. Isi dan kepemilikan posting belum diverifikasi otomatis."}</small></div>
          <p className="notice">Kode membuka room di aplikasi, tetapi belum menjamin hanya orang yang diundang bisa bergabung lewat blockchain. Gunakan nominal demo dahulu.</p>
          <label className="checkbox"><input disabled={busy} type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} />Saya sudah mempublikasikan posting dan memahami bahwa aturan campaign tidak dapat diubah setelah dibuat.</label>
          {!owner && <div className="wallet-prompt"><p>Detail sudah siap. Hubungkan wallet untuk membuat campaign.</p><WalletMultiButton>Hubungkan wallet</WalletMultiButton></div>}
        </>}
        {failure && <div className="banner warn" role="alert">{failure} <a href="#faucet">Get demo COOK</a></div>}
        <div className="form-actions">{step > 0 && <button className="ghost" type="button" disabled={busy} onClick={() => { setError(null); setStep(step - 1); }}>Kembali</button>}<button className="primary" type="submit" aria-busy={busy} disabled={busy || (step === 2 && (!owner || !agreed))}>{busy ? "Menunggu konfirmasi…" : step === 2 ? "Create campaign" : "Lanjut"}<Icon name="arrow" /></button><small>Langkah {step + 1} dari 3</small></div>
      </form>
    </section>
    <aside className="campaign-summary"><span className="step-count">RINGKASAN CAMPAIGN</span><h3>{draft.name || "Campaign barumu"}</h3><dl><div><dt>Iuran per putaran</dt><dd>{draft.contribution || "—"} COOK</dd></div><div><dt>Jaminan saat join</dt><dd>{draft.collateral || "—"} COOK</dd></div><div><dt>Jumlah anggota</dt><dd>{draft.seats || "—"} orang</dd></div><div><dt>Durasi putaran</dt><dd>{durationLabels[draft.duration]}</dd></div></dl><hr /><span className="muted">Kas per putaran jika semua kursi terisi</span><strong className="summary-pot">{Number.isFinite(Number(draft.seats) * Number(draft.contribution)) ? (Number(draft.seats) * Number(draft.contribution)).toLocaleString("en-US", { maximumFractionDigits: 9 }) : "—"} <small>COOK</small></strong><p className="muted">Biaya pembuatan dari wallet: {cost === null ? "menunggu estimasi…" : "sekitar " + formatCook(cost, 6) + " COOK"}. Jaminan baru disetor saat bergabung.</p><a href="#guide">Pelajari cara kerja arisan<Icon name="arrow" /></a></aside>
  </div>;
}

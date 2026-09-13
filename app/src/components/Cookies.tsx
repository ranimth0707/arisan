import { useCallback, useEffect, useState } from "react";
import { PublicKey, SystemProgram } from "@solana/web3.js";

import {
  bn, connection, countdown, findConfig, findEnvelope, findEnvelopeVault,
  assertCanAfford, formatCook, readableError, toLamports,
  type CookieJarProgram,
} from "../lib/cookiejar";
import type { RentKind } from "../hooks/useCookieJar";
import type { InstructionBuilder } from "../lib/send";

export interface CookieView {
  address: PublicKey;
  creator: PublicKey;
  message: string;
  total: number;
  remaining: number;
  claimsTotal: number;
  claimsDone: number;
  surprise: boolean;
  expiryTs: number;
}

export async function loadCookies(program: CookieJarProgram): Promise<CookieView[]> {
  const raw = await program.account.envelope.all();
  return raw
    .map((e) => {
      const a = e.account;
      return {
        address: e.publicKey,
        creator: a.creator,
        message: a.message,
        total: a.totalAmount.toNumber(),
        remaining: a.remaining.toNumber(),
        claimsTotal: a.claimsTotal,
        claimsDone: a.claimsDone,
        surprise: "surprise" in a.split,
        expiryTs: a.expiryTs.toNumber(),
      };
    })
    .sort((a, b) => b.expiryTs - a.expiryTs);
}

interface Props {
  program: CookieJarProgram;
  owner: PublicKey | null;
  submit: (
    build: InstructionBuilder,
    rent?: RentKind,
    instruction?: string,
  ) => Promise<{ signature: string; sponsored: boolean }>;
}

export function Cookies({ program, owner, submit }: Props) {
  const [cookies, setCookies] = useState<CookieView[] | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setCookies(await loadCookies(program));
    } catch {
      setCookies([]);
    }
  }, [program]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Anything left in an expired cookie belongs to whoever filled it. Without
  // this the leftovers would sit in the escrow forever.
  const sweep = async (c: CookieView) => {
    if (!owner) return;
    setBusy(c.address.toBase58());
    setErr(null);
    try {
      await submit(async () => [
        await program.methods.sweepEnvelope().accountsPartial({
          creator: owner,
          envelope: c.address,
          envelopeVault: findEnvelopeVault(c.address),
          systemProgram: SystemProgram.programId,
        }).instruction(),
      ], "none", "sweepEnvelope");
      await refresh();
    } catch (e) {
      setErr(readableError(e));
    } finally {
      setBusy(null);
    }
  };

  const share = (address: PublicKey) => {
    const link = `${window.location.origin}${window.location.pathname}?cookie=${address.toBase58()}`;
    void navigator.clipboard.writeText(link);
    setCopied(address.toBase58());
    setTimeout(() => setCopied(null), 2500);
  };

  return (
    <>
      <BakeCookie program={program} owner={owner} submit={submit} onDone={refresh} />

      {err && <div className="banner warn">{err}</div>}

      {!cookies ? (
        <div className="empty"><span className="jar">🥠</span>Checking the oven...</div>
      ) : cookies.length === 0 ? (
        <div className="empty"><span className="jar">🥠</span>No fortune cookies yet.</div>
      ) : (
        <div className="grid">
          {cookies.map((c) => {
            const key = c.address.toBase58();
            const live = c.expiryTs > Date.now() / 1000 && c.claimsDone < c.claimsTotal;
            return (
              <div className="card" key={key}>
                <div className="spread">
                  <strong>{c.message || "A fortune cookie"}</strong>
                  <span className={`pill ${live ? "lucky" : "closed"}`}>
                    {c.surprise ? "surprise" : "even split"}
                  </span>
                </div>

                <div className="row" style={{ gap: 20, margin: "14px 0" }}>
                  <div className="stat">left inside<b>{formatCook(c.remaining)}</b></div>
                  <div className="stat">opened<b>{c.claimsDone}/{c.claimsTotal}</b></div>
                </div>

                <div className="muted">
                  {live ? `expires in ${countdown(c.expiryTs)}` : "finished"}
                </div>

                <div className="row" style={{ marginTop: 12 }}>
                  <button className="ghost" onClick={() => share(c.address)}>
                    {copied === key ? "Link copied" : "Copy share link"}
                  </button>
                  <a className="ghost" style={{ textDecoration: "none" }}
                     href={`?cookie=${key}`}>Open it</a>
                  {owner && owner.equals(c.creator) && !live && c.remaining > 0 && (
                    <button
                      className="primary"
                      disabled={busy !== null}
                      onClick={() => sweep(c)}
                    >
                      {busy === key ? "..." : `Take back ${formatCook(c.remaining)}`}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

function BakeCookie({ program, owner, submit, onDone }: Props & { onDone: () => void }) {
  const [message, setMessage] = useState("");
  const [amount, setAmount] = useState("10");
  const [claims, setClaims] = useState("5");
  const [surprise, setSurprise] = useState(true);
  const [hours, setHours] = useState("48");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);

  const bake = async () => {
    if (!owner) return;
    const count = Math.round(Number(claims));
    const total = Number(amount);
    if (!Number.isFinite(count) || count < 1 || count > 1000) {
      setErr("Pick between 1 and 1000 people.");
      return;
    }
    if (!Number.isFinite(total) || total <= 0) {
      setErr("Put some COOK inside first.");
      return;
    }
    setErr(null);
    setBusy(true);
    try {
      await assertCanAfford(owner, toLamports(total), "fill a cookie with that much");

      const now = Math.floor(Date.now() / 1000);
      const id = now;
      const envelope = findEnvelope(owner, id);
      await submit(async () => [await program.methods
        .createEnvelope(
          bn(id), message.slice(0, 64), bn(toLamports(total)), count,
          surprise ? { surprise: {} } : { equal: {} },
          bn(now + Math.round(Number(hours) * 3600)),
        )
        .accountsPartial({
          creator: owner, config: findConfig(), envelope,
          envelopeVault: findEnvelopeVault(envelope),
          systemProgram: SystemProgram.programId,
        })
        .instruction()], "none", "createEnvelope");
      const url = `${window.location.origin}${window.location.pathname}?cookie=${envelope.toBase58()}`;
      setLink(url);
      void navigator.clipboard.writeText(url);
      onDone();
    } catch (e) {
      setErr(readableError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <strong>Bake a fortune cookie</strong>
      <p className="muted" style={{ marginTop: 4 }}>
        Fill it with COOK, share the link, and anyone can crack it open. They do
        not need a single COOK to do it, and what they get lands straight in a
        jar where it keeps earning.
      </p>

      {err && <div className="banner warn">{err}</div>}
      {link && (
        <div className="banner info">
          Link copied. <span className="mono">{link}</span>
        </div>
      )}

      <label>Message</label>
      <input value={message} onChange={(e) => setMessage(e.target.value)}
             maxLength={64} placeholder="welcome to Cookie Chain" />

      <div className="row" style={{ gap: 12 }}>
        <div style={{ flex: 1 }}>
          <label>COOK inside</label>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
        </div>
        <div style={{ flex: 1 }}>
          <label>For how many people</label>
          <input value={claims} onChange={(e) => setClaims(e.target.value)} inputMode="numeric" />
        </div>
        <div style={{ flex: 1 }}>
          <label>Expires in (hours)</label>
          <input value={hours} onChange={(e) => setHours(e.target.value)} inputMode="decimal" />
        </div>
      </div>

      <label>How it splits</label>
      <select value={surprise ? "surprise" : "equal"}
              onChange={(e) => setSurprise(e.target.value === "surprise")}>
        <option value="surprise">Surprise · random amount each, nobody knows until they open it</option>
        <option value="equal">Even · everyone gets the same</option>
      </select>

      <button className="primary" style={{ marginTop: 14 }} disabled={busy || !owner} onClick={bake}>
        {busy ? "Baking..." : "Bake and get the link"}
      </button>
      {!owner && <div className="muted" style={{ marginTop: 8 }}>Connect a wallet to bake one.</div>}
    </div>
  );
}

export { connection };

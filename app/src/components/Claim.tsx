import { useCallback, useEffect, useState } from "react";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

import {
  SLOT_HASHES, connection, countdown, findClaim, findConfig, findEnvelopeVault,
  findJarVault, findPosition, formatCook, readableError, txUrl,
  type CookieJarProgram,
} from "../lib/cookiejar";
import { loadJars, type JarView } from "./Jars";
import type { RentKind } from "../hooks/useCookieJar";
import type { InstructionBuilder } from "../lib/send";
import { Icon } from "./UI";

interface Props {
  program: CookieJarProgram;
  owner: PublicKey | null;
  submit: (
    build: InstructionBuilder,
    rent?: RentKind,
    instruction?: string,
  ) => Promise<{ signature: string; sponsored: boolean }>;
  sponsored: boolean;
  address: string;
}

type EnvelopeAccount = Awaited<
  ReturnType<CookieJarProgram["account"]["envelope"]["fetch"]>
>;

export function Claim({ program, owner, submit, sponsored, address }: Props) {
  const [envelope, setEnvelope] = useState<EnvelopeAccount | null>(null);
  const [jars, setJars] = useState<JarView[]>([]);
  const [target, setTarget] = useState<string>("");
  const [intoJar, setIntoJar] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ signature: string; amount: number } | null>(null);
  const [alreadyClaimed, setAlreadyClaimed] = useState(false);

  const key = (() => {
    try { return new PublicKey(address); } catch { return null; }
  })();

  const load = useCallback(async () => {
    if (!key) { setErr("That link does not point at a valid fortune cookie."); return; }
    try {
      const e = await program.account.envelope.fetch(key);
      setEnvelope(e);
      const list = (await loadJars(program)).filter((j) => j.endTs > Date.now() / 1000);
      setJars(list);
      if (list.length && !target) setTarget(list[0].address.toBase58());
      if (owner) {
        const claim = await connection.getAccountInfo(findClaim(key, owner));
        setAlreadyClaimed(Boolean(claim));
      }
    } catch (e) {
      setErr(readableError(e));
    }
  }, [program, address, owner]);

  useEffect(() => { void load(); }, [load]);

  const crack = async () => {
    if (!owner || !key) return;
    setErr(null);
    setBusy(true);
    try {
      const vaultBefore = intoJar && target
        ? await connection.getBalance(findJarVault(new PublicKey(target)))
        : await connection.getBalance(owner);

      let rent: RentKind;
      let build: InstructionBuilder;

      if (intoJar) {
        if (!target) throw new Error("Pick a jar to drop it into.");
        const jar = new PublicKey(target);
        const position = findPosition(jar, owner);
        const isNew = !(await connection.getAccountInfo(position));
        rent = isNew ? "claim+position" : "claim";
        build = async (payer) => [
          await program.methods
            .crackIntoJar()
            .accountsPartial({
              claimer: owner,
              payer,
              config: findConfig(),
              envelope: key,
              envelopeVault: findEnvelopeVault(key),
              claim: findClaim(key, owner),
              jar,
              jarVault: findJarVault(jar),
              position,
              slotHashes: SLOT_HASHES,
              systemProgram: SystemProgram.programId,
            })
            .instruction(),
        ];
      } else {
        rent = "claim";
        build = async (payer) => [
          await program.methods
            .crack()
            .accountsPartial({
              claimer: owner,
              payer,
              envelope: key,
              envelopeVault: findEnvelopeVault(key),
              claim: findClaim(key, owner),
              slotHashes: SLOT_HASHES,
              systemProgram: SystemProgram.programId,
            })
            .instruction(),
        ];
      }

      const { signature } = await submit(build, rent, intoJar ? "crackIntoJar" : "crack");

      const vaultAfter = intoJar && target
        ? await connection.getBalance(findJarVault(new PublicKey(target)))
        : await connection.getBalance(owner);

      setDone({ signature, amount: Math.max(0, vaultAfter - vaultBefore) });
      await load();
    } catch (e) {
      setErr(readableError(e));
    } finally {
      setBusy(false);
    }
  };

  if (err && !envelope) {
    return (
      <div className="card">
        <div className="banner warn">{err}</div>
        <a className="ghost" href={window.location.pathname} style={{ textDecoration: "none" }}>
          Back to the kitchen
        </a>
      </div>
    );
  }

  if (!envelope) return <div className="empty"><span className="empty-symbol"><Icon name="wallet" /></span><h3>Finding your cookie…</h3></div>;

  const e = envelope;
  const left = e.claimsTotal - e.claimsDone;
  const expired = e.expiryTs.toNumber() <= Date.now() / 1000;

  if (done) {
    return (
      <div className="card" style={{ textAlign: "center" }}>
        <span className="success-mark"><Icon name="check" /></span>
        <h2 style={{ margin: "8px 0" }}>You got {formatCook(done.amount)} COOK</h2>
        <p className="muted">
          {intoJar
            ? "It went straight into your jar, where it keeps earning. You can take it out whenever you want."
            : "It landed in your wallet."}
        </p>
        {sponsored && <div className="banner info">You paid nothing. The gas was covered for you.</div>}
        <div className="row" style={{ justifyContent: "center", marginTop: 12 }}>
          <a className="ghost" style={{ textDecoration: "none" }} href={txUrl(done.signature)} target="_blank" rel="noreferrer">
            See it on chain
          </a>
          <a className="primary" style={{ textDecoration: "none", display: "inline-block" }} href={window.location.pathname}>
            Go to the jars
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div style={{ textAlign: "center", marginBottom: 14 }}>
        <span className="cookie-mark" aria-hidden="true"><Icon name="wallet" /></span>
        <h2 style={{ margin: "6px 0" }}>{e.message || "Someone left you a fortune cookie"}</h2>
        <p className="muted" style={{ margin: 0 }}>
          {formatCook(e.remaining.toNumber())} COOK still inside · {left} of {e.claimsTotal} left
          {!expired && ` · expires in ${countdown(e.expiryTs.toNumber())}`}
        </p>
      </div>

      {sponsored && (
        <div className="banner info">
          You do not need any COOK to open this. The fee is covered for you.
        </div>
      )}
      {err && <div className="banner warn">{err}</div>}

      {expired ? (
        <div className="banner warn">This cookie has expired.</div>
      ) : left === 0 ? (
        <div className="banner warn">Every piece has been taken already.</div>
      ) : alreadyClaimed ? (
        <div className="banner warn">You have already opened this one.</div>
      ) : !owner ? (
        <div style={{ textAlign: "center" }}>
          <p className="muted">Connect a wallet to open it.</p>
          <WalletMultiButton />
        </div>
      ) : (
        <>
          <label>Where should it go</label>
          <select value={intoJar ? "jar" : "wallet"} onChange={(ev) => setIntoJar(ev.target.value === "jar")}>
            <option value="jar">Into a jar · keeps earning, withdraw any time</option>
            <option value="wallet">Straight to my wallet</option>
          </select>

          {intoJar && (
            <>
              <label>Which jar</label>
              {jars.length === 0 ? (
                <div className="banner warn">No open jars right now. Take it to your wallet instead.</div>
              ) : (
                <select value={target} onChange={(ev) => setTarget(ev.target.value)}>
                  {jars.map((j) => (
                    <option key={j.address.toBase58()} value={j.address.toBase58()}>
                      {j.name || "Unnamed jar"} · {j.lucky ? "lucky draw" : "streaming"} · {formatCook(j.rewardPool)} COOK prize
                    </option>
                  ))}
                </select>
              )}
            </>
          )}

          <button
            className="primary"
            style={{ marginTop: 16, width: "100%" }}
            disabled={busy || (intoJar && jars.length === 0)}
            onClick={crack}
          >
            {busy ? "Cracking it open..." : "Crack it open"}
          </button>
        </>
      )}
    </div>
  );
}

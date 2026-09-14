import { useCallback, useEffect, useState } from "react";
import { PublicKey, SystemProgram } from "@solana/web3.js";

import {
  assertCanAfford, bn, connection, countdown, findCampaign, findCampaignVault,
  findConfig, findDonation, findJarVault, findPosition, formatCook, formatCount,
  readableError, toLamports, type CookieJarProgram,
} from "../lib/cookiejar";
import { loadJars, type JarView } from "./Jars";
import type { RentKind } from "../hooks/useCookieJar";
import type { InstructionBuilder } from "../lib/send";

export interface CampaignView {
  address: PublicKey;
  creator: PublicKey;
  campaignId: string;
  title: string;
  story: string;
  target: number;
  raised: number;
  withdrawn: number;
  donors: number;
  gifts: number;
  deadlineTs: number;
  closed: boolean;
}

export async function loadCampaigns(program: CookieJarProgram): Promise<CampaignView[]> {
  const raw = await program.account.campaign.all();
  return raw
    .map((c) => ({
      address: c.publicKey,
      creator: c.account.creator,
      campaignId: c.account.campaignId.toString(),
      title: c.account.title,
      story: c.account.story,
      target: c.account.target.toNumber(),
      raised: c.account.raised.toNumber(),
      withdrawn: c.account.withdrawn.toNumber(),
      donors: c.account.donorCount.toNumber(),
      gifts: c.account.donationCount.toNumber(),
      deadlineTs: c.account.deadlineTs.toNumber(),
      closed: c.account.closed,
    }))
    // Open ones first, then the nearest deadline, so help that is still needed
    // is what a visitor sees.
    .sort((a, b) => {
      const aLive = !a.closed && a.deadlineTs > Date.now() / 1000;
      const bLive = !b.closed && b.deadlineTs > Date.now() / 1000;
      if (aLive !== bLive) return aLive ? -1 : 1;
      return a.deadlineTs - b.deadlineTs;
    });
}

interface Props {
  program: CookieJarProgram;
  owner: PublicKey | null;
  submit: (
    build: InstructionBuilder,
    rent?: RentKind,
    instruction?: string,
  ) => Promise<{ signature: string; sponsored: boolean }>;
  sponsored: boolean;
  onChanged: () => void;
}

export function Campaigns({ program, owner, submit, sponsored, onChanged }: Props) {
  const [campaigns, setCampaigns] = useState<CampaignView[] | null>(null);
  const [jars, setJars] = useState<JarView[]>([]);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showAsk, setShowAsk] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setCampaigns(await loadCampaigns(program));
      setJars((await loadJars(program)).filter((j) => j.endTs > Date.now() / 1000));
    } catch (e) {
      setCampaigns([]);
      setErr(readableError(e));
    }
  }, [program]);

  useEffect(() => { void refresh(); }, [refresh]);

  const give = async (c: CampaignView) => {
    if (!owner) return;
    const key = c.address.toBase58();
    const value = Number(amounts[key] ?? "");
    if (!Number.isFinite(value) || value <= 0) {
      setErr("Enter how much you want to give.");
      return;
    }
    setErr(null);
    setBusy(key + "give");
    try {
      await assertCanAfford(owner, toLamports(value), "give that much");
      const donation = findDonation(c.address, owner);
      const isFirst = !(await connection.getAccountInfo(donation));

      await submit(
        async (payer) => [
          await program.methods.donate(bn(toLamports(value))).accountsPartial({
            donor: owner,
            payer,
            config: findConfig(),
            campaign: c.address,
            campaignVault: findCampaignVault(c.address),
            donation,
            systemProgram: SystemProgram.programId,
          }).instruction(),
        ],
        isFirst ? "donation" : "none",
        "donate",
      );
      setAmounts((a) => ({ ...a, [key]: "" }));
      await refresh();
      onChanged();
    } catch (e) {
      setErr(readableError(e));
    } finally {
      setBusy(null);
    }
  };

  const moveToJar = async (c: CampaignView, jar: JarView) => {
    if (!owner) return;
    const key = c.address.toBase58();
    setBusy(key + "move");
    setErr(null);
    try {
      const available = c.raised - c.withdrawn;
      await submit(
        async (payer) => [
          await program.methods.withdrawToJar(bn(available)).accountsPartial({
            creator: owner,
            payer,
            campaign: c.address,
            campaignVault: findCampaignVault(c.address),
            jar: jar.address,
            jarVault: findJarVault(jar.address),
            position: findPosition(jar.address, owner),
            systemProgram: SystemProgram.programId,
          }).instruction(),
        ],
        "position",
        "withdrawToJar",
      );
      await refresh();
      onChanged();
    } catch (e) {
      setErr(readableError(e));
    } finally {
      setBusy(null);
    }
  };

  if (!campaigns) {
    return <div className="empty"><span className="jar">🍪</span>Looking for people who need help...</div>;
  }

  return (
    <>
      {err && <div className="banner warn">{err}</div>}

      <div className="row" style={{ justifyContent: "space-between", marginBottom: 14 }}>
        <span className="muted">
          {campaigns.length} {campaigns.length === 1 ? "person has" : "people have"} asked for help
        </span>
        <button className="ghost" onClick={() => setShowAsk((s) => !s)}>
          {showAsk ? "Cancel" : "Ask for help"}
        </button>
      </div>

      {showAsk && (
        <AskForHelp
          program={program}
          owner={owner}
          submit={submit}
          sponsored={sponsored}
          onDone={async () => { setShowAsk(false); await refresh(); onChanged(); }}
        />
      )}

      {campaigns.length === 0 ? (
        <div className="empty">
          <span className="jar">🍪</span>
          Nobody has asked yet. If you need a hand, you can be the first.
        </div>
      ) : (
        <div className="grid">
          {campaigns.map((c) => {
            const key = c.address.toBase58();
            const live = !c.closed && c.deadlineTs > Date.now() / 1000;
            const pct = c.target > 0 ? Math.min(100, (c.raised / c.target) * 100) : 0;
            const mine = owner?.equals(c.creator) ?? false;
            const available = c.raised - c.withdrawn;

            return (
              <div className="card" key={key}>
                <div className="spread">
                  <strong>{c.title}</strong>
                  <span className={`pill ${live ? "prop" : "closed"}`}>
                    {c.closed ? "closed" : live ? "open" : "ended"}
                  </span>
                </div>

                {c.story && (
                  <p className="muted" style={{ marginTop: 8, marginBottom: 12 }}>{c.story}</p>
                )}

                <div className="meter" title={`${pct.toFixed(0)}% of the goal`}>
                  <span style={{ width: `${pct}%` }} />
                </div>

                <div className="row" style={{ gap: 20, margin: "12px 0" }}>
                  <div className="stat">raised<b>{formatCook(c.raised)}</b></div>
                  <div className="stat">goal<b>{formatCook(c.target)}</b></div>
                  <div className="stat">people helping<b>{formatCount(c.donors)}</b></div>
                </div>

                <div className="muted" style={{ marginBottom: 10 }}>
                  {live ? `${countdown(c.deadlineTs)} left` : "no longer taking help"}
                  {c.gifts > c.donors && ` · ${formatCount(c.gifts)} gifts`}
                </div>

                {owner && live && !mine && (
                  <div className="row">
                    <input
                      placeholder="COOK"
                      inputMode="decimal"
                      value={amounts[key] ?? ""}
                      onChange={(e) => setAmounts((a) => ({ ...a, [key]: e.target.value }))}
                      style={{ flex: 1, minWidth: 90 }}
                    />
                    <button
                      className="primary"
                      disabled={busy !== null}
                      onClick={() => give(c)}
                    >
                      {busy === key + "give" ? "..." : "Give"}
                    </button>
                  </div>
                )}

                {mine && available > 0 && (
                  <div className="banner info" style={{ marginTop: 10 }}>
                    <div style={{ marginBottom: 8 }}>
                      {formatCook(available)} COOK raised and waiting for you.
                    </div>
                    {jars.length === 0 ? (
                      <span className="muted">Open a jar first to keep it somewhere safe.</span>
                    ) : (
                      <button
                        className="primary"
                        disabled={busy !== null}
                        onClick={() => moveToJar(c, jars[0])}
                      >
                        {busy === key + "move"
                          ? "..."
                          : `Move it into ${jars[0].name || "your jar"}`}
                      </button>
                    )}
                  </div>
                )}

                {!owner && live && (
                  <p className="muted">Connect a wallet to help.</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

function AskForHelp({
  program, owner, submit, sponsored, onDone,
}: Omit<Props, "onChanged"> & { onDone: () => void }) {
  const [title, setTitle] = useState("");
  const [story, setStory] = useState("");
  const [target, setTarget] = useState("500");
  const [days, setDays] = useState("30");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const open = async () => {
    if (!owner) return;
    if (!title.trim()) { setErr("Give it a title so people know what it is for."); return; }
    const goal = Number(target);
    if (!Number.isFinite(goal) || goal <= 0) { setErr("Set a goal."); return; }

    setErr(null);
    setBusy(true);
    try {
      const now = Math.floor(Date.now() / 1000);
      const id = now;
      const campaign = findCampaign(owner, id);
      await submit(
        async (payer) => [
          await program.methods
            .createCampaign(
              bn(id),
              title.slice(0, 64),
              story.slice(0, 280),
              bn(toLamports(goal)),
              bn(now + Math.round(Number(days) * 86400)),
            )
            .accountsPartial({
              creator: owner,
              payer,
              config: findConfig(),
              campaign,
              campaignVault: findCampaignVault(campaign),
              systemProgram: SystemProgram.programId,
            })
            .instruction(),
        ],
        "campaign",
        "createCampaign",
      );
      onDone();
    } catch (e) {
      setErr(readableError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <strong>Ask for help</strong>
      <p className="muted" style={{ marginTop: 4 }}>
        No approval step, no fee, and nobody takes a cut. Whatever people give is
        yours the moment it arrives.
      </p>

      {sponsored && (
        <div className="banner info">
          You do not need any COOK to do this. Opening a request is covered for you.
        </div>
      )}
      {err && <div className="banner warn">{err}</div>}

      <label>What do you need help with</label>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={64}
        placeholder="Pay for a medical bill"
      />

      <label>Tell people the situation</label>
      <textarea
        value={story}
        onChange={(e) => setStory(e.target.value)}
        maxLength={280}
        rows={3}
        placeholder="A few honest sentences go further than a long appeal."
      />
      <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
        {story.length}/280
      </div>

      <div className="row" style={{ gap: 12 }}>
        <div style={{ flex: 1 }}>
          <label>Goal (COOK)</label>
          <input value={target} onChange={(e) => setTarget(e.target.value)} inputMode="decimal" />
        </div>
        <div style={{ flex: 1 }}>
          <label>Open for (days)</label>
          <input value={days} onChange={(e) => setDays(e.target.value)} inputMode="decimal" />
        </div>
      </div>

      <button className="primary" style={{ marginTop: 14 }} disabled={busy || !owner} onClick={open}>
        {busy ? "Opening..." : "Open the request"}
      </button>
      {!owner && <div className="muted" style={{ marginTop: 8 }}>Connect a wallet first.</div>}
    </div>
  );
}

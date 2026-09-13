import { useCallback, useEffect, useState } from "react";
import { PublicKey, SystemProgram } from "@solana/web3.js";

import {
  bn, connection, countdown, findConfig, findJar, findJarVault, findPosition,
  findRewardVault, formatCook, getBalances, readableError, toLamports,
  assertCanAfford, SLOT_HASHES, type CookieJarProgram,
} from "../lib/cookiejar";
import type { RentKind } from "../hooks/useCookieJar";
import type { InstructionBuilder } from "../lib/send";

export interface JarView {
  address: PublicKey;
  creator: PublicKey;
  jarId: string;
  name: string;
  lucky: boolean;
  endTs: number;
  minDeposit: number;
  totalDeposited: number;
  rewardPool: number;
  depositors: number;
  entries: number;
  prizeClaimed: boolean;
  drawState: "notStarted" | "requested" | "finalized";
  drawTargetSlot: number;
  winnerIndex: number;
  winner: PublicKey | null;
}

export async function loadJars(program: CookieJarProgram): Promise<JarView[]> {
  const raw = await program.account.jar.all();
  const pools = await getBalances(raw.map((j) => findRewardVault(j.publicKey)));

  return raw
    .map((j, i) => ({
      address: j.publicKey,
      creator: j.account.creator,
      jarId: j.account.jarId.toString(),
      name: j.account.name,
      lucky: "lucky" in j.account.mode,
      endTs: j.account.endTs.toNumber(),
      minDeposit: j.account.minDeposit.toNumber(),
      totalDeposited: j.account.totalDeposited.toNumber(),
      rewardPool: pools[i],
      depositors: j.account.depositorCount.toNumber(),
      entries: j.account.entryCount.toNumber(),
      prizeClaimed: j.account.prizeClaimed,
      drawState: ("finalized" in j.account.drawState
        ? "finalized"
        : "requested" in j.account.drawState
          ? "requested"
          : "notStarted") as JarView["drawState"],
      drawTargetSlot: j.account.drawTargetSlot.toNumber(),
      winnerIndex: j.account.winnerIndex.toNumber(),
      winner: j.account.winner ?? null,
    }))
    .sort((a, b) => b.endTs - a.endTs);
}

interface Props {
  program: CookieJarProgram;
  owner: PublicKey | null;
  submit: (
    build: InstructionBuilder,
    rent?: RentKind,
    instruction?: string,
  ) => Promise<{ signature: string; sponsored: boolean }>;
  onChanged: () => void;
}

export function Jars({ program, owner, submit, onChanged }: Props) {
  const [jars, setJars] = useState<JarView[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [positions, setPositions] = useState<
    Record<string, { amount: number; entryIndex: number; hasEntry: boolean }>
  >({});
  const [localError, setLocalError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const list = await loadJars(program);
      setJars(list);
      if (owner) {
        // fetchMultiple returns null for positions that do not exist yet, which
        // is the common case, so this is one call instead of one per jar.
        const mine = await program.account.position.fetchMultiple(
          list.map((j) => findPosition(j.address, owner)),
        );
        setPositions(Object.fromEntries(
          list.map((j, i) => [j.address.toBase58(), {
            amount: mine[i]?.amount.toNumber() ?? 0,
            entryIndex: mine[i]?.entryIndex.toNumber() ?? -1,
            hasEntry: mine[i]?.hasEntry ?? false,
          }]),
        ));
      }
    } catch (e) {
      // Leaving `jars` null would keep the loading state up forever and hide
      // the reason. An empty list plus the message is the honest thing to show.
      console.error("could not read jars", e);
      setJars([]);
      setLocalError(readableError(e));
    }
  }, [program, owner]);

  useEffect(() => { void refresh(); }, [refresh]);

  const act = async (jar: JarView, kind: "deposit" | "withdraw") => {
    if (!owner) return;
    const value = Number(amounts[jar.address.toBase58()] ?? "");
    if (!Number.isFinite(value) || value <= 0) {
      setLocalError("Enter an amount first.");
      return;
    }
    setLocalError(null);
    setBusy(jar.address.toBase58() + kind);
    try {
      const position = findPosition(jar.address, owner);
      const isNew = !(await connection.getAccountInfo(position));
      if (kind === "deposit") {
        await assertCanAfford(owner, toLamports(value), "put that much in a jar");
      }

      await submit(
        async (payer) =>
          kind === "deposit"
            ? [await program.methods
                .deposit(bn(toLamports(value)))
                .accountsPartial({
                  owner, payer, config: findConfig(), jar: jar.address,
                  jarVault: findJarVault(jar.address), position,
                  systemProgram: SystemProgram.programId,
                })
                .instruction()]
            : [await program.methods
                .withdraw(bn(toLamports(value)))
                .accountsPartial({
                  owner, jar: jar.address, jarVault: findJarVault(jar.address),
                  position, systemProgram: SystemProgram.programId,
                })
                .instruction()],
        (kind === "deposit" && isNew ? "position" : "none") as RentKind,
        kind,
      );
      setAmounts((a) => ({ ...a, [jar.address.toBase58()]: "" }));
      await refresh();
      onChanged();
    } catch {
      // already surfaced by the shared toast
    } finally {
      setBusy(null);
    }
  };

  const harvest = async (jar: JarView) => {
    if (!owner) return;
    setBusy(jar.address.toBase58() + "harvest");
    try {
      await submit(async () => [
        await program.methods
          .harvest()
          .accountsPartial({
            owner, jar: jar.address, rewardVault: findRewardVault(jar.address),
            position: findPosition(jar.address, owner),
            systemProgram: SystemProgram.programId,
          })
          .instruction(),
      ], "none", "harvest");
      await refresh();
    } catch { /* surfaced by toast */ } finally { setBusy(null); }
  };

  // The draw is a permissionless crank in two phases, so a jar can never be
  // held hostage by an absent creator. Anyone looking at the page can run it.
  const runDraw = async (jar: JarView) => {
    setBusy(jar.address.toBase58() + "draw");
    setLocalError(null);
    try {
      if (jar.drawState === "notStarted") {
        await submit(async () => [
          await program.methods.requestDraw()
            .accountsPartial({ jar: jar.address }).instruction(),
        ], "none", "requestDraw");
        setLocalError("Draw requested. Give it a few seconds, then finish it.");
      } else {
        await submit(async () => [
          await program.methods.finalizeDraw()
            .accountsPartial({ jar: jar.address, slotHashes: SLOT_HASHES })
            .instruction(),
        ], "none", "finalizeDraw");
      }
      await refresh();
      onChanged();
    } catch (e) {
      setLocalError(readableError(e));
    } finally {
      setBusy(null);
    }
  };

  // If the drawn entry never shows up, the prize is not stranded. After the
  // claim window anyone can reset the draw and a new winner gets picked.
  const redraw = async (jar: JarView) => {
    setBusy(jar.address.toBase58() + "redraw");
    setLocalError(null);
    try {
      await submit(async () => [
        await program.methods.redraw()
          .accountsPartial({ jar: jar.address }).instruction(),
      ], "none", "redraw");
      await refresh();
    } catch (e) {
      setLocalError(readableError(e));
    } finally {
      setBusy(null);
    }
  };

  const collectPrize = async (jar: JarView) => {
    if (!owner) return;
    setBusy(jar.address.toBase58() + "prize");
    try {
      await submit(async () => [
        await program.methods.claimPrize().accountsPartial({
          owner, jar: jar.address, rewardVault: findRewardVault(jar.address),
          position: findPosition(jar.address, owner),
          systemProgram: SystemProgram.programId,
        }).instruction(),
      ], "none", "claimPrize");
      await refresh();
      onChanged();
    } catch { /* surfaced by toast */ } finally { setBusy(null); }
  };

  const addPrize = async (jar: JarView) => {
    if (!owner) return;
    const value = Number(amounts[jar.address.toBase58()] ?? "");
    if (!Number.isFinite(value) || value <= 0) {
      setLocalError("Enter an amount first.");
      return;
    }
    setBusy(jar.address.toBase58() + "fund");
    try {
      await submit(async () => [
        await program.methods.fundJar(bn(toLamports(value))).accountsPartial({
          funder: owner, jar: jar.address,
          rewardVault: findRewardVault(jar.address),
          systemProgram: SystemProgram.programId,
        }).instruction(),
      ], "none", "fundJar");
      setAmounts((a) => ({ ...a, [jar.address.toBase58()]: "" }));
      await refresh();
      onChanged();
    } catch { /* surfaced by toast */ } finally { setBusy(null); }
  };

  if (!jars) return <div className="empty"><span className="jar">🍪</span>Reading the shelf...</div>;

  return (
    <>
      {localError && <div className="banner warn">{localError}</div>}

      <div className="row" style={{ justifyContent: "space-between", marginBottom: 14 }}>
        <span className="muted">{jars.length} jar{jars.length === 1 ? "" : "s"} on the shelf</span>
        <button className="ghost" onClick={() => setShowCreate((s) => !s)}>
          {showCreate ? "Cancel" : "Open a new jar"}
        </button>
      </div>

      {showCreate && (
        <CreateJar
          program={program}
          owner={owner}
          submit={submit}
          onDone={async () => { setShowCreate(false); await refresh(); onChanged(); }}
        />
      )}

      {jars.length === 0 ? (
        <div className="empty"><span className="jar">🍪</span>No jars yet. Open the first one.</div>
      ) : (
        <div className="grid">
          {jars.map((jar) => {
            const key = jar.address.toBase58();
            const mine = positions[key] ?? { amount: 0, entryIndex: -1, hasEntry: false };
            const open = jar.endTs > Date.now() / 1000;
            return (
              <div className="card" key={key}>
                <div className="spread">
                  <strong>{jar.name || "Unnamed jar"}</strong>
                  <span className={`pill ${!open ? "closed" : jar.lucky ? "lucky" : "prop"}`}>
                    {!open ? "closed" : jar.lucky ? "lucky draw" : "streaming"}
                  </span>
                </div>

                <div className="row" style={{ gap: 20, margin: "14px 0" }}>
                  <div className="stat">in the jar<b>{formatCook(jar.totalDeposited)}</b></div>
                  <div className="stat">prize pool<b>{formatCook(jar.rewardPool)}</b></div>
                  <div className="stat">{jar.lucky ? "entries" : "savers"}<b>{jar.lucky ? jar.entries : jar.depositors}</b></div>
                </div>

                <div className="muted" style={{ marginBottom: 10 }}>
                  {open ? `closes in ${countdown(jar.endTs)}` : "closed"}
                  {jar.lucky && ` · min ${formatCook(jar.minDeposit)} COOK for one entry`}
                </div>

                {mine.amount > 0 && (
                  <div className="banner info" style={{ marginBottom: 10 }}>
                    You have {formatCook(mine.amount)} COOK in here.
                    {jar.lucky && mine.hasEntry && ` Your entry is #${mine.entryIndex}.`}
                  </div>
                )}

                {jar.lucky && !open && <DrawPanel
                  jar={jar}
                  mine={mine}
                  busy={busy}
                  onDraw={() => runDraw(jar)}
                  onCollect={() => collectPrize(jar)}
                  onRedraw={() => redraw(jar)}
                />}

                {owner && (
                  <>
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
                        disabled={!open || busy !== null}
                        onClick={() => act(jar, "deposit")}
                      >
                        {busy === key + "deposit" ? "..." : "Add"}
                      </button>
                      <button
                        className="ghost"
                        disabled={mine.amount === 0 || busy !== null}
                        onClick={() => act(jar, "withdraw")}
                      >
                        Take out
                      </button>
                    </div>

                    {open && (
                      // Anyone can top up someone else's prize pool. This is how
                      // another project sponsors a giveaway for its own users.
                      <button
                        className="ghost"
                        style={{ marginTop: 8 }}
                        disabled={busy !== null}
                        onClick={() => addPrize(jar)}
                      >
                        {busy === key + "fund" ? "..." : "Sponsor this prize pool"}
                      </button>
                    )}

                    {!jar.lucky && mine.amount > 0 && (
                      <button
                        className="ghost"
                        style={{ marginTop: 8 }}
                        disabled={busy !== null}
                        onClick={() => harvest(jar)}
                      >
                        Collect rewards
                      </button>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

type CreateJarProps = Omit<Props, "onChanged"> & { onDone: () => void };

function CreateJar({ program, owner, submit, onDone }: CreateJarProps) {
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"lucky" | "proportional">("lucky");
  const [hours, setHours] = useState("24");
  const [reward, setReward] = useState("10");
  const [minDeposit, setMinDeposit] = useState("1");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const create = async () => {
    if (!owner) return;
    const duration = Math.round(Number(hours) * 3600);
    if (!Number.isFinite(duration) || duration < 60) {
      setErr("A jar has to stay open for at least a minute.");
      return;
    }
    setErr(null);
    setBusy(true);
    try {
      await assertCanAfford(owner, toLamports(Number(reward) || 0), "fund that prize pool");

      const now = Math.floor(Date.now() / 1000);
      const jarId = now;
      const jar = findJar(owner, jarId);
      await submit(async () => [await program.methods
        .createJar(
          bn(jarId), name.slice(0, 32),
          mode === "lucky" ? { lucky: {} } : { proportional: {} },
          bn(now), bn(now + duration),
          bn(toLamports(Number(minDeposit) || 0)),
          bn(toLamports(Number(reward) || 0)),
        )
        .accountsPartial({
          creator: owner, config: findConfig(), jar,
          jarVault: findJarVault(jar), rewardVault: findRewardVault(jar),
          systemProgram: SystemProgram.programId,
        })
        .instruction()], "none", "createJar");
      onDone();
    } catch (e) {
      setErr(readableError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <strong>Open a jar</strong>
      <p className="muted" style={{ marginTop: 4 }}>
        Everything put in here is withdrawable at any time. The prize comes from
        the pool you fund, never from anyone's deposit.
      </p>
      {err && <div className="banner warn">{err}</div>}

      <label>Name</label>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Friday Cookie Jar" maxLength={32} />

      <label>How the prize is shared</label>
      <select value={mode} onChange={(e) => setMode(e.target.value as never)}>
        <option value="lucky">Lucky draw · one entry each, equal odds, winner takes the pool</option>
        <option value="proportional">Streaming · everyone earns by amount and time held</option>
      </select>

      <div className="row" style={{ gap: 12 }}>
        <div style={{ flex: 1 }}>
          <label>Open for (hours)</label>
          <input value={hours} onChange={(e) => setHours(e.target.value)} inputMode="decimal" />
        </div>
        <div style={{ flex: 1 }}>
          <label>Prize pool (COOK)</label>
          <input value={reward} onChange={(e) => setReward(e.target.value)} inputMode="decimal" />
        </div>
        {mode === "lucky" && (
          <div style={{ flex: 1 }}>
            <label>Min to enter (COOK)</label>
            <input value={minDeposit} onChange={(e) => setMinDeposit(e.target.value)} inputMode="decimal" />
          </div>
        )}
      </div>

      <button className="primary" style={{ marginTop: 14 }} disabled={busy || !owner} onClick={create}>
        {busy ? "Opening..." : "Open jar"}
      </button>
    </div>
  );
}

interface DrawPanelProps {
  jar: JarView;
  mine: { amount: number; entryIndex: number; hasEntry: boolean };
  busy: string | null;
  onDraw: () => void;
  onCollect: () => void;
  onRedraw: () => void;
}

/** Matches PRIZE_CLAIM_WINDOW in the program. */
const PRIZE_CLAIM_WINDOW = 60 * 60 * 24;

/**
 * The Lucky endgame. Running the draw is permissionless on purpose, so a closed
 * jar never sits on a prize waiting for its creator to show up.
 */
function DrawPanel({ jar, mine, busy, onDraw, onCollect, onRedraw }: DrawPanelProps) {
  const key = jar.address.toBase58();

  if (jar.entries === 0) {
    return <div className="banner warn">Closed with nobody in it. Nothing to draw.</div>;
  }

  if (jar.prizeClaimed) {
    return (
      <div className="banner info">
        Entry #{jar.winnerIndex} won and collected the pool.
      </div>
    );
  }

  if (jar.drawState === "finalized") {
    const iWon = mine.hasEntry && mine.entryIndex === jar.winnerIndex;
    if (iWon) {
      return (
        <div className="banner info">
          <div style={{ marginBottom: 8 }}>Your entry won.</div>
          <button className="primary" disabled={busy !== null} onClick={onCollect}>
            {busy === key + "prize" ? "..." : `Collect ${formatCook(jar.rewardPool)} COOK`}
          </button>
        </div>
      );
    }

    const abandoned = Date.now() / 1000 > jar.endTs + PRIZE_CLAIM_WINDOW;
    return (
      <div className="banner info">
        <div style={{ marginBottom: abandoned ? 8 : 0 }}>
          Entry #{jar.winnerIndex} won
          {abandoned ? " but never collected." : ". Waiting for them to collect."}
        </div>
        {abandoned && (
          <button className="primary" disabled={busy !== null} onClick={onRedraw}>
            {busy === key + "redraw" ? "..." : "Draw again"}
          </button>
        )}
      </div>
    );
  }

  const requested = jar.drawState === "requested";
  return (
    <div className="banner warn">
      <div style={{ marginBottom: 8 }}>
        {requested
          ? "Draw requested against a future block. Finish it once that block exists."
          : "This jar has closed. Anyone can run the draw."}
      </div>
      <button className="primary" disabled={busy !== null} onClick={onDraw}>
        {busy === key + "draw" ? "..." : requested ? "Finish the draw" : "Run the draw"}
      </button>
    </div>
  );
}

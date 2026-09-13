import { useCallback, useEffect, useState } from "react";
import { PublicKey, SystemProgram } from "@solana/web3.js";

import {
  assertCanAfford, bn, countdown, findBond, findCircle, findConfig,
  findMember, findPot, formatCook, readableError, toLamports, SLOT_HASHES,
  type CookieJarProgram,
} from "../lib/cookiejar";
import type { RentKind } from "../hooks/useCookieJar";
import type { InstructionBuilder } from "../lib/send";

type State = "forming" | "running" | "finished";

export interface CircleView {
  address: PublicKey;
  creator: PublicKey;
  circleId: string;
  name: string;
  contribution: number;
  collateral: number;
  maxMembers: number;
  memberCount: number;
  roundSeconds: number;
  state: State;
  round: number;
  nextPayoutTs: number;
  paidThisRound: number;
  pot: number;
  winnersSoFar: number;
  winnerIndex: number;
  winnerDrawn: boolean;
  drawTargetSlot: number;
}

export interface MemberView {
  wallet: PublicKey;
  seat: number;
  collateral: number;
  paidRound: number;
  roundsPaid: number;
  roundsMissed: number;
  hasWon: boolean;
  active: boolean;
}

export async function loadCircles(program: CookieJarProgram): Promise<CircleView[]> {
  const raw = await program.account.circle.all();
  return raw
    .map((c) => ({
      address: c.publicKey,
      creator: c.account.creator,
      circleId: c.account.circleId.toString(),
      name: c.account.name,
      contribution: c.account.contribution.toNumber(),
      collateral: c.account.collateral.toNumber(),
      maxMembers: c.account.maxMembers,
      memberCount: c.account.memberCount,
      roundSeconds: c.account.roundSeconds.toNumber(),
      state: ("running" in c.account.state
        ? "running"
        : "finished" in c.account.state
          ? "finished"
          : "forming") as State,
      round: c.account.round,
      nextPayoutTs: c.account.nextPayoutTs.toNumber(),
      paidThisRound: c.account.paidThisRound,
      pot: c.account.potAmount.toNumber(),
      winnersSoFar: c.account.winnersSoFar,
      winnerIndex: c.account.winnerIndex,
      winnerDrawn: c.account.winnerDrawn,
      drawTargetSlot: c.account.drawTargetSlot.toNumber(),
    }))
    // Ones you can still join first, then running, then done.
    .sort((a, b) => {
      const rank = (s: State) => (s === "forming" ? 0 : s === "running" ? 1 : 2);
      return rank(a.state) - rank(b.state) || Number(b.circleId) - Number(a.circleId);
    });
}

async function loadMembers(
  program: CookieJarProgram,
  circle: PublicKey,
): Promise<MemberView[]> {
  const raw = await program.account.member.all([
    { memcmp: { offset: 8, bytes: circle.toBase58() } },
  ]);
  return raw
    .map((m) => ({
      wallet: m.account.wallet,
      seat: m.account.seat,
      collateral: m.account.collateral.toNumber(),
      paidRound: m.account.paidRound,
      roundsPaid: m.account.roundsPaid,
      roundsMissed: m.account.roundsMissed,
      hasWon: m.account.hasWon,
      active: m.account.active,
    }))
    .sort((a, b) => a.seat - b.seat);
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

export function Circles({ program, owner, submit, onChanged }: Props) {
  const [circles, setCircles] = useState<CircleView[] | null>(null);
  const [members, setMembers] = useState<Record<string, MemberView[]>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const list = await loadCircles(program);
      setCircles(list);
      const boards = await Promise.all(list.map((c) => loadMembers(program, c.address)));
      setMembers(Object.fromEntries(list.map((c, i) => [c.address.toBase58(), boards[i]])));
    } catch (e) {
      setCircles([]);
      setErr(readableError(e));
    }
  }, [program]);

  useEffect(() => { void refresh(); }, [refresh]);

  const run = async (
    key: string,
    build: InstructionBuilder,
    rent: RentKind,
    ix: string,
  ) => {
    setBusy(key);
    setErr(null);
    setNote(null);
    try {
      await submit(build, rent, ix);
      await refresh();
      onChanged();
    } catch (e) {
      setErr(readableError(e));
    } finally {
      setBusy(null);
    }
  };

  const join = (c: CircleView) => {
    if (!owner) return;
    return run(
      c.address.toBase58() + "join",
      async (payer) => {
        await assertCanAfford(owner, c.collateral, "post the collateral for this circle");
        return [await program.methods.joinCircle().accountsPartial({
          member: owner, payer, circle: c.address, bond: findBond(c.address),
          membership: findMember(c.address, owner),
          systemProgram: SystemProgram.programId,
        }).instruction()];
      },
      "member",
      "joinCircle",
    );
  };

  const pay = (c: CircleView) => {
    if (!owner) return;
    return run(
      c.address.toBase58() + "pay",
      async () => {
        await assertCanAfford(owner, c.contribution, "pay this round");
        return [await program.methods.contribute().accountsPartial({
          member: owner, circle: c.address, pot: findPot(c.address),
          membership: findMember(c.address, owner),
          systemProgram: SystemProgram.programId,
        }).instruction()];
      },
      "none",
      "contribute",
    );
  };

  const start = (c: CircleView) =>
    owner && run(
      c.address.toBase58() + "start",
      async () => [await program.methods.startCircle()
        .accountsPartial({ creator: owner, circle: c.address }).instruction()],
      "none",
      "startCircle",
    );

  // Anyone can run these. That is what stops a circle stalling on an absent
  // organiser, so the buttons are shown to everybody, member or not.
  const draw = (c: CircleView) =>
    run(
      c.address.toBase58() + "draw",
      async () => [
        c.drawTargetSlot === 0
          ? await program.methods.requestTurn()
              .accountsPartial({ circle: c.address }).instruction()
          : await program.methods.finalizeTurn()
              .accountsPartial({ circle: c.address, slotHashes: SLOT_HASHES })
              .instruction(),
      ],
      "none",
      c.drawTargetSlot === 0 ? "requestTurn" : "finalizeTurn",
    ).then(() => {
      if (c.drawTargetSlot === 0) {
        setNote("Draw locked to an upcoming block. Give it a few seconds, then finish it.");
      }
    });

  const collect = (c: CircleView) =>
    owner && run(
      c.address.toBase58() + "collect",
      async () => [await program.methods.claimTurn().accountsPartial({
        winner: owner, circle: c.address, pot: findPot(c.address),
        membership: findMember(c.address, owner),
        systemProgram: SystemProgram.programId,
      }).instruction()],
      "none",
      "claimTurn",
    );

  const chase = (c: CircleView, m: MemberView) =>
    run(
      c.address.toBase58() + "slash" + m.seat,
      async () => [await program.methods.slashAbsent().accountsPartial({
        circle: c.address, pot: findPot(c.address), bond: findBond(c.address),
        membership: findMember(c.address, m.wallet),
        systemProgram: SystemProgram.programId,
      }).instruction()],
      "none",
      "slashAbsent",
    );

  const topUp = (c: CircleView) =>
    owner && run(
      c.address.toBase58() + "topup",
      async () => {
        await assertCanAfford(owner, c.collateral, "top your collateral back up");
        return [await program.methods.topUpBond(bn(c.collateral)).accountsPartial({
          member: owner, circle: c.address, bond: findBond(c.address),
          membership: findMember(c.address, owner),
          systemProgram: SystemProgram.programId,
        }).instruction()];
      },
      "none",
      "topUpBond",
    );

  const takeBond = (c: CircleView) =>
    owner && run(
      c.address.toBase58() + "bond",
      async () => [await program.methods.withdrawBond().accountsPartial({
        member: owner, circle: c.address, bond: findBond(c.address),
        membership: findMember(c.address, owner),
        systemProgram: SystemProgram.programId,
      }).instruction()],
      "none",
      "withdrawBond",
    );

  if (!circles) {
    return <div className="empty"><span className="jar">🍪</span>Looking for circles...</div>;
  }

  return (
    <>
      <div className="card" style={{ marginBottom: 18 }}>
        <strong>An arisan nobody can run off with.</strong>
        <p className="muted" style={{ marginTop: 6, marginBottom: 10 }}>
          A group agrees an amount and a period. Every round each member pays that
          in, and one member who has not had a turn yet takes the whole pot. When
          everyone has had a turn it is done.
        </p>
        <div className="row" style={{ gap: 18 }}>
          <div className="stat">
            nobody holds the money
            <b style={{ fontSize: 14 }}>the pot is a program account</b>
          </div>
          <div className="stat">
            skipping costs you
            <b style={{ fontSize: 14 }}>a missed round comes out of your collateral</b>
          </div>
          <div className="stat">
            the draw cannot be timed
            <b style={{ fontSize: 14 }}>settled on a block that does not exist yet</b>
          </div>
        </div>
      </div>

      {err && <div className="banner warn">{err}</div>}
      {note && <div className="banner info">{note}</div>}

      <div className="row" style={{ justifyContent: "space-between", marginBottom: 14 }}>
        <span className="muted">
          {circles.filter((c) => c.state !== "finished").length} of {circles.length} circles active
        </span>
        <button className="ghost" onClick={() => setShowNew((s) => !s)}>
          {showNew ? "Cancel" : "Start a circle"}
        </button>
      </div>

      {showNew && (
        <NewCircle
          program={program}
          owner={owner}
          submit={submit}
          onDone={async () => { setShowNew(false); await refresh(); onChanged(); }}
        />
      )}

      {circles.length === 0 ? (
        <div className="empty"><span className="jar">🍪</span>No circles yet. Start the first one.</div>
      ) : (
        <div className="grid">
          {circles.map((c) => {
            const key = c.address.toBase58();
            const board = members[key] ?? [];
            const me = owner ? board.find((m) => m.wallet.equals(owner)) : undefined;
            const roundOver = c.nextPayoutTs > 0 && Date.now() / 1000 >= c.nextPayoutTs;
            const owed = me && c.state === "running" && me.paidRound < c.round;
            const isCreator = owner?.equals(c.creator) ?? false;
            const expanded = open === key;

            return (
              <div className="card" key={key}>
                <div className="spread">
                  <strong>{c.name}</strong>
                  <span className={`pill ${c.state === "running" ? "prop" : c.state === "forming" ? "lucky" : "closed"}`}>
                    {c.state === "forming" ? "taking members" : c.state === "running" ? `round ${c.round}` : "complete"}
                  </span>
                </div>

                <div className="row" style={{ gap: 20, margin: "14px 0" }}>
                  <div className="stat">each round<b>{formatCook(c.contribution)}</b></div>
                  <div className="stat">in the pot<b>{formatCook(c.pot)}</b></div>
                  <div className="stat">seats<b>{c.memberCount}/{c.maxMembers}</b></div>
                </div>

                <div className="muted" style={{ marginBottom: 10 }}>
                  {c.state === "forming"
                    ? `${formatCook(c.collateral)} COOK collateral to join`
                    : c.state === "running"
                      ? roundOver
                        ? "this round has closed"
                        : `${countdown(c.nextPayoutTs)} left this round`
                      : `all ${c.winnersSoFar} turns taken`}
                </div>

                {owed && (
                  <div className="banner warn" style={{ marginBottom: 10 }}>
                    You owe {formatCook(c.contribution)} COOK for round {c.round}.
                  </div>
                )}
                {me && !me.active && (
                  <div className="banner warn" style={{ marginBottom: 10 }}>
                    Your collateral ran out, so you cannot take a turn until you
                    put it back.
                  </div>
                )}

                <div className="row">
                  {c.state === "forming" && owner && !me && c.memberCount < c.maxMembers && (
                    <button className="primary" disabled={busy !== null} onClick={() => join(c)}>
                      {busy === key + "join" ? "..." : `Join · ${formatCook(c.collateral)} COOK`}
                    </button>
                  )}
                  {c.state === "forming" && isCreator && c.memberCount >= 2 && (
                    <button className="primary" disabled={busy !== null} onClick={() => start(c)}>
                      {busy === key + "start" ? "..." : "Start it"}
                    </button>
                  )}
                  {owed && (
                    <button className="primary" disabled={busy !== null} onClick={() => pay(c)}>
                      {busy === key + "pay" ? "..." : "Pay this round"}
                    </button>
                  )}
                  {c.state === "running" && roundOver && !c.winnerDrawn && (
                    <button className="primary" disabled={busy !== null} onClick={() => draw(c)}>
                      {busy === key + "draw"
                        ? "..."
                        : c.drawTargetSlot === 0 ? "Draw this round" : "Finish the draw"}
                    </button>
                  )}
                  {c.state === "running" && c.winnerDrawn && me?.seat === c.winnerIndex && (
                    <button className="primary" disabled={busy !== null} onClick={() => collect(c)}>
                      {busy === key + "collect" ? "..." : `Take ${formatCook(c.pot)} COOK`}
                    </button>
                  )}
                  {me && !me.active && (
                    <button className="ghost" disabled={busy !== null} onClick={() => topUp(c)}>
                      {busy === key + "topup" ? "..." : "Put collateral back"}
                    </button>
                  )}
                  {c.state === "finished" && me && me.collateral > 0 && (
                    <button className="primary" disabled={busy !== null} onClick={() => takeBond(c)}>
                      {busy === key + "bond" ? "..." : `Take back ${formatCook(me.collateral)} COOK`}
                    </button>
                  )}
                  <button className="ghost" onClick={() => setOpen(expanded ? null : key)}>
                    {expanded ? "Hide the books" : "Open the books"}
                  </button>
                </div>

                {c.state === "running" && c.winnerDrawn && (
                  <div className="banner info" style={{ marginTop: 10 }}>
                    Seat {c.winnerIndex} has this round.
                  </div>
                )}

                {expanded && (
                  <Books
                    circle={c}
                    board={board}
                    owner={owner}
                    roundOver={roundOver}
                    busy={busy}
                    onChase={(m) => chase(c, m)}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

/**
 * The public ledger. In a real arisan this is a notebook somebody keeps and
 * everybody has to trust. Here it is the chain, so every member can see exactly
 * who has paid, who has missed, and who has already had a turn.
 */
function Books({
  circle, board, owner, roundOver, busy, onChase,
}: {
  circle: CircleView;
  board: MemberView[];
  owner: PublicKey | null;
  roundOver: boolean;
  busy: string | null;
  onChase: (m: MemberView) => void;
}) {
  if (board.length === 0) {
    return <p className="muted" style={{ marginTop: 12 }}>Nobody has joined yet.</p>;
  }

  return (
    <div style={{ marginTop: 14, borderTop: "2px solid var(--dough-dark)", paddingTop: 12 }}>
      {board.map((m) => {
        const owes = circle.state === "running" && m.paidRound < circle.round;
        const isMe = owner?.equals(m.wallet) ?? false;
        return (
          <div key={m.seat} className="spread" style={{ padding: "7px 0", alignItems: "center" }}>
            <span className="mono">
              seat {m.seat} · {m.wallet.toBase58().slice(0, 4)}…{m.wallet.toBase58().slice(-4)}
              {isMe && <strong> (you)</strong>}
            </span>
            <span className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
              {m.hasWon && <span className="pill closed">had a turn</span>}
              {m.roundsMissed > 0 && (
                <span className="pill lucky">missed {m.roundsMissed}</span>
              )}
              {/* Only ever says paid when they actually paid. A round settled by
                  slashing their collateral is a miss, not a payment, and
                  labelling it "paid" would quietly launder the one fact the
                  group most needs to see. */}
              {owes
                ? <span className="pill lucky">owes round {circle.round}</span>
                : circle.state === "running" && m.roundsPaid >= circle.round
                  ? <span className="pill prop">paid {m.roundsPaid}</span>
                  : circle.state === "running" && (
                      <span className="pill closed">covered from collateral</span>
                    )}
              <span className="mono">{formatCook(m.collateral)} held</span>
              {owes && roundOver && (
                <button
                  className="ghost"
                  style={{ padding: "4px 10px", fontSize: 12 }}
                  disabled={busy !== null}
                  onClick={() => onChase(m)}
                >
                  {busy === circle.address.toBase58() + "slash" + m.seat
                    ? "..."
                    : "Take it from their collateral"}
                </button>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function NewCircle({
  program, owner, submit, onDone,
}: Omit<Props, "onChanged"> & { onDone: () => void }) {
  const [name, setName] = useState("");
  const [contribution, setContribution] = useState("10");
  const [collateral, setCollateral] = useState("10");
  const [seats, setSeats] = useState("5");
  const [days, setDays] = useState("30");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const create = async () => {
    if (!owner) return;
    const amount = Number(contribution);
    const bond = Number(collateral);
    const count = Math.round(Number(seats));
    const roundSeconds = Math.round(Number(days) * 86400);

    if (!name.trim()) { setErr("Give the circle a name."); return; }
    if (!Number.isFinite(amount) || amount <= 0) { setErr("Set the amount each round."); return; }
    if (bond < amount) { setErr("Collateral has to cover at least one round, or it guarantees nothing."); return; }
    if (!Number.isFinite(count) || count < 2 || count > 100) { setErr("Between 2 and 100 seats."); return; }
    if (roundSeconds < 60) { setErr("A round has to be at least a minute."); return; }

    setErr(null);
    setBusy(true);
    try {
      const id = Math.floor(Date.now() / 1000);
      const circle = findCircle(owner, id);
      await submit(
        async (payer) => [
          await program.methods
            .createCircle(bn(id), name.slice(0, 48), bn(toLamports(amount)),
              bn(toLamports(bond)), count, bn(roundSeconds))
            .accountsPartial({
              creator: owner, payer, config: findConfig(), circle,
              pot: findPot(circle), bond: findBond(circle),
              systemProgram: SystemProgram.programId,
            })
            .instruction(),
        ],
        "circle",
        "createCircle",
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
      <strong>Start a circle</strong>
      <p className="muted" style={{ marginTop: 4 }}>
        Everything you set here is frozen the moment it is created. You will not
        be able to raise the amount or weaken the collateral afterwards, which is
        the reason anyone should be willing to join yours.
      </p>

      {err && <div className="banner warn">{err}</div>}

      <label>Name</label>
      <input value={name} onChange={(e) => setName(e.target.value)}
             maxLength={48} placeholder="Arisan Warga RT 04" />

      <div className="row" style={{ gap: 12 }}>
        <div style={{ flex: 1 }}>
          <label>Each round (COOK)</label>
          <input value={contribution} onChange={(e) => setContribution(e.target.value)} inputMode="decimal" />
        </div>
        <div style={{ flex: 1 }}>
          <label>Collateral to join</label>
          <input value={collateral} onChange={(e) => setCollateral(e.target.value)} inputMode="decimal" />
        </div>
      </div>

      <div className="row" style={{ gap: 12 }}>
        <div style={{ flex: 1 }}>
          <label>Seats</label>
          <input value={seats} onChange={(e) => setSeats(e.target.value)} inputMode="numeric" />
        </div>
        <div style={{ flex: 1 }}>
          <label>Days per round</label>
          <input value={days} onChange={(e) => setDays(e.target.value)} inputMode="decimal" />
        </div>
      </div>

      <p className="muted" style={{ marginTop: 10 }}>
        Higher collateral makes the circle safer for everybody and harder to
        join. One round's worth is the floor the program enforces.
      </p>

      <button className="primary" style={{ marginTop: 8 }} disabled={busy || !owner} onClick={create}>
        {busy ? "Creating..." : "Create it"}
      </button>
      {!owner && <div className="muted" style={{ marginTop: 8 }}>Connect a wallet first.</div>}
    </div>
  );
}

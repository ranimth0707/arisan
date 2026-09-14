import { useCallback, useEffect, useState } from "react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { Icon, type Navigate } from "./UI";
import { PublicKey, SystemProgram } from "@solana/web3.js";

import {
  assertCanAfford, bn, connection, countdown, findBond, findRoom,
  findMember, findPot, findRoster, findSafety, formatCook, hashInviteCode,
  readableError, SLOT_HASHES,
  type CookieJarProgram,
} from "../lib/cookiejar";
import type { RentKind } from "../hooks/useCookieJar";
import type { InstructionBuilder } from "../lib/send";
import { claimBlocker, drawPhase, TURN_CLAIM_WINDOW } from "../lib/circle-progress";

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

export interface CircleRoomView {
  circle: PublicKey;
  creator: PublicKey;
  description: string;
  socialUrl: string;
  inviteCodeHash: number[];
}

interface CircleSafetyView {
  protected: boolean;
  requiredReserve: number;
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
): Promise<Record<string, MemberView[]>> {
  const raw = await program.account.member.all();
  const boards: Record<string, MemberView[]> = {};
  for (const m of raw) {
    const key = m.account.circle.toBase58();
    (boards[key] ??= []).push({
      wallet: m.account.wallet,
      seat: m.account.seat,
      collateral: m.account.collateral.toNumber(),
      paidRound: m.account.paidRound,
      roundsPaid: m.account.roundsPaid,
      roundsMissed: m.account.roundsMissed,
      hasWon: m.account.hasWon,
      active: m.account.active,
    });
  }
  for (const board of Object.values(boards)) board.sort((a, b) => a.seat - b.seat);
  return boards;
}

async function loadRooms(program: CookieJarProgram): Promise<CircleRoomView[]> {
  const raw = await program.account.circleRoom.all();
  return raw.map((room) => ({
    circle: room.account.circle,
    creator: room.account.creator,
    description: room.account.description,
    socialUrl: room.account.socialUrl,
    inviteCodeHash: Array.from(room.account.inviteCodeHash),
  }));
}

async function loadSafeties(program: CookieJarProgram): Promise<Record<string, CircleSafetyView>> {
  const raw = await program.account.circleSafety.all();
  return Object.fromEntries(raw.map((s) => [s.account.circle.toBase58(), {
    protected: s.account.protected,
    requiredReserve: s.account.requiredReserve.toNumber(),
  }]));
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
  mode: "home" | "campaigns" | "join";
  navigate: Navigate;
}

export function Circles({ program, owner, submit, onChanged, mode, navigate }: Props) {
  const [circles, setCircles] = useState<CircleView[] | null>(null);
  const [rooms, setRooms] = useState<Record<string, CircleRoomView>>({});
  const [members, setMembers] = useState<Record<string, MemberView[]>>({});
  const [safeties, setSafeties] = useState<Record<string, CircleSafetyView>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [roomCode, setRoomCode] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    if (mode !== "join" || !selected) return;
    const room = document.getElementById("room-" + selected);
    room?.focus({ preventScroll: true });
    room?.scrollIntoView({ block: "start", behavior: "instant" });
  }, [mode, selected]);
  const [opening, setOpening] = useState(false);
  const [filter, setFilter] = useState<"mine" | "opened">("mine");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const [accessCodes, setAccessCodes] = useState<Record<string, string>>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("arisan-room-codes") ?? "{}");
      return Object.fromEntries(Object.entries(saved ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
    }
    catch { return {}; }
  });
  const [hiddenCircles, setHiddenCircles] = useState<Record<string, boolean>>(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem("arisan-hidden-circles") ?? "{}");
      if (!saved || typeof saved !== "object") return {};
      return Object.fromEntries(Object.entries(saved).filter((entry): entry is [string, boolean] => entry[1] === true));
    }
    catch { return {}; }
  });
  const [showHidden, setShowHidden] = useState(false);

  const [syncError, setSyncError] = useState(false);
  const [slot, setSlot] = useState<number | null>(null);
  const refresh = useCallback(async (silent = false) => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const [list, roomList, boards, currentSlot, safetyList] = await Promise.race([
        Promise.all([loadCircles(program), loadRooms(program), loadMembers(program), connection.getSlot("confirmed"), loadSafeties(program)]),
        new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("The network is slow. Reload the campaign and try again.")), 12000); }),
      ]);
      setRooms(Object.fromEntries(roomList.map((room) => [room.circle.toBase58(), room])));
      setMembers(boards);
      setSafeties(safetyList);
      setCircles(list);
      setSlot(currentSlot);
      setSyncError(false);
      if (!silent) setErr(null);
    } catch (e) {
      setSyncError(true);
      if (!silent) { setCircles(current => current ?? []); setErr(readableError(e)); }
    } finally { clearTimeout(timeout); }
  }, [program]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => { if (!document.hidden) void refresh(true); }, 15000);
    return () => clearInterval(timer);
  }, [refresh]);

  const rememberAccess = (circle: PublicKey, code: string) => {
    const next = { ...accessCodes, [circle.toBase58()]: code };
    setAccessCodes(next);
    try { localStorage.setItem("arisan-room-codes", JSON.stringify(next)); } catch { /* In-memory access is sufficient for this session. */ }
  };

  const openRoom = async () => {
    setOpening(true); setErr(null);
    try {
      if (!roomCode.trim()) throw new Error("Enter the creator's code first.");
      const hash = await hashInviteCode(roomCode);
      const room = Object.values(rooms).find(candidate => candidate.inviteCodeHash.every((v, i) => v === hash[i]));
      if (!room) throw new Error("Code not found. Check it or ask the creator for the correct code.");
      rememberAccess(room.circle, roomCode.trim());
      setSelected(room.circle.toBase58());
      setOpen(null);
      setNote("Campaign found. Read the rules below before joining.");
    } catch (e) { setErr(readableError(e)); } finally { setOpening(false); }
  };

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
      return true;
    } catch (e) {
      setErr(readableError(e));
      return false;
    } finally {
      setBusy(null);
    }
  };

  const join = (c: CircleView) => {
    const key = c.address.toBase58();
    const isCreator = owner?.equals(c.creator) ?? false;
    const room = rooms[key];
    if (!owner || !room || (!accessCodes[key] && !isCreator)) return;
    return run(
      key + "join",
      async (payer) => {
        if (c.collateral > 0) await assertCanAfford(owner, c.collateral, "post the collateral for this circle");
        const inviteCodeHash = accessCodes[key]
          ? await hashInviteCode(accessCodes[key])
          : room.inviteCodeHash;
        return [await program.methods.joinCircle(inviteCodeHash).accountsPartial({
          member: owner, payer, circle: c.address, bond: findBond(c.address),
          membership: findMember(c.address, owner), room: findRoom(c.address),
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
      async (payer) => [await program.methods.startCircle()
        .accountsPartial({
          starter: owner, payer, circle: c.address, roster: findRoster(c.address),
          safety: findSafety(c.address), bond: findBond(c.address),
          systemProgram: SystemProgram.programId,
        }).instruction()],
      "circleRoster",
      "startCircle",
    );

  const ensureRoster = async (c: CircleView, payer: PublicKey) => {
    const roster = findRoster(c.address);
    const safety = findSafety(c.address);
    const [existing, existingSafety] = await Promise.all([
      program.account.circleRoster.fetchNullable(roster),
      program.account.circleSafety.fetchNullable(safety),
    ]);
    if (existing?.ready && existingSafety?.protected) return [];

    const board = members[c.address.toBase58()] ?? [];
    if (board.length !== c.memberCount) {
      throw new Error("The member ledger is incomplete. Reload the campaign and try again.");
    }

    const setup = [];
    if (!existing) {
      setup.push(await program.methods.initializeCircleRoster().accountsPartial({
        payer, circle: c.address, roster, safety, bond: findBond(c.address),
        systemProgram: SystemProgram.programId,
      }).instruction());
    }
    if (!existingSafety && existing) {
      setup.push(await program.methods.initializeCircleSafety().accountsPartial({
        payer, circle: c.address, bond: findBond(c.address), safety,
        systemProgram: SystemProgram.programId,
      }).remainingAccounts(board.map(member => ({
        pubkey: findMember(c.address, member.wallet),
        isSigner: false,
        isWritable: false,
      }))).instruction());
    }
    // A newly-created roster still needs the winner bitmap imported. An
    // existing unprotected roster is also allowed through this same path so
    // members can top up before the first post-upgrade draw.
    if (!existing || !existing.ready || Boolean(existingSafety && !existingSafety.protected)) {
      setup.push(await program.methods.syncCircleMembers().accountsPartial({
        payer, circle: c.address, roster, safety, bond: findBond(c.address),
      }).remainingAccounts(board.map(member => ({
        pubkey: findMember(c.address, member.wallet),
        isSigner: false,
        isWritable: false,
      }))).instruction());
    }
    return setup;
  };

  // Anyone can run these. That is what stops a circle stalling on an absent
  // organiser, so the buttons are shown to everybody, member or not.
  const draw = async (c: CircleView) => {
    let requested = false;
    const [rosterAccount, safetyAccount] = await Promise.all([
      program.account.circleRoster.fetchNullable(findRoster(c.address)),
      program.account.circleSafety.fetchNullable(findSafety(c.address)),
    ]);
    const protectedCircle = Boolean(rosterAccount?.ready && safetyAccount?.protected);
    const setupRent: RentKind = rosterAccount ? safetyAccount ? "none" : "circleSafety" : "circleRoster";
    return run(
      c.address.toBase58() + "draw",
      async (payer) => {
        // Another member may have advanced the room, or the 300-slot window
        // may have expired while this tab or a wallet approval stayed open.
        const [latest, currentSlot] = await Promise.all([program.account.circle.fetch(c.address), connection.getSlot("confirmed")]);
        if (latest.winnerDrawn) throw new Error("The draw is already complete. Reload the campaign to see the recipient.");
        const phase = drawPhase(latest.drawTargetSlot.toNumber(), currentSlot);
        if (phase === "waiting") throw new Error("The draw is waiting for the next block. Try again in a few seconds.");
        requested = phase === "request" || phase === "expired";
        const setup = await ensureRoster(c, payer);
        const turn = requested
          ? await program.methods.requestTurn().accountsPartial({
              circle: c.address, safety: findSafety(c.address), bond: findBond(c.address),
            }).instruction()
          : await program.methods.finalizeTurn().accountsPartial({
              circle: c.address, roster: findRoster(c.address), safety: findSafety(c.address),
              bond: findBond(c.address), slotHashes: SLOT_HASHES,
            }).instruction();
        return [...setup, turn];
      },
      protectedCircle ? "none" : setupRent,
      c.drawTargetSlot === 0 ? "requestTurn" : "finalizeTurn",
    ).then(success => {
      if (success && requested) {
        setNote("The draw has started. Wait a few seconds, then choose Finish the draw. Complete it before it expires.");
      }
    });
  };

  const redraw = (c: CircleView, winner: MemberView) => run(
    c.address.toBase58() + "redraw",
    async () => [await program.methods.redrawTurn().accountsPartial({
      circle: c.address,
      membership: findMember(c.address, winner.wallet),
    }).instruction()],
    "none", "redrawTurn",
  ).then(success => { if (success) setNote("The draw was reset. Choose Run the draw to select a seat again."); });

  const collect = async (c: CircleView) => {
    if (!owner) return;
    const [rosterAccount, safetyAccount] = await Promise.all([
      program.account.circleRoster.fetchNullable(findRoster(c.address)),
      program.account.circleSafety.fetchNullable(findSafety(c.address)),
    ]);
    const protectedCircle = Boolean(rosterAccount?.ready && safetyAccount?.protected);
    const setupRent: RentKind = rosterAccount ? safetyAccount ? "none" : "circleSafety" : "circleRoster";
    return run(
      c.address.toBase58() + "collect",
      async (payer) => {
        const setup = await ensureRoster(c, payer);
        const claim = await program.methods.claimTurn().accountsPartial({
          winner: owner, circle: c.address, pot: findPot(c.address),
          roster: findRoster(c.address),
          safety: findSafety(c.address),
          membership: findMember(c.address, owner),
          systemProgram: SystemProgram.programId,
        }).instruction();
        return [...setup, claim];
      },
      protectedCircle ? "none" : setupRent,
      "claimTurn",
    );
  };

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
        const me = (members[c.address.toBase58()] ?? []).find(member => member.wallet.equals(owner));
        const required = c.contribution * Math.max(0, c.memberCount - c.winnersSoFar);
        const amount = Math.max(0, required - (me?.collateral ?? 0));
        if (amount <= 0) throw new Error("Your reserve already covers the remaining obligations.");
        await assertCanAfford(owner, amount, "complete your remaining reserve");
        return [await program.methods.topUpBond(bn(amount)).accountsPartial({
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

  const toggleHidden = (c: CircleView) => {
    if (c.state !== "finished") return;
    const key = c.address.toBase58();
    const next = { ...hiddenCircles };
    if (next[key]) delete next[key];
    else next[key] = true;
    setHiddenCircles(next);
    try { localStorage.setItem("arisan-hidden-circles", JSON.stringify(next)); } catch { /* In-memory state still works for this session. */ }
    setOpen(null);
  };

  const mineAll = (circles ?? []).filter(c => owner && (c.creator.equals(owner) || members[c.address.toBase58()]?.some(m => m.wallet.equals(owner))));
  const openedAll = (circles ?? []).filter(c => Boolean(accessCodes[c.address.toBase58()]));
  const hideUnlessRequested = (c: CircleView) => showHidden || !hiddenCircles[c.address.toBase58()];
  const mine = mineAll.filter(hideUnlessRequested);
  const opened = openedAll.filter(hideUnlessRequested);
  const visible = mode === "join" ? (circles ?? []).filter(c => c.address.toBase58() === selected) : filter === "opened" ? opened : mine;
  return (
    <>
      {mode === "join" && <section className="join-panel">
        <span className="action-icon"><Icon name="enter" /></span>
        <h2>Have an Arisan invite?</h2>
        <p>The campaign creator gives you the code. Entering it does not move COOK or make you a member.</p>
        <form onSubmit={e => { e.preventDefault(); void openRoom(); }}>
          <label htmlFor="room-code">Room code</label>
          <div className="code-copy"><input id="room-code" value={roomCode} onChange={e => setRoomCode(e.target.value)} placeholder="ARISAN-ABCD-2345" autoComplete="off" spellCheck={false} /><button className="primary" disabled={opening || circles === null || !roomCode.trim()} aria-busy={opening}>{opening ? "Searching…" : "Open room"}<Icon name="arrow" /></button></div>
        </form>
        <div className="demo-shortcut"><span>Want to try it? Demo code: <code>ARISAN-DEMO-9002</code></span><button className="text-button" onClick={() => setRoomCode("ARISAN-DEMO-9002")}>Use code</button></div>
        <a href="#guide">Not sure how it works? Open the guide.</a>
      </section>}
      {err && <div className="banner warn" role="alert">{err} <button className="text-button" onClick={() => void refresh()}>Reload</button></div>}
      {note && <div className="banner info" role="status">{note}</div>}
      {circles !== null && <div className="sync-status"><span>{syncError ? "Updates are disconnected; this data may be out of date." : "Status updates automatically every 15 seconds."}</span><button className="text-button" onClick={() => void refresh()}>Reload</button></div>}
      {mode !== "join" && <div className="section-heading"><h2>{mode === "home" ? "My campaigns" : "Arisan rooms"} <span className="count">{mine.length}</span></h2><a href="#create" className="text-action"><Icon name="plus" />Create campaign</a></div>}
      {mode === "campaigns" && <>
        <div className="segmented"><button onClick={() => setFilter("mine")} aria-pressed={filter === "mine"}>Created / joined</button><button onClick={() => setFilter("opened")} aria-pressed={filter === "opened"}>Opened invites</button></div>
        {mineAll.some(c => hiddenCircles[c.address.toBase58()]) && <button className="text-button hidden-toggle" type="button" onClick={() => setShowHidden(value => !value)}>{showHidden ? "Hide completed" : `Show hidden (${mineAll.filter(c => hiddenCircles[c.address.toBase58()]).length})`}</button>}
      </>}
      {circles === null ? <div className="skeleton-list" role="status"><span>Loading campaigns…</span><div /><div /></div> : visible.length === 0 ? (
        mode === "join" ? null : <div className="empty"><span className="empty-symbol"><Icon name="circles" /></span><h3>{owner ? "No campaigns here yet." : "Your Arisan groups will appear here."}</h3><p>{owner ? "Create a new campaign or enter a code from a creator." : "Connect a wallet to see campaigns you created and joined."}</p><div className="row">{!owner && <WalletMultiButton>Connect wallet</WalletMultiButton>}<button className="ghost" onClick={() => navigate("create")}>Create campaign</button><button className="text-button" onClick={() => navigate("join")}>I have a code<Icon name="arrow" /></button></div></div>
      ) : (
        <div className="campaign-list">
          {visible.map((c) => {
            const key = c.address.toBase58();
            const board = members[key] ?? [];
            const me = owner ? board.find((m) => m.wallet.equals(owner)) : undefined;
            const roundOver = c.nextPayoutTs > 0 && now / 1000 >= c.nextPayoutTs;
            const owed = me && c.state === "running" && me.paidRound < c.round;
            const isCreator = owner?.equals(c.creator) ?? false;
            const expanded = open === key;
            const room = rooms[key];
            const unlocked = Boolean(room && (accessCodes[key] || me || isCreator));
            const phase = drawPhase(c.drawTargetSlot, slot);
            const winner = board.find(member => member.seat === c.winnerIndex);
            const blockedClaim = claimBlocker(winner, c.round);
            const redrawAt = c.nextPayoutTs + TURN_CLAIM_WINDOW;
            const remainingTurns = Math.max(0, c.memberCount - c.winnersSoFar);
            const requiredReservePerMember = c.contribution * remainingTurns;
            const reserveShortfall = me ? Math.max(0, requiredReservePerMember - me.collateral) : 0;
            const safety = safeties[key];

            return (
              <article className="circle-card" key={key} id={"room-" + key} tabIndex={-1} aria-label={"Detail campaign " + c.name}>
                <div className="spread">
                  <div className="circle-title"><span className="avatar">{c.name.charAt(0)}</span><div><strong className="circle-name">{c.name}</strong><span className="muted">{isCreator ? "Created by you" : me ? "You are a member" : "Invited campaign"}</span></div></div>
                  <span className={`pill ${c.state === "running" ? "prop" : c.state === "forming" ? "lucky" : "closed"}`}>
                    {c.state === "forming" ? (c.memberCount >= c.maxMembers ? "Room full" : "Accepting members") : c.state === "running" ? `Round ${c.round}` : "Finished"}
                  </span>
                </div>

                <div className="circle-metrics">
                  <div className="metric"><div className="stat">Contribution per round<b>{formatCook(c.contribution)} <small>COOK</small></b></div></div>
                  <div className="metric"><div className="stat">Current pool<b>{formatCook(c.pot)} <small>COOK</small></b></div></div>
                  <div className="metric"><div className="stat">Members<b>{c.memberCount}/{c.maxMembers}</b></div></div>
                </div>

                <div className="circle-timing">
                  {c.state === "forming"
                    ? `Reserve when joining: ${formatCook(c.collateral)} COOK per member · Round ${c.roundSeconds < 3600 ? Math.round(c.roundSeconds / 60) + " minute" : c.roundSeconds < 86400 ? Math.round(c.roundSeconds / 3600) + " hour" : Math.round(c.roundSeconds / 86400) + " day"}`
                    : c.state === "running"
                      ? roundOver
                        ? "Round deadline has passed"
                        : `${countdown(c.nextPayoutTs)} left in this round`
                      : `${c.winnersSoFar} turns complete`}
                </div>

                <p className="circle-commitment">
                  <strong>{c.state === "forming" ? "If started now" : "Each member's commitment"}:</strong>{" "}
                  {c.memberCount} rounds × {formatCook(c.contribution)} COOK = {formatCook(c.memberCount * c.contribution)} COOK total.
                  Previous recipients are automatically removed from future draws. The creator cannot withdraw the pool. The reserve is not a fee: if everyone follows the rules, the unused balance returns after completion. New rounds stay locked until every member's reserve covers the remaining obligations.
                </p>

                {room ? (
                  <div className="room-details">
                    <span className="room-author">Creator {room.creator.toBase58().slice(0, 4)}…{room.creator.toBase58().slice(-4)}</span>
                    <p>{room.description}</p>
                    <a href={room.socialUrl} target="_blank" rel="noreferrer">View creator's post ↗</a>
                  </div>
                ) : (
                  <div className="banner warn room-warning">
                    This legacy campaign has no room details yet. Contact the creator before inviting new members.
                  </div>
                )}

                {owed && (
                  <div className="banner warn" style={{ marginBottom: 10 }}>
                    Round {c.round} contribution: {formatCook(c.contribution)} COOK unpaid.
                  </div>
                )}
                {me && !me.active && (
                  <div className="banner warn" style={{ marginBottom: 10 }}>
                    Your reserve is too low. Top it up before collecting a turn.
                  </div>
                )}
                {c.state === "running" && (!safety || !safety.protected) && (
                  <div className="banner warn" style={{ marginBottom: 10 }}>
                    Campaign temporarily locked: reserves are not sufficient to protect the other members. Repair the shortfall, then anyone can continue the ledger.
                  </div>
                )}

                {c.state === "forming" && <p className="next-action"><strong>Next step: </strong>{c.memberCount >= c.maxMembers ? "Room is full. Wait for the creator to start the Arisan." : me ? "You have joined. Wait for the creator to start after at least two members join." : isCreator ? "This legacy campaign does not list the creator as a member. Join now so your seat is counted." : "Read the post and rules. Joining moves the reserve from your wallet."}</p>}
                {c.state === "running" && !c.winnerDrawn && <p className="next-action"><strong>Next step: </strong>{!roundOver ? "Pay the contribution, then wait for the round deadline before running the draw." : phase === "expired" ? "The previous draw expired. Restart the draw to continue." : c.drawTargetSlot ? "The draw has started. Finish it to see the recipient seat." : `${c.paidThisRound}/${c.memberCount} members have contributed. Run and finish the draw, then the recipient can collect the pool.`}</p>}
                {isCreator && accessCodes[key] && <details className="invite-details"><summary>Group invite code</summary><code>{accessCodes[key]}</code><p>Save the code and share it with the members you invited.</p></details>}
                <div className="actions">
                  {!owner && <WalletMultiButton>Connect wallet to join</WalletMultiButton>}
                  {c.state === "forming" && owner && !me && unlocked && c.memberCount < c.maxMembers && (
                    <button className="primary" disabled={busy !== null} onClick={() => join(c)}>
                      {busy === key + "join" ? "…" : isCreator ? "Join as creator" : `Join room · ${formatCook(c.collateral)} COOK`}
                    </button>
                  )}
                  {c.state === "forming" && owner && !me && !unlocked && room && (
                    <span className="room-lock">Enter the creator's code to join</span>
                  )}
                  {c.state === "forming" && owner && c.memberCount >= 2 && (isCreator || c.memberCount >= c.maxMembers) && (
                    <button className="primary" disabled={busy !== null} onClick={() => start(c)}>
                      {busy === key + "start" ? "..." : "Start Arisan"}
                    </button>
                  )}
                  {owed && (
                    <button className="primary" disabled={busy !== null} onClick={() => pay(c)}>
                      {busy === key + "pay" ? "..." : "Pay contribution"}
                    </button>
                  )}
                  {owner && c.state === "running" && roundOver && !c.winnerDrawn && (
                    <button className="primary" disabled={busy !== null || phase === "waiting" || phase === "loading"} onClick={() => draw(c)}>
                      {busy === key + "draw"
                        ? "..."
                        : phase === "request" ? "Run the draw" : phase === "expired" ? "Restart the draw" : phase === "waiting" || phase === "loading" ? "Waiting for block…" : "Finish the draw"}
                    </button>
                  )}
                  {c.state === "running" && c.winnerDrawn && me?.seat === c.winnerIndex && !blockedClaim && c.pot > 0 && (
                    <button className="primary" disabled={busy !== null} onClick={() => collect(c)}>
                      {busy === key + "collect" ? "..." : `Collect turn · ${formatCook(c.pot)} COOK`}
                    </button>
                  )}
                  {owner && winner && c.state === "running" && c.winnerDrawn && (Boolean(blockedClaim) || now / 1000 >= redrawAt) && <button className="ghost" disabled={busy !== null} onClick={() => redraw(c, winner)}>{busy === key + "redraw" ? "…" : blockedClaim ? "Remove seat & redraw" : "Draw again"}</button>}
                  {me && reserveShortfall > 0 && (
                    <button className="ghost" disabled={busy !== null} onClick={() => topUp(c)}>
                      {busy === key + "topup" ? "..." : `Top up reserve · ${formatCook(reserveShortfall)} COOK`}
                    </button>
                  )}
                  {c.state === "finished" && me && me.collateral > 0 && (
                    <button className="primary" disabled={busy !== null} onClick={() => takeBond(c)}>
                      {busy === key + "bond" ? "..." : `Withdraw reserve · ${formatCook(me.collateral)} COOK`}
                    </button>
                  )}
                  {c.state === "finished" && (me || isCreator) && (
                    <button className="ghost" disabled={busy !== null} onClick={() => toggleHidden(c)}>
                      {hiddenCircles[key] ? "Show in my list" : "Hide from my list"}
                    </button>
                  )}
                  <button className="ghost" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : key)}>
                    {expanded ? "Close ledger" : "View members & ledger"}
                  </button>
                </div>

                {c.state === "running" && c.winnerDrawn && (
                  <div className="banner info" style={{ marginTop: 10 }}>
                    <strong>Seat {c.winnerIndex + 1} selected.</strong> {blockedClaim ?? (me?.seat === c.winnerIndex ? "You can collect the pool with the Collect turn button." : `Waiting for ${winner?.wallet.toBase58().slice(0, 4)}…${winner?.wallet.toBase58().slice(-4)} to collect the pool.`)}
                    {blockedClaim && <p>{winner?.hasWon ? "This seat will not enter future draws. Remove it now and start a new draw." : now / 1000 >= redrawAt ? "The claim window has passed. Use Draw again to try another seat." : "This seat is not eligible and can be removed from the draw result."}</p>}
                    {c.pot === 0 && <p>The pool is empty. Members need to contribute first.</p>}
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
              </article>
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
 * who has paid, who has missed, and who has already received a turn.
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
    return <p className="muted" style={{ marginTop: 12 }}>No members have joined yet.</p>;
  }

  return (
    <div className="books">
      {board.map((m) => {
        const owes = circle.state === "running" && m.paidRound < circle.round;
        const isMe = owner?.equals(m.wallet) ?? false;
        return (
          <div key={m.seat} className="book-row">
            <span className="mono book-wallet">
              seat {m.seat + 1} · {m.wallet.toBase58().slice(0, 4)}…{m.wallet.toBase58().slice(-4)}
              {isMe && <strong> (you)</strong>}
            </span>
            <span className="book-status">
              {m.hasWon && <span className="pill closed">received</span>}
              {m.roundsMissed > 0 && (
                <span className="pill lucky">missed {m.roundsMissed}</span>
              )}
              {/* Only ever says paid when they actually paid. A round settled by
                  slashing their collateral is a miss, not a payment, and
                  labelling it "paid" would quietly launder the one fact the
                  group most needs to see. */}
              {owes
                ? <span className="pill lucky">round {circle.round} unpaid</span>
                : circle.state === "running" && m.roundsPaid >= circle.round
                  ? <span className="pill prop">paid {m.roundsPaid} times</span>
                  : circle.state === "running" && m.paidRound >= circle.round
                    ? <span className="pill lucky">covered from reserve</span>
                    : circle.state === "running" && (
                        <span className="pill closed">payment history incomplete</span>
                      )}
              <span className="mono">reserve {formatCook(m.collateral)} COOK</span>
              {owes && roundOver && (
                <button
                  className="ghost"
                  disabled={busy !== null}
                  onClick={() => onChase(m)}
                >
                  {busy === circle.address.toBase58() + "slash" + m.seat
                    ? "..."
                    : m.collateral > 0 ? "Cover from reserve" : "Mark as missed"}
                </button>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

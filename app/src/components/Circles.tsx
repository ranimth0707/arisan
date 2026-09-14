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

  const [syncError, setSyncError] = useState(false);
  const [slot, setSlot] = useState<number | null>(null);
  const refresh = useCallback(async (silent = false) => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const [list, roomList, boards, currentSlot, safetyList] = await Promise.race([
        Promise.all([loadCircles(program), loadRooms(program), loadMembers(program), connection.getSlot("confirmed"), loadSafeties(program)]),
        new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("Jaringan sedang lambat. Coba muat ulang campaign.")), 12000); }),
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
      if (!roomCode.trim()) throw new Error("Masukkan kode dari creator terlebih dahulu.");
      const hash = await hashInviteCode(roomCode);
      const room = Object.values(rooms).find(candidate => candidate.inviteCodeHash.every((v, i) => v === hash[i]));
      if (!room) throw new Error("Kode belum ditemukan. Periksa kembali atau minta kode yang benar ke creator.");
      rememberAccess(room.circle, roomCode.trim());
      setSelected(room.circle.toBase58());
      setOpen(null);
      setNote("Campaign ditemukan. Baca aturan di bawah sebelum bergabung.");
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
      throw new Error("Pembukuan anggota belum lengkap. Muat ulang campaign lalu coba lagi.");
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
        if (latest.winnerDrawn) throw new Error("Undian sudah selesai. Muat ulang campaign untuk melihat penerimanya.");
        const phase = drawPhase(latest.drawTargetSlot.toNumber(), currentSlot);
        if (phase === "waiting") throw new Error("Undian sedang menunggu blok berikutnya. Coba lagi beberapa detik lagi.");
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
        setNote("Undian dimulai. Tunggu beberapa detik, lalu pilih Selesaikan undian. Selesaikan segera agar tidak kedaluwarsa.");
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
  ).then(success => { if (success) setNote("Undian direset. Pilih Mulai undian untuk menentukan kursi lagi."); });

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
        if (amount <= 0) throw new Error("Cadanganmu sudah mencukupi untuk kewajiban tersisa.");
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

  const mine = (circles ?? []).filter(c => owner && (c.creator.equals(owner) || members[c.address.toBase58()]?.some(m => m.wallet.equals(owner))));
  const opened = (circles ?? []).filter(c => Boolean(accessCodes[c.address.toBase58()]));
  const visible = mode === "join" ? (circles ?? []).filter(c => c.address.toBase58() === selected) : filter === "opened" ? opened : mine;
  return (
    <>
      {mode === "join" && <section className="join-panel">
        <span className="action-icon"><Icon name="enter" /></span>
        <h2>Punya undangan arisan?</h2>
        <p>Kode diberikan oleh creator campaign. Memasukkan kode belum memindahkan COOK atau membuatmu menjadi anggota.</p>
        <form onSubmit={e => { e.preventDefault(); void openRoom(); }}>
          <label htmlFor="room-code">Kode room</label>
          <div className="code-copy"><input id="room-code" value={roomCode} onChange={e => setRoomCode(e.target.value)} placeholder="ARISAN-ABCD-2345" autoComplete="off" spellCheck={false} /><button className="primary" disabled={opening || circles === null || !roomCode.trim()} aria-busy={opening}>{opening ? "Mencari…" : "Buka room"}<Icon name="arrow" /></button></div>
        </form>
        <div className="demo-shortcut"><span>Ingin mencoba? Kode demo: <code>ARISAN-DEMO-9002</code></span><button className="text-button" onClick={() => setRoomCode("ARISAN-DEMO-9002")}>Gunakan kode</button></div>
        <a href="#guide">Belum paham cara ikut? Buka panduan.</a>
      </section>}
      {err && <div className="banner warn" role="alert">{err} <button className="text-button" onClick={() => void refresh()}>Muat ulang</button></div>}
      {note && <div className="banner info" role="status">{note}</div>}
      {circles !== null && <div className="sync-status"><span>{syncError ? "Pembaruan terputus; data mungkin belum terbaru." : "Status diperbarui otomatis setiap 15 detik."}</span><button className="text-button" onClick={() => void refresh()}>Muat ulang</button></div>}
      {mode !== "join" && <div className="section-heading"><h2>{mode === "home" ? "Campaign saya" : "Room arisan"} <span className="count">{mine.length}</span></h2><a href="#create" className="text-action"><Icon name="plus" />Create campaign</a></div>}
      {mode === "campaigns" && <div className="segmented"><button onClick={() => setFilter("mine")} aria-pressed={filter === "mine"}>Dibuat / diikuti</button><button onClick={() => setFilter("opened")} aria-pressed={filter === "opened"}>Undangan dibuka</button></div>}
      {circles === null ? <div className="skeleton-list" role="status"><span>Memuat campaign…</span><div /><div /></div> : visible.length === 0 ? (
        mode === "join" ? null : <div className="empty"><span className="empty-symbol"><Icon name="circles" /></span><h3>{owner ? "Belum ada campaign di sini." : "Grup arisanmu akan muncul di sini."}</h3><p>{owner ? "Buat campaign baru atau masuk menggunakan kode dari creator." : "Hubungkan wallet untuk melihat campaign yang kamu buat dan ikuti."}</p><div className="row">{!owner && <WalletMultiButton>Hubungkan wallet</WalletMultiButton>}<button className="ghost" onClick={() => navigate("create")}>Create campaign</button><button className="text-button" onClick={() => navigate("join")}>Saya punya kode<Icon name="arrow" /></button></div></div>
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
                  <div className="circle-title"><span className="avatar">{c.name.charAt(0)}</span><div><strong className="circle-name">{c.name}</strong><span className="muted">{isCreator ? "Dibuat oleh kamu" : me ? "Kamu anggota campaign ini" : "Undangan campaign"}</span></div></div>
                  <span className={`pill ${c.state === "running" ? "prop" : c.state === "forming" ? "lucky" : "closed"}`}>
                    {c.state === "forming" ? (c.memberCount >= c.maxMembers ? "Room penuh" : "Menerima anggota") : c.state === "running" ? `Putaran ${c.round}` : "Selesai"}
                  </span>
                </div>

                <div className="circle-metrics">
                  <div className="metric"><div className="stat">Iuran per putaran<b>{formatCook(c.contribution)} <small>COOK</small></b></div></div>
                  <div className="metric"><div className="stat">Kas saat ini<b>{formatCook(c.pot)} <small>COOK</small></b></div></div>
                  <div className="metric"><div className="stat">Anggota<b>{c.memberCount}/{c.maxMembers}</b></div></div>
                </div>

                <div className="circle-timing">
                  {c.state === "forming"
                    ? `Cadangan keamanan saat join: ${formatCook(c.collateral)} COOK per anggota · Putaran ${c.roundSeconds < 3600 ? Math.round(c.roundSeconds / 60) + " menit" : c.roundSeconds < 86400 ? Math.round(c.roundSeconds / 3600) + " jam" : Math.round(c.roundSeconds / 86400) + " hari"}`
                    : c.state === "running"
                      ? roundOver
                        ? "Batas waktu putaran sudah lewat"
                        : `Sisa waktu putaran: ${countdown(c.nextPayoutTs)}`
                      : `Semua ${c.winnersSoFar} giliran selesai`}
                </div>

                <p className="circle-commitment">
                  <strong>{c.state === "forming" ? "Jika dimulai sekarang" : "Komitmen setiap anggota"}:</strong>{" "}
                  {c.memberCount} putaran × {formatCook(c.contribution)} COOK = {formatCook(c.memberCount * c.contribution)} COOK total.
                  Penerima lama otomatis keluar dari undian berikutnya. Creator tidak dapat menarik kas. Cadangan keamanan bukan biaya: jika semua patuh, sisanya kembali setelah selesai. Putaran baru terkunci sampai cadangan semua anggota cukup untuk menutup kewajiban tersisa.
                </p>

                {room ? (
                  <div className="room-details">
                    <span className="room-author">Creator {room.creator.toBase58().slice(0, 4)}…{room.creator.toBase58().slice(-4)}</span>
                    <p>{room.description}</p>
                    <a href={room.socialUrl} target="_blank" rel="noreferrer">Lihat posting creator ↗</a>
                  </div>
                ) : (
                  <div className="banner warn room-warning">
                    Campaign lama ini belum memiliki detail room. Hubungi creator sebelum mengundang anggota baru.
                  </div>
                )}

                {owed && (
                  <div className="banner warn" style={{ marginBottom: 10 }}>
                    Iuran putaran {c.round}: {formatCook(c.contribution)} COOK belum dibayar.
                  </div>
                )}
                {me && !me.active && (
                  <div className="banner warn" style={{ marginBottom: 10 }}>
                    Jaminanmu tidak cukup. Isi ulang agar bisa mengambil giliran.
                  </div>
                )}
                {c.state === "running" && (!safety || !safety.protected) && (
                  <div className="banner warn" style={{ marginBottom: 10 }}>
                    Campaign terkunci sementara: cadangan keamanan belum mencukupi untuk melindungi anggota lain. Lengkapi cadangan yang kurang, lalu siapa pun bisa melanjutkan pembukuan.
                  </div>
                )}

                {c.state === "forming" && <p className="next-action"><strong>Langkah berikutnya: </strong>{c.memberCount >= c.maxMembers ? "Room penuh. Tunggu creator memulai arisan." : me ? "Kamu sudah bergabung. Tunggu creator memulai arisan setelah minimal dua anggota masuk." : isCreator ? "Campaign lama ini belum mencatat creator sebagai anggota. Gabung sekarang agar kursimu ikut dihitung." : "Baca posting dan aturan. Join memindahkan jaminan dari wallet kamu."}</p>}
                {c.state === "running" && !c.winnerDrawn && <p className="next-action"><strong>Langkah berikutnya: </strong>{!roundOver ? "Bayar iuran, lalu tunggu batas waktu putaran untuk memulai undian." : phase === "expired" ? "Undian sebelumnya kedaluwarsa. Mulai ulang undian untuk melanjutkan." : c.drawTargetSlot ? "Undian sudah dimulai. Selesaikan undian untuk melihat kursi penerima." : `Iuran terkumpul dari ${c.paidThisRound}/${c.memberCount} anggota. Mulai undian, selesaikan, lalu penerima mengambil kas.`}</p>}
                {isCreator && accessCodes[key] && <details className="invite-details"><summary>Kode undangan grup</summary><code>{accessCodes[key]}</code><p>Simpan kode dan kirim ke anggota yang kamu undang.</p></details>}
                <div className="actions">
                  {!owner && <WalletMultiButton>Hubungkan wallet untuk ikut</WalletMultiButton>}
                  {c.state === "forming" && owner && !me && unlocked && c.memberCount < c.maxMembers && (
                    <button className="primary" disabled={busy !== null} onClick={() => join(c)}>
                      {busy === key + "join" ? "…" : isCreator ? "Gabung sebagai creator" : `Join room · ${formatCook(c.collateral)} COOK`}
                    </button>
                  )}
                  {c.state === "forming" && owner && !me && !unlocked && room && (
                    <span className="room-lock">Masukkan kode dari creator untuk bergabung</span>
                  )}
                  {c.state === "forming" && owner && c.memberCount >= 2 && (isCreator || c.memberCount >= c.maxMembers) && (
                    <button className="primary" disabled={busy !== null} onClick={() => start(c)}>
                      {busy === key + "start" ? "..." : "Mulai arisan"}
                    </button>
                  )}
                  {owed && (
                    <button className="primary" disabled={busy !== null} onClick={() => pay(c)}>
                      {busy === key + "pay" ? "..." : "Bayar iuran"}
                    </button>
                  )}
                  {owner && c.state === "running" && roundOver && !c.winnerDrawn && (
                    <button className="primary" disabled={busy !== null || phase === "waiting" || phase === "loading"} onClick={() => draw(c)}>
                      {busy === key + "draw"
                        ? "..."
                        : phase === "request" ? "Mulai undian" : phase === "expired" ? "Mulai ulang undian" : phase === "waiting" || phase === "loading" ? "Menunggu blok…" : "Selesaikan undian"}
                    </button>
                  )}
                  {c.state === "running" && c.winnerDrawn && me?.seat === c.winnerIndex && !blockedClaim && c.pot > 0 && (
                    <button className="primary" disabled={busy !== null} onClick={() => collect(c)}>
                      {busy === key + "collect" ? "..." : `Ambil giliran · ${formatCook(c.pot)} COOK`}
                    </button>
                  )}
                  {owner && winner && c.state === "running" && c.winnerDrawn && (Boolean(blockedClaim) || now / 1000 >= redrawAt) && <button className="ghost" disabled={busy !== null} onClick={() => redraw(c, winner)}>{busy === key + "redraw" ? "…" : blockedClaim ? "Keluarkan kursi & undi ulang" : "Undi ulang"}</button>}
                  {me && reserveShortfall > 0 && (
                    <button className="ghost" disabled={busy !== null} onClick={() => topUp(c)}>
                      {busy === key + "topup" ? "..." : `Lengkapi cadangan · ${formatCook(reserveShortfall)} COOK`}
                    </button>
                  )}
                  {c.state === "finished" && me && me.collateral > 0 && (
                    <button className="primary" disabled={busy !== null} onClick={() => takeBond(c)}>
                      {busy === key + "bond" ? "..." : `Tarik jaminan · ${formatCook(me.collateral)} COOK`}
                    </button>
                  )}
                  <button className="ghost" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : key)}>
                    {expanded ? "Tutup pembukuan" : "Lihat anggota & pembukuan"}
                  </button>
                </div>

                {c.state === "running" && c.winnerDrawn && (
                  <div className="banner info" style={{ marginTop: 10 }}>
                    <strong>Kursi {c.winnerIndex + 1} terpilih.</strong> {blockedClaim ?? (me?.seat === c.winnerIndex ? "Kamu bisa mengambil kas melalui tombol Ambil giliran." : `Menunggu ${winner?.wallet.toBase58().slice(0, 4)}…${winner?.wallet.toBase58().slice(-4)} mengambil kas.`)}
                    {blockedClaim && <p>{winner?.hasWon ? "Kursi ini tidak akan masuk undian berikutnya. Keluarkan sekarang lalu mulai undian baru." : now / 1000 >= redrawAt ? "Batas klaim sudah lewat. Gunakan Undi ulang untuk mencoba kursi lagi." : "Kursi ini tidak memenuhi syarat dan dapat langsung dikeluarkan dari hasil undian."}</p>}
                    {c.pot === 0 && <p>Kas masih kosong. Anggota perlu menyetor iuran.</p>}
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
 * who has paid, who has missed, and who has already sudah menerima.
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
    return <p className="muted" style={{ marginTop: 12 }}>Belum ada anggota yang bergabung.</p>;
  }

  return (
    <div className="books">
      {board.map((m) => {
        const owes = circle.state === "running" && m.paidRound < circle.round;
        const isMe = owner?.equals(m.wallet) ?? false;
        return (
          <div key={m.seat} className="book-row">
            <span className="mono book-wallet">
              kursi {m.seat + 1} · {m.wallet.toBase58().slice(0, 4)}…{m.wallet.toBase58().slice(-4)}
              {isMe && <strong> (kamu)</strong>}
            </span>
            <span className="book-status">
              {m.hasWon && <span className="pill closed">sudah menerima</span>}
              {m.roundsMissed > 0 && (
                <span className="pill lucky">tunggak {m.roundsMissed}</span>
              )}
              {/* Only ever says paid when they actually paid. A round settled by
                  slashing their collateral is a miss, not a payment, and
                  labelling it "paid" would quietly launder the one fact the
                  group most needs to see. */}
              {owes
                ? <span className="pill lucky">belum setor putaran {circle.round}</span>
                : circle.state === "running" && m.roundsPaid >= circle.round
                  ? <span className="pill prop">setor {m.roundsPaid} kali</span>
                  : circle.state === "running" && m.paidRound >= circle.round
                    ? <span className="pill lucky">ditutup dari cadangan</span>
                    : circle.state === "running" && (
                        <span className="pill closed">riwayat iuran belum lengkap</span>
                      )}
              <span className="mono">jaminan {formatCook(m.collateral)} COOK</span>
              {owes && roundOver && (
                <button
                  className="ghost"
                  disabled={busy !== null}
                  onClick={() => onChase(m)}
                >
                  {busy === circle.address.toBase58() + "slash" + m.seat
                    ? "..."
                    : m.collateral > 0 ? "Tutup dari cadangan" : "Tandai tunggakan"}
                </button>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

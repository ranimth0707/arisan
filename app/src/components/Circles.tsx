import { useCallback, useEffect, useState } from "react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { Icon, type Navigate } from "./UI";
import { PublicKey, SystemProgram } from "@solana/web3.js";

import {
  assertCanAfford, bn, countdown, findBond, findRoom,
  findMember, findPot, formatCook, hashInviteCode,
  readableError, SLOT_HASHES,
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

export interface CircleRoomView {
  circle: PublicKey;
  creator: PublicKey;
  description: string;
  socialUrl: string;
  inviteCodeHash: number[];
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
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [roomCode, setRoomCode] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
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
  const refresh = useCallback(async (silent = false) => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const [list, roomList, boards] = await Promise.race([
        Promise.all([loadCircles(program), loadRooms(program), loadMembers(program)]),
        new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("Jaringan sedang lambat. Coba muat ulang campaign.")), 12000); }),
      ]);
      setRooms(Object.fromEntries(roomList.map((room) => [room.circle.toBase58(), room])));
      setMembers(boards);
      setCircles(list);
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
    if (!owner || !accessCodes[c.address.toBase58()]) return;
    return run(
      c.address.toBase58() + "join",
      async (payer) => {
        await assertCanAfford(owner, c.collateral, "post the collateral for this circle");
        const inviteCodeHash = await hashInviteCode(accessCodes[c.address.toBase58()]);
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
    ).then(success => {
      if (success && c.drawTargetSlot === 0) {
        setNote("Undian sedang disiapkan. Tunggu beberapa detik, lalu pilih Selesaikan undian.");
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
            const unlocked = Boolean(room && (accessCodes[key] || me));

            return (
              <article className="circle-card" key={key}>
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
                    ? `Jaminan saat join: ${formatCook(c.collateral)} COOK · Putaran ${c.roundSeconds < 3600 ? Math.round(c.roundSeconds / 60) + " menit" : c.roundSeconds < 86400 ? Math.round(c.roundSeconds / 3600) + " jam" : Math.round(c.roundSeconds / 86400) + " hari"}`
                    : c.state === "running"
                      ? roundOver
                        ? "Batas waktu putaran sudah lewat"
                        : `Sisa waktu putaran: ${countdown(c.nextPayoutTs)}`
                      : `Semua ${c.winnersSoFar} giliran selesai`}
                </div>

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

                {c.state === "forming" && <p className="next-action"><strong>Langkah berikutnya: </strong>{c.memberCount >= c.maxMembers ? "Room penuh. Tunggu creator memulai arisan." : me ? "Kamu sudah bergabung. Tunggu creator memulai arisan setelah minimal dua anggota masuk." : "Baca posting dan aturan. Join memindahkan jaminan dari wallet kamu."}</p>}
                {isCreator && accessCodes[key] && <details className="invite-details"><summary>Kode undangan grup</summary><code>{accessCodes[key]}</code><p>Simpan kode dan kirim ke anggota yang kamu undang.</p></details>}
                <div className="actions">
                  {!owner && <WalletMultiButton>Hubungkan wallet untuk ikut</WalletMultiButton>}
                  {c.state === "forming" && owner && !me && unlocked && c.memberCount < c.maxMembers && (
                    <button className="primary" disabled={busy !== null} onClick={() => join(c)}>
                      {busy === key + "join" ? "..." : `Join room · ${formatCook(c.collateral)} COOK`}
                    </button>
                  )}
                  {c.state === "forming" && owner && !me && !unlocked && room && (
                    <span className="room-lock">Masukkan kode dari creator untuk bergabung</span>
                  )}
                  {c.state === "forming" && isCreator && c.memberCount >= 2 && (
                    <button className="primary" disabled={busy !== null} onClick={() => start(c)}>
                      {busy === key + "start" ? "..." : "Mulai arisan"}
                    </button>
                  )}
                  {owed && (
                    <button className="primary" disabled={busy !== null} onClick={() => pay(c)}>
                      {busy === key + "pay" ? "..." : "Bayar iuran"}
                    </button>
                  )}
                  {c.state === "running" && roundOver && !c.winnerDrawn && (
                    <button className="primary" disabled={busy !== null} onClick={() => draw(c)}>
                      {busy === key + "draw"
                        ? "..."
                        : c.drawTargetSlot === 0 ? "Mulai undian" : "Selesaikan undian"}
                    </button>
                  )}
                  {c.state === "running" && c.winnerDrawn && me?.seat === c.winnerIndex && (
                    <button className="primary" disabled={busy !== null} onClick={() => collect(c)}>
                      {busy === key + "collect" ? "..." : `Ambil giliran · ${formatCook(c.pot)} COOK`}
                    </button>
                  )}
                  {me && !me.active && (
                    <button className="ghost" disabled={busy !== null} onClick={() => topUp(c)}>
                      {busy === key + "topup" ? "..." : "Isi ulang jaminan"}
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
                    Kursi {c.winnerIndex + 1} mendapat giliran putaran ini.
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
                  : circle.state === "running" && (
                      <span className="pill closed">diselesaikan; cek riwayat iuran</span>
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
                    : "Tagih dari jaminan"}
                </button>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

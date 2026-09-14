import { useState } from "react";
import { Icon, type Navigate } from "./UI";

const steps = [
  { title: "Mulai dari satu grup.", detail: "Contoh: kamu, Bima, dan Citra sepakat iuran 10 COOK per putaran. Setiap orang mengunci cadangan 30 COOK (10 × 3 putaran), bukan biaya tambahan.", action: "Coba setor iuran" },
  { title: "Iuran masuk ke kas bersama.", detail: "Tiga anggota × 10 COOK = 30 COOK. Cadangan disimpan terpisah. Jika seseorang mangkir, program memotong cadangannya agar kas tetap 30 COOK.", action: "Lihat contoh undian" },
  { title: "Satu orang mendapat giliran.", detail: "Di contoh ini, giliran jatuh ke kamu. Pada campaign asli, hasil undian ditentukan program. Penerima harus memenuhi syarat pembayaran dan jaminan.", action: "Coba ambil giliran" },
  { title: "Giliranmu selesai, iuran tetap jalan.", detail: "Kamu menerima 30 COOK. Putaran berikutnya kamu tetap membayar 10 COOK, tetapi tidak mendapat giliran lagi. Arisan selesai setelah semua anggota menerima giliran.", action: "Ulangi simulasi" },
];
export function Guide({ navigate }: { navigate: Navigate }) {
  const [step, setStep] = useState(0);
  const [role, setRole] = useState<"member" | "creator">("member");
  return <>
    <section className="simulation" aria-label="Simulasi arisan">
      <div className="simulation-visual">
        <span className="pill closed">Simulasi · bukan transaksi asli</span>
        <span className="pot-label">{step === 3 ? "Kamu menerima" : "Kas putaran 1"}</span>
        <div className="pot-amount">{step === 0 ? "0" : "30"} <span>COOK</span></div>
        <div className="demo-members">{["Kamu", "Bima", "Citra"].map((name, i) => <div key={name} className={i === 0 && step >= 2 ? "demo-member selected" : "demo-member"}>
          <span className="avatar">{name[0]}</span><strong>{name}</strong><small>{step === 0 ? "Belum setor" : step >= 2 && i === 0 ? (step === 3 ? "Sudah menerima" : "Dapat giliran") : "Setor 10 COOK"}</small>
        </div>)}</div>
      </div>
      <div className="simulation-copy">
        <span className="step-count">LANGKAH {step + 1} DARI 4</span>
        <div className="step-progress" aria-hidden="true">{steps.map((_, i) => <span key={i} className={i <= step ? "done" : ""} />)}</div>
        <div aria-live="polite"><h2>{steps[step].title}</h2><p>{steps[step].detail}</p></div>
        <button className="primary" onClick={() => setStep((step + 1) % 4)}>{steps[step].action}<Icon name="arrow" /></button>
        <small>Simulasi ini tidak menghubungkan wallet atau memindahkan uang.</small>
      </div>
    </section>
    <section className="guide-section">
      <h2>Sekarang, mulai dari mana?</h2>
      <div className="segmented" aria-label="Pilih panduan"><button aria-pressed={role === "member"} onClick={() => setRole("member")}>Saya mau ikut</button><button aria-pressed={role === "creator"} onClick={() => setRole("creator")}>Saya mau membuat</button></div>
      <ol className="guide-steps">
        {(role === "member" ? [
          ["Minta kode ke creator", "Kode membuka campaign yang dituju. Baca tujuan grup, posting creator, iuran, dan durasi sebelum ikut."],
          ["Hubungkan wallet & siapkan COOK", "Untuk mencoba, buka Get demo COOK. Saldo dipakai untuk jaminan dan iuran, bukan hanya gas."],
          ["Join room, lalu tunggu creator", "Saat Join, cadangan keamanan dipindahkan dari wallet. Nilainya adalah iuran × jumlah anggota. Creator memulai arisan setelah minimal dua anggota bergabung."],
          ["Bayar setiap putaran", "Setor iuran sampai semua mendapat giliran, termasuk setelah kamu menerima kas. Pantau batas waktu dan pembukuan di room."],
        ] : [
          ["Isi detail campaign", "Beri nama dan jelaskan siapa yang boleh ikut serta tujuan arisannya."],
          ["Sepakati aturan", "Tentukan iuran, cadangan keamanan, jumlah anggota, dan lama putaran. Aturan tidak dapat diubah setelah dibuat."],
          ["Posting ke sosial media", "Gunakan draft yang disiapkan, publikasikan sendiri, lalu tempel URL posting publik. Link disimpan, isi posting belum diverifikasi otomatis."],
          ["Buat room & undang grupmu", "Hubungkan wallet, review aturan, lalu Create campaign. Creator otomatis menjadi anggota pertama; simpan kode yang muncul dan bagikan ke anggota."],
        ]).map(([title, detail], i) => <li key={title}><span>{i + 1}</span><div><h3>{title}</h3><p>{detail}</p></div></li>)}
      </ol>
      <button className="primary" onClick={() => navigate(role === "member" ? "join" : "create")}>{role === "member" ? "Saya punya kode" : "Create campaign"}<Icon name="arrow" /></button>
    </section>
    <section className="faq"><h2>Yang perlu kamu tahu</h2>
      <details><summary>Apa bedanya cadangan keamanan dan iuran?</summary><p>Cadangan keamanan dikunci saat bergabung dan disimpan terpisah dari kas. Untuk campaign baru nilainya minimal iuran × jumlah anggota, sehingga setiap kewajiban tersisa bisa ditutup. Iuran tetap dibayar setiap putaran untuk membentuk kas. Cadangan yang tidak terpakai bisa ditarik setelah arisan selesai.</p></details>
      <details><summary>Kalau ada yang tidak bayar?</summary><p>Setelah tenggat, siapa pun dapat menutup tunggakan dari cadangan anggota tersebut. Saldo cadangannya berkurang, tetapi kas putaran tetap utuh. Jika cadangan semua anggota belum cukup, program mengunci undian dan pencairan sampai saldo dilengkapi—anggota lain tidak dipaksa menutup kekurangannya.</p></details>
      <details><summary>Apakah demo memakai uang sungguhan?</summary><p>Simulasi di atas hanya contoh. Get demo COOK dan campaign di aplikasi memakai transaksi nyata di Cookie Chain mainnet. Periksa nominal sebelum menyetujui transaksi di wallet.</p></details>
      <details><summary>Apakah kode membatasi siapa yang bisa ikut?</summary><p>Belum sepenuhnya. Aplikasi meminta kode untuk membuka room, tetapi program blockchain saat ini belum memiliki otorisasi anggota yang kuat. Pengguna teknis bisa melewati pembatasan kode aplikasi. Detail dan pembukuan juga bersifat publik. Jangan menganggap kode sebagai jaminan privasi atau identitas anggota.</p></details>
    </section>
  </>;
}

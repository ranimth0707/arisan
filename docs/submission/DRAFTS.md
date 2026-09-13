# Submission drafts

Three things to post. Everything below is ready to copy, except the two
`REPLACE_WITH_YOUR_X_URL` placeholders in `apps.json.entry.json`.

## Where the field stands

Eleven submissions: four merged, seven open PRs. Categories are crowded in
Tooling, and `cookie-jar` is already taken by a different project. Cookie Tin goes
in as DeFi. The nearest neighbours are `cookiepad` (launchpad) and
`crumbs-portfolio` (positions viewer). Nothing else in the field holds deposits,
which matters because Volume and TVL are named judging criteria and every other
entry's TVL is incidental rather than the product.

---

## 1. PR to the submissions repo

```bash
cd /tmp
gh repo fork cookiechain/superteam-hackathon-submissions --clone --remote
cd superteam-hackathon-submissions

cp ~/Documents/zerion-cli/cookiejar/docs/submission/cookie-tin.png logos/cookie-tin.png
mkdir -p screenshots/cookie-tin
# add screenshots here as 01-*.png, 02-*.png before committing

node -e '
const fs = require("fs");
const apps = JSON.parse(fs.readFileSync("apps.json", "utf8"));
const entry = JSON.parse(fs.readFileSync(
  process.env.HOME + "/Documents/zerion-cli/cookiejar/docs/submission/apps.json.entry.json", "utf8"));
const list = Array.isArray(apps) ? apps : apps.apps;
if (list.some(a => a.id === entry.id)) throw new Error("already there");
list.push(entry);
fs.writeFileSync("apps.json", JSON.stringify(apps, null, 2) + "\n");
console.log("added, now", list.length, "entries");
'

git checkout -b add-cookie-tin
git add apps.json logos/cookie-tin.png screenshots/cookie-tin
git commit -m "Add Cookie Tin"
git push -u origin add-cookie-tin
gh pr create --repo cookiechain/superteam-hackathon-submissions \
  --title "Add Cookie Tin" \
  --body "On-chain fundraising for Cookie Chain: ask for help with an empty wallet, give without paying a fee.

Live: https://cookietin-cook.vercel.app
Source: https://github.com/ranimth0707/cookie-tin
Program: Dwd7DXUQHRJaj1suYz6fTcVW7JJqBFVztg1z77t6Ysg

A donor spends exactly what they meant to give. Their fee and the rent for their
donation record come from a sponsor vault, not from them. Real transaction, donor
down exactly 25,000,000,000 lamports and the campaign vault up exactly the same:
https://cookiescan.io/tx/3bkvRh78V2q3dhAeHHZedjez6Ds5yZSXtiSBxsrFbHedyoeERHU7R3rZYqSEB38qHxbpspLxr5vUv6u5cufFJuby

Raised funds default into the asker's own jar rather than their wallet, so a
successful campaign moves value inside the protocol rather than draining it, and
the money still comes out the moment a bill arrives."
```

---

## 2. X thread, Indonesian

Your audience, your voice. Open a tin with a real prize first, then put its link
in the last tweet.

> **1/**
> jujur, tiap kali lihat produk DeFi aku selalu nanya hal yang sama: kalau salah,
> duitku hilang gak?
>
> dan jawabannya hampir selalu "bisa".
>
> jadi 2 minggu ini aku garap yang jawabannya gak bisa ✨

> **2/**
> namanya Cookie Tin, jalan di Cookie Chain.
>
> kamu simpan COOK di dalam kaleng. kapan pun mau ambil, balik utuh. gak
> dipinjamkan ke siapa-siapa, gak ditradingkan, gak dipakai apa-apa.
>
> yang kamu perebutkan itu hadiah di atasnya, yang diisi sponsor.

> **3/**
> ini bagian yang paling aku jagain pas bikin.
>
> modal dan hadiah disimpan di dua akun terpisah di dalam kontraknya.
>
> jadi bukan cuma "aku janji gak akan bayar hadiah pakai duit orang lain". emang
> gak ada jalannya secara struktur. mau pun gak bisa.

> **4/**
> ada 2 model kaleng:
>
> streaming, semua yang nyimpen dapat, dihitung dari jumlah dikali lama
>
> lucky, satu dompet satu kupon. simpan 1 COOK dan 1.000 COOK peluangnya sama
> persis. ini sengaja, biar dompet paling gede gak otomatis menang

> **5/**
> undiannya juga gak bisa diatur.
>
> pas undian diminta, hasilnya diikat ke blok yang saat itu belum ada. jadi yang
> manggil undian pun gak tahu bakal keluar apa.
>
> dan siapa pun boleh menjalankan undiannya, gak harus si pembuat. jadi hadiah
> gak bisa ngendon gara-gara yang punya kaleng menghilang.

> **6/**
> satu hal lagi: gasnya ditanggung.
>
> nyimpen, ngambil, ngumpulin hadiah, semuanya gratis biaya transaksi.
>
> dompet isi 0 pun bisa ikut. aku udah tes sendiri pakai dompet kosong, dan
> saldonya tetap 0 sebelum dan sesudah.

> **7/**
> semua yang aku klaim di atas ada transaksinya di explorer, tinggal klik.
>
> repo-nya juga kebuka >> github.com/ranimth0707/cookie-tin
>
> jujur ini bukan ide paling rumit, tapi aku lebih milih bikin satu hal yang
> beneran kelar daripada lima yang setengah jadi wkwkwk

> **8/**
> aku udah buka satu kaleng berhadiah, siapa pun boleh ikut.
>
> LINK_KALENG_DISINI
>
> catatan: wallet kalian mungkin kasih warning transaksi bakal gagal. itu karena
> dia ngintip di jaringan yang salah, transaksinya sendiri aman.
>
> kalau ada yang aneh kasih tau aku ya
>
> see u and byeeee ✨

## 3. English, for the Cookie Chain Telegram and as a quote-tweet

> Built **Cookie Tin** for the Superteam bounty: prize savings on Cookie Chain
> where the deposit cannot be lost.
>
> Principal and prize money live in separate program accounts, so paying a prize
> out of somebody else's deposit is structurally impossible rather than checked.
> Withdrawal stays open even while the protocol is paused. The prize comes from a
> sponsor, never from other savers.
>
> Lucky tins give one entry per wallet, so 1 COOK and 1,000 COOK have identical
> odds. The draw settles against the hash of a slot that did not exist when it was
> requested, and running it is permissionless so a closed tin never waits on its
> creator.
>
> Gas is covered throughout. A wallet holding exactly zero COOK can deposit,
> withdraw and collect. Real one, 0 lamports before and 0 after:
> https://cookiescan.io/tx/63nPzm62sSE6bvYeTitre8vDLgWRHb8GB1kMMuZqABdFoH3bkPux6pnTdAe2LWg93NnMP3WK9k9YsULAf2Fb2eGY
>
> Live: https://cookietin-cook.vercel.app
> Code: https://github.com/ranimth0707/cookie-tin
> Program: `Dwd7DXUQHRJaj1suYz6fTcVW7JJqBFVztg1z77t6Ysg`
>
> Any project here can fund its own gas vault and point a deployment at it, so
> your users never hit the empty-wallet wall. Happy to help wire it up.
>
> Two gotchas for everyone building on Cookie Chain. Programs must be built for
> SBPF v0, and the loader does not support `ExtendProgram`, so deploy with a
> generous `--max-len` because a program account cannot be grown later. And
> wallet-adapter's `signTransaction` does not forward a chain id, so a wallet
> previews against whichever Solana network it knows and warns that a perfectly
> good transaction will fail.

# Submission drafts

Three things to post. Everything below is ready to copy, except the two
`REPLACE_WITH_YOUR_X_URL` placeholders in `apps.json.entry.json`.

## Where the field stands

Eleven submissions: four merged, seven open PRs. Categories are crowded in
Tooling, and `cookie-jar` is already taken by a different project. Bake Care goes
in as DeFi. The nearest neighbours are `cookiepad` (launchpad) and
`crumbs-portfolio` (positions viewer), neither of which is about people giving
money to each other.

---

## 1. PR to the submissions repo

```bash
cd /tmp
gh repo fork cookiechain/superteam-hackathon-submissions --clone --remote
cd superteam-hackathon-submissions

cp ~/Documents/zerion-cli/cookiejar/docs/submission/bake-care.png logos/bake-care.png
mkdir -p screenshots/bake-care
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

git checkout -b add-bake-care
git add apps.json logos/bake-care.png screenshots/bake-care
git commit -m "Add Bake Care"
git push -u origin add-bake-care
gh pr create --repo cookiechain/superteam-hackathon-submissions \
  --title "Add Bake Care" \
  --body "On-chain fundraising for Cookie Chain: ask for help with an empty wallet, give without paying a fee.

Live: https://bakecare-cook.vercel.app
Source: https://github.com/ranimth0707/bake-care
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

Your audience, your voice. Replace the last link with a live campaign once you
have opened one.

> **1/**
> jujur, yang bikin aku lama mikir bukan teknologinya.
>
> tapi ini: orang yang paling butuh bantuan, biasanya justru yang paling gak
> punya apa-apa buat mulai. termasuk buat bayar biaya transaksi.
>
> jadi 2 minggu ini aku garap ini ✨

> **2/**
> namanya Bake Care, jalan di Cookie Chain.
>
> konsepnya kayak kitabisa, tapi on-chain.
>
> kamu bisa buka permintaan bantuan: judul, cerita, target. gak ada approval, gak
> ada potongan, dan gak butuh punya token sama sekali buat mulai.

> **3/**
> yang aku paling suka dari bagian ini:
>
> orang yang mau bantu cuma bayar persis yang dia niatkan kasih. gak lebih
> sepeser pun.
>
> biaya transaksinya ditanggung. jadi kalau kamu mau kasih 25, ya keluar 25.
> bukan 25 plus ongkos ini itu.

> **4/**
> tapi ada satu hal yang bikin aku mikir lama.
>
> galang dana itu secara alami "bocor". uang masuk, uang keluar, selesai. sehari
> ramai terus sepi lagi.
>
> ini bukan tebakan. Base kehilangan 30% dananya dalam 2 minggu setelah program
> insentifnya berhenti.

> **5/**
> jadi aku balik jalurnya.
>
> dana yang terkumpul gak langsung lari ke dompet. dia mendarat di "toples"
> punya si penggalang.
>
> tetap 100% miliknya, bisa ditarik detik itu juga pas tagihan datang. tapi
> selama nunggu, uangnya tetap bekerja.

> **6/**
> satu detail kecil yang buatku penting:
>
> jumlah orang yang bantu dihitung per dompet, bukan per transfer.
>
> jadi kalau satu orang kasih 3 kali, angkanya tetap 1 orang. metrik "berapa
> orang peduli" harus jujur, kalau nggak ya buat apa.

> **7/**
> udah jalan di mainnet, bisa kalian coba sekarang.
>
> semua klaim di atas ada transaksinya, tinggal klik di explorer. termasuk donor
> yang saldonya turun persis sejumlah yang dia kasih.
>
> repo-nya kebuka >> github.com/ranimth0707/bake-care

> **8/**
> aku udah buka satu permintaan buat contoh, kalian bisa coba kasih berapa pun.
>
> LINK_KAMPANYE_DISINI
>
> catatan: wallet kalian mungkin kasih warning transaksi bakal gagal. itu karena
> dia ngintip di jaringan yang salah, transaksinya sendiri aman.
>
> kasih masukan ya, masih banyak yang mau aku benerin
>
> see u and byeeee ✨

---

## 3. English, for the Cookie Chain Telegram and as a quote-tweet

> Built **Bake Care** for the Superteam bounty: on-chain fundraising where the
> person asking does not need any COOK to start and the person giving pays only
> the gift.
>
> A donor's fee and the rent for their donation record both come from a sponsor
> vault. They spend exactly what they meant to give, to the lamport. Real one:
> donor down 25,000,000,000 lamports, campaign vault up exactly the same.
> https://cookiescan.io/tx/3bkvRh78V2q3dhAeHHZedjez6Ds5yZSXtiSBxsrFbHedyoeERHU7R3rZYqSEB38qHxbpspLxr5vUv6u5cufFJuby
>
> Raised funds default into the asker's own jar rather than their wallet, so they
> stay withdrawable the moment a bill arrives but keep earning while they wait.
> A successful campaign moves value inside the protocol rather than draining it,
> which is the part most giveaway mechanics get backwards.
>
> Live: https://bakecare-cook.vercel.app
> Code: https://github.com/ranimth0707/bake-care
> Program: `Dwd7DXUQHRJaj1suYz6fTcVW7JJqBFVztg1z77t6Ysg`
>
> Any project here can fund its own gas vault and point a deployment at it, so
> your users never hit the empty-wallet wall. Happy to help wire it up.
>
> Two gotchas worth knowing for everyone building on Cookie Chain. Programs must
> be built for SBPF v0, and the loader does not support `ExtendProgram`, so
> deploy with a generous `--max-len` because a program account cannot be grown
> later. And wallet-adapter's `signTransaction` does not forward a chain id, so a
> wallet previews against whichever Solana network it knows and warns that a
> perfectly good transaction will fail.

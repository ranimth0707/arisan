# Submission drafts

Three things to post. Everything below is ready to copy, except the two
`REPLACE_WITH_YOUR_X_URL` placeholders in `apps.json.entry.json`.

---

## 1. PR to the submissions repo

Only four entries exist there so far, all in Infrastructure or Tooling. Nothing
in DeFi. Given the bounty is judged on Volume and TVL, that is the gap.

```bash
cd /tmp
gh repo fork cookiechain/superteam-hackathon-submissions --clone --remote
cd superteam-hackathon-submissions

cp ~/Documents/zerion-cli/cookiejar/docs/submission/cookie-jar.png logos/cookie-jar.png
mkdir -p screenshots/cookie-jar
# add screenshots here as 01-*.png, 02-*.png before committing

# splice the entry into apps.json
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

git checkout -b add-cookie-jar
git add apps.json logos/cookie-jar.png screenshots/cookie-jar
git commit -m "Add Cookie Jar"
git push -u origin add-cookie-jar
gh pr create --repo cookiechain/superteam-hackathon-submissions \
  --title "Add Cookie Jar" \
  --body "Gasless giveaways on Cookie Chain where claiming raises TVL instead of draining it.

Live: https://cookiejar-cook.vercel.app
Source: https://github.com/ranimth0707/cookie-jar
Program: Dwd7DXUQHRJaj1suYz6fTcVW7JJqBFVztg1z77t6Ysg

A wallet holding zero COOK can crack open a giveaway and pay nothing. What it
receives lands in a jar position inside the protocol rather than in a wallet, so
the claim is an inflow. Real Nightly wallet doing exactly that, 0 lamports before
and after: https://cookiescan.io/tx/63nPzm62sSE6bvYeTitre8vDLgWRHb8GB1kMMuZqABdFoH3bkPux6pnTdAe2LWg93NnMP3WK9k9YsULAf2Fb2eGY"
```

---

## 2. X thread, Indonesian

Your audience, your voice. This is the one that actually brings users, which is
what moves the numbers. Replace the last line's link with a live Fortune Cookie
you funded first.

> **1/**
> jujur, masalah paling nyebelin di chain baru itu bukan teknologinya.
>
> tapi kamu gabisa ngapa-ngapain sebelum punya token buat bayar gas. dan buat
> dapet token itu, kamu butuh token lain dulu. muter aja gitu wkwkwk
>
> nah 2 minggu ini aku garap sesuatu buat ngatasin itu ✨

> **2/**
> namanya Cookie Jar, jalan di Cookie Chain.
>
> konsepnya kayak amplop THR. aku isi COOK, share link, siapa aja bisa buka.
>
> bedanya: kamu gaperlu punya COOK sama sekali buat bukanya. gasnya udah
> ditanggung. dompet isi nol pun bisa.

> **3/**
> tapi ada satu hal yang bikin aku mikir lama.
>
> giveaway biasa itu bocor. orang klaim, duitnya keluar dari kontrak, selesai.
> ramai sehari terus sepi lagi.
>
> ini bukan tebakan. Base kehilangan 30% TVL dalam 2 minggu setelah program
> insentifnya berhenti. Blast juga anjlok pas airdropnya cair.

> **4/**
> jadi aku balik logikanya.
>
> pas kamu klaim, duitnya gak dikirim ke dompetmu. dia pindah ke "toples"
> punyamu, yang masih di dalam protokolnya.
>
> tetep 100% punya kamu, bisa ditarik kapan aja. tapi selama disimpan, kamu
> dapet bagian dari hadiah yang disediain sponsor.
>
> jadi klaim itu bikin duit masuk, bukan keluar.

> **5/**
> toplesnya ada 2 mode:
>
> streaming — semua yang nyimpen dapet, dihitung dari jumlah dikali lama
>
> lucky draw — satu dompet satu kupon. deposit 1 COOK dan 1.000 COOK peluangnya
> sama persis. ini sengaja, biar yang modal kecil gak kalah duluan

> **6/**
> yang bikin aku agak deg-degan: modal orang gabisa hilang.
>
> deposit sama kolam hadiah disimpan di dua tempat terpisah di kontraknya. jadi
> secara struktur emang gak mungkin hadiah dibayar pakai duit orang lain.
> bukan karena aku janji, tapi karena emang gaada jalannya.

> **7/**
> udah jalan di mainnet dan bisa kalian coba sekarang.
>
> semua yang aku klaim di atas ada transaksinya, tinggal klik di explorer.
> termasuk dompet isi 0 lamports yang tetep 0 lamports setelah dapet 44 COOK.
>
> repo-nya juga kebuka >> github.com/ranimth0707/cookie-jar

> **8/**
> ini amplop yang udah aku isi, siapa cepat dia dapat.
>
> LINK_AMPLOP_DISINI
>
> catatan kecil: set dulu jaringan di wallet kalian ke Cookie Chain, kalau nggak
> nanti muncul warning padahal transaksinya aman.
>
> kalau ada yang aneh kasih tau aku ya, masih banyak yang mau aku perbaiki
>
> see u and byeeee ✨

---

## 3. English, for the Cookie Chain Telegram and as a quote-tweet

Alex asked people to spread the word to move Volume and TVL, so lead with the
mechanic rather than the marketing.

> Built **Cookie Jar** for the Superteam bounty: gasless giveaways where claiming
> raises TVL instead of draining it.
>
> A wallet with zero COOK cracks open a Fortune Cookie and pays nothing. What it
> gets does not land in a wallet, it lands in a jar position inside the protocol,
> so the claim is an inflow rather than an outflow. Deposits are withdrawable any
> time and earn from a sponsor-funded pool while they sit.
>
> Live: https://cookiejar-cook.vercel.app
> Code: https://github.com/ranimth0707/cookie-jar
> Program: `Dwd7DXUQHRJaj1suYz6fTcVW7JJqBFVztg1z77t6Ysg`
>
> A real Nightly wallet doing it, 0 lamports before and 0 after:
> https://cookiescan.io/tx/63nPzm62sSE6bvYeTitre8vDLgWRHb8GB1kMMuZqABdFoH3bkPux6pnTdAe2LWg93NnMP3WK9k9YsULAf2Fb2eGY
>
> Any project on Cookie Chain can fund its own gas vault and point a deployment
> at it, so your users never hit the empty-wallet wall. Happy to help wire it up.
>
> One gotcha worth knowing for everyone building here: wallet-adapter's
> `signTransaction` does not forward a chain id, so a wallet left on another
> network simulates against that one and warns the transaction will fail. Naming
> `solana:9wDaBRDgArEUpvhHxGguNkwozsZh4UpG` through the Wallet Standard fixes it.

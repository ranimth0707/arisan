# Submission drafts

Everything below is ready to copy, except the two `REPLACE_WITH_YOUR_X_URL`
placeholders in `apps.json.entry.json`.

## Where the field stands

Eleven submissions: four merged, seven open PRs, mostly Tooling. Nothing else in
the field is a savings circle, and nothing else locks deposits for a fixed term.
That matters because Volume and TVL are named judging criteria, and every other
entry's TVL is incidental rather than the mechanism itself.

`cookie-jar` was already taken by another entry, which is why this is filed as
`arisan`.

---

## 1. PR to the submissions repo

```bash
cd /tmp
gh repo fork cookiechain/superteam-hackathon-submissions --clone --remote
cd superteam-hackathon-submissions

cp ~/Documents/zerion-cli/cookiejar/docs/submission/arisan.png logos/arisan.png
mkdir -p screenshots/arisan
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

git checkout -b add-arisan
git add apps.json logos/arisan.png screenshots/arisan
git commit -m "Add Arisan"
git push -u origin add-arisan
gh pr create --repo cookiechain/superteam-hackathon-submissions \
  --title "Add Arisan" \
  --body "Rotating savings circles on Cookie Chain, protected by a full reserve instead of trust.

Live: https://arisan-cook.vercel.app
Source: https://github.com/ranimth0707/arisan
Program: Dwd7DXUQHRJaj1suYz6fTcVW7JJqBFVztg1z77t6Ysg

An arisan works offline because everyone in the group knows each other. Online it
breaks two ways, and both are handled in the program rather than in a promise.

Somebody stops paying after they have had their turn, so every member posts a
reserve equal to the full commitment on joining. A missed round comes out of
that member's reserve and goes into the pot.
Verified on mainnet with a three-member circle: in round two only two members
paid, the defaulter's reserve went from 0.6 COOK to 0.4 COOK, and the pot still
paid out the full 0.6 COOK.

The organiser runs off with the money, so nobody holds it. The pot is a program
account, the draw commits to a block three slots ahead so even the organiser
cannot time their own turn, running the draw and charging a defaulter are both
permissionless, and every group parameter is frozen at creation.

22/22 checks on mainnet, including the refusals: a fourth member cannot squeeze
into three seats, nobody joins once it is running, paying twice in a round is
rejected, the same absence cannot be charged twice, and the reserve-covered
default leaves the full pot intact.

Prior art is credited in the README. The design follows Akyba Protocol's ROSCA
spec on Cardano. What is different here is that it runs on Cookie Chain and every
fee is sponsored, so a member with an empty wallet can join, pay and collect."
```

---

## 2. X thread, Indonesian

Your audience, your voice. Start a real circle first, then put its link in the
last tweet.

> **1/**
> jujur, arisan online itu konsepnya bagus banget tapi rawan banget.
>
> yang udah dapet giliran tiba-tiba ngilang. atau yang megang uangnya yang ngilang.
>
> nah 2 minggu ini aku garap arisan yang dua-duanya gak bisa kejadian ✨

> **2/**
> masalah pertama: yang udah dapet arisan terus berhenti bayar.
>
> di sini tiap anggota ngunci cadangan sebesar total komitmen pas gabung. bulan
> ini gak bayar? cadangannya yang dipotong, dan potongannya masuk ke kas.
>
> jadi yang rajin bayar tetep dapet utuh. yang nunggak yang nanggung sendiri.

> **3/**
> aku tes beneran di mainnet, 3 orang, iuran 0.2 per putaran.
>
> putaran 2 cuma 2 orang yang bayar. hasilnya:
>
> cadangan si penunggak: 0.6 → 0.4
> kas: 0.4 → 0.6
>
> kasnya tetep penuh. kalau cadangan kurang, program mengunci undian supaya
> anggota lain gak pernah nombok.

> **4/**
> masalah kedua: yang megang uang kabur.
>
> di sini gak ada yang megang. kasnya ada di kontrak, dan ketuanya gak punya
> kunci ke sana sama sekali.
>
> uang cuma bisa keluar ke satu arah: ke orang yang nomornya keluar.

> **5/**
> terus gimana biar undiannya gak diatur?
>
> pas undian dimulai, hasilnya diikat ke blok yang saat itu belum ada.
>
> jadi ketua pun gak bisa ngatur waktu biar gilirannya keluar duluan. gak ada
> yang tau hasilnya, termasuk yang mencet tombolnya.

> **6/**
> dan ini yang aku suka:
>
> siapa pun boleh menjalankan undian, dan siapa pun boleh nagih cadangan si
> penunggak. gak harus ketua.
>
> di test kemarin, yang nagih malah dompet yang bukan anggota sama sekali. jadi
> arisan gak bisa macet gara-gara ketuanya ngilang.

> **7/**
> semua pembukuan kebuka.
>
> siapa udah bayar, siapa nunggak dan berapa kali, siapa udah dapet giliran,
> jaminan masing-masing sisa berapa.
>
> di arisan beneran ini catatan di buku yang dipegang satu orang. di sini semua
> anggota bisa lihat sendiri.

> **8/**
> oh iya, biaya transaksinya ditanggung. gabung, bayar, ambil giliran, semua
> gratis ongkos.
>
> tapi iuran sama cadangan tetep dari duit kalian sendiri ya. cadangan yang
> dibayarin orang lain gak menjamin apa-apa wkwkwk

> **9/**
> aku udah buka satu arisan, siapa pun boleh ikut.
>
> LINK_ARISAN_DISINI
>
> catatan: wallet kalian mungkin kasih warning transaksi bakal gagal. itu karena
> dia ngintip di jaringan yang salah, transaksinya sendiri aman.
>
> kalau ada yang aneh kasih tau aku ya
>
> see u and byeeee ✨

---

## 3. English, for the Cookie Chain Telegram and as a quote-tweet

> Built **Arisan** for the Superteam bounty: rotating savings circles on Cookie
> Chain, protected by a full reserve instead of trust.
>
> A group agrees an amount and a period, everyone pays in each round, and one
> member who has not had a turn takes the pot. It works offline because everyone
> knows each other. Online it breaks two ways, and both are handled in the
> program rather than in a promise.
>
> Somebody stops paying after their turn: every member posts a reserve equal to
> the full commitment, and a missed round comes out of it and goes into the pot.
> Tested on mainnet with three members. Round two, only two paid. The
> defaulter's reserve went from 0.6 COOK to 0.4 COOK, and the pot still paid out
> the full 0.6 COOK.
>
> The organiser runs off: nobody holds the money. The pot is a program account,
> the draw commits to a block three slots ahead so even the organiser cannot time
> their own turn, running the draw and charging a defaulter are both
> permissionless, and every parameter is frozen at creation.
>
> 22/22 on mainnet including the refusals and reserve coverage.
>
> Live: https://arisan-cook.vercel.app
> Code: https://github.com/ranimth0707/arisan
> Program: `Dwd7DXUQHRJaj1suYz6fTcVW7JJqBFVztg1z77t6Ysg`
>
> Prior art credited in the README: the design follows Akyba Protocol's ROSCA
> spec on Cardano. What is different is that it runs here, and every fee is
> sponsored, so a member with an empty wallet can join, pay and collect.
>
> Two gotchas for everyone building on Cookie Chain. Programs must be built for
> SBPF v0, and `anchor build` leaves a v3 binary, so run `cargo-build-sbf --arch
> v0` after it. And the loader does not support `ExtendProgram`, so deploy with a
> generous `--max-len`, because a program account cannot be grown later.

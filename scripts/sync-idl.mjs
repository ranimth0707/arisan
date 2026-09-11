// Copies the freshly built IDL and types out of target/ and into the committed
// paths the app and relayer build from. Run this after every `anchor build`,
// otherwise the frontend keeps talking to the previous version of the program.

import fs from "node:fs";

const copies = [
  ["../target/idl/cookie_jar.json", "../app/src/lib/idl.json"],
  ["../target/types/cookie_jar.ts", "../app/src/lib/cookie_jar_type.ts"],
];

for (const [from, to] of copies) {
  const src = new URL(from, import.meta.url);
  if (!fs.existsSync(src)) {
    console.error(`missing ${from}, run anchor build first`);
    process.exit(1);
  }
  fs.copyFileSync(src, new URL(to, import.meta.url));
  console.log(`${from} -> ${to}`);
}

await import("./gen-relayer-constants.mjs");

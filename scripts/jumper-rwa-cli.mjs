#!/usr/bin/env node

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const MISSION_SLUG = "coinbase-rwa-raffle-1";
export const MISSION_PAGE = `https://jumper.xyz/id/missions/${MISSION_SLUG}#mission-widget`;
export const RWA_PROVIDER_PAGE = "https://rwa.jumper.xyz/providers/coinbase";
export const JUMPER_API_BASE = "https://api.jumper.xyz/v1";
export const STRAPI_BASE = "https://strapi.jumper.xyz";

// Contracts currently linked by Jumper RWA's Coinbase provider page.
export const ELIGIBLE_ASSETS = Object.freeze([
  { ticker: "NVDA", token: "NVDAc", address: "0xb20000000000000000000078ee7ce2fE4908108C" },
  { ticker: "SPCX", token: "SPCXc", address: "0xb2000000000000000000007b9fcbd005511aCBd5" },
  { ticker: "GOOGL", token: "GOOGLc", address: "0xb2000000000000000000002D0BA3164cc74f58B7" },
  { ticker: "AAPL", token: "AAPLc", address: "0xb200000000000000000000C2e324d24d7eEcd1fb" },
  { ticker: "META", token: "METAc", address: "0xb2000000000000000000008bC8786B856E61707C" },
  { ticker: "MSFT", token: "MSFTc", address: "0xB200000000000000000000Ab99cFa739E253872B" },
  { ticker: "TSLA", token: "TSLAc", address: "0xb2000000000000000000001e800a7f5189430cD0" },
  { ticker: "AMZN", token: "AMZNc", address: "0xb200000000000000000000d9192b6B456483C2E8" },
  { ticker: "MSTR", token: "MSTRc", address: "0xb2000000000000000000004884b426556b92883d" },
  { ticker: "SNDK", token: "SNDKc", address: "0xb200000000000000000000397293Cb8cda9a10c5" },
]);

export const VOLUME_TIERS = Object.freeze([
  { minimum: 0, multiplier: 0, xp: 0, next: 250 },
  { minimum: 250, multiplier: 1, xp: 10, next: 1_000 },
  { minimum: 1_000, multiplier: 2, xp: 15, next: 10_000 },
  { minimum: 10_000, multiplier: 3, xp: 20, next: 100_000 },
  { minimum: 100_000, multiplier: 5, xp: 30, next: null },
]);

const DEFAULT_HISTORY_LIMIT = 200;
const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

function assetByTicker(value) {
  const ticker = String(value || "").toUpperCase();
  return ELIGIBLE_ASSETS.find((asset) => asset.ticker === ticker);
}

export function buildAssetUrl(ticker) {
  const asset = assetByTicker(ticker);
  if (!asset) throw new Error(`Unknown eligible asset: ${ticker}`);
  return `https://rwa.jumper.xyz/assets/${asset.ticker}`;
}

export function parseNumeric(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const normalized = value.replace(/[$,\s]/g, "");
    if (!normalized) return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (value && typeof value === "object") {
    for (const key of ["value_usd", "valueUsd", "usd", "amount_usd", "amountUsd", "value"]) {
      const parsed = parseNumeric(value[key]);
      if (parsed !== null) return parsed;
    }
  }
  return null;
}

function isSuccessfulTrade(transaction) {
  const type = String(transaction?.type || "").toLowerCase();
  const status = String(transaction?.status || "").toLowerCase();
  const tradeLike = type === "trade" || type.includes("swap");
  const failed = ["failed", "error", "reverted", "pending"].some((item) => status.includes(item));
  return tradeLike && !failed;
}

function assetForToken(symbol) {
  const normalized = String(symbol || "").toLowerCase();
  return ELIGIBLE_ASSETS.find((asset) => asset.token.toLowerCase() === normalized);
}

function inferTransferValue(transfers) {
  const values = transfers.map((transfer) => parseNumeric(transfer.value)).filter((value) => value !== null);
  return values.length ? Math.max(...values) : null;
}

export function inspectEligibleHistory(historyPayload) {
  const transactions = Array.isArray(historyPayload?.transactions) ? historyPayload.transactions : [];
  const matches = [];
  let unknownValueCount = 0;

  for (const transaction of transactions) {
    if (!isSuccessfulTrade(transaction)) continue;
    const transfers = Array.isArray(transaction.transfers) ? transaction.transfers : [];
    const eligibleTransfers = transfers
      .map((transfer) => ({ transfer, asset: assetForToken(transfer.fungible) }))
      .filter(({ asset }) => asset);
    if (!eligibleTransfers.length) continue;

    const valueUsd = inferTransferValue(eligibleTransfers.map(({ transfer }) => transfer));
    if (valueUsd === null) unknownValueCount += 1;
    matches.push({
      hash: transaction.hash || null,
      timestamp: transaction.timestamp || null,
      status: transaction.status || null,
      type: transaction.type || null,
      assets: [...new Set(eligibleTransfers.map(({ asset }) => asset.ticker))],
      tokens: [...new Set(eligibleTransfers.map(({ transfer }) => transfer.fungible))],
      valueUsd,
      source: "zerion history",
    });
  }

  const observedVolumeUsd = matches.reduce((sum, match) => sum + (match.valueUsd ?? 0), 0);
  return {
    observedVolumeUsd,
    unknownValueCount,
    matchedTransactions: matches.length,
    transactions: matches,
    caveat:
      "Zerion history does not expose Jumper route provenance; this is an observed estimate, not the official mission total.",
  };
}

export function volumeTier(volumeUsd) {
  const volume = Number.isFinite(Number(volumeUsd)) ? Number(volumeUsd) : 0;
  let selected = VOLUME_TIERS[0];
  for (const tier of VOLUME_TIERS) {
    if (volume >= tier.minimum) selected = tier;
  }
  return {
    minimum: selected.minimum,
    multiplier: selected.multiplier,
    xp: selected.xp,
    nextThreshold: selected.next,
    gapToNext: selected.next === null ? 0 : Math.max(0, selected.next - volume),
  };
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text.slice(0, 500) };
  }
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status} from ${url}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

export async function fetchMissionMetadata() {
  const params = new URLSearchParams();
  params.set("filters[Slug][$eq]", MISSION_SLUG);
  params.set("populate[0]", "tasks_verification");
  params.set("populate[1]", "tasks_verification.TaskWidgetInformation");
  const body = await fetchJson(`${STRAPI_BASE}/api/quests?${params.toString()}`);
  const mission = body?.data?.[0];
  if (!mission) throw new Error("Mission metadata was not found in Jumper Strapi");
  return {
    id: mission.id,
    documentId: mission.documentId,
    slug: mission.Slug,
    title: mission.Title,
    startDate: mission.StartDate,
    endDate: mission.EndDate,
    hasEnded: Boolean(mission.hasEnded),
    tasks: (mission.tasks_verification || []).map((task) => ({
      id: task.id,
      uuid: task.uuid,
      name: task.name,
      type: task.TaskType,
      required: Boolean(task.isRequired),
      hasTask: Boolean(task.hasTask),
      link: task.TaskWidgetInformation?.CTALink || null,
    })),
    source: `${STRAPI_BASE}/api/quests`,
  };
}

export async function fetchOfficialVerification(address) {
  if (!EVM_ADDRESS_RE.test(address)) throw new Error("--address must be a 20-byte EVM address (0x...)");
  return fetchJson(`${JUMPER_API_BASE}/tasks_verification/verify/${encodeURIComponent(address)}`);
}

function normalizeVerification(body, mission) {
  const entries = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : [];
  const missionIds = new Set([mission.documentId, mission.id, mission.slug, MISSION_SLUG].filter(Boolean).map(String));
  const relevant = entries.filter((entry) => missionIds.has(String(entry.questId)));
  const verifiedStepIds = new Set(relevant.map((entry) => String(entry.stepId)));
  const tasks = mission.tasks.map((task) => ({
    ...task,
    verified: verifiedStepIds.has(String(task.uuid)) || verifiedStepIds.has(String(task.id)),
  }));
  return { entries: relevant, tasks };
}

async function runZerionHistory(target, limit) {
  const zerionBin = process.env.ZERION_BIN || "zerion";
  try {
    const result = await execFileAsync(zerionBin, ["history", target, "--chain", "base", "--limit", String(limit), "--json"], {
      maxBuffer: 25 * 1024 * 1024,
      encoding: "utf8",
    });
    const payload = JSON.parse(result.stdout);
    if (payload?.error) throw new Error(payload.error.message || "Zerion history failed");
    return payload;
  } catch (error) {
    throw new Error(`Unable to read Base history through Zerion CLI: ${error.message}`);
  }
}

async function resolveTarget(options) {
  if (options.address) {
    if (!EVM_ADDRESS_RE.test(options.address)) throw new Error("--address must be a 20-byte EVM address (0x...)");
    return { address: options.address, target: options.address };
  }
  if (!options.wallet) throw new Error("Provide --address 0x... or --wallet <zerion-wallet-name>");
  const probe = await runZerionHistory(options.wallet, 1);
  const address = probe?.wallet?.address;
  if (!EVM_ADDRESS_RE.test(address || "")) {
    throw new Error("Zerion did not return an EVM address for that wallet; pass --address explicitly");
  }
  return { address, target: options.wallet };
}

export async function buildStatus(options) {
  const { address, target } = await resolveTarget(options);
  const limit = Math.min(Math.max(Number(options.limit || DEFAULT_HISTORY_LIMIT), 1), 1_000);
  const [missionResult, historyResult, verificationResult] = await Promise.allSettled([
    fetchMissionMetadata(),
    runZerionHistory(target, limit),
    fetchOfficialVerification(address),
  ]);

  const mission = missionResult.status === "fulfilled" ? missionResult.value : null;
  const history = historyResult.status === "fulfilled" ? inspectEligibleHistory(historyResult.value) : null;
  const official = mission && verificationResult.status === "fulfilled"
    ? normalizeVerification(verificationResult.value, mission)
    : null;
  const volume = history?.observedVolumeUsd || 0;
  const tier = volumeTier(volume);

  return {
    address,
    target,
    mission: mission
      ? {
          slug: mission.slug,
          title: mission.title,
          startDate: mission.startDate,
          endDate: mission.endDate,
          activeNow: !mission.hasEnded && (!mission.startDate || Date.now() >= Date.parse(mission.startDate)) && (!mission.endDate || Date.now() <= Date.parse(mission.endDate)),
          page: MISSION_PAGE,
          providerPage: RWA_PROVIDER_PAGE,
          tasks: official?.tasks || mission.tasks,
        }
      : { page: MISSION_PAGE, providerPage: RWA_PROVIDER_PAGE, error: missionResult.reason.message },
    observed: history || { error: historyResult.reason.message },
    estimate: {
      observedVolumeUsd: volume,
      tier,
      target100kGapUsd: Math.max(0, 100_000 - volume),
    },
    officialVerification: official
      ? { tasks: official.tasks, rawEntries: official.entries, source: `${JUMPER_API_BASE}/tasks_verification/verify/${address}` }
      : { error: verificationResult.reason?.message || "Unavailable", source: `${JUMPER_API_BASE}/tasks_verification/verify/${address}` },
    safety: {
      execution: "This tool never signs, broadcasts, or loops swaps.",
      eligibility: "Only swaps completed through Jumper RWA are intended to count; Zerion history cannot prove route provenance.",
      volume: "Do not trade solely to manufacture volume. Treat $100k as a high-risk target and use only real, independently justified trades.",
    },
  };
}

function parseArgs(argv) {
  const [command = "help", ...rest] = argv;
  const options = {};
  const positionals = [];
  for (let index = 0; index < rest.length; index += 1) {
    const item = rest[index];
    if (!item.startsWith("--")) {
      positionals.push(item);
      continue;
    }
    const [rawKey, inlineValue] = item.slice(2).split("=", 2);
    const key = rawKey.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (inlineValue !== undefined) options[key] = inlineValue;
    else if (rest[index + 1] && !rest[index + 1].startsWith("--")) options[key] = rest[++index];
    else options[key] = true;
  }
  options.positionals = positionals;
  return { command, options };
}

function print(value, options) {
  process.stdout.write(options.pretty ? `${JSON.stringify(value, null, 2)}\n` : `${JSON.stringify(value)}\n`);
}

function help() {
  return {
    usage: "npm run jumper:rwa -- <command> [options]",
    commands: {
      assets: "List the currently eligible Coinbase RWA assets and their Jumper URLs",
      status: "Read official Jumper verification plus an observed Base estimate from Zerion history",
      plan: "Show thresholds and a safe, non-executing plan for a target volume",
      open: "Open an eligible asset page in the default browser",
    },
    examples: [
      "npm run jumper:rwa -- assets --pretty",
      "npm run jumper:rwa -- status --address 0xYourBaseWallet --limit 200 --pretty",
      "npm run jumper:rwa -- status --wallet my-wallet --pretty",
      "npm run jumper:rwa -- plan --target 100000 --current 250 --pretty",
      "npm run jumper:rwa -- open --asset NVDA",
    ],
    note: "Actual swaps must be completed in Jumper RWA; this helper intentionally does not call zerion swap.",
  };
}

async function main(argv = process.argv.slice(2)) {
  const { command, options } = parseArgs(argv);
  if (command === "help" || command === "--help") return print(help(), options);
  if (command === "assets") {
    return print({ mission: MISSION_PAGE, provider: RWA_PROVIDER_PAGE, assets: ELIGIBLE_ASSETS.map((asset) => ({ ...asset, url: buildAssetUrl(asset.ticker), explorer: `https://basescan.org/token/${asset.address}` })) }, options);
  }
  if (command === "plan") {
    const current = parseNumeric(options.current) ?? 0;
    const target = parseNumeric(options.target) ?? 100_000;
    return print({ currentVolumeUsd: current, targetVolumeUsd: target, gapUsd: Math.max(0, target - current), currentTier: volumeTier(current), thresholds: VOLUME_TIERS, providerPage: RWA_PROVIDER_PAGE, execution: "Manual confirmation in Jumper RWA is required for every real trade; no automated loop is provided." }, options);
  }
  if (command === "open") {
    const url = buildAssetUrl(options.asset || "NVDA");
    const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
    const openerArgs = process.platform === "win32" ? ["/c", "start", "", url] : [url];
    await execFileAsync(opener, openerArgs);
    return print({ opened: url }, options);
  }
  if (command === "status") return print(await buildStatus(options), options);
  throw new Error(`Unknown command: ${command}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({ error: error.message })}\n`);
    process.exitCode = 1;
  });
}


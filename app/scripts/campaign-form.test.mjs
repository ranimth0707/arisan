import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultDraft, depositNote, isSocialPost, parseCookInput, restoreDraft, validateDraft } from "../src/lib/campaign-form.ts";

const valid = { ...defaultDraft, name: "Arisan Studio", description: "Untuk teman-teman studio.", socialUrl: "https://x.com/arisan/status/123456" };

test("no public post is required to open a private circle", () => {
  // Requiring one was backwards: the premise is a group who already know each
  // other, and making them announce it before they may start contradicts that.
  for (const step of [0, 1, 2]) {
    assert.equal(validateDraft({ ...valid, socialUrl: "" }, step), null, `step ${step}`);
  }
  // A link is still allowed, and still has to be a real post if given.
  assert.equal(validateDraft(valid, 2), null);
  assert.equal(validateDraft({ ...valid, socialUrl: "https://x.com/someone" }, 2)?.field, "socialUrl");
});
test("the deposit has no floor — the group decides it", () => {
  // There used to be a floor of contribution x seats, the whole commitment. It
  // meant only members who could already afford the pot were allowed into a
  // circle whose purpose is saving up to it. How much commitment to ask of your
  // own group is the organiser's call; the form explains rather than refuses.
  for (const deposit of ["0", "0.01", "0.1", "0.2", "5"]) {
    assert.equal(validateDraft({ ...valid, collateral: deposit }, 2), null, deposit);
  }
  assert.equal(validateDraft({ ...valid, collateral: "-1" }, 2)?.field, "collateral");
});

test("the form says what a deposit of that size actually buys", () => {
  // valid.contribution is 0.1.
  assert.equal(depositNote({ ...valid, collateral: "0.2" })?.tone, "ok");
  assert.match(depositNote({ ...valid, collateral: "0.2" }).message, /2 missed rounds/);
  assert.equal(depositNote({ ...valid, collateral: "0.1" })?.tone, "ok");
  assert.match(depositNote({ ...valid, collateral: "0.1" }).message, /one missed round/);

  // Below one contribution the pot really does shrink, and saying so is the
  // whole reason this is advisory instead of a block.
  const thin = depositNote({ ...valid, collateral: "0.01" });
  assert.equal(thin?.tone, "thin");
  assert.match(thin.message, /pot is smaller/);
  assert.equal(depositNote({ ...valid, collateral: "0" })?.tone, "thin");
});
for (const [field, value] of [
  ["name", " "], ["name", "a".repeat(49)], ["name", "漢".repeat(17)],
  ["description", ""], ["description", "a".repeat(281)],
  ["contribution", "0"], ["contribution", "-1"], ["contribution", "1e4"],
  ["contribution", "0.1234567891"], ["contribution", "NaN"], ["contribution", "999999999999999999999"],
  ["collateral", "-0.1"], ["collateral", "Infinity"], ["collateral", "999999999999999999"],
  ["seats", "1"], ["seats", "101"], ["seats", "2.5"], ["duration", "0"], ["duration", "toString"],
  ["socialUrl", "javascript:alert(1)"], ["socialUrl", "https://x.com/arisan"],
]) test("reject invalid " + field + ": " + value.slice(0, 24), () => {
  assert.equal(validateDraft({ ...valid, [field]: value }, 2)?.field, field);
});
for (const url of [
  "https://x.com/creator/status/123456", "https://www.instagram.com/p/ABC/",
  "https://www.threads.com/@creator/post/ABC", "https://facebook.com/creator/posts/123",
  "https://t.me/channel/123",
]) test("accept a supported post URL: " + url, () => assert.equal(isSocialPost(url), true));
for (const url of [
  "https://x.com.evil.test/person/status/123", "https://evil.test/x.com/status/123",
  "http://x.com/person/status/123", "https://user:pass@x.com/person/status/123",
  "https://x.com:8443/person/status/123", "https://github.com/ranimth0707/arisan",
]) test("reject non-post URL: " + url, () => assert.equal(isSocialPost(url), false));
test("parse amounts without floating-point rounding", () => {
  assert.equal(parseCookInput("0.1"), 100000000);
  assert.equal(parseCookInput("0.000000001"), 1);
  assert.equal(parseCookInput("1.234567891"), 1234567891);
  assert.equal(parseCookInput("9007199.254740991"), Number.MAX_SAFE_INTEGER);
  assert.equal(parseCookInput("9007199.254740992"), null);
  assert.equal(validateDraft({ ...valid, contribution: "9007199", collateral: "9007199" }, 2)?.field, "contribution");
});
test("restore draft safely after faucet navigation or corrupt browser storage", () => {
  assert.deepEqual(restoreDraft(JSON.stringify(valid)), valid);
  assert.deepEqual(restoreDraft("bad JSON"), defaultDraft);
  assert.deepEqual(restoreDraft("null"), defaultDraft);
  assert.equal(restoreDraft('{"name":null,"seats":3}').name, "");
  assert.equal(restoreDraft('{"name":"Saved","seats":3}').seats, "3");
});

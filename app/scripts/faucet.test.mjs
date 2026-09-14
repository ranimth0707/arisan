// The faucet's client key decides who shares a rate-limit bucket, so getting it
// wrong is the difference between a limit and a decoration.

import test from "node:test";
import assert from "node:assert/strict";

import { clientAddress } from "../api/faucet.js";

test("prefers the header the edge sets itself", () => {
  assert.equal(
    clientAddress({ "x-real-ip": "203.0.113.7", "x-forwarded-for": "1.1.1.1" }, null),
    "203.0.113.7",
  );
});

test("takes the last forwarded hop, not the first", () => {
  // A caller can prepend anything to x-forwarded-for. Only the rightmost entry
  // was written by infrastructure the caller does not control, so using the
  // first entry would let one machine mint a fresh quota per request.
  assert.equal(
    clientAddress({ "x-forwarded-for": "9.9.9.9, 8.8.8.8, 198.51.100.4" }, null),
    "198.51.100.4",
  );
});

test("a single forwarded hop is still the client", () => {
  assert.equal(clientAddress({ "x-forwarded-for": "198.51.100.4" }, null), "198.51.100.4");
});

test("falls back to the socket when no proxy header is present", () => {
  assert.equal(clientAddress({}, { remoteAddress: "127.0.0.1" }), "127.0.0.1");
});

test("blank headers do not become the shared 'empty' bucket", () => {
  assert.equal(
    clientAddress({ "x-real-ip": "   ", "x-forwarded-for": " , " }, { remoteAddress: "10.0.0.2" }),
    "10.0.0.2",
  );
});

test("gives up with a constant rather than undefined", () => {
  // Undefined would key every anonymous caller into one bucket, which is a
  // denial of service against everyone else rather than a limit on the abuser.
  assert.equal(clientAddress({}, null), "unknown");
});

import assert from "node:assert/strict";
import test from "node:test";
import { parseCookies } from "../src/lib/http.js";

test("parseCookies decodes valid cookie pairs", () => {
  assert.deepEqual(parseCookies("sid=test%20token; theme=dark"), {
    sid: "test token",
    theme: "dark"
  });
});

test("parseCookies tolerates malformed percent encoding", () => {
  assert.deepEqual(parseCookies("sid=bad%ZZtoken; ok=yes"), {
    sid: "bad%ZZtoken",
    ok: "yes"
  });
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { equal, hash, sign, rate, csv, attended } from "./security.js";
test("security primitives", () => {
  assert.ok(equal(sign("a", "key"), sign("a", "key")));
  assert.ok(!equal("a", "aa"));
  assert.notEqual(hash("a"), hash("b"));
});
test("attendance math", () => {
  assert.equal(rate(0, 0), 0);
  assert.equal(rate(3, 4), 75);
  assert.ok(attended("PRESENT"));
  assert.ok(attended("LATE"));
  assert.ok(!attended("ABSENT"));
  assert.ok(!attended("EXCUSED"));
});
test("CSV formula injection", () => {
  assert.equal(csv("=SUM(A1)"), '"\'=SUM(A1)"');
  assert.equal(csv('a"b'), '"a""b"');
});

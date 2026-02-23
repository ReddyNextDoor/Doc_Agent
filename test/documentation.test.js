import test from "node:test";
import assert from "node:assert/strict";
import { buildRepositorySnapshot, shouldIncludePath } from "../src/documentation.js";

test("shouldIncludePath excludes lockfiles and binaries", () => {
  assert.equal(shouldIncludePath("package-lock.json"), false);
  assert.equal(shouldIncludePath("assets/logo.png"), false);
  assert.equal(shouldIncludePath("src/index.js"), true);
});

test("buildRepositorySnapshot includes README fallback", () => {
  const snapshot = buildRepositorySnapshot("", [{ path: "src/main.js", content: "console.log('x')" }]);

  assert.match(snapshot, /README missing or empty/);
  assert.match(snapshot, /File: src\/main.js/);
});

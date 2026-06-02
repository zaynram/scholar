// src/server/util/p-limit.test.ts — foundation cycle 6.2 (Task 2.2)
//
// The single-slot mutex underpins the §13 annotation-reconciliation push path
// (lifecycle.ts:146 `pLimit(1)`): pdf-child round-trips must serialize so a
// concurrent annotations.list cannot interleave with an in-flight push. These
// tests pin the three load-bearing properties — rejects non-1 concurrency,
// serializes, and survives a rejecting task — without any process spawning.
import { test, expect } from "bun:test";
import pLimit from "./p-limit.ts";

test("rejects any concurrency other than 1 (the only shape lifecycle needs)", () => {
  expect(() => pLimit(2)).toThrow(/concurrency=1/);
  expect(() => pLimit(0)).toThrow(/concurrency=1/);
  expect(() => pLimit(1)).not.toThrow();
});

test("returns the wrapped task's resolved value to the caller", async () => {
  const limit = pLimit(1);
  expect(await limit(async () => "hi")).toBe("hi");
  expect(await limit(async () => 42)).toBe(42);
});

test("serializes: a queued task does not start until the prior one settles", async () => {
  const limit = pLimit(1);
  const events: string[] = [];
  let release!: () => void;
  const blocked = new Promise<void>((r) => {
    release = r;
  });

  const p1 = limit(async () => {
    events.push("1:start");
    await blocked;
    events.push("1:end");
  });
  const p2 = limit(async () => {
    events.push("2:start");
    events.push("2:end");
  });

  // While task 1 is blocked, task 2 must not have begun.
  await Bun.sleep(5);
  expect(events).toEqual(["1:start"]);

  release();
  await Promise.all([p1, p2]);
  // Strict ordering: 1 fully completes before 2 begins.
  expect(events).toEqual(["1:start", "1:end", "2:start", "2:end"]);
});

test("a rejecting task propagates to its caller but does NOT kill the queue", async () => {
  const limit = pLimit(1);
  const failing = limit(async () => {
    throw new Error("boom");
  });
  const following = limit(async () => "survived");

  await expect(failing).rejects.toThrow("boom");
  // The chain swallows the rejection internally so the next task still runs.
  expect(await following).toBe("survived");
});

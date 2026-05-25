// src/server/util/p-limit.ts — foundation cycle 6.2 (Task 2.2)
//
// 30-LOC inline single-slot mutex. Foundation ships this rather than depending
// on the `p-limit` npm package; the §6.1 dep manifest is closed and adding
// p-limit would require a foundation-only amendment for no real benefit.
// concurrency=1 is the only shape pdf/lifecycle.ts needs; we throw on anything else.

export default function pLimit(concurrency: number) {
  if (concurrency !== 1) {
    throw new Error("foundation's inline pLimit only supports concurrency=1");
  }
  let chain: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.then(fn, fn);
    // Swallow rejections on the chain so a single failure doesn't kill the queue.
    chain = run.catch(() => undefined);
    return run as Promise<T>;
  };
}

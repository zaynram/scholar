// src/server/ui/resource.test.ts — foundation cycle 6.1 (Task 1.10b)
//
// Foundation scaffolds registerUiResource as a no-op; frontends fills the body
// at cycle 6.9 (registers `ui://scholar/app.html` and serves the single-file
// React bundle).
import { test, expect } from "bun:test";
import { registerUiResource } from "./resource.ts";

test("registerUiResource is a foundation-scaffolded no-op (frontends fills at 6.9)", () => {
  expect(typeof registerUiResource).toBe("function");
  expect(registerUiResource.length).toBe(2);
  // Stub MUST NOT throw on a minimal server-shaped object + fake ctx.
  const fakeServer = { registerResource: () => {} } as never;
  const fakeCtx = {} as never;
  expect(() => registerUiResource(fakeServer, fakeCtx)).not.toThrow();
});

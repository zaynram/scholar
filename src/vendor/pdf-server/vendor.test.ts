// src/vendor/pdf-server/vendor.test.ts — foundation cycle 6.2 (Task 2.1)
//
// Drift canary: pins the anchor strings spec §7.2 cites from the upstream
// dist. Re-vendoring on a minor bump runs this test; any failure pins the
// affected behaviour to a versioned shim in src/server/pdf/lifecycle.ts.
import { test, expect } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const vendorRoot = import.meta.dir;

test("vendored pdf-server dist/index.js exists and contains §7.2 anchors", () => {
  const indexJs = join(vendorRoot, "dist", "index.js");
  expect(existsSync(indexJs)).toBe(true);
  const indexContent = readFileSync(indexJs, "utf8");
  const serverJsPath = join(vendorRoot, "dist", "server.js");
  const serverContent = existsSync(serverJsPath) ? readFileSync(serverJsPath, "utf8") : "";
  // Pin the §7.2 anchor: createServer is wired with useClientRoots, somewhere
  // in dist/index.js OR dist/server.js (upstream bundling may move the line).
  expect(indexContent.includes("useClientRoots") || serverContent.includes("useClientRoots")).toBe(
    true,
  );
  // Pin the §7.2 anchor: refreshRoots clears allowedLocalDirs.
  expect(
    indexContent.includes("allowedLocalDirs") || serverContent.includes("allowedLocalDirs"),
  ).toBe(true);
});

test("vendored upstream version matches expected pin", () => {
  const pkg = JSON.parse(readFileSync(join(vendorRoot, "package.json"), "utf8"));
  expect(pkg.name).toBe("@modelcontextprotocol/server-pdf");
  expect(pkg.version).toBe("1.7.2");
});

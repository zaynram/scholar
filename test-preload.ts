import { GlobalRegistrator } from "@happy-dom/global-registrator";

/**
 * Opt-in helpers for happy-dom DOM globals. UI tests (src/ui/**) call
 * registerDom() in beforeAll() and unregisterDom() in afterAll() to scope
 * the DOM shims to UI tests only — preserving Bun's native fetch/Response
 * for server tests that stub Bun.serve.
 *
 * History: the earlier global preload at bunfig.toml [test] preload
 * registered happy-dom globally and broke 4 server tests (prompts ×2,
 * digest ×1, arxiv ×1) where the happy-dom Response/fetch override
 * collided with Bun.serve-based test stubs. Switched to opt-in here at
 * chore foundation-isolate-happy-dom-to-ui-tests-only.
 */
export function registerDom(): void {
  GlobalRegistrator.register();
}

export function unregisterDom(): void {
  GlobalRegistrator.unregister();
}

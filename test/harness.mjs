/**
 * Harness for pi-model-pin.
 *
 * Simulates exactly how pi treats extension modules and factories:
 *   - within a process, the module is loaded once; the factory re-runs with a
 *     FRESH ExtensionAPI for every session (/new). Module-level state is shared.
 *   - a new process = a fresh module evaluation (pinned state gone).
 *
 * Usage: npm test   (or: node test/harness.mjs)
 */
import { createJiti } from "jiti";

const extUrl = new URL("../index.ts", import.meta.url).href;

// --- mocks ------------------------------------------------------------------

const DEFAULT = { provider: "provider", id: "default-model" };
const GOOD = { provider: "provider", id: "non-default-model" };
const ALT = { provider: "openai", id: "gpt-x" };

function makeAPI(opts = {}) {
  const handlers = new Map();
  const commands = new Map();
  const api = {
    called: [], // setModel calls
    on(event, fn) {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event).push(fn);
    },
    registerCommand(name, def) {
      commands.set(name, def.handler);
    },
    async setModel(model) {
      api.called.push({ provider: model.provider, id: model.id });
      // Overridable so tests can simulate auth being unavailable.
      return opts.setModelResult ?? true;
    },
    async emit(eventName, event, ctx) {
      for (const h of handlers.get(eventName) ?? []) await h(event, ctx);
    },
    async runCommand(name, ctx) {
      await commands.get(name)?.(undefined, ctx);
    },
  };
  return api;
}

// ctx.ui.setStatus on a real ui ctx; our mock surfaces calls for assertions.
function makeCtx(currentModel, opts = {}) {
  const ctx = {
    model: currentModel,
    hasUI: opts.hasUI ?? false,
    ui: null,
    __notify: 0,
    modelRegistry: {
      find(provider, id) {
        // Overridable so tests can simulate a model that left the catalog.
        if (typeof opts.find === "function") return opts.find(provider, id);
        return { provider, id };
      },
    },
    __notifyMsgs: [],
    __status: null,
  };
  ctx.ui = {
    setStatus(_id, text) {
      ctx.__status = text;
    },
    theme: {
      // mirrors pi's Theme.fg(color, text); mock returns plain text
      fg(_color, text) {
        return text;
      },
    },
    notify(msg) {
      ctx.__notify++;
      ctx.__notifyMsgs.push(msg);
    },
  };
  return ctx;
}

const startup = (ctx) => ({ type: "session_start", reason: "startup" });
const newSession = (ctx) => ({ type: "session_start", reason: "new" });
const resume = (ctx) => ({ type: "session_start", reason: "resume" });
const pick = (model, source = "set") => ({ type: "model_select", model, previousModel: undefined, source });

// --- test runner ------------------------------------------------------------

let pass = 0;
let fail = 0;
const results = [];

function check(name, cond, extra = "") {
  if (cond) {
    pass++;
    results.push(`  ✓ ${name}`);
  } else {
    fail++;
    results.push(`  ✗ ${name} ${extra}`);
  }
}

// --- Use case 1: keep a pinned model across /new within one process ---------
// Baseline: the default is captured at startup and never needs re-applying.
const loader1 = createJiti(import.meta.url, { moduleCache: false });
const factory1 = await loader1.import(extUrl, { default: true });

const uc1a = makeAPI();
await factory1(uc1a);
await uc1a.emit("session_start", startup(DEFAULT), makeCtx(DEFAULT));
check("Use case 1: startup does not call setModel", uc1a.called.length === 0);

// Picking a non-default model records a pin without switching immediately.
const uc1b = makeAPI();
await factory1(uc1b);
await uc1b.emit("session_start", startup(DEFAULT), makeCtx(DEFAULT)); // idempotent baseline
await uc1b.emit("model_select", pick(GOOD), makeCtx(GOOD));
check("Use case 1: picking a non-default model does not call setModel", uc1b.called.length === 0);

// /new starts on the default, so the extension re-applies the pinned model.
const uc1c = makeAPI();
await factory1(uc1c);
await uc1c.emit("session_start", newSession(DEFAULT), makeCtx(DEFAULT));
check(
  "Use case 1: /new re-applies the pinned model",
  uc1c.called.length === 1 && uc1c.called[0].provider === GOOD.provider && uc1c.called[0].id === GOOD.id,
  `got ${JSON.stringify(uc1c.called)}`,
);
// pi emits model_select("set") for the setModel call above -> the pin must survive.
await uc1c.emit("model_select", pick(GOOD), makeCtx(GOOD));

// A second /new keeps it.
const uc1d = makeAPI();
await factory1(uc1d);
await uc1d.emit("session_start", newSession(DEFAULT), makeCtx(DEFAULT));
check(
  "Use case 1: a second /new keeps the pinned model",
  uc1d.called.length === 1 && uc1d.called[0].id === GOOD.id,
  `got ${JSON.stringify(uc1d.called)}`,
);

// Selecting the process default again clears the pin.
const uc1e = makeAPI();
await factory1(uc1e);
await uc1e.emit("model_select", pick(DEFAULT), makeCtx(DEFAULT));
const uc1f = makeAPI();
await factory1(uc1f);
await uc1f.emit("session_start", newSession(DEFAULT), makeCtx(DEFAULT));
check("Use case 1: returning to the default un-pins /new", uc1f.called.length === 0, `got ${JSON.stringify(uc1f.called)}`);

// A later non-default pick replaces the pinned value.
const uc1g = makeAPI();
await factory1(uc1g);
await uc1g.emit("model_select", pick(ALT), makeCtx(ALT));
const uc1h = makeAPI();
await factory1(uc1h);
await uc1h.emit("session_start", newSession(DEFAULT), makeCtx(DEFAULT));
check(
  "Use case 1: a later selection replaces the pinned model",
  uc1h.called.length === 1 && uc1h.called[0].id === ALT.id,
  `got ${JSON.stringify(uc1h.called)}`,
);

// --- Use case 2: a brand-new process starts on the configured default -------
const loader2 = createJiti(import.meta.url, { moduleCache: false });
const factory2 = await loader2.import(extUrl, { default: true }); // fresh module

const uc2a = makeAPI();
await factory2(uc2a);
await uc2a.emit("session_start", startup(DEFAULT), makeCtx(DEFAULT));
const uc2b = makeAPI();
await factory2(uc2b);
await uc2b.emit("session_start", newSession(DEFAULT), makeCtx(DEFAULT)); // /new before any /model
check(
  "Use case 2: /new before any /model keeps the configured default",
  uc2b.called.length === 0,
  `got ${JSON.stringify(uc2b.called)}`,
);
await uc2b.emit("model_select", pick(GOOD), makeCtx(GOOD));
const uc2c = makeAPI();
await factory2(uc2c);
await uc2c.emit("session_start", newSession(DEFAULT), makeCtx(DEFAULT));
check(
  "Use case 2: after picking a model, /new pins it",
  uc2c.called.length === 1 && uc2c.called[0].id === GOOD.id,
  `got ${JSON.stringify(uc2c.called)}`,
);

// --- Use case 3: the first session is a /resume -----------------------------
const loader3 = createJiti(import.meta.url, { moduleCache: false });
const factory3 = await loader3.import(extUrl, { default: true });

const uc3a = makeAPI();
await factory3(uc3a);
await uc3a.emit("session_start", resume(DEFAULT), makeCtx(DEFAULT));

// The resumed session's model becomes the process baseline, so selecting *it*
// again must not create a pin.
await uc3a.emit("model_select", pick(DEFAULT), makeCtx(DEFAULT));
const uc3b = makeAPI();
await factory3(uc3b);
await uc3b.emit("session_start", newSession(DEFAULT), makeCtx(DEFAULT));
check(
  "Use case 3: the resumed model becomes the process baseline",
  uc3b.called.length === 0,
  `got ${JSON.stringify(uc3b.called)}`,
);

// ...and a later non-default pick is still pinned across /new.
await uc3a.emit("model_select", pick(GOOD), makeCtx(GOOD));
const uc3c = makeAPI();
await factory3(uc3c);
await uc3c.emit("session_start", newSession(DEFAULT), makeCtx(DEFAULT));
check(
  "Use case 3: /new still pins a later selection",
  uc3c.called.length === 1 && uc3c.called[0].id === GOOD.id,
  `got ${JSON.stringify(uc3c.called)}`,
);

// --- Use case 4: inspect the pin with /pin-status and the footer ------------
const loader4 = createJiti(import.meta.url, { moduleCache: false });
const factory4 = await loader4.import(extUrl, { default: true });

// No pin (default model in effect) -> /pin-status must NOT claim it's pinned.
const uc4a = makeAPI();
await factory4(uc4a);
const ctx4a = makeCtx(DEFAULT, { hasUI: true });
await uc4a.emit("session_start", startup(DEFAULT), ctx4a);
await uc4a.runCommand("pin-status", ctx4a);
const uc4aMsg = ctx4a.__notifyMsgs.join(" ");
check(
  "Use case 4: /pin-status reports no pin for the default",
  uc4aMsg.includes("No model pinned") && !uc4aMsg.includes("Pinned:"),
  `got "${uc4aMsg}"`,
);
check(
  "Use case 4: the footer has no pinned indicator on the default",
  !String(ctx4a.__status ?? "").includes("Pinned"),
  `got "${ctx4a.__status}"`,
);

// Pinned model -> /pin-status names it explicitly.
const uc4b = makeAPI();
await factory4(uc4b);
await uc4b.emit("session_start", startup(DEFAULT), makeCtx(DEFAULT));
await uc4b.emit("model_select", pick(GOOD), makeCtx(GOOD));
const ctx4b = makeCtx(GOOD, { hasUI: true });
await uc4b.runCommand("pin-status", ctx4b);
const uc4bMsg = ctx4b.__notifyMsgs.join(" ");
check(
  "Use case 4: /pin-status reports the pinned model",
  uc4bMsg.includes(`Pinned: ${GOOD.provider}/${GOOD.id}`),
  `got "${uc4bMsg}"`,
);

// --- Use case 5: /new confirms the restored pin -----------------------------
const loader5 = createJiti(import.meta.url, { moduleCache: false });
const factory5 = await loader5.import(extUrl, { default: true });
const uc5a = makeAPI();
await factory5(uc5a);
await uc5a.emit("session_start", startup(DEFAULT), makeCtx(DEFAULT));
await uc5a.emit("model_select", pick(GOOD), makeCtx(GOOD));
const ctx5 = makeCtx(DEFAULT, { hasUI: true });
const uc5b = makeAPI();
await factory5(uc5b);
await uc5b.emit("session_start", newSession(DEFAULT), ctx5);
check(
  "Use case 5: /new keeps the pinned model and notifies",
  uc5b.called.length === 1 && ctx5.__notify === 1,
  `setModel=${JSON.stringify(uc5b.called)} notify=${ctx5.__notify}`,
);

// --- Use case 6: drop the pin with /unpin -----------------------------------
const loader6 = createJiti(import.meta.url, { moduleCache: false });
const factory6 = await loader6.import(extUrl, { default: true });
const uc6a = makeAPI();
await factory6(uc6a);
await uc6a.emit("session_start", startup(DEFAULT), makeCtx(DEFAULT));
await uc6a.emit("model_select", pick(GOOD), makeCtx(GOOD));
const ctx6 = makeCtx(GOOD, { hasUI: true });
await uc6a.runCommand("unpin", ctx6);
check(
  "Use case 6: /unpin notifies that the default will be used",
  ctx6.__notifyMsgs.some((m) => m.includes("unpinned")),
  `got ${JSON.stringify(ctx6.__notifyMsgs)}`,
);
const uc6b = makeAPI();
await factory6(uc6b);
await uc6b.emit("session_start", newSession(DEFAULT), makeCtx(DEFAULT));
check(
  "Use case 6: /new no longer applies the pin after /unpin",
  uc6b.called.length === 0,
  `got ${JSON.stringify(uc6b.called)}`,
);

// --- Use case 7: the pinned model leaves the catalog ------------------------
const loader7 = createJiti(import.meta.url, { moduleCache: false });
const factory7 = await loader7.import(extUrl, { default: true });
const uc7a = makeAPI();
await factory7(uc7a);
await uc7a.emit("session_start", startup(DEFAULT), makeCtx(DEFAULT));
await uc7a.emit("model_select", pick(GOOD), makeCtx(GOOD));
const ctx7 = makeCtx(DEFAULT, { hasUI: true, find: () => undefined });
const uc7b = makeAPI();
await factory7(uc7b);
await uc7b.emit("session_start", newSession(DEFAULT), ctx7);
check(
  "Use case 7: /new warns and does not call setModel",
  uc7b.called.length === 0 &&
  ctx7.__notifyMsgs.some((m) => m.includes("no longer available")),
  `setModel=${JSON.stringify(uc7b.called)} notify=${JSON.stringify(ctx7.__notifyMsgs)}`,
);
const uc7c = makeAPI();
await factory7(uc7c);
await uc7c.emit("session_start", newSession(DEFAULT), makeCtx(DEFAULT));
check(
  "Use case 7: the pin is cleared so later /new stays on the default",
  uc7c.called.length === 0,
  `got ${JSON.stringify(uc7c.called)}`,
);

// --- Use case 8: the pinned model loses auth --------------------------------
const loader8 = createJiti(import.meta.url, { moduleCache: false });
const factory8 = await loader8.import(extUrl, { default: true });
const uc8a = makeAPI();
await factory8(uc8a);
await uc8a.emit("session_start", startup(DEFAULT), makeCtx(DEFAULT));
await uc8a.emit("model_select", pick(GOOD), makeCtx(GOOD));
const ctx8 = makeCtx(DEFAULT, { hasUI: true });
const uc8b = makeAPI({ setModelResult: false });
await factory8(uc8b);
await uc8b.emit("session_start", newSession(DEFAULT), ctx8);
check(
  "Use case 8: /new warns without crashing",
  uc8b.called.length === 1 &&
  ctx8.__notifyMsgs.some((m) => m.includes("auth not configured")),
  `setModel=${JSON.stringify(uc8b.called)} notify=${JSON.stringify(ctx8.__notifyMsgs)}`,
);
// The pin is intentionally retained so a later /new retries once auth is back.
const uc8c = makeAPI();
await factory8(uc8c);
await uc8c.emit("session_start", newSession(DEFAULT), makeCtx(DEFAULT));
check(
  "Use case 8: the pin is retained and retried on the next /new",
  uc8c.called.length === 1 && uc8c.called[0].id === GOOD.id,
  `got ${JSON.stringify(uc8c.called)}`,
);

// --- Use case 9: /reload clears the pin -------------------------------------
const loader9 = createJiti(import.meta.url, { moduleCache: false });
const factory9 = await loader9.import(extUrl, { default: true });
const uc9a = makeAPI();
await factory9(uc9a);
await uc9a.emit("session_start", startup(DEFAULT), makeCtx(DEFAULT));
await uc9a.emit("model_select", pick(GOOD), makeCtx(GOOD));
// /reload re-baselines on the configured default and clears the pin.
const ctx9 = makeCtx(DEFAULT, { hasUI: true });
await uc9a.emit("session_start", { type: "session_start", reason: "reload" }, ctx9);
check(
  "Use case 9: /reload clears the pin and footer indicator",
  !String(ctx9.__status ?? "").includes("Pinned"),
  `got "${ctx9.__status}"`,
);
const uc9b = makeAPI();
await factory9(uc9b);
await uc9b.emit("session_start", newSession(DEFAULT), makeCtx(DEFAULT));
check(
  "Use case 9: /new uses the default after /reload",
  uc9b.called.length === 0,
  `got ${JSON.stringify(uc9b.called)}`,
);

// --- Use case 10: pin a Ctrl+P selection (source "cycle") -------------------
const loader10 = createJiti(import.meta.url, { moduleCache: false });
const factory10 = await loader10.import(extUrl, { default: true });
const uc10a = makeAPI();
await factory10(uc10a);
await uc10a.emit("session_start", startup(DEFAULT), makeCtx(DEFAULT));
await uc10a.emit("model_select", pick(GOOD, "cycle"), makeCtx(GOOD));
const uc10b = makeAPI();
await factory10(uc10b);
await uc10b.emit("session_start", newSession(DEFAULT), makeCtx(DEFAULT));
check(
  "Use case 10: a Ctrl+P selection is pinned across /new",
  uc10b.called.length === 1 && uc10b.called[0].id === GOOD.id,
  `got ${JSON.stringify(uc10b.called)}`,
);

// --- Use case 11: ignore restore-sourced model events -----------------------
const loader11 = createJiti(import.meta.url, { moduleCache: false });
const factory11 = await loader11.import(extUrl, { default: true });
const uc11a = makeAPI();
await factory11(uc11a);
await uc11a.emit("session_start", startup(DEFAULT), makeCtx(DEFAULT));
await uc11a.emit("model_select", pick(GOOD, "restore"), makeCtx(GOOD));
const uc11b = makeAPI();
await factory11(uc11b);
await uc11b.emit("session_start", newSession(DEFAULT), makeCtx(DEFAULT));
check(
  "Use case 11: a restore-sourced event does not create a pin",
  uc11b.called.length === 0,
  `got ${JSON.stringify(uc11b.called)}`,
);

// --- Use case 12: a different working directory resets the pin --------------
// A cwd change makes pi clear the cached extension factory, so the module is
// re-evaluated. A fresh jiti loader models exactly that reset.
const loader12 = createJiti(import.meta.url, { moduleCache: false });
const factory12 = await loader12.import(extUrl, { default: true });
const uc12a = makeAPI();
await factory12(uc12a);
await uc12a.emit("session_start", startup(DEFAULT), makeCtx(DEFAULT));
await uc12a.emit("model_select", pick(GOOD), makeCtx(GOOD));
// New cwd => factory re-imported => pin is gone.
const factory12b = await createJiti(import.meta.url, { moduleCache: false }).import(extUrl, { default: true });
const uc12b = makeAPI();
await factory12b(uc12b);
await uc12b.emit("session_start", startup(DEFAULT), makeCtx(DEFAULT));
const uc12c = makeAPI();
await factory12b(uc12c);
await uc12c.emit("session_start", newSession(DEFAULT), makeCtx(DEFAULT));
check(
  "Use case 12: /new uses the default after a cwd change",
  uc12c.called.length === 0,
  `got ${JSON.stringify(uc12c.called)}`,
);

// --- results ----------------------------------------------------------------
console.log("\npi-model-pin harness\n" + "-".repeat(30));
console.log(results.join("\n"));
console.log("-".repeat(30));
console.log(`PASS ${pass}  FAIL ${fail}`);
process.exit(fail > 0 ? 1 : 0);

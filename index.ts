/**
 * pi-model-pin
 *
 * Keep the model you explicitly pick with `/model` (or Ctrl+P cycling) across
 * `/new` sessions *within the same pi process* — but always fall back to the
 * configured default model when you start a **new pi process** (for example in
 * a new terminal tab).
 *
 * Semantics
 * ---------
 *   /model PROVIDER/MODEL      pick a non-default model
 *   /new                       fresh session, still on PROVIDER/MODEL  <- kept
 *   (exit, new terminal) pi    back on the configured default model  <- reset
 *   /model <default model>     switches back to default -> /new no longer keeps it
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

interface ModelRef {
  provider: string;
  id: string;
}

/**
 * Module-level state. Survives `/new` inside one process and is discarded when
 * a fresh pi process loads this module.
 */
let processDefault: ModelRef | undefined; // model in effect
let pinned: ModelRef | undefined; // last explicitly selected model
let baselined = false;

const modelKey = (m: ModelRef | undefined): string | undefined =>
  m ? `${m.provider}/${m.id}` : undefined;

const fromModel = (m: { provider: string; id: string } | undefined): ModelRef | undefined =>
  m ? { provider: m.provider, id: m.id } : undefined;

// Info notifications
function notifyInfo(ctx: ExtensionContext, message: string) {
  if (!ctx.hasUI) return;

  ctx.ui.notify(message, "info");
}

function updateStatus(ctx?: ExtensionContext) {
  if (!ctx?.hasUI) return;

  // Footer distinguishes a pinned model from the plain default
  try {
    ctx.ui.setStatus("pi-model-pin", pinned ? ctx.ui.theme.fg("success", "Pinned model") : undefined);
  } catch (error) {
    console.error("[pi-model-pin] failed to update status:", error);
  }
}

export default function (pi: ExtensionAPI) {
  // Track explicit model selections while this process runs
  pi.on("model_select", async (event, ctx) => {
    if (event.source === "restore") return;
    if (!baselined) return;

    const chosen = fromModel(event.model);

    // Explicitly returning to the process-default model clears the pinned model
    pinned = chosen && modelKey(chosen) !== modelKey(processDefault) ? chosen : undefined;
    updateStatus(ctx);
  });

  // (Re)baseline at the first session, re-apply at /new
  pi.on("session_start", async (event, ctx) => {
    if (!baselined || event.reason === "startup" || event.reason === "reload") {
      processDefault = fromModel(ctx.model);
      pinned = undefined;
      baselined = true;
      updateStatus(ctx);

      return;
    }

    // resume/fork restore their own recorded model
    if (event.reason !== "new") return;

    // A /new session inside the same process to keep the pinned model
    if (!pinned) {
      updateStatus(ctx);

      return;
    }

    // Snapshot the pin and check if it's still resolvable
    const target = pinned;
    const current = modelKey(fromModel(ctx.model));
    if (modelKey(target) === current) {
      updateStatus(ctx);

      return;
    }

    const model = ctx.modelRegistry.find(target.provider, target.id);
    if (!model) {
      const gone = `${target.provider}/${target.id}`;
      pinned = undefined; // no longer resolvable in this session's catalog
      if (ctx.hasUI) {
        ctx.ui.notify(
          `${gone} is no longer available, default model used.`,
          "warning",
        );
      }
      updateStatus(ctx);

      return;
    }

    const ok = await pi.setModel(model);
    if (ok) {
      notifyInfo(ctx, `Pinned model: ${target.provider}/${target.id}`);
    } else if (ctx.hasUI) {
      ctx.ui.notify(
        `Couldn't keep ${target.provider}/${target.id} (auth not configured). You need to login again.`,
        "error",
      );
    }

    updateStatus(ctx);
  });

  // Commands to inspect and clear the pinned model
  pi.registerCommand("pin-status", {
    description: "Show which model /new will keep (pinned model, if any)",
    handler: async (_args, ctx) => {
      const label = pinned
        ? `Pinned: ${pinned.provider}/${pinned.id}`
        : "No model pinned";

      if (ctx.hasUI) notifyInfo(ctx, label);
      else console.log(`[pin-status] ${label}`);
    },
  });

  pi.registerCommand("unpin", {
    description: "Drop the pinned model so the next /new uses the default",
    handler: async (_args, ctx) => {
      pinned = undefined;

      updateStatus(ctx);
      notifyInfo(ctx, "Model unpinned, default model will be used.");
    },
  });
}

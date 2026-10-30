import "@lophn/ui/tokens.css";
import "@lophn/ui/base.css";
import "../chrome.css";
import { t } from "@lophn/i18n";
import type { OverlayApi } from "../../ipc/overlay.ts";
import { overlayRegistry } from "./registry.ts";
import { surfaceMount } from "./surfaces/surface.tsx";
import styles from "./entry.module.css";

declare global {
  var lophnShell: OverlayApi;
}
const root = document.getElementById("root");
if (root) {
  root.className = styles.root;
  const status = document.createElement("aside");
  status.className = styles.status;
  status.hidden = true;
  const text = document.createElement("p");
  text.textContent = t("common.overlay.unavailable");
  const retry = document.createElement("button");
  retry.textContent = t("common.button.retry");
  status.append(text, retry);
  document.body.append(status);
  const registry = overlayRegistry(
    root,
    globalThis.lophnShell,
    styles,
    () => {
      status.hidden = false;
    },
    surfaceMount(),
  );
  retry.addEventListener("click", () => {
    status.hidden = true;
    registry.retryReady();
  });
  globalThis.addEventListener(
    "pagehide",
    () => {
      registry.dispose();
      status.remove();
    },
    { once: true },
  );
}

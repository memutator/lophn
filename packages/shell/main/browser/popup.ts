// window.open 결정. 크기를 준 popup은 floated 탭, 아닌 것(target=_blank)은 docked 탭이다.
import { decideNavigation } from "./navigation.ts";

export type PopupPlacement =
  | { kind: "docked" }
  | { kind: "floated"; width: number; height: number };

export type PopupDecision =
  | { action: "allow"; url: string; placement: PopupPlacement }
  | {
      action: "deny";
      reason: "unparseable" | "scheme" | "credentials" | "no-activation";
      external?: true;
    };

/** `width`, `height`만 읽는다. 양의 정수(소수는 내림)가 아니면 없는 것이다. */
export function parseWindowFeatures(features: string): {
  width?: number;
  height?: number;
} {
  const out: { width?: number; height?: number } = {};
  for (const part of features.split(",")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim().toLowerCase();
    if (key !== "width" && key !== "height") continue;
    const text = part.slice(eq + 1).trim();
    if (!/^\d+(\.\d+)?$/.test(text)) continue;
    const value = Math.floor(Number(text));
    if (value > 0) out[key] = value;
  }
  return out;
}

export function decidePopup(input: {
  url: string;
  features: string;
  activated: boolean;
}): PopupDecision {
  const nav = decideNavigation({ url: input.url, isMainFrame: true });
  if (!nav.allow) {
    return nav.external
      ? { action: "deny", reason: nav.reason, external: true }
      : { action: "deny", reason: nav.reason };
  }
  if (!input.activated) return { action: "deny", reason: "no-activation" };
  const { width, height } = parseWindowFeatures(input.features);
  return {
    action: "allow",
    url: input.url,
    placement:
      width !== undefined && height !== undefined
        ? { kind: "floated", width, height }
        : { kind: "docked" },
  };
}

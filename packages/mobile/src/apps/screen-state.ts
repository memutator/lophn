// What the app screen shows, decided from the facts the hook gathers (without React Native, so it is tested alone). A guest
// that has reached `running` stays on screen while the computer is away, the list is read again and the view is opened
// again, and goes away only for the reasons in `phone-screen.md`: a new bundle or epoch (a new key), Try again, the guest
// failing, the app not running on the computer, its screen entry gone, or the phone refusing it.
import type { PhoneCanRun } from "../../../protocol/apps/phone-screen.ts";
import type { BundleRefusal } from "./bundle.ts";
import type { GuestState } from "./guest/mod.ts";
import type { ViewState } from "./view.ts";

export interface ScreenFacts {
  /** Null: no computer on screen. */
  readonly computer: "connecting" | "connected" | "offline" | "update" | "revoked" | null;
  readonly list: "loading" | "ready" | "failed";
  /** The app's phone screen entry in the list (the last one read while the list is being read again). */
  readonly entry: boolean;
  readonly fits: PhoneCanRun | null;
  readonly bound: ViewState;
  readonly linked: boolean;
  /** The bundle on screen or being waited for: its hash, and whether it is the phone's to run. */
  readonly bundle: { readonly hash: string; readonly ok: boolean } | null;
  /** Counts Try again. */
  readonly attempt: number;
  /** `ViewState.open.epoch`. */
  readonly epoch: number;
  /** The last state the guest reported, with the key it ran under. */
  readonly guest: { readonly key: string; readonly state: GuestState } | null;
}

export type ScreenDecision =
  | { readonly kind: "loading" | "offline" | "stopped" | "failed" }
  | { readonly kind: "refused"; readonly reason: BundleRefusal }
  /** `away`: the computer is not reachable; the guest stays and the screen says so in a line. */
  | { readonly kind: "running"; readonly key: string; readonly away: boolean };

/** A new key mounts a new guest. */
export function guestKeyOf(facts: Pick<ScreenFacts, "bundle" | "attempt" | "epoch">): string | null {
  return facts.bundle?.ok === true ? `${facts.bundle.hash}:${facts.attempt}:${facts.epoch}` : null;
}

export function decideScreen(facts: ScreenFacts): ScreenDecision {
  const { computer, list, fits, bound } = facts;
  const key = guestKeyOf(facts);
  const mine = facts.guest !== null && facts.guest.key === key ? facts.guest.state : null;
  const failedGuest = mine !== null && typeof mine === "object";

  if (mine === "running" && key !== null) {
    // Held: what the person has on screen is kept through whatever is only about reaching the computer.
    if (list === "ready" && (!facts.entry || fits === null)) return { kind: "stopped" };
    if (fits !== null && !fits.ok) return { kind: "refused", reason: fits.reason };
    if (bound.kind === "stopped") return { kind: "stopped" };
    if (bound.kind === "failed") return { kind: "failed" };
    if (!facts.linked || computer === null) return { kind: "loading" };
    return { kind: "running", key, away: computer !== "connected" };
  }

  if (computer === null || computer === "connecting") return { kind: "loading" };
  if (computer !== "connected") return { kind: "offline" };
  if (list === "failed") return { kind: "failed" };
  if (list === "loading") return { kind: "loading" };
  if (!facts.entry || fits === null) return { kind: "stopped" };
  if (!fits.ok) return { kind: "refused", reason: fits.reason };
  if (bound.kind === "stopped") return { kind: "stopped" };
  if (bound.kind === "failed") return { kind: "failed" };
  if (bound.kind === "opening" || !facts.linked) return { kind: "loading" };
  // A bundle of the release before stays on screen until the new one is ready.
  if (facts.bundle === null) return { kind: "loading" };
  if (!facts.bundle.ok || key === null) return { kind: "failed" };
  if (failedGuest) return { kind: "failed" };
  return { kind: "running", key, away: false };
}

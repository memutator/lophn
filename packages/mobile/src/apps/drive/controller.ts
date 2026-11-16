// The phone's side of `drive.*` (packages/protocol/phone/drive.ts), without React Native: which preview screens this
// phone shows, who drove them last, and whether the person took control. A request reaches the native module only for
// a view a preview screen of this phone registered for the asking computer; a live app screen never registers, so its
// view is "no preview" like any unknown id.
import type { z } from "zod";
import { err, type Result } from "../../../../base/mod.ts";
import type {
  DriveAct,
  DriveSnapshotOutput,
  driveActInputSchema,
  driveScreenshotInputSchema,
  driveScreenshotOutputSchema,
  driveSnapshotInputSchema,
  driveWaitInputSchema,
} from "../../../../protocol/phone/drive.ts";

export type DriveScreenshot = z.infer<typeof driveScreenshotOutputSchema>;

/** The native module (modules/lophn-drive), faked in tests. */
export interface DriveNative {
  snapshot(view: string): Promise<Result<DriveSnapshotOutput>>;
  act(view: string, snapshot: string, act: DriveAct): Promise<Result<Record<string, never>>>;
  screenshot(view: string, format: "jpeg" | "png"): Promise<Result<DriveScreenshot>>;
  waitText(view: string, text: string, timeoutMs: number): Promise<Result<{ found: boolean }>>;
}

/** The `drive.*` handlers of one computer's link (PhoneCtx.drive). */
export interface DrivePort {
  snapshot(input: z.output<typeof driveSnapshotInputSchema>): Promise<Result<DriveSnapshotOutput>>;
  act(input: z.output<typeof driveActInputSchema>): Promise<Result<Record<string, never>>>;
  screenshot(input: z.output<typeof driveScreenshotInputSchema>): Promise<Result<DriveScreenshot>>;
  wait(input: z.output<typeof driveWaitInputSchema>): Promise<Result<{ found: boolean }>>;
}

// The driving line stays this long after the last request.
export const DRIVING_SHOWN_MS = 60_000;

/** What the preview screen says under its top line about who drives it. */
export type DriveLine =
  | { readonly kind: "none" }
  | { readonly kind: "driving"; readonly by: string }
  | { readonly kind: "control" };

/** One open preview screen. */
export interface PreviewHandle {
  /** The view it shows now; a new bundle or another screen opens a new view. */
  show(view: string): void;
  takeControl(): void;
  handBack(): void;
  line(): DriveLine;
  /** Leaving the screen: its view is no longer driven, and taking control ends. */
  close(): void;
}

interface Preview {
  readonly computer: string;
  view: string | null;
  control: boolean;
  last: { by: string; at: number } | null;
}

export function lineOf(preview: Pick<Preview, "control" | "last">, now: number): DriveLine {
  if (preview.control) return { kind: "control" };
  if (preview.last !== null && now - preview.last.at < DRIVING_SHOWN_MS) {
    return { kind: "driving", by: preview.last.by };
  }
  return { kind: "none" };
}

const noPreview = (): Result<never> =>
  err({
    code: "unavailable",
    message: "No preview of this view is open on the phone.",
    details: { reason: "no_preview" },
  });

const takenOver = (): Result<never> =>
  err({
    code: "conflict",
    message: "The person took control of this screen.",
    details: { reason: "taken_over" },
  });

// The native module says screen_off when the screen is off or the window lost focus. A request only gets here while the
// app is in front (answerRequest), so the screen is on and something covers the preview: a sheet or dialog the app
// opened (its content is outside the screen lophn reads), the person's own menu, or a system panel. The core tells the
// agent what `covered` means (PHONE_TAB_TEXT.covered).
function uncovered<T>(result: Result<T>): Result<T> {
  if (result.ok || result.error.details?.["reason"] !== "screen_off") return result;
  return err({
    code: "unavailable",
    message: "Something covers the preview on the phone.",
    details: { reason: "covered" },
  });
}

export function createDrive(deps: { native: DriveNative; now: () => number }) {
  const previews = new Set<Preview>();
  const listeners = new Set<() => void>();
  const changed = () => {
    for (const listener of [...listeners]) listener();
  };

  // The preview a request is for, noting who asked; null when this phone shows no such view to that computer.
  function enter(computer: string, input: { view: string; by: string }): Preview | null {
    for (const preview of previews) {
      if (preview.computer !== computer || preview.view !== input.view) continue;
      preview.last = { by: input.by, at: deps.now() };
      changed();
      return preview;
    }
    return null;
  }

  return {
    /** A preview screen of `computer` opened. */
    open(computer: string): PreviewHandle {
      const preview: Preview = { computer, view: null, control: false, last: null };
      previews.add(preview);
      const set = (patch: Partial<Preview>) => {
        Object.assign(preview, patch);
        changed();
      };
      return {
        show: (view) => set({ view }),
        takeControl: () => set({ control: true }),
        handBack: () => set({ control: false }),
        line: () => lineOf(preview, deps.now()),
        close() {
          previews.delete(preview);
          changed();
        },
      };
    },

    /** Something about a preview changed: a request, take control, a view. */
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    port(computer: string): DrivePort {
      return {
        async snapshot(input) {
          if (!enter(computer, input)) return noPreview();
          return uncovered(await deps.native.snapshot(input.view));
        },
        async act(input) {
          const preview = enter(computer, input);
          if (!preview) return noPreview();
          if (preview.control) return takenOver();
          return uncovered(await deps.native.act(input.view, input.snapshot, input.act));
        },
        async screenshot(input) {
          if (!enter(computer, input)) return noPreview();
          return uncovered(await deps.native.screenshot(input.view, input.format));
        },
        async wait(input) {
          if (!enter(computer, input)) return noPreview();
          return uncovered(await deps.native.waitText(input.view, input.text, input.timeout_ms));
        },
      };
    },
  };
}

export type Drive = ReturnType<typeof createDrive>;

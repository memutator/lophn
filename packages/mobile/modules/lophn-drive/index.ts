// lophn-drive: reads and drives a guest screen (a user app's phone screen in GuestScreen) by its view id, for `drive.*`
// (packages/protocol/phone/drive.ts). It only finds the guest of a view; whether that view is a preview the agent may
// drive is the caller's check. Failures come back as Results, never thrown:
// - unavailable: the app is not in front (phone_in_background), the screen is off or the window has no focus
//   (screen_off), no guest of that view is showing (no_preview), or the build has no module (unsupported)
// - conflict: the node is not from the view's last snapshot, is gone or changed (stale_ref), or cannot be brought on
//   screen (off_screen)
// - invalid_input: type or fill on a node that takes no text, press Enter with no text field, scroll with nothing to scroll
// - internal: anything else, a screenshot over 1 MiB after a second JPEG try, an answer outside the contract
import { requireOptionalNativeModule } from "expo";
import type { z } from "zod";
import type { Result } from "../../../base/result.ts";
import { internalError } from "../../../base/errors.ts";
import {
  type DriveAct,
  type DriveSnapshotOutput,
  driveActOutputSchema,
  driveScreenshotOutputSchema,
  driveSnapshotOutputSchema,
  driveWaitOutputSchema,
} from "../../../protocol/phone/drive.ts";
import { missingModule, readAnswer } from "./src/answer.ts";

export type DriveScreenshot = z.infer<typeof driveScreenshotOutputSchema>;

interface Native {
  snapshot(view: string): Promise<string>;
  act(view: string, snapshot: string, act: string): Promise<string>;
  screenshot(view: string, format: string): Promise<string>;
  waitText(view: string, text: string, timeoutMs: number): Promise<string>;
  keepScreenOn(on: boolean): void;
}

const native = requireOptionalNativeModule<Native>("LophnDrive");

// Whether this build can drive screens at all (a phone without it does not offer `drive.*`).
export const driveAvailable = native !== null;

async function run<T>(ask: (n: Native) => Promise<string>, schema: z.ZodType<T>): Promise<Result<T>> {
  if (!native) return missingModule();
  try {
    return readAnswer(await ask(native), schema);
  } catch {
    return { ok: false, error: internalError() };
  }
}

// The guest's nodes on screen, and a scroll container's rows off screen (flag `offscreen`). Secure fields show "••••".
// Each call starts the view's node numbers at 1 and becomes the only snapshot `act` accepts.
export const snapshot = (view: string): Promise<Result<DriveSnapshotOutput>> =>
  run((n) => n.snapshot(view), driveSnapshotOutputSchema);

export const act = (view: string, snapshotId: string, action: DriveAct): Promise<Result<Record<string, never>>> =>
  run((n) => n.act(view, snapshotId, JSON.stringify(action)), driveActOutputSchema);

// The guest only, at most 1080 px on the long side; JPEG q80 (q60 if that is over 1 MiB) or PNG.
export const screenshot = (view: string, format: "jpeg" | "png"): Promise<Result<DriveScreenshot>> =>
  run((n) => n.screenshot(view, format), driveScreenshotOutputSchema);

// Looks for `text` in the names, values and text of the screen every 200 ms until `timeoutMs`.
export const waitText = (view: string, text: string, timeoutMs: number): Promise<Result<{ found: boolean }>> =>
  run((n) => n.waitText(view, text, timeoutMs), driveWaitOutputSchema);

// Keeps the phone screen on while a driven screen is open (the window's FLAG_KEEP_SCREEN_ON).
export function keepScreenOn(on: boolean): void {
  native?.keepScreenOn(on);
}

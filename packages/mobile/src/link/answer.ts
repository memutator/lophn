import type { z } from "zod";
import { err, type LophnError, type Result } from "../../../base/mod.ts";
import { capabilityFrom } from "../../../protocol/phone/capabilities.ts";
import type { PhoneCapability } from "../../../protocol/apps/phone-request.ts";
import {
  PHONE_KINDS,
  type PhoneKind,
  type PhoneUnavailableReason,
} from "../../../protocol/phone/kinds.ts";
import type {
  PhoneRequestFrame,
  PhoneResponseFrame,
} from "../../../protocol/phone/link.ts";
import type { DrivePort } from "../apps/drive/controller.ts";
import { CAPABILITY_HANDLERS, type CapabilityCtx } from "./capabilities.ts";

// What handlers may use. A new kind that needs another native call adds a port here, so tests can fake it.
export type PhoneCtx = CapabilityCtx & { drive: DrivePort };

export type PhoneHandler<K extends PhoneKind> = (
  input: z.infer<(typeof PHONE_KINDS)[K]["input"]>,
  ctx: PhoneCtx,
) => Promise<Result<z.infer<(typeof PHONE_KINDS)[K]["output"]>>>;

// The kinds this phone answers over the link: the capabilities a backend may ask (`capabilities.ts`, the same handlers a
// phone screen reaches directly) and `drive.*`. `answerRequest` and `hello.capabilities` follow from the keys, so a kind
// with no handler is "unsupported" and never advertised.
export const PHONE_HANDLERS: { [K in PhoneKind]?: PhoneHandler<K> } = {
  ...(Object.fromEntries(
    Object.entries(CAPABILITY_HANDLERS).filter(([name]) =>
      capabilityFrom(name as PhoneCapability, "backend"),
    ),
  ) as { [K in PhoneKind]?: PhoneHandler<K> }),
  "drive.snapshot": (input, ctx) => ctx.drive.snapshot(input),
  "drive.act": (input, ctx) => ctx.drive.act(input),
  "drive.screenshot": (input, ctx) => ctx.drive.screenshot(input),
  "drive.wait": (input, ctx) => ctx.drive.wait(input),
};

export function phoneCapabilities(): string[] {
  return Object.keys(PHONE_HANDLERS);
}

function unavailable(reason: PhoneUnavailableReason): LophnError {
  return {
    code: "unavailable",
    message: reason,
    details: { reason },
  };
}

export type AnswerDeps = {
  ctx: PhoneCtx;
  // False while the app is not in front. The phone is never woken, so nothing is read then.
  isActive: () => boolean;
  // Runs fn after ms; returns a cancel function.
  wait: (ms: number, fn: () => void) => () => void;
};

async function run(
  frame: PhoneRequestFrame,
  deps: AnswerDeps,
): Promise<Result<unknown>> {
  const kind = frame.kind as PhoneKind;
  const handler: PhoneHandler<PhoneKind> | undefined = Object.hasOwn(
    PHONE_HANDLERS,
    kind,
  )
    ? (PHONE_HANDLERS[kind] as PhoneHandler<PhoneKind>)
    : undefined;
  if (!handler) return err(unavailable("unsupported"));
  if (!deps.isActive()) return err(unavailable("phone_in_background"));
  const input = PHONE_KINDS[kind].input.safeParse(frame.input);
  if (!input.success) {
    return err({ code: "invalid_input", message: input.error.message });
  }
  try {
    return await handler(input.data as never, deps.ctx);
  } catch {
    return err({ code: "internal", message: "internal error" });
  }
}

// The `response` for a `request`, or undefined when the answer would come after the deadline (the core drops those).
export async function answerRequest(
  frame: PhoneRequestFrame,
  deps: AnswerDeps,
): Promise<PhoneResponseFrame | undefined> {
  let cancel = () => {};
  const late = new Promise<undefined>((resolve) => {
    cancel = deps.wait(frame.deadline_ms, () => resolve(undefined));
  });
  const result = await Promise.race([run(frame, deps), late]);
  cancel();
  if (!result) return undefined;
  return result.ok
    ? { type: "response", id: frame.id, ok: true, value: result.value }
    : { type: "response", id: frame.id, ok: false, error: result.error };
}

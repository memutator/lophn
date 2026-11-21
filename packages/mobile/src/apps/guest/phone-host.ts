// The phone half of one guest's phone capabilities, without React Native: answers a guest's `phone` messages. Who asks is
// only what the host knows (this host belongs to one view of one app; `granted` is that app's list from the computer or
// its install record). Nothing in the message names an app, a release or a grant.
import type { LophnError } from "../../../../base/mod.ts";
import type { PhoneCapability } from "../../../../protocol/apps/phone-request.ts";
import {
  capabilityFrom,
  isPhoneCapability,
  PHONE_CAPABILITY_TABLE,
} from "../../../../protocol/phone/capabilities.ts";
import type { JsonValue } from "../../../../protocol/base/json-values.ts";
import type { CAPABILITY_HANDLERS, CapabilityCtx } from "../../link/capabilities.ts";
import type { CallOutcome } from "./session.ts";

export interface PhoneHost {
  // What the guest may use now, for `init.phone`.
  capabilities(): string[];
  standIn: boolean;
  request(capability: string, input: JsonValue): Promise<CallOutcome>;
  // The guest is gone: an open interactive capability is closed.
  close(): void;
}

const fail = (
  code: string,
  message: string,
  extra: { reason?: string; capability?: string } = {},
): CallOutcome => ({
  ok: false,
  error: {
    code,
    message,
    ...(extra.reason === undefined ? {} : { reason: extra.reason }),
    ...(extra.capability === undefined
      ? {}
      : { permission: "phone.use" as const, scope: { capability: extra.capability } }),
  },
});

const failed = (error: LophnError): CallOutcome => {
  const reason = error.details?.["reason"];
  return fail(error.code, error.message, typeof reason === "string" ? { reason } : {});
};

export function createPhoneHost(options: {
  // The capabilities the app may use now. Live: its release's declaration and the person's grants. Preview: what the
  // previewed declaration declares (no grant exists for a preview, and a capability the app forgot to declare must fail
  // there as it will live). Read at every request.
  granted: () => readonly string[];
  // A preview view: nothing reaches the phone; the table's stand-in values answer.
  standIn: boolean;
  // False while the phone app is not in front. Checked when a request starts: an OS dialog or share sheet opened by a
  // running request does not fail it. A preview is not asked.
  isActive: () => boolean;
  handlers: typeof CAPABILITY_HANDLERS;
  ctx: CapabilityCtx;
  // Runs fn after ms; returns a cancel function.
  wait: (ms: number, fn: () => void) => () => void;
  // Closes what an interactive capability put on screen (the scanner).
  dismiss: () => void;
  // An interactive request (one that shows something to the person: the camera, a picker, the share sheet) opened (true) or
  // ended (false). The view uses it so a long stay there is not counted as the screen being left alone.
  onInteractive?: (open: boolean) => void;
}): PhoneHost {
  // One interactive capability at a time.
  let interactive = false;
  const setInteractive = (open: boolean) => {
    if (interactive === open) return;
    interactive = open;
    options.onInteractive?.(open);
  };
  const screenCapabilities = () =>
    Object.keys(PHONE_CAPABILITY_TABLE).filter((name) =>
      capabilityFrom(name as PhoneCapability, "screen"),
    );

  const forbidden = (capability: string) =>
    fail("forbidden", `phone.use ${JSON.stringify({ capability })} is not permitted`, { capability });

  async function run(capability: PhoneCapability, input: JsonValue): Promise<CallOutcome> {
    const spec = PHONE_CAPABILITY_TABLE[capability];
    const handler = options.handlers[capability] as
      | ((input: unknown, ctx: CapabilityCtx) => Promise<
          { ok: true; value: unknown } | { ok: false; error: LophnError }
        >)
      | undefined;
    if (handler === undefined) {
      return fail("unavailable", `${capability} is not in this build`, { reason: "unsupported" });
    }
    const parsed = spec.input.safeParse(input);
    if (!parsed.success) {
      return fail("invalid_input", `${capability} input is invalid`);
    }
    if (spec.interactive && interactive) {
      return fail("conflict", "another phone capability that needs the person is open");
    }
    if (spec.interactive) setInteractive(true);
    let cancel = () => {};
    const late = new Promise<CallOutcome>((resolve) => {
      cancel = options.wait(spec.deadline_ms, () => {
        if (spec.interactive) options.dismiss();
        resolve(fail("unavailable", `${capability} took too long`, { reason: "timeout" }));
      });
    });
    try {
      return await Promise.race([
        handler(parsed.data, options.ctx).then(
          (result): CallOutcome =>
            result.ok ? { ok: true, value: result.value as JsonValue } : failed(result.error),
          () => fail("internal", "internal error"),
        ),
        late,
      ]);
    } finally {
      cancel();
      if (spec.interactive) setInteractive(false);
    }
  }

  return {
    standIn: options.standIn,
    capabilities() {
      const granted = options.granted();
      return screenCapabilities().filter(
        (name) =>
          granted.includes(name) && (options.standIn || Object.hasOwn(options.handlers, name)),
      );
    },
    async request(capability, input) {
      if (!isPhoneCapability(capability) || !capabilityFrom(capability, "screen")) {
        return fail("invalid_input", `${capability} is not a phone capability`);
      }
      if (options.standIn) {
        return options.granted().includes(capability)
          ? { ok: true, value: PHONE_CAPABILITY_TABLE[capability].stand_in as JsonValue }
          : forbidden(capability);
      }
      if (!options.isActive()) {
        return fail("unavailable", "the phone app is not in front", { reason: "phone_in_background" });
      }
      if (!options.granted().includes(capability)) return forbidden(capability);
      return run(capability, input);
    },
    close() {
      if (interactive) {
        options.dismiss();
        // The guest is gone: its request no longer holds the view (the late result is dropped).
        setInteractive(false);
      }
    },
  };
}

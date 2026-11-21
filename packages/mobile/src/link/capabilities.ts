import type { z } from "zod";
import { err, ok, type Result } from "../../../base/mod.ts";
import type { PhoneCapability } from "../../../protocol/apps/phone-request.ts";
import {
  PHONE_CAPABILITY_TABLE,
  type PhoneCapabilityTable,
} from "../../../protocol/phone/capabilities.ts";
import { PHONE_OS_PERMISSION_DENIED } from "../../../protocol/phone/kinds.ts";
import { type LocationPort, locationGet } from "./location.ts";

// The capabilities of this phone, one handler each, for both ways in: the link (`answer.ts`, the computer's backend asks
// through core) and the guest host (`apps/guest/phone-host.ts`, a phone screen or a backend that runs on the phone asks
// directly). Each handler reaches the phone only through a port so tests fake it; `native.ts` has the real ones.

export type NetworkPort = {
  state(): Promise<z.infer<PhoneCapabilityTable["network.get"]["output"]>>;
};
export type HapticsPort = {
  play(kind: z.infer<PhoneCapabilityTable["haptics.play"]["input"]>["kind"]): Promise<void>;
};
export type ClipboardPort = {
  // null when the clipboard holds no text.
  readText(): Promise<string | null>;
  writeText(text: string): Promise<void>;
};
export type LinkingPort = {
  // False when no app on the phone can open the url.
  open(url: string): Promise<boolean>;
};
export type SharePort = {
  text(text: string, title?: string): Promise<void>;
};
export type ScanPort = {
  // True when the OS camera permission is granted. Asks the person only if they were never asked.
  permission(): Promise<boolean>;
  // Shows lophn's scanner over the app screen until a code is read or the person closes it (then cancelled).
  scan(): Promise<z.infer<PhoneCapabilityTable["code.scan"]["output"]>>;
};

// What a capability handler may use.
export type CapabilityCtx = {
  location: LocationPort;
  network: NetworkPort;
  haptics: HapticsPort;
  clipboard: ClipboardPort;
  linking: LinkingPort;
  share: SharePort;
  scanner: ScanPort;
};

export type CapabilityHandler<K extends PhoneCapability> = (
  input: z.infer<PhoneCapabilityTable[K]["input"]>,
  ctx: CapabilityCtx,
) => Promise<Result<z.infer<PhoneCapabilityTable[K]["output"]>>>;

// For the link: a capability that only a screen may ask never reaches it, so this is not run.
export const noScanner: ScanPort = {
  permission: async () => false,
  scan: async () => ({ cancelled: true }),
};

const done = () => ok({});

// A capability without a handler here is a type error.
const ALL_HANDLERS: { [K in PhoneCapability]: CapabilityHandler<K> } = {
  "location.get": locationGet,
  "network.get": async (_input, { network }) => ok(await network.state()),
  "haptics.play": async ({ kind }, { haptics }) => {
    await haptics.play(kind);
    return done();
  },
  "clipboard.read": async (_input, { clipboard }) =>
    ok({ text: await clipboard.readText() }),
  "clipboard.write": async ({ text }, { clipboard }) => {
    await clipboard.writeText(text);
    return done();
  },
  "code.scan": async (_input, { scanner }) => {
    if (!(await scanner.permission())) {
      return err({
        code: "forbidden",
        message: "camera permission is denied on the phone",
        details: { reason: PHONE_OS_PERMISSION_DENIED },
      });
    }
    return ok(await scanner.scan());
  },
  "link.open": async ({ url }, { linking }) =>
    (await linking.open(url))
      ? done()
      : err({
          code: "unavailable",
          message: "no app on the phone can open this link",
        }),
  "share.text": async ({ text, title }, { share }) => {
    await share.text(text, title);
    return done();
  },
};

// Build-time switch: capabilities a build leaves out, by name, comma separated (`EXPO_PUBLIC_LOPHN_PHONE_CAPABILITIES_OFF`,
// read once here). A left-out capability has no handler, so the phone neither says it has it nor runs it. A name that is
// not a capability stops the app at start: a typo must not leave a capability on.
const LEFT_OUT = (process.env.EXPO_PUBLIC_LOPHN_PHONE_CAPABILITIES_OFF ?? "")
  .split(",")
  .map((name: string) => name.trim())
  .filter((name: string) => name !== "");
for (const name of LEFT_OUT) {
  if (!Object.hasOwn(PHONE_CAPABILITY_TABLE, name)) {
    throw new Error(`EXPO_PUBLIC_LOPHN_PHONE_CAPABILITIES_OFF: ${name} is not a phone capability`);
  }
}

export const CAPABILITY_HANDLERS: {
  [K in PhoneCapability]?: CapabilityHandler<K>;
} = Object.fromEntries(
  Object.entries(ALL_HANDLERS).filter(([name]) => !LEFT_OUT.includes(name)),
);

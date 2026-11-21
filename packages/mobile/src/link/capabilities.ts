import type { z } from "zod";
import { err, ok, type Result } from "../../../base/mod.ts";
import type { PhoneCapability } from "../../../protocol/apps/phone-request.ts";
import {
  PHONE_CAPABILITY_TABLE,
  type PhoneCapabilityTable,
} from "../../../protocol/phone/capabilities.ts";
import { PHONE_OS_PERMISSION_DENIED } from "../../../protocol/phone/kinds.ts";
import type { AppFileHandle } from "../../../protocol/apps/app-file-values.ts";
import type { Candidate } from "../apps/files/place.ts";
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
  // Hands a file (a `file:` URI) to the OS share sheet. False when this phone cannot share files.
  file(file: { uri: string; type: string; name?: string; title?: string }): Promise<boolean>;
};
export type CameraPort = {
  // True when the OS camera permission is granted. Asks the person again for as long as the OS allows it.
  permission(): Promise<boolean>;
  // The system camera; null when the person leaves it without a photo.
  capture(): Promise<Candidate | null>;
};
export type PickerPort = {
  // The system photo picker (images only; it hands over only the photos chosen, so it needs no permission).
  photos(max: number): Promise<Candidate[]>;
  // The system document picker; the files are copied to the cache.
  files(options: { types?: string[]; max: number }): Promise<Candidate[]>;
};
// This guest's file place (apps/files/place.ts): takes a file in and keeps it as the app's kind says, and gives the URI of a
// file it holds (taking it from a computer first when it does not).
export type FilesPort = {
  add(file: Candidate): Promise<Result<AppFileHandle>>;
  ensure(file: string): Promise<Result<{ uri: string }>>;
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
  camera: CameraPort;
  picker: PickerPort;
  files: FilesPort;
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

// For the link: a capability that needs a file place is a screen's, so the link has none and these are not run.
export const noFiles: FilesPort = {
  add: async () => err({ code: "unavailable", message: "this phone has no file place for the link" }),
  ensure: async () => err({ code: "unavailable", message: "this phone has no file place for the link" }),
};

const done = () => ok({});

// The picked files go into the place one by one; the first that fails ends the call (the ones already in stay: they are
// immutable bytes that a later pick finds again).
async function keep(
  picked: readonly Candidate[],
  files: FilesPort,
): Promise<Result<{ cancelled: false; files: AppFileHandle[] } | { cancelled: true }>> {
  if (picked.length === 0) return ok({ cancelled: true });
  const handles: AppFileHandle[] = [];
  for (const one of picked) {
    const added = await files.add(one);
    if (!added.ok) return added;
    handles.push(added.value);
  }
  return ok({ cancelled: false, files: handles });
}

const denied = (what: string) =>
  err({
    code: "forbidden" as const,
    message: `${what} permission is denied on the phone`,
    details: { reason: PHONE_OS_PERMISSION_DENIED },
  });

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
  "camera.capture": async (_input, { camera, files }) => {
    if (!(await camera.permission())) return denied("camera");
    const taken = await camera.capture();
    if (taken === null) return ok({ cancelled: true });
    const added = await files.add(taken);
    return added.ok ? ok({ cancelled: false, file: added.value }) : added;
  },
  "photos.pick": async ({ max }, { picker, files }) =>
    keep(await picker.photos(max ?? 1), files),
  "files.pick": async ({ types, max }, { picker, files }) =>
    keep(await picker.files({ ...(types === undefined ? {} : { types }), max: max ?? 1 }), files),
  "share.file": async ({ file, title }, { files, share }) => {
    const held = await files.ensure(file.file);
    if (!held.ok) return held;
    const shared = await share.file({
      uri: held.value.uri,
      type: file.type,
      ...(file.name === undefined ? {} : { name: file.name }),
      ...(title === undefined ? {} : { title }),
    });
    return shared
      ? done()
      : err({ code: "unavailable", message: "this phone cannot share files" });
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

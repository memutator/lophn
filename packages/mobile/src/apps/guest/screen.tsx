import SandboxReactNativeView, {
  type SandboxReactNativeViewRef,
} from "@callstack/react-native-sandbox";
import { useEffect, useRef, useState } from "react";
import { AppState, View } from "react-native";
import type { PhoneLocal, PhonePlace } from "../../../../protocol/apps/phone-screen.ts";
import { CAPABILITY_HANDLERS } from "../../link/capabilities.ts";
import type { FilePlace } from "../files/place.ts";
import { cameraPermission, phonePorts } from "../../link/native.ts";
import { APP_DB_SUBSTITUTION, type GuestAppDbProp, useAppDbBinding } from "./app-db.ts";
import { basePath, fileExists, wrapBackend } from "./files.ts";
import { GUEST_MODULES } from "./modules.ts";
import { createPhoneHost } from "./phone-host.ts";
import { createScanner, ScannerOverlay } from "./scanner.tsx";
import {
  type AppEvent,
  createGuestSession,
  type GuestCall,
  type GuestState,
} from "./session.ts";

// A guest that has not said `ready` by then is `did_not_start`.
export const GUEST_START_LIMIT_MS = 10_000;

export interface GuestScreenProps {
  // The host's id for this view. The only identity the guest has.
  view: string;
  // Absolute path of the screen's phone.js, downloaded and checked against its manifest hash.
  screenFile: string;
  place: PhonePlace;
  scheme: "light" | "dark";
  locale: string;
  // Calls the screen's app operation for this view.
  call: GuestCall;
  // Which phone capabilities this view may use. `granted` is the app's list (live: its release's declaration and the
  // person's grants, from the computer or the install record; preview: what the previewed declaration declares),
  // `standIn` a preview view, which never reaches the phone.
  phone: { granted: readonly string[]; standIn: boolean };
  // App events for this view.
  subscribe: (listener: (event: AppEvent) => void) => () => void;
  onState: (state: GuestState) => void;
  // Why the guest failed, for the developer. Default: console.warn.
  log?: (line: string) => void;
  // This guest's file place: where the files of the app live for this guest. The guest draws files only from it.
  files: FilePlace;
  // An app that runs on the phone gives these together. The guest then loads base|backend|screen and runs the app's
  // read and write operations itself; external ones still come to `call`.
  // Absolute path of the app's backend.js, downloaded and checked against its manifest hash.
  backendFile?: string;
  // The release's operation effects and data schema (its phone/backend.json).
  local?: PhoneLocal;
  // The app's database file, bound to this guest while it is mounted.
  appDb?: GuestAppDbProp;
  // A local call committed a change; it is in the outbox.
  onLocalChange?: () => void;
  // The guest's camera, picker or share sheet opened (true) or ended (false): the view does not count that time as the
  // screen left alone.
  onInteractive?: (open: boolean) => void;
}

// One user app phone screen in its own React Native runtime. It starts on mount and is destroyed on unmount (no idle
// keep-alive); to run it again, or to run a new screen file, remount it with a new `key`. Draw nothing on top of it:
// the sandbox sends a touch to the host instead of the guest when another view covers it. The one thing drawn over it
// is the scanner of `code.scan`, while a scan is open.
export function GuestScreen(props: GuestScreenProps) {
  const latest = useRef(props);
  latest.current = props;
  const ref = useRef<SandboxReactNativeViewRef>(null);
  const say = (line: string) =>
    (latest.current.log ?? console.warn)(`guest ${latest.current.view}: ${line}`);
  // A new origin per mount: views with one origin share a runtime, so a remount under the same origin would get the
  // old runtime and the old bundle.
  const [origin] = useState(
    () => `${props.view}:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
  );
  const [base] = useState(basePath);
  const [files] = useState(() =>
    props.backendFile === undefined
      ? [base, props.screenFile]
      : [base, props.backendFile, props.screenFile],
  );
  // A missing script file ends the whole app inside the loader, so it is checked before the runtime starts.
  const [present] = useState(() => files.every(fileExists));
  // Do not bind the app DB if the guest will never mount due to missing script files.
  const dbReady = useAppDbBinding(origin, present ? props.appDb : undefined);
  const [scripts] = useState(() =>
    present && props.backendFile !== undefined
      ? [base, wrapBackend(props.backendFile), props.screenFile]
      : files,
  );
  const startTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearStartTimer = () => {
    if (startTimer.current !== null) {
      clearTimeout(startTimer.current);
      startTimer.current = null;
    }
  };
  const [scanner] = useState(createScanner);
  const [session] = useState(() =>
    createGuestSession({
      init: {
        place: props.place,
        scheme: props.scheme,
        locale: props.locale,
        local: props.local ?? null,
      },
      call: (operation, input) => latest.current.call(operation, input),
      locate: (file) => latest.current.files.ensure(file),
      phone: createPhoneHost({
        granted: () => latest.current.phone.granted,
        standIn: props.phone.standIn,
        // The notion the link entrance uses: the connection pauses when the app state is not "active".
        isActive: () => AppState.currentState === "active",
        handlers: CAPABILITY_HANDLERS,
        ctx: {
          ...phonePorts,
          scanner: { permission: cameraPermission, scan: scanner.scan },
          files: latest.current.files,
        },
        wait: (ms, fn) => {
          const timer = setTimeout(fn, ms);
          return () => clearTimeout(timer);
        },
        dismiss: scanner.close,
        onInteractive: (open) => latest.current.onInteractive?.(open),
      }),
      post: (message) => ref.current?.postMessage(message),
      onState: (state) => {
        if (state !== "starting") clearStartTimer();
        latest.current.onState(state);
      },
      onLocalChange: () => latest.current.onLocalChange?.(),
      log: (line) => say(line),
    }),
  );

  useEffect(() => {
    if (!present) {
      say(`missing ${files.join(" or ")}`);
      latest.current.onState({
        failed: "did_not_start",
        message: `missing ${files.join(" or ")}`,
      });
      return;
    }
    latest.current.onState("starting");
    startTimer.current = setTimeout(session.timeout, GUEST_START_LIMIT_MS);
    const stop = latest.current.subscribe(session.event);
    return () => {
      clearStartTimer();
      stop();
      session.close();
    };
  }, [present, session, origin, files]);

  const scheme = useRef(props.scheme);
  useEffect(() => {
    if (scheme.current === props.scheme) return;
    scheme.current = props.scheme;
    session.appearance(props.scheme);
  }, [props.scheme, session]);

  if (!present || !dbReady) return null;
  return (
    <View style={{ flex: 1 }}>
      <SandboxReactNativeView
        ref={ref}
        origin={origin}
        componentName="Screen"
        jsBundleSource={scripts.join("|")}
        allowedTurboModules={GUEST_MODULES}
        turboModuleSubstitutions={props.appDb ? APP_DB_SUBSTITUTION : undefined}
        imageFolder={props.files.folder()}
        onMessage={session.receive}
        onError={session.error}
        style={{ flex: 1 }}
      />
      <ScannerOverlay scanner={scanner} />
    </View>
  );
}

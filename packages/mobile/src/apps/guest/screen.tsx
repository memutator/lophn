import SandboxReactNativeView, {
  type SandboxReactNativeViewRef,
} from "@callstack/react-native-sandbox";
import { useEffect, useRef, useState } from "react";
import type { PhonePlace } from "../../../../protocol/apps/phone-screen.ts";
import { basePath, fileExists } from "./files.ts";
import { GUEST_MODULES } from "./modules.ts";
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
  // App events for this view.
  subscribe: (listener: (event: AppEvent) => void) => () => void;
  onState: (state: GuestState) => void;
  // Why the guest failed, for the developer. Default: console.warn.
  log?: (line: string) => void;
}

// One user app phone screen in its own React Native runtime. It starts on mount and is destroyed on unmount (no idle
// keep-alive); to run it again, or to run a new screen file, remount it with a new `key`. Draw nothing on top of it:
// the sandbox sends a touch to the host instead of the guest when another view covers it.
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
  const [files] = useState(() => [basePath(), props.screenFile]);
  // A missing script file ends the whole app inside the loader, so it is checked before the runtime starts.
  const [present] = useState(() => files.every(fileExists));
  const [session] = useState(() =>
    createGuestSession({
      init: { place: props.place, scheme: props.scheme, locale: props.locale },
      call: (operation, input) => latest.current.call(operation, input),
      post: (message) => ref.current?.postMessage(message),
      onState: (state) => latest.current.onState(state),
      log: (line) => say(line),
    }),
  );

  useEffect(() => {
    if (!present) {
      say(`missing ${files.join(" or ")}`);
      latest.current.onState({ failed: "did_not_start" });
      return;
    }
    latest.current.onState("starting");
    const timer = setTimeout(session.timeout, GUEST_START_LIMIT_MS);
    const stop = latest.current.subscribe(session.event);
    return () => {
      clearTimeout(timer);
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

  if (!present) return null;
  return (
    <SandboxReactNativeView
      ref={ref}
      origin={origin}
      componentName="Screen"
      jsBundleSource={files.join("|")}
      allowedTurboModules={GUEST_MODULES}
      onMessage={session.receive}
      onError={session.error}
      style={{ flex: 1 }}
    />
  );
}

// Notifications on this phone: the person's choice and switches, the permission, the push token, and what this phone tells
// each paired computer: its token and switches (`devices/set_push`) and whether it is in front and on which session
// (`presence/report`). Mounted once above the screens, so the start flow's Paired screen and Settings read the same state.
import { t } from "@lophn/i18n";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState } from "react-native";
import { presenceReport } from "../../../protocol/attention/mod.ts";
import type { PushPrefs } from "../../../protocol/attention/mod.ts";
import { devicesSetPush } from "../../../protocol/remote/routes.ts";
import { commandCall } from "../../../shell/renderer/command-call.ts";
import type { ComputerData, Computers } from "../data/mod.ts";
import type { CoreSource } from "../../../shell/renderer/desktop/connection/connection.ts";

export type { PushPrefs };

// The wireframe's switches: only a missed job stays quiet until asked for.
export const DEFAULT_PREFS: PushPrefs = {
  needs_you: true,
  long_finish: true,
  app_update: true,
  job_missed: false,
  app_notify: true,
  quiet_when_present: true,
  show_names: true,
};

/**
 * - loading: the saved choice or the permission is not read yet
 * - unavailable: no push token can be had (a release build before the Expo project exists, or the token call failed)
 * - off: the person has not turned notifications on (Not now, or not asked yet)
 * - denied: turned on, but the system does not let lophn show notifications
 * - on: this phone has a token and tells the computers
 */
export type PushStatus = "loading" | "unavailable" | "off" | "denied" | "on";

interface Saved {
  readonly enabled: boolean;
  // Paired asked once; pairing another computer does not ask again.
  readonly asked?: boolean;
  readonly prefs: PushPrefs;
  // Dev builds: the token made on first use, because no Expo project is there to give a real one.
  readonly devToken?: string;
}

const KEY = "push";
const FALLBACK: Saved = { enabled: false, prefs: DEFAULT_PREFS };
const PRESENCE_MS = 30_000;
const projectId = (
  Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined
)?.eas?.projectId;
// Without an Expo project a real token cannot be asked for; only dev builds make do with a made-up one.
const CAN_HAVE_TOKEN = projectId !== undefined || __DEV__;

// A banner would only repeat what is on screen: core does not push to a phone that is in front, and a local test
// notification is meant to be seen from the background.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: false,
    shouldShowList: false,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

// The channels must exist before the permission is asked and before a token is asked for (Android 13).
const channels = Promise.all(
  (
    [
      ["needs-you", Notifications.AndroidImportance.HIGH],
      ["finished", Notifications.AndroidImportance.DEFAULT],
      ["apps", Notifications.AndroidImportance.DEFAULT],
    ] as const
  ).map(([id, importance]) =>
    Notifications.setNotificationChannelAsync(id, {
      name: t(
        `mobile.notifications.channel.${id}` as "mobile.notifications.channel.apps",
      ),
      description: t(
        `mobile.notifications.channel.${id}-note` as "mobile.notifications.channel.apps-note",
      ),
      importance,
    }),
  ),
);

async function askPermission(): Promise<boolean> {
  await channels;
  return (await Notifications.requestPermissionsAsync()).granted;
}

async function tokenOf(saved: Saved): Promise<string | null> {
  await channels;
  if (projectId === undefined) {
    return saved.devToken ?? null;
  }
  try {
    return (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  } catch {
    return null;
  }
}

export interface Push {
  readonly status: PushStatus;
  readonly prefs: PushPrefs;
  /** Paired has asked already (turned on, or Not now). */
  readonly asked: boolean;
  setPref(key: keyof PushPrefs, on: boolean): void;
  /** Asks the system for permission and starts telling the computers. */
  turnOn(): Promise<void>;
  /** Not now: stays off until turned on in Settings. */
  skip(): void;
  /** The session screen on show, so a computer does not push about what is in front of the person. Returns the way to stop looking. */
  look(session: string): () => void;
}

const PushContext = createContext<Push | null>(null);

export function usePush(): Push {
  const push = useContext(PushContext);
  if (push === null) throw new Error("PushProvider is missing");
  return push;
}

export function PushProvider({
  computers,
  children,
}: {
  computers: Computers<ComputerData>;
  children: ReactNode;
}) {
  const [saved, setSaved] = useState<Saved | null>(null);
  // null until read; "undetermined" counts as not granted.
  const [granted, setGranted] = useState<boolean | null>(null);
  // undefined: not asked for yet; null: could not be had.
  const [token, setToken] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    void SecureStore.getItemAsync(KEY).then((raw) => {
      const found = raw === null ? null : (JSON.parse(raw) as Partial<Saved>);
      setSaved({
        ...FALLBACK,
        ...found,
        prefs: { ...DEFAULT_PREFS, ...found?.prefs },
      });
    });
    const check = () =>
      void Notifications.getPermissionsAsync().then((p) => setGranted(p.granted));
    check();
    // The person may switch it in the system settings and come back.
    const app = AppState.addEventListener("change", (next) => {
      if (next === "active") check();
    });
    // A new device token means a new Expo token.
    const rotated = Notifications.addPushTokenListener(() =>
      setToken(undefined),
    );
    return () => {
      app.remove();
      rotated.remove();
    };
  }, []);

  const update = useCallback((next: Partial<Saved>) => {
    setSaved((before) => {
      const merged = { ...(before ?? FALLBACK), ...next };
      void SecureStore.setItemAsync(KEY, JSON.stringify(merged));
      return merged;
    });
  }, []);

  const wanted = saved?.enabled === true && granted === true;
  useEffect(() => {
    if (!wanted || saved === null || token !== undefined) return;
    if (projectId === undefined && saved.devToken === undefined) {
      if (!__DEV__) return setToken(null);
      update({
        devToken: `ExponentPushToken[lophn-dev-${crypto.randomUUID().slice(0, 8)}]`,
      });
      return;
    }
    let live = true;
    void tokenOf(saved).then((found) => live && setToken(found));
    return () => {
      live = false;
    };
  }, [wanted, saved, token, update]);

  const status: PushStatus =
    saved === null || granted === null
      ? "loading"
      : !CAN_HAVE_TOKEN
        ? "unavailable"
        : !saved.enabled
          ? "off"
          : !granted
            ? "denied"
            : token === undefined
              ? "loading"
              : token === null
                ? "unavailable"
                : "on";

  // What each computer is told. Null while the choice is still being read.
  const input = useMemo(
    () =>
      status === "loading" || saved === null
        ? null
        : { token: status === "on" ? token : null, prefs: saved.prefs },
    [status, token, saved?.prefs],
  );

  const inputRef = useRef(input);
  const presence = useRef({
    focused: AppState.currentState === "active",
    looking: null as string | null,
  });
  // What each connected computer was last told. A computer that is not connected is forgotten, so it is told again
  // (registration and presence) the next time it connects.
  const known = useRef(new Map<string, string>());

  const reportTo = useCallback((core: CoreSource) => {
    const { focused, looking } = presence.current;
    void core
      .call({
        kind: "memory",
        resource: presenceReport.resource,
        method: presenceReport.method,
        body: { focused, looking: looking === null ? [] : [looking] },
      })
      .catch(() => {});
  }, []);

  // Presence goes to every connected computer.
  const reportAll = useCallback(() => {
    for (const item of computers.get().computers) {
      const core = item.sample ? undefined : computers.link(item.key)?.data.core;
      if (item.status === "connected" && core !== undefined) reportTo(core);
    }
  }, [computers, reportTo]);

  // A computer that just connected, or does not have the latest token and switches, is told.
  const sync = useCallback(() => {
    const text = inputRef.current === null ? "" : JSON.stringify(inputRef.current);
    for (const item of computers.get().computers) {
      const core = item.sample ? undefined : computers.link(item.key)?.data.core;
      if (item.status !== "connected" || core === undefined) {
        known.current.delete(item.key);
        continue;
      }
      const before = known.current.get(item.key);
      known.current.set(item.key, text);
      if (before === undefined) reportTo(core);
      if (text !== "" && before !== text) {
        const forget = () => known.current.delete(item.key);
        void core
          .call(
            commandCall(devicesSetPush, {
              input: JSON.parse(text),
              compare: {},
              key: crypto.randomUUID(),
            }),
          )
          .then((reply) => reply.ok || forget(), forget);
      }
    }
  }, [computers, reportTo]);

  useEffect(() => {
    inputRef.current = input;
    sync();
  }, [input, sync]);

  useEffect(() => {
    const off = computers.subscribe(sync);
    const app = AppState.addEventListener("change", (next) => {
      presence.current.focused = next === "active";
      reportAll();
    });
    const timer = setInterval(() => {
      if (presence.current.focused) reportAll();
    }, PRESENCE_MS);
    return () => {
      off();
      app.remove();
      clearInterval(timer);
    };
  }, [computers, sync, reportAll]);

  const look = useCallback(
    (session: string) => {
      presence.current.looking = session;
      reportAll();
      return () => {
        // Another session screen may have taken over already.
        if (presence.current.looking !== session) return;
        presence.current.looking = null;
        reportAll();
      };
    },
    [reportAll],
  );

  const value = useMemo<Push>(
    () => ({
      status,
      prefs: saved?.prefs ?? DEFAULT_PREFS,
      asked: saved?.asked === true,
      setPref: (key, on) =>
        update({ prefs: { ...(saved?.prefs ?? DEFAULT_PREFS), [key]: on } }),
      async turnOn() {
        setGranted(await askPermission());
        update({ enabled: true, asked: true });
      },
      skip: () => update({ enabled: false, asked: true }),
      look,
    }),
    [status, saved?.prefs, update, look],
  );
  return <PushContext value={value}>{children}</PushContext>;
}

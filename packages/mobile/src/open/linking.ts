// Everything outside the app that points at a place: a URL (a widget tap, a home screen shortcut, adb) and a tapped
// notification. Both go through `parseOpenTarget`; `OpenTapped` (opener.tsx) is where the place opens, because only
// the frame holds the stack.
import * as Notifications from "expo-notifications";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Linking } from "react-native";
import { useComputers } from "../data/mod.ts";
import { notificationData } from "../push/target.ts";
import { type OpenTarget, parseOpenTarget } from "./target.ts";

export interface Open {
  /** A target nothing has opened yet. */
  readonly pending: OpenTarget | null;
  /** It was dealt with. */
  settle(): void;
}

export const OpenContext = createContext<Open>({
  pending: null,
  settle: () => {},
});

export function useOpen(): Open {
  return useContext(OpenContext);
}

/** Mounted once at the app root. A URL or a tap that arrives before the computers are read waits for them. */
export function useOpenTargets(): Open {
  const { ready, computers } = useComputers();
  // What arrived and is not parsed yet: a URL, or a notification's data.
  const [incoming, setIncoming] = useState<unknown>(null);

  useEffect(() => {
    // Cold start: the URL or the notification that opened the app.
    void Linking.getInitialURL().then((url) => url !== null && setIncoming(url));
    const last = Notifications.getLastNotificationResponse();
    if (last !== null) {
      setIncoming(notificationData(last.notification.request.content.data));
    }
    // The app was already running.
    const url = Linking.addEventListener("url", (event) => setIncoming(event.url));
    const tap = Notifications.addNotificationResponseReceivedListener((response) =>
      setIncoming(notificationData(response.notification.request.content.data)),
    );
    return () => {
      url.remove();
      tap.remove();
    };
  }, []);

  // Joined so a computer's status changing does not make a new `pending` for the same target.
  const hosts = JSON.stringify(computers.map((one) => one.key));
  const pending = useMemo(
    () =>
      ready ? parseOpenTarget(incoming, new Set<string>(JSON.parse(hosts))) : null,
    [ready, incoming, hosts],
  );
  // Not something to open (or a computer not paired): drop it, so pairing that computer later does not open it.
  useEffect(() => {
    if (ready && incoming !== null && pending === null) setIncoming(null);
  }, [ready, incoming, pending]);

  return useMemo(
    () => ({
      pending,
      settle() {
        setIncoming(null);
        Notifications.clearLastNotificationResponse();
      },
    }),
    [pending],
  );
}

// Opens what a tapped notification, widget or shortcut points at: picks the computer it is about, then the session, the app
// or the Inbox.
import { useContext, useEffect } from "react";
import { FrameContext, type Place, paramsOf } from "../app/nav.ts";
import {
  useComputers,
  useSessionsSettled,
  useSessionTarget,
} from "../data/mod.ts";
import { useOpen } from "./linking.ts";
import { sessionWaitAction } from "./session-wait.ts";

// A session the computer does not list (deleted, or it never connected) is not worth waiting for: the Inbox shows what waits.
const WAIT_MS = 8000;

/** Mounted once inside the frame (its stack is what it opens places on). */
export function OpenTapped() {
  const { pending: tapped, settle } = useOpen();
  const { computers, current, select } = useComputers();
  const frame = useContext(FrameContext);
  const host =
    tapped === null || tapped.kind === "widget_bind"
      ? undefined
      : computers.find((one) => one.key === tapped.host);
  const here = host !== undefined && host.key === current;
  const sessionsSettled = useSessionsSettled();
  const target = useSessionTarget(
    here && tapped?.kind === "session" ? tapped.session : null,
  );

  const show = (place: Place) => {
    frame.stack.current?.reset({
      index: 1,
      routes: [{ name: "home" }, { name: place.name, params: paramsOf(place) }],
    });
    settle();
  };

  const status = host?.status;
  useEffect(() => {
    if (tapped === null) return;
    // A widget names no computer: the screen lists them all.
    if (tapped.kind === "widget_bind") {
      return show({
        name: "widget-pick",
        widget: tapped.widget,
        configure: tapped.configure,
      });
    }
    // Not a computer paired on this phone: the tap opens nothing.
    if (host === undefined || status === undefined) return settle();
    if (!here) return select(host.key);
    if (tapped.kind === "app") {
      return show({ name: "app", id: tapped.app, screen: tapped.screen });
    }
    if (tapped.kind === "inbox") return show({ name: "inbox" });
    const action = sessionWaitAction({ target, status, sessionsSettled });
    if (action.kind === "open") return show({ name: "session", ...action.target });
    if (action.kind === "wait") return;
    const timer = setTimeout(() => show({ name: "inbox" }), WAIT_MS);
    return () => clearTimeout(timer);
  }, [tapped, here, target, status, sessionsSettled]);
  return null;
}

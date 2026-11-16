// Opens what a tapped notification, widget or shortcut points at: picks the computer it is about, then the session, the app
// or the Inbox.
import { useContext, useEffect } from "react";
import { FrameContext, type Place, paramsOf } from "../app/nav.ts";
import { useComputers, useSessionTarget } from "../data/mod.ts";
import { useOpen } from "./linking.ts";

// A session the computer does not list (deleted, or it never connected) is not worth waiting for: the Inbox shows what waits.
const WAIT_MS = 8000;

/** Mounted once inside the frame (its stack is what it opens places on). */
export function OpenTapped() {
  const { pending: tapped, settle } = useOpen();
  const { computers, current, select } = useComputers();
  const frame = useContext(FrameContext);
  const host = tapped === null ? undefined : computers.find((one) => one.key === tapped.host);
  const here = host !== undefined && host.key === current;
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

  useEffect(() => {
    if (tapped === null) return;
    // Not a computer paired on this phone: the tap opens nothing.
    if (host === undefined) return settle();
    if (!here) return select(host.key);
    if (tapped.kind === "app") {
      // `tapped.screen` waits for the app screen place (the user-apps task); until then an app opens as its workspace.
      return show({ name: "workspace", workspace: { kind: "app", id: tapped.app } });
    }
    if (tapped.kind === "inbox") return show({ name: "inbox" });
    if (target !== null) return show({ name: "session", ...target });
    const timer = setTimeout(() => show({ name: "inbox" }), WAIT_MS);
    return () => clearTimeout(timer);
  }, [tapped, here, target]);
  return null;
}

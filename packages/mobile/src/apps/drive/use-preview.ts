// What a preview screen (Preview from lophn) shows, put together like the live app screen: the preview running on the
// computer, its bundle taken by the preview's process, a preview view on the computer and the guest. The screen keeps
// the phone awake and registers its view with the drive controller, so the computer's lophn agents can drive it.
import { useEffect, useMemo, useRef, useState } from "react";
import { phoneCanRun } from "../../../../protocol/apps/phone-screen.ts";
import { useEventClient } from "../../../../shell/renderer/desktop/connection/events/hooks.tsx";
import { newId } from "../../../../shell/renderer/prefixed-id.ts";
import type { ComputerItem, PhoneApp, PhoneApps } from "../../data/mod.ts";
import { type Bundle, prepareBundle } from "../bundle.ts";
import { bundleFiles } from "../bundle-files.ts";
import { createUpdateCoalescer, ensureBase, type GuestState, guestHostInfo } from "../guest/mod.ts";
import type { AppScreenState } from "../use-app-screen.ts";
import { linkView, type ViewLink, type ViewState } from "../view.ts";
import { cacheFiles } from "../local/native.ts";
import { createFilePlace, type FilePlace } from "../files/place.ts";
import { drive, keepScreenOn, type PreviewHandle } from "./mod.ts";

const REOPEN_MS = 2_000;

let base: Promise<unknown> | null = null;
const baseReady = () => {
  base ??= ensureBase().catch((error: unknown) => {
    base = null;
    throw error;
  });
  return base;
};

export interface PreviewScreen {
  /** `stopped` is the preview no longer running on the computer. */
  readonly state: AppScreenState;
  /** The screen on show: the one asked for when the preview has it, else its first. */
  readonly screen: string | null;
  readonly handle: PreviewHandle | null;
  retry(): void;
}

export function usePreview({
  computer,
  apps,
  app,
  screen: wanted,
}: {
  computer: ComputerItem | null;
  apps: PhoneApps;
  app: PhoneApp | undefined;
  screen: string | undefined;
}): PreviewScreen {
  const client = useEventClient();
  const preview = app?.preview ?? null;
  const screen = preview?.screens.find((one) => one.screen === wanted) ?? preview?.screens[0];
  const fits = screen === undefined ? null : phoneCanRun(screen.manifest, guestHostInfo());
  const online = computer?.status === "connected";
  const appId = app?.app;
  const screenKey = screen?.screen;
  const hash = preview?.bundle_hash;
  const runs = fits?.ok === true;
  const [attempt, setAttempt] = useState(0);

  // A new preview bundle or another screen is a new view, so a ref the agent took on the old one cannot touch the new.
  const view = useMemo(() => newId("view"), [hash, screenKey]);

  // Awake and drivable while the screen is open; taking control ends when it closes.
  const computerKey = computer?.key;
  const [handle, setHandle] = useState<PreviewHandle | null>(null);
  useEffect(() => {
    if (computerKey === undefined) return;
    const next = drive.open(computerKey);
    setHandle(next);
    return () => {
      setHandle(null);
      next.close();
    };
  }, [computerKey]);
  useEffect(() => {
    handle?.show(view);
  }, [handle, view]);
  useEffect(() => {
    keepScreenOn(true);
    return () => keepScreenOn(false);
  }, []);

  const [link, setLink] = useState<ViewLink | null>(null);
  const [bound, setBound] = useState<ViewState>({ kind: "opening" });
  const reload = useRef(apps.reload);
  reload.current = apps.reload;
  useEffect(() => {
    if (appId === undefined || screenKey === undefined || !runs) return;
    setBound({ kind: "opening" });
    const next = linkView({
      client,
      input: { view, mode: "preview", app: appId, release: null, screen: screenKey, place: "phone", params: {} },
      now: Date.now,
      onState: setBound,
      // A rebuilt preview: the list read again carries its new bundle, which opens a new view.
      onRebound: () => reload.current(),
    });
    setLink(next);
    return () => {
      setLink(null);
      next.close();
    };
  }, [client, view, appId, screenKey, runs]);

  // The view can come back stopped while the list still has the preview: opened again over a link that died in the
  // background. Until the list says the preview stopped, it is opened again every few seconds.
  const lingering = bound.kind === "stopped" && preview !== null;
  useEffect(() => {
    if (!lingering || link === null) return;
    const timer = setTimeout(() => link.reopen(), REOPEN_MS);
    return () => clearTimeout(timer);
  }, [bound, lingering, link]);

  const [bundle, setBundle] = useState<{ view: string; got: Bundle } | null>(null);
  const [coalescer] = useState(() =>
    createUpdateCoalescer<{ view: string; got: Bundle } | null>({
      onCommit: setBundle,
      equals: (a, b) => a?.view === b?.view && a?.got.ok === b?.got.ok,
    }),
  );
  useEffect(() => () => coalescer.cancel(), [coalescer]);
  const latest = useRef({ preview, screen });
  latest.current = { preview, screen };
  useEffect(() => {
    const { preview: running, screen: shown } = latest.current;
    if (running === null || shown === undefined || appId === undefined || computerKey === undefined) return;
    if (!online || !runs) return;
    let gone = false;
    const fail = (): Bundle => ({ ok: false, reason: "unavailable" });
    void Promise.all([
      prepareBundle(
        { core: client.core, files: bundleFiles(), host: guestHostInfo() },
        computerKey,
        {
          app: appId,
          screen: shown.screen,
          bundle_hash: running.bundle_hash,
          manifest: shown.manifest,
          process_nonce: running.process_nonce,
        },
      ),
      baseReady(),
    ]).then(
      ([got]) => !gone && coalescer.push({ view, got }),
      () => !gone && coalescer.push({ view, got: fail() }),
    );
    return () => {
      gone = true;
    };
  }, [client, computerKey, appId, view, online, runs, attempt, coalescer]);

  const [guest, setGuest] = useState<{ key: string; state: GuestState } | null>(null);
  const guestKey = `${view}:${attempt}`;

  // The preview's file place: a cache of its own (a preview must not show the live app's files). Its files are the
  // computer's samples, read from the preview's data area.
  const computerNow = useRef(computer);
  computerNow.current = computer;
  const clientNow = useRef(client);
  clientNow.current = client;
  const nonce = preview?.process_nonce;
  const place = useMemo<FilePlace | null>(
    () =>
      appId === undefined || computerKey === undefined || nonce === undefined
        ? null
        : createFilePlace({
            files: cacheFiles,
            dir: `${computerKey}/${appId}/preview`,
            app: appId,
            keeping: () => ({ kind: "upload" }),
            links: () =>
              computerNow.current?.status === "connected"
                ? [{ computer: computerKey, remote: clientNow.current.core }]
                : [],
            target: () => ({ mode: "preview", app: appId, process_nonce: nonce }),
            newName: () => newId("stg"),
            now: Date.now,
            sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
          }),
    [appId, computerKey, nonce],
  );

  const retry = () => {
    setGuest(null);
    coalescer.reset();
    setBundle(null);
    setAttempt((n) => n + 1);
    link?.reopen();
  };

  const state = ((): AppScreenState => {
    if (computer === null || computer.status === "connecting") return { kind: "loading" };
    if (!online) return { kind: "offline" };
    if (apps.state === "failed") return { kind: "failed" };
    if (apps.state === "loading") return { kind: "loading" };
    if (screen === undefined || fits === null) return { kind: "stopped" };
    if (!fits.ok) return { kind: "refused", reason: fits.reason };
    if (lingering) return { kind: "loading" };
    if (bound.kind === "failed") return { kind: "failed" };
    if (bound.kind === "opening" || link === null) return { kind: "loading" };
    if (bundle === null || bundle.view !== view) return { kind: "loading" };
    if (!bundle.got.ok) return { kind: "failed" };
    if (guest?.key === guestKey && typeof guest.state === "object") return { kind: "failed" };
    if (place === null) return { kind: "loading" };
    return {
      kind: "running",
      away: false,
      key: guestKey,
      view,
      file: bundle.got.file,
      call: link.call,
      subscribe: link.subscribe,
      // A preview never reaches the phone: what its declaration declares answers with stand-in values, the rest is forbidden.
      phone: { granted: preview?.phone_capabilities ?? [], standIn: true },
      files: place,
      interactive: link.interactive,
      onState: (next) => setGuest({ key: guestKey, state: next }),
    };
  })();

  return { state, screen: screenKey ?? null, handle, retry };
}

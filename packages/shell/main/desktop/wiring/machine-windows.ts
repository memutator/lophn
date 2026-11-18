// Windows of other machines: one window per machine, opened with its own preload (`preload-remote.cjs`) on the same desktop
// page. Main binds the window to the machine (machine-route), pushes that machine's link state and frames to it alone,
// tells the machine what the window shows (presence) and keeps its title on the machine's name. A machine that leaves the
// device list keeps its window, which shows the removed gate. These windows are not in `ctx.windows`: this computer's
// notices, presence, surface and global keys never see them.
import {
  app,
  BrowserWindow,
  dialog,
  powerMonitor,
  type WebContents,
} from "electron";
import { isAbsolute, join } from "node:path";

import type { Id } from "../../../../protocol/base/ids.ts";
import { CORE_EVENT_CHANNEL, CORE_STATE_CHANNEL } from "../../../ipc/core.ts";
import type { CoreReply } from "../../../ipc/core-api.ts";
import {
  MACHINES_CHANGED_CHANNEL,
  MACHINES_CLONE_HERE_CHANNEL,
  MACHINES_OPEN_CHANNEL,
  MACHINES_THIS_READ_CHANNEL,
  MACHINES_THIS_WINDOW_CHANNEL,
  MACHINES_VISIBLE_CHANNEL,
  type MachinesReply,
  type MachineWindow,
  machinesCloneHereSchema,
  machinesOpenSchema,
  machinesThisReadSchema,
  machinesVisibleSchema,
  type ThisComputerRead,
} from "../../../ipc/machines.ts";
import { createPresenceReporter } from "../../notice/presence.ts";
import { reveal } from "../headless.ts";
import { word } from "../i18n.ts";
import { checkCaller, checkInput, type IpcEvent } from "../ipc-guard.ts";
import { DESKTOP_URL } from "../shell-protocol.ts";
import { openWindow, windowTitle } from "../window.ts";
import type { Registered, ShellContext } from "./context.ts";
import { createWindowPlaces } from "../viewer/window-places.ts";
import {
  createShellWindow,
  onScreen,
  openDesktopWindow,
  recentWindow,
  rememberWorkspace,
  restoredWorkspace,
  wrap,
} from "./desktop-window.ts";
import type { Machines } from "./machines.ts";
import type { MachineLink } from "../viewer/machine-route.ts";

const THIS_COMPUTER_ROUTES: Record<
  ThisComputerRead,
  { resource: string; method: string }
> = {
  "project.list": { resource: "projects", method: "list" },
  ListAgents: { resource: "agents", method: "list" },
  ListSessions: { resource: "sessions", method: "list" },
};

type Opened = {
  window: BrowserWindow;
  machine: Id<"mch">;
  name: string;
  link: MachineLink;
  // The last core state sent to the window.
  shown: string;
  // Sessions the window says it shows.
  visible: Set<string>;
  presence: ReturnType<typeof createPresenceReporter>;
};

export function register(ctx: ShellContext, machines: Machines): Registered {
  const { ipc, headless } = ctx;
  const registry = ctx.overlays.overlayRegistry();
  const preload = join(ctx.here, "preload-remote.cjs");
  const opened = new Map<Id<"mch">, Opened>();
  const places = createWindowPlaces(ctx.dataRoot);
  let placesLoaded = false;
  void places.loaded.then(() => {
    placesLoaded = true;
  });

  const send = (entry: Opened, channel: string, payload: unknown) => {
    if (!entry.window.isDestroyed()) {
      entry.window.webContents.send(channel, payload);
    }
  };
  const reportOver = (link: MachineLink, body: unknown) => {
    // headless has no person in front of it.
    if (headless.headless || link.current().state !== "ready") return;
    void link.call({ resource: "presence", method: "report", body });
  };

  // Pushes the link state when it changed; a window that became connected tells the machine what it shows.
  function pushState(entry: Opened): void {
    const state = entry.link.current();
    const text = JSON.stringify(state);
    if (text === entry.shown) return;
    const was = (JSON.parse(entry.shown) as { state: string }).state;
    entry.shown = text;
    send(entry, CORE_STATE_CHANNEL, state);
    if (state.state === "ready" && was !== "ready") entry.presence.report();
  }

  machines.onFrame((machine, message) => {
    const entry = opened.get(machine);
    if (entry !== undefined) send(entry, CORE_EVENT_CHANNEL, message);
  });

  function openMachine(machine: Id<"mch">, name: string): void {
    const found = opened.get(machine);
    if (found !== undefined && !found.window.isDestroyed()) {
      reveal(found.window, headless);
      return;
    }
    // The first window can be asked for before the saved places are read.
    if (!placesLoaded) {
      void places.loaded.then(() => openMachine(machine, name));
      return;
    }
    // The start window can open on a pinned machine whose name was never saved and that is not in the list.
    const title =
      machines.list().machines.find((row) => row.id === machine)?.name ??
      (name || word("machines.label.unknown-name"));
    // This machine's own last place; one never saved opens where this computer's last window was.
    const place = places.get(machine);
    const workspace =
      place === undefined ? restoredWorkspace(ctx) : onScreen(place);
    const link = machines.link(machine);
    let window: BrowserWindow | undefined;
    openWindow({
      platform: process.platform,
      packaged: app.isPackaged,
      preload,
      title: windowTitle(title),
      ...(workspace ? { bounds: workspace.bounds, show: false } : {}),
      // The machine is not in the address: main's table decides it from the sending window.
      url: DESKTOP_URL,
      windows: {
        create: (config) => {
          window = createShellWindow(ctx, config, preload);
          ctx.machineRoute.bind(window.webContents.id, machine, link);
          return wrap(window);
        },
      },
    });
    const created = window!;
    rememberWorkspace(ctx, created, workspace, false, (state) =>
      places.save(machine, state),
    );
    const entry: Opened = {
      window: created,
      machine,
      name: title,
      link,
      shown: JSON.stringify(link.current()),
      visible: new Set(),
      presence: createPresenceReporter({
        view: () =>
          created.isDestroyed() || !created.isFocused()
            ? { focused: false, looking: [] }
            : { focused: true, looking: [...entry.visible] },
        idleMs: () => powerMonitor.getSystemIdleTime() * 1000,
        send: (report) => reportOver(link, report),
        every(ms, fn) {
          const timer = setInterval(fn, ms);
          timer.unref?.();
          return () => clearInterval(timer);
        },
      }),
    };
    opened.set(machine, entry);
    ctx.topWindows.add(created);
    const contentsId = created.webContents.id;
    created.webContents.on("did-finish-load", () =>
      send(entry, CORE_STATE_CHANNEL, link.current()),
    );
    created.on("focus", () => {
      ctx.topWindows.delete(created);
      ctx.topWindows.add(created);
      // Only a switch that reached the machine counts as the last used one.
      if (link.current().state === "ready") {
        machines.markUsed(machine);
      }
      entry.presence.changed();
    });
    created.on("blur", () => entry.presence.changed());
    created.on("closed", () => {
      ctx.machineRoute.unbind(contentsId);
      ctx.topWindows.delete(created);
      if (opened.get(machine) === entry) opened.delete(machine);
      entry.presence.stop();
      reportOver(link, {
        focused: false,
        idle_ms: Math.round(powerMonitor.getSystemIdleTime() * 1000),
        looking: [],
      });
      link.watch([]);
    });
  }
  ctx.machineWindows.open = openMachine;

  // A window of this computer that gets focus makes this computer the last used machine.
  ctx.windowHooks.created.push((window) => {
    window.on("focus", () => {
      const self = machines.list().this;
      if (self !== null) machines.markUsed(self.id);
    });
  });

  const unsubscribe = machines.subscribe((list) => {
    for (const entry of opened.values()) {
      if (entry.window.isDestroyed()) continue;
      send(entry, MACHINES_CHANGED_CHANNEL, list);
      pushState(entry);
      const row = list.machines.find((one) => one.id === entry.machine);
      if (row !== undefined && row.name !== entry.name) {
        entry.name = row.name;
        entry.window.setTitle(windowTitle(row.name));
      }
    }
  });

  const allowed = (event: IpcEvent): boolean => {
    const caller = checkCaller(registry, event);
    return caller.ok && caller.value.origin.host === "desktop";
  };

  ipc.handle(
    MACHINES_OPEN_CHANNEL,
    (event: IpcEvent, input: unknown): MachinesReply => {
      if (!allowed(event)) return { ok: false, code: "forbidden" };
      const parsed = checkInput(machinesOpenSchema, input);
      if (!parsed.ok) return { ok: false, code: "invalid_input" };
      const { machine, session } = parsed.value;
      const list = machines.list();
      if (list.this === null) return { ok: false, code: "unavailable" };
      if (machine === list.this.id) {
        if (session !== undefined) {
          ctx.sessionWindows.reveal(session);
          return { ok: true };
        }
        const recent = recentWindow(ctx);
        if (recent === undefined) openDesktopWindow(ctx);
        else reveal(recent, headless);
        return { ok: true };
      }
      // Another machine's sessions open inside its own window; this channel only opens this computer's.
      if (session !== undefined) return { ok: false, code: "invalid_input" };
      const row = list.machines.find((one) => one.id === machine);
      if (row === undefined) return { ok: false, code: "not_found" };
      openMachine(machine, row.name);
      return { ok: true };
    },
  );

  ipc.handle(MACHINES_THIS_WINDOW_CHANNEL, (event: IpcEvent): MachineWindow => {
    const machine = ctx.machineOf(event.sender);
    const entry = machine === null ? undefined : opened.get(machine);
    return {
      machine:
        entry === undefined ? null : { id: entry.machine, name: entry.name },
    };
  });

  ipc.handle(MACHINES_VISIBLE_CHANNEL, (event: IpcEvent, input: unknown) => {
    const machine = ctx.machineOf(event.sender);
    const entry = machine === null ? undefined : opened.get(machine);
    if (entry === undefined) return;
    const parsed = checkInput(machinesVisibleSchema, input);
    if (!parsed.ok) return;
    if (parsed.value.visible) entry.visible.add(parsed.value.session);
    else entry.visible.delete(parsed.value.session);
    entry.presence.changed();
  });

  // Both reach this computer's core as the person. machine-route has already refused windows of this computer and reads
  // outside the allowed lists; the machine is the sending window's, never the renderer's word.
  const failure = (code: string, message: string): CoreReply => ({
    ok: false,
    error: { code, message },
  });
  ipc.handle(
    MACHINES_THIS_READ_CHANNEL,
    async (event: IpcEvent, input: unknown): Promise<CoreReply> => {
      if (!allowed(event) || ctx.machineOf(event.sender) === null) {
        return failure("forbidden", "only a window of another machine");
      }
      const parsed = checkInput(machinesThisReadSchema, input);
      if (!parsed.ok) return failure("invalid_input", "not a read");
      const session = ctx.core.session();
      if (session === null) return failure("unavailable", "core is not ready");
      const { resource, method } = THIS_COMPUTER_ROUTES[parsed.value.route];
      return await session.internal(
        "read",
        resource,
        method,
        parsed.value.input,
      );
    },
  );

  // A parent folder for the clone when this computer has no projects folder yet. headless never shows a dialog.
  async function pickParent(sender: WebContents): Promise<string | null> {
    if (headless.headless) {
      const pick = process.env.LOPHN_SHELL_PICK_FOLDER;
      return pick !== undefined && isAbsolute(pick) ? pick : null;
    }
    const options = {
      title: word("machines.title.clone-parent"),
      properties: ["openDirectory" as const, "createDirectory" as const],
    };
    const parent = BrowserWindow.fromWebContents(sender);
    const result = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options);
    const path = result.canceled ? undefined : result.filePaths[0];
    return path !== undefined && isAbsolute(path) ? path : null;
  }

  ipc.handle(
    MACHINES_CLONE_HERE_CHANNEL,
    async (event: IpcEvent, input: unknown): Promise<CoreReply> => {
      if (!allowed(event) || ctx.machineOf(event.sender) === null) {
        return failure("forbidden", "only a window of another machine");
      }
      const parsed = checkInput(machinesCloneHereSchema, input);
      if (!parsed.ok) return failure("invalid_input", "not a clone");
      const session = ctx.core.session();
      if (session === null) return failure("unavailable", "core is not ready");
      const clone = (body: object) =>
        session.internal("memory", "projects", "clone", body);
      const first = await clone(parsed.value);
      if (
        first.ok ||
        first.error.details?.["reason"] !== "projects_folder_unset"
      ) {
        return first;
      }
      const parent = await pickParent(event.sender as unknown as WebContents);
      return parent === null ? first : await clone({ ...parsed.value, parent });
    },
  );

  return {
    stop() {
      unsubscribe();
      for (const channel of [
        MACHINES_THIS_READ_CHANNEL,
        MACHINES_CLONE_HERE_CHANNEL,
        MACHINES_OPEN_CHANNEL,
        MACHINES_THIS_WINDOW_CHANNEL,
        MACHINES_VISIBLE_CHANNEL,
      ]) {
        ipc.removeHandler(channel);
      }
      for (const entry of opened.values()) entry.presence.stop();
    },
  };
}

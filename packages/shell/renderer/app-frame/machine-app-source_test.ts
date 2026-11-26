import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AppViewOpen } from "../../ipc/app-frame.ts";
import type { EventClient } from "../desktop/connection/events/client.ts";
import type { MachineData, MachineHub } from "../desktop/machines/data.ts";
import type { MachineRef } from "../desktop/machines/scope.tsx";
import type { IconReader } from "../parts/icon-upload/icon-reader.ts";
import type { AppViewsDeps } from "./app-views.tsx";
import {
  appIconReader,
  appWorkspaceForScope,
  eventClientOf,
  findMatchingAppPanelTab,
  localTabMachine,
  screensSourceOf,
} from "./machine-app-source.ts";

function fakeReader(label: string): IconReader {
  return async (id: string) => `data:image/png;base64,${label}:${id}`;
}

function fakeData(
  appViews: AppViewsDeps | null,
  events: EventClient,
): MachineData {
  return { appViews, events } as unknown as MachineData;
}

function fakeHub(
  entries: ReadonlyMap<MachineRef, MachineData>,
): Pick<MachineHub, "get"> {
  return {
    get(machine) {
      const found = entries.get(machine);
      if (found === undefined) {
        throw new Error(`unknown machine ${String(machine)}`);
      }
      return found;
    },
  };
}

describe("appIconReader", () => {
  const localIcon = fakeReader("local");
  const remoteAIcon = fakeReader("remote-a");
  const remoteBIcon = fakeReader("remote-b");
  const localViews = { icon: localIcon } as unknown as AppViewsDeps;
  const remoteAViews = { icon: remoteAIcon } as unknown as AppViewsDeps;
  const remoteBViews = { icon: remoteBIcon } as unknown as AppViewsDeps;
  const events = {} as EventClient;
  const hub = fakeHub(
    new Map<MachineRef, MachineData>([
      [null, fakeData(localViews, events)],
      ["mch_a", fakeData(remoteAViews, events)],
      ["mch_b", fakeData(remoteBViews, events)],
    ]),
  );

  it("uses the current scope icon reader when machine is omitted", () => {
    assert.equal(appIconReader(hub, remoteBViews), remoteBIcon);
  });

  it("reads local icons from hub(null) even when current scope is a remote machine", () => {
    assert.equal(appIconReader(hub, remoteBViews, null), localIcon);
  });

  it("reads another machine's icons from hub(machine) when viewing a different workspace", () => {
    assert.equal(appIconReader(hub, remoteBViews, "mch_a"), remoteAIcon);
  });

  it("falls back to current scope icon reader when hub is missing", () => {
    assert.equal(appIconReader(null, localViews, null), localIcon);
    assert.equal(appIconReader(null, remoteAViews, "mch_a"), remoteAIcon);
  });

  it("returns undefined instead of throwing when hub rejects an unavailable machine", () => {
    assert.equal(appIconReader(hub, localViews, "mch_missing"), undefined);
  });
});

describe("screensSourceOf", () => {
  const localViews = { icon: fakeReader("local") } as unknown as AppViewsDeps;
  const remoteViews = { icon: fakeReader("remote") } as unknown as AppViewsDeps;
  const localEvents = { id: "local" } as unknown as EventClient;
  const remoteEvents = { id: "remote" } as unknown as EventClient;
  const hub = fakeHub(
    new Map<MachineRef, MachineData>([
      [null, fakeData(localViews, localEvents)],
      ["mch_remote", fakeData(remoteViews, remoteEvents)],
    ]),
  );

  it("returns this computer's appViews and events for machine=null even inside a remote scope", () => {
    const resolved = screensSourceOf(hub, remoteViews, remoteEvents, null);
    assert.equal(resolved.appViews, localViews);
    assert.equal(resolved.events, localEvents);
  });

  it("returns current scope appViews and events when machine is omitted or hub is absent", () => {
    assert.deepEqual(screensSourceOf(hub, remoteViews, remoteEvents), {
      appViews: remoteViews,
      events: remoteEvents,
    });
    assert.deepEqual(screensSourceOf(null, remoteViews, remoteEvents, null), {
      appViews: remoteViews,
      events: remoteEvents,
    });
  });

  it("returns nulls cleanly when hub rejects an unavailable machine", () => {
    assert.deepEqual(
      screensSourceOf(hub, remoteViews, remoteEvents, "mch_missing"),
      { appViews: null, events: null },
    );
  });
});

describe("eventClientOf", () => {
  const localEvents = { id: "local" } as unknown as EventClient;
  const remoteEvents = { id: "remote" } as unknown as EventClient;
  const hub = fakeHub(
    new Map<MachineRef, MachineData>([
      [null, fakeData(null, localEvents)],
      ["mch_remote", fakeData(null, remoteEvents)],
    ]),
  );

  it("returns this computer's EventClient for machine=null even inside a remote scope", () => {
    assert.equal(eventClientOf(hub, remoteEvents, null), localEvents);
  });

  it("falls back to current scope EventClient when machine is omitted or hub is absent", () => {
    assert.equal(eventClientOf(hub, remoteEvents), remoteEvents);
    assert.equal(eventClientOf(null, remoteEvents, null), remoteEvents);
  });

  it("returns null cleanly when hub rejects an unavailable machine", () => {
    assert.equal(eventClientOf(hub, remoteEvents, "mch_missing"), null);
  });
});

describe("appWorkspaceForScope", () => {
  const localProject: AppViewOpen["workspace"] = {
    kind: "project",
    id: "prj_local",
    identity: "pri_1",
    formerIdentities: [],
    folders: ["/local/repo"],
  };
  const remoteProject: AppViewOpen["workspace"] = {
    kind: "project",
    id: "prj_remote",
    identity: "pri_2",
    formerIdentities: [],
    folders: ["/remote/repo"],
  };

  it("passes workspace context when app scope matches workspace machine", () => {
    assert.equal(
      appWorkspaceForScope({ machine: null, value: localProject }, null),
      localProject,
    );
    assert.equal(
      appWorkspaceForScope(
        { machine: "mch_remote", value: remoteProject },
        "mch_remote",
      ),
      remoteProject,
    );
  });

  it("hides remote workspace context from local chrome apps (tray, sidebar, local app panels)", () => {
    assert.equal(
      appWorkspaceForScope(
        { machine: "mch_remote", value: remoteProject },
        null,
      ),
      undefined,
    );
  });

  it("isolates cross-machine workspace contexts and handles missing provider", () => {
    assert.equal(
      appWorkspaceForScope({ machine: "mch_a", value: remoteProject }, "mch_b"),
      undefined,
    );
    assert.equal(appWorkspaceForScope(null, null), undefined);
  });
});

describe("localTabMachine", () => {
  it("stamps thisComputer when opening a local shell tab inside a remote workspace", () => {
    assert.equal(
      localTabMachine({ machine: "mch_remote", thisComputer: "mch_self" }),
      "mch_self",
    );
  });

  it("returns undefined on local workspaces or before thisComputer is known", () => {
    assert.equal(
      localTabMachine({ machine: null, thisComputer: "mch_self" }),
      undefined,
    );
    assert.equal(
      localTabMachine({ machine: "mch_remote", thisComputer: null }),
      undefined,
    );
    assert.equal(localTabMachine({ machine: "mch_remote" }), undefined);
  });
});

describe("findMatchingAppPanelTab", () => {
  const remoteTab = {
    key: "tab-remote",
    kind: "app_panel",
    app: "app_01",
    screen: "main",
  };
  const localTab = {
    key: "tab-local",
    kind: "app_panel",
    app: "app_01",
    screen: "main",
    machine: "mch_self",
  };

  it("does not match an open remote app panel when launching a local pinned app in a remote workspace", () => {
    assert.equal(
      findMatchingAppPanelTab(
        [remoteTab],
        { app: "app_01", surface: "main" },
        "mch_self",
        "mch_remote",
        "mch_self",
      ),
      undefined,
    );
  });

  it("matches the local app panel tab when both remote and local tabs for the same app exist", () => {
    assert.equal(
      findMatchingAppPanelTab(
        [remoteTab, localTab],
        { app: "app_01", surface: "main" },
        "mch_self",
        "mch_remote",
        "mch_self",
      ),
      localTab,
    );
  });

  it("matches an unstamped local tab in a local workspace", () => {
    assert.equal(
      findMatchingAppPanelTab(
        [remoteTab],
        { app: "app_01", surface: "main" },
        undefined,
        null,
        "mch_self",
      ),
      remoteTab,
    );
  });
});

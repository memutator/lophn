import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { EventClient } from "../desktop/connection/events/client.ts";
import type { MachineData, MachineHub } from "../desktop/machines/data.ts";
import type { MachineRef } from "../desktop/machines/scope.tsx";
import type { IconReader } from "../parts/icon-upload/icon-reader.ts";
import type { AppViewsDeps } from "./app-views.tsx";
import { appIconReader, screensSourceOf } from "./machine-app-source.ts";

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

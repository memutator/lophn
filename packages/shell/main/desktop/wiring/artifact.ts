// artifact 탭: 봉한 partition의 `<webview>` guest 목록과 renderer IPC. 위치·보임은 renderer CSS이고,
// 붙이기 판정은 browser의 combined `will-attach-webview` handler에 resolver로 넣는다.
import { app } from "electron";
import { randomUUID } from "node:crypto";
import { watch } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  ARTIFACT_EVENT_CHANNEL,
  ARTIFACT_STATE_CHANNEL,
} from "../../../ipc/artifact.ts";
import { createActivation } from "../../browser/activation.ts";
import {
  createArtifactIpc,
  registerArtifactIpc,
  removeArtifactIpc,
} from "../../artifact/artifact-ipc.ts";
import { deleteArtifactFolder } from "../../artifact/delete.ts";
import { electronArtifactViews } from "../../artifact/electron-view.ts";
import { electronArtifactSession } from "../../artifact/electron-session.ts";
import { listArtifacts } from "../../artifact/list.ts";
import { ARTIFACT_MAX_BYTES } from "../../artifact/paths.ts";
import {
  type ArtifactViews,
  createArtifactViews,
} from "../../artifact/registry.ts";
import type { Id } from "../../../../protocol/base/ids.ts";
import { artifactsFolder } from "../../../../protocol/projects/artifact.ts";
import { createRemoteArtifacts } from "../../artifact/remote.ts";
import { createArtifactRoots } from "../../artifact/roots.ts";
import { createArtifactServer } from "../../artifact/serve.ts";
import { sealArtifactSession } from "../../artifact/session.ts";
import { nodeArtifactFs, resolveSource } from "../../artifact/source.ts";
import { watchFolder } from "../../artifact/watch.ts";
import type { BrowserWiring } from "./browser.ts";
import { changedIds, type Registered, type ShellContext } from "./context.ts";

export type ArtifactWiring = Registered & {
  views: ArtifactViews;
};

export function register(
  ctx: ShellContext,
  browser: Pick<BrowserWiring, "webviewGuests">,
): ArtifactWiring {
  const { headless, ipc, windowRef, windowOfRef } = ctx;

  const roots = createArtifactRoots();
  const isRemoteMachine = (machine: string | undefined): machine is string =>
    machine !== undefined && machine !== ctx.machines.list().this?.id;
  const remoteArtifacts = createRemoteArtifacts((machine) =>
    ctx.machines.link(machine as Id<"mch">),
  );
  // instance 상태를 cursor 끝까지 읽어 `_instance.json` 본문으로 만든다. 못 읽거나 상한을 넘으면
  // null이다(agent가 report를 끝없이 내도 main이 커지지 않게 한다).
  const readInstance = async (instance: string): Promise<string | null> => {
    const lines: unknown[] = [];
    let size = 0;
    let cursor: string | undefined;
    for (;;) {
      const res = await ctx.coreInternal(
        "read",
        "workflow_instances",
        "read",
        cursor === undefined ? { instance } : { instance, cursor },
      );
      if (!res.ok) return null;
      const page = res.value;
      if (typeof page !== "object" || page === null) return null;
      const { lines: pageLines, next_cursor: next } = page as Record<
        string,
        unknown
      >;
      if (!Array.isArray(pageLines)) return null;
      lines.push(...pageLines);
      size += JSON.stringify(pageLines).length;
      if (size > ARTIFACT_MAX_BYTES) return null;
      if (typeof next !== "string" || next === cursor) {
        const { instance: state, last_reports } = page as Record<
          string,
          unknown
        >;
        const json = JSON.stringify({ instance: state, last_reports, lines });
        return json.length > ARTIFACT_MAX_BYTES ? null : json;
      }
      cursor = next;
    }
  };
  const kit = async (name: "kit.js" | "kit.css") => {
    try {
      return new Uint8Array(
        await readFile(
          join(
            ctx.rendererDist(),
            "artifact-kit",
            name === "kit.js" ? "entry.js" : "entry.css",
          ),
        ),
      );
    } catch {
      return null;
    }
  };
  const serve = createArtifactServer({
    rootOf: roots.rootOf,
    scopeOf: roots.scopeOf,
    remoteOf: roots.remoteOf,
    readRemote: remoteArtifacts.read,
    readInstance,
    kit,
    maxBytes: ARTIFACT_MAX_BYTES,
  });
  // userData(desktop.ts)를 잡은 뒤 첫 view에서 한 번만 봉한다. 못 봉하면 view를 만들지 않고, 다음
  // 요청이 다시 시도한다.
  let sealed: Promise<void> | undefined;
  const ensureSession = () =>
    (sealed ??= sealArtifactSession(electronArtifactSession(), serve).catch(
      (error) => {
        sealed = undefined;
        throw error;
      },
    ));

  const host = electronArtifactViews({
    packaged: app.isPackaged,
    headless,
  });

  const sendTo = (channel: string) => (ref: string, payload: unknown) => {
    const window = windowOfRef(ref);
    if (window !== undefined && !window.webContents.isDestroyed()) {
      window.webContents.send(channel, payload);
    }
  };

  const views = createArtifactViews({
    host,
    activation: createActivation({ nowMs: () => Date.now() }, (id) =>
      ctx.driverInput.marked(id),
    ),
    resolve: (source) =>
      source.kind === "artifact" && isRemoteMachine(source.machine)
        ? remoteArtifacts.resolve({ ...source, machine: source.machine })
        : resolveSource(ctx.dataRoot, source, nodeArtifactFs),
    ensureSession,
    registerRoot: roots.register,
    registerRemoteRoot: roots.registerRemote,
    watch: (input, onChange) =>
      watchFolder(
        input,
        {
          watch: (dir, options, listener) =>
            watch(dir, options, () => listener()),
          timer: {
            set: (fn, ms) => setTimeout(fn, ms),
            clear: (handle) => clearTimeout(handle as NodeJS.Timeout),
          },
        },
        onChange,
      ),
    ids: { viewSession: () => `artifact-${randomUUID()}` },
    pushState: sendTo(ARTIFACT_STATE_CHANNEL),
    pushEvent: sendTo(ARTIFACT_EVENT_CHANNEL),
  });

  registerArtifactIpc(
    ipc,
    createArtifactIpc({
      registry: ctx.overlays.overlayRegistry(),
      windowOf: (sender) => {
        const window = ctx.shellWindowOf(sender);
        return window === undefined ? undefined : windowRef(window);
      },
      views,
      list: (workspace, machine) =>
        isRemoteMachine(machine)
          ? remoteArtifacts.list(machine, workspace)
          : listArtifacts(ctx.dataRoot, workspace, nodeArtifactFs),
      remove: async ({ project, name }) => {
        const deleted = await deleteArtifactFolder(
          artifactsFolder(ctx.dataRoot, { kind: "project", id: project }),
          name,
        );
        if (!deleted.ok) {
          const { code, message } = deleted.error;
          return {
            ok: false,
            error: {
              code:
                code === "invalid_input" ||
                code === "forbidden" ||
                code === "not_found"
                  ? code
                  : "internal",
              message,
            },
          };
        }
        // 지운 뒤에 view를 버린다. 지우기가 실패하면 열린 탭은 그대로다.
        views.removeSource({ kind: "artifact", project, name });
        return { ok: true, value: null };
      },
    }),
  );
  // build가 artifact preload를 같은 dist에 .cjs로 낸다. 붙이기에서 강제한다.
  const preload = join(ctx.here, "preload-artifact.cjs");
  browser.webviewGuests.add((window, src) => {
    const accepted = views.acceptGuest(window, src);
    if (accepted === undefined) return undefined;
    return {
      target: {
        kind: "artifact",
        partition: accepted.partition,
        src: accepted.src,
        preload,
      },
      bind: (guest) => views.bindGuest(accepted, guest),
      drop: () => views.dropGuest(accepted),
    };
  });

  ctx.windowHooks.closed.push(({ ref }) => views.closeWindow(ref));
  // CLI로 낸 report는 session event가 없어 이 event가 view가 알 유일한 길이다. 이 event는 남지 않고
  // 놓친 view는 다시 열 때 다시 읽는다. instance command는 늘 id를 싣는다.
  ctx.relay.conditions.push({ types: ["StateChanged"] });
  ctx.relay.events.push((event) => {
    for (const instance of changedIds(event, "workflow_instances")) {
      if (instance !== null) views.reloadInstance(instance);
    }
  });

  return {
    views,
    stop() {
      removeArtifactIpc(ipc);
      views.dispose();
    },
  };
}

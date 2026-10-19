// artifact 탭: 봉한 partition의 native view 목록과 renderer IPC. 위치·숨김 길은 artifact.frame으로
// app-views.ts가 받는다. 층 순서는 browser와 같은 것을 쓴다(창마다 하나여야 한다).
import { app } from "electron";
import { randomUUID } from "node:crypto";
import { watch } from "node:fs";
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
import { electronArtifactViews } from "../../artifact/electron-view.ts";
import { electronArtifactSession } from "../../artifact/electron-session.ts";
import { listArtifacts } from "../../artifact/list.ts";
import { ARTIFACT_MAX_BYTES } from "../../artifact/paths.ts";
import {
  type ArtifactViews,
  createArtifactViews,
} from "../../artifact/registry.ts";
import { createArtifactRoots } from "../../artifact/roots.ts";
import { createArtifactServer } from "../../artifact/serve.ts";
import { sealArtifactSession } from "../../artifact/session.ts";
import { nodeArtifactFs, resolveSource } from "../../artifact/source.ts";
import { watchFolder } from "../../artifact/watch.ts";
import type { ArtifactFrame } from "../../browser/frame-router.ts";
import type { BrowserWiring } from "./browser.ts";
import type { Registered, ShellContext } from "./context.ts";

export type ArtifactWiring = Registered & {
  views: ArtifactViews;
  frame: ArtifactFrame;
};

export function register(
  ctx: ShellContext,
  browser: Pick<BrowserWiring, "orderOf">,
): ArtifactWiring {
  const { headless, ipc, windowRef, windowOfRef } = ctx;

  const roots = createArtifactRoots();
  const serve = createArtifactServer({
    rootOf: roots.rootOf,
    maxBytes: ARTIFACT_MAX_BYTES,
  });
  // userData(desktop.ts)를 잡은 뒤 첫 view에서 한 번만 봉한다. 못 봉하면 view를 만들지 않고, 다음
  // 요청이 다시 시도한다.
  let sealed: Promise<void> | undefined;
  const ensureSession = () =>
    sealed ??= sealArtifactSession(electronArtifactSession(), serve).catch(
      (error) => {
        sealed = undefined;
        throw error;
      },
    );

  const host = electronArtifactViews({
    windowOf: (ref) => windowOfRef(ref),
    // build가 artifact preload를 같은 dist에 .cjs로 낸다.
    preload: join(ctx.here, "preload-artifact.cjs"),
    packaged: app.isPackaged,
    headless,
    orderOf: browser.orderOf,
  });

  const sendTo = (channel: string) => (ref: string, payload: unknown) => {
    const window = windowOfRef(ref);
    if (window !== undefined && !window.webContents.isDestroyed()) {
      window.webContents.send(channel, payload);
    }
  };

  const views = createArtifactViews({
    host,
    activation: createActivation({ nowMs: () => Date.now() }),
    resolve: (source) => resolveSource(ctx.dataRoot, source, nodeArtifactFs),
    ensureSession,
    registerRoot: roots.register,
    watch: (input, onChange) =>
      watchFolder(input, {
        watch: (dir, options, listener) =>
          watch(dir, options, () => listener()),
        timer: {
          set: (fn, ms) => setTimeout(fn, ms),
          clear: (handle) => clearTimeout(handle as NodeJS.Timeout),
        },
      }, onChange),
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
      list: (project) => listArtifacts(ctx.dataRoot, project, nodeArtifactFs),
    }),
  );
  ctx.windowHooks.closed.push(({ ref }) => views.closeWindow(ref));

  return {
    views,
    frame: views,
    stop() {
      removeArtifactIpc(ipc);
      views.dispose();
    },
  };
}

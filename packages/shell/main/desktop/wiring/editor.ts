// 파일 adapter와 창 닫기 guard. renderer는 절대 경로만 보내고 main이 디스크를 직접 읽고 쓴다.
// core는 연결 폴더(폴더 목록의 범위)와 project의 첫 폴더(지침 경로)를 알 때만 부른다.
// 창마다 guard가 저장 중 수를 기억한다.
import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";

import { app, shell } from "electron";

import {
  FILE_CHANGED_CHANNEL,
  FILE_CLOSE_REQUEST_CHANNEL,
} from "../../../ipc/files.ts";
import { CloseGuard, guardWindowClose } from "../../editor/close-guard.ts";
import { createFileAdapter } from "../../editor/file-adapter.ts";
import { createInstructions } from "../../editor/instructions.ts";
import { registerFilesIpc, removeFilesIpc } from "../../editor/ipc.ts";
import type { Registered, ShellContext } from "./context.ts";

// Linux의 Electron `shell.trashItem`은 KDE에서 `kioclient move <path> trash:/`를 띄우고, 그게 파일 하나에
// 5초쯤 걸린다(같은 파일에 `gio trash`는 0초). gio가 없거나 실패하면(휴지통이 없는 tmpfs 등) Electron으로 넘긴다.
// gio는 못 버리면 아무것도 지우지 않고 실패한다.
function gioTrash(path: string): Promise<void> {
  return new Promise((resolve, reject) =>
    execFile("gio", ["trash", "--", path], (error) =>
      error ? reject(error) : resolve(),
    ),
  );
}

type ProjectFolders = {
  id: string;
  status: string;
  folders: { path: string }[];
};

export function register(ctx: ShellContext): Registered {
  const { dataRoot, overlays, ipc, log, closeGuards } = ctx;

  /** 활성 project들. core를 못 읽으면 null이다. */
  async function activeProjects(): Promise<ProjectFolders[] | null> {
    const found: ProjectFolders[] = [];
    let cursor: string | undefined;
    do {
      const reply = await ctx.coreInternal("read", "projects", "list", {
        status: "active",
        ...(cursor === undefined ? {} : { cursor }),
      });
      if (!reply.ok) return null;
      const value = reply.value as {
        projects?: ProjectFolders[];
        next_cursor?: string | null;
      };
      found.push(...(value.projects ?? []));
      cursor = value.next_cursor ?? undefined;
    } while (cursor !== undefined);
    return found;
  }

  const fileAdapter = createFileAdapter({
    dataRoot,
    folders: async () =>
      (await activeProjects())?.flatMap((project) =>
        project.folders.map((folder) => folder.path),
      ) ?? null,
    trash: (path) =>
      process.platform === "linux"
        ? gioTrash(path).catch(() => shell.trashItem(path))
        : shell.trashItem(path),
    reveal: (path) => shell.showItemInFolder(path),
    notify: (owner, change) => {
      const window = [...ctx.windows].find(
        (one) => !one.isDestroyed() && one.webContents.id === owner,
      );
      window?.webContents.send(FILE_CHANGED_CHANNEL, change);
    },
  });
  const instructions = createInstructions({
    dataRoot,
    firstFolder: async (project) => {
      const projects = await activeProjects();
      if (projects === null) throw new Error("core is not ready");
      return (
        projects.find((one) => one.id === project)?.folders[0]?.path ?? null
      );
    },
    makeDir: async (path) => {
      await mkdir(path, { recursive: true });
    },
  });
  registerFilesIpc(ipc, {
    registry: overlays.overlayRegistry(),
    adapter: fileAdapter,
    instructions,
    guardOf: (id) => closeGuards.get(id),
  });

  // 창 닫기는 편집기의 마지막 고침을 먼저 본다.
  ctx.windowHooks.created.push((window) => {
    const contentsId = window.webContents.id;
    const guard = new CloseGuard({
      send: (request) => {
        if (!window.isDestroyed()) {
          window.webContents.send(FILE_CLOSE_REQUEST_CHANNEL, request);
        }
      },
      log,
    });
    closeGuards.add(contentsId, guard);
    guardWindowClose(
      {
        onClose: (listener) => window.on("close", listener),
        close: () => window.close(),
        isDestroyed: () => window.isDestroyed(),
      },
      guard,
      {
        quitting: () => ctx.quit.active(),
        quitRequested: () => ctx.quit.requested,
        resumeQuit: () => app.quit(),
        quitCancelled: () => {
          ctx.quit.requested = false;
        },
      },
    );
  });
  ctx.windowHooks.closed.push(({ contentsId }) => {
    closeGuards.remove(contentsId);
    fileAdapter.dropOwner(contentsId);
  });

  return { stop: () => removeFilesIpc(ipc) };
}

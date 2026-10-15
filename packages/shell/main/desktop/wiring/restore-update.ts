// settings backup 복원, settings update, OS notification.
import { app, Notification } from "electron";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { registerRestoreIpc, removeRestoreIpc } from "../core/restore-ipc.ts";
import { registerUpdateIpc, removeUpdateIpc } from "../core/update-ipc.ts";
import { guardNotifier } from "../headless.ts";
import {
  createOsNotifications,
  displayFromReply,
  type OsNotifier,
} from "../os-notification.ts";
import type { Registered, ShellContext } from "./context.ts";

function electronNotifier(): OsNotifier {
  // 올린 notification을 닫히거나 눌릴 때까지 잡아 둔다. 놓치면 클릭 handler가 사라진다.
  const live = new Set<Notification>();
  return {
    isSupported: () => Notification.isSupported(),
    show(note, onClick) {
      const shown = new Notification({ title: note.title, body: note.body });
      live.add(shown);
      shown.on("click", () => {
        live.delete(shown);
        onClick();
      });
      shown.on("close", () => live.delete(shown));
      shown.show();
    },
  };
}

export function register(ctx: ShellContext): Registered {
  const { here, dataRoot, headless, overlays, core, ipc, log } = ctx;

  // OS notification. 지금 도착한 NotificationCreated마다 core가 주는 OS
  // 표시 요청(사람이 켰을 때만 값이 있다)으로 계기 종류의 고정 문구만 올린다. 클릭은
  // things-to-confirm을 열 뿐 읽음이 아니다. 표시 실패는 고정 이유로 core에 알린다. headless는
  // OS에 올리지 않는다.
  const osNotifications = createOsNotifications({
    notifier: guardNotifier(electronNotifier(), headless, log),
    display: async (notification) => {
      // event가 먼저 도착하고 display reader가 한 박자 늦으면 not_found·unavailable다.
      // 그때 null로 끝내면 이 main은 그 id를 이미 본 것으로 기억해 실패를 보고하지 않는다.
      // 사람이 끈 경우(ok이고 display가 비어 있음)와 다른 오류는 다시 묻지 않는다.
      const deadline = Date.now() + 4_000;
      for (;;) {
        const session = core.session();
        if (!session) return null;
        const reply = await session.internal(
          "read",
          "notifications",
          "display",
          { notification },
        );
        if (reply.ok) return displayFromReply(reply.value);
        const code = reply.error.code;
        if (
          (code !== "not_found" && code !== "unavailable") ||
          Date.now() >= deadline
        ) return null;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    },
    report: async (notification, reason) => {
      const session = core.session();
      if (!session) return;
      await session.internal("memory", "notifications", "delivery", {
        notification,
        reason,
      });
    },
    open: () => ctx.desktop.send("things-to-confirm"),
    unavailable: () => ctx.tray.current?.notice("notifications-unavailable"),
    log,
  });
  ctx.relay.arrived.push((events) => void osNotifications.arrived(events));

  // settings backup 복원. 계획을 읽고 사람이 확인한 묶음만 결정 handle로 복원한다.
  // 복원 뒤 core는 같은 pipe의 새 hello로 다시 시작하고 connection이 session을 다시 연다.
  registerRestoreIpc(ipc, {
    registry: overlays.overlayRegistry(),
    pipe: () => core.restorePipe(),
    register: (request) => core.registerConfirmation(request),
  });

  // settings update(flow update-lophn 1–2). 사람이 고른 로컬 metadata로 안내하고,
  // 정상 정지를 확인한 뒤에만 그 파일로 설치 파일을 바꾼다. 다운로드·재시작은 없다.
  registerUpdateIpc(ipc, {
    registry: overlays.overlayRegistry(),
    session: () => core.session(),
    dataRoot: () => dataRoot,
    stopPlatform: () => core.confirmStop(),
    version: () => {
      try {
        const parsed = JSON.parse(
          readFileSync(join(here, "..", "package.json"), "utf8"),
        ) as { version?: unknown };
        if (typeof parsed.version === "string" && parsed.version !== "") {
          return parsed.version;
        }
      } catch {
        // package.json을 못 읽으면 Electron이 아는 version만 쓴다.
      }
      return app.getVersion();
    },
  });

  return {
    stop() {
      removeRestoreIpc(ipc);
      removeUpdateIpc(ipc);
    },
  };
}

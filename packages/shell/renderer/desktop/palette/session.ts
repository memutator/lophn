// 창 안 명령 팔레트 하나. shell overlay view에 palette 표면으로 열고
// 검색어가 오면 지금 공간의 행을 다시 만들어 같은 표면에 보낸다. 고른 행의 대상은
// 이 renderer에만 있고 overlay·main에는 행 id와 이름만 간다.
import type { Timer } from "@lophn/design/components";

import type {
  OverlayApi,
  OverlayIdentity,
  Rect,
} from "../../../ipc/overlay.ts";
import { overlayConsumer } from "../../overlay/consumer.ts";
import {
  arrange,
  type PaletteEntry,
  type PaletteGroup,
  paletteModel,
  SEARCH_DEBOUNCE_MS,
} from "./model.ts";
import { groupLabel } from "./labels.ts";

/** 공간이 팔레트에 내놓는 것. 행은 그 공간의 지금 탐색 대상만 가리킨다. */
export interface PaletteScope<T> {
  readonly title: string;
  readonly order: readonly PaletteGroup[];
  /** 검색어 없이도 아는 행(열린 탭·목록·행동). */
  entries(): readonly PaletteEntry<T>[];
  /** 검색어로 찾는 파일. 실패는 빈 목록이다. */
  search?(query: string): Promise<readonly PaletteEntry<T>[]>;
  choose(target: T): void;
}

interface Session {
  readonly requestId: string;
  readonly scope: PaletteScope<unknown>;
  readonly targets: Map<string, unknown>;
  identity?: OverlayIdentity;
  serial: number;
  pending?: unknown;
}

export interface PaletteOpener {
  /** 열려 있으면 닫고 아니면 연다(같은 키로 열고 닫는다). */
  toggle<T>(scope: PaletteScope<T>, opener: HTMLElement): Promise<void>;
  readonly open: boolean;
  dispose(): void;
}

// 팔레트는 창 본문 전체를 쓰므로 anchor는 본문 가운데 한 점이면 된다.
function centerAnchor(): Rect {
  return {
    x: Math.max(0, Math.round(globalThis.innerWidth / 2)),
    y: Math.max(0, Math.round(globalThis.innerHeight / 2)),
    width: 1,
    height: 1,
  };
}

let requests = 0;

export function paletteOpener(
  api: OverlayApi,
  { timer, anchor = centerAnchor }: { timer: Timer; anchor?: () => Rect },
): PaletteOpener {
  let session: Session | null = null;

  function end(current: Session) {
    if (current.pending !== undefined) timer.clear(current.pending);
    if (session === current) session = null;
  }

  async function refresh(current: Session, query: string) {
    const serial = ++current.serial;
    const { scope } = current;
    const local = scope.entries();
    const found = scope.search && query.trim() !== ""
      ? await scope.search(query.trim()).catch(() => [])
      : [];
    // 그 사이 닫혔거나 더 새 검색어가 왔으면 버린다.
    if (session !== current || current.serial !== serial) return;
    const rows = arrange(scope.order, [...local, ...found], query);
    const next = paletteModel(scope.title, rows, serial, groupLabel);
    for (const [id, target] of next.targets) current.targets.set(id, target);
    if (current.identity) {
      await consumer.update({ ...current.identity, model: next.model });
    }
  }

  const consumer = overlayConsumer(api, (result) => {
    const current = session;
    if (!current || result.requestId !== current.requestId) return;
    if (result.type === "pointer") return;
    if (result.type === "query") {
      if (current.pending !== undefined) timer.clear(current.pending);
      current.pending = timer.set(() => {
        current.pending = undefined;
        void refresh(current, result.text);
      }, SEARCH_DEBOUNCE_MS);
      return;
    }
    end(current);
    if (result.type === "selected" && result.choiceId) {
      const target = current.targets.get(result.choiceId);
      if (target !== undefined) current.scope.choose(target);
    }
  }, () => {
    if (session) end(session);
  });

  return {
    get open() {
      return session !== null;
    },
    async toggle(scope, opener) {
      if (session) {
        const current = session;
        end(current);
        if (current.identity) await consumer.close(current.identity);
        return;
      }
      const current: Session = {
        requestId: `palette-${++requests}`,
        scope: scope as PaletteScope<unknown>,
        targets: new Map(),
        serial: 0,
      };
      session = current;
      const first = paletteModel(
        scope.title,
        arrange(scope.order, scope.entries(), ""),
        0,
        groupLabel,
      );
      for (const [id, target] of first.targets) {
        current.targets.set(id, target);
      }
      const opened = await consumer.open({
        requestId: current.requestId,
        kind: "palette",
        anchorRect: anchor(),
        model: first.model,
      }, opener);
      if (!opened.ok) {
        end(current);
        return;
      }
      if (session === current) current.identity = opened.value;
    },
    dispose() {
      if (session) end(session);
      consumer.dispose();
    },
  };
}

import type {
  OverlayApi,
  OverlayError,
  OverlayKind,
  OverlayResult,
  OverlaySnapshot,
  OverlaySurface,
} from "../../ipc/overlay.ts";

const zToken: Record<OverlayKind, string> = {
  menu: "popover",
  popover: "popover",
  tooltip: "tooltip",
  dialog: "dialog",
  palette: "palette",
  sheet: "sheet",
  drag: "shell",
  notification: "toast",
};

// 표면이 돌려주는 사람의 조작. 고른 결과·닫힘·검색어만 있고 command는 없다.
export interface SurfaceActions {
  select(choiceId: string): void;
  close(): void;
  /** 검색 palette의 검색어. 표면은 열린 채다. */
  query(text: string): void;
  /** 연 쪽이 같은 표면의 행을 바꾸면 새 표면으로 부른다. 그만 들을 함수를 돌려준다. */
  watch(listener: (surface: OverlaySurface) => void): () => void;
}

// host 안에 표면을 그리고 지우는 함수를 돌려준다. 지울 때는 결과도 focus 이동도 만들지 않는다.
export type SurfaceMount = (
  host: HTMLElement,
  surface: OverlaySurface,
  actions: SurfaceActions,
) => () => void;

type Item = {
  node: HTMLElement;
  surface: OverlaySurface;
  unmount: () => void;
  watchers: Set<(surface: OverlaySurface) => void>;
  // 고르기·닫기는 표면마다 한 번만 보낸다. 실패하면 같은 표면의 다음 조작으로 다시 보낼 수 있다.
  terminal: "idle" | "pending" | "done";
};

// registry는 native overlay 하나 안의 sibling host만 만들고 표면 모양은 mount에 맡긴다.
export function overlayRegistry(
  root: HTMLElement,
  api: OverlayApi,
  classes: Record<string, string>,
  onError: (error: OverlayError) => void,
  mount: SurfaceMount,
) {
  const nodes = new Map<string, Item>();
  let disposed = false;
  let current: OverlaySnapshot | undefined;
  async function send(input: OverlayResult) {
    if (disposed) return;
    try {
      const result = await api.result(input);
      if (!disposed && !result.ok) onError(result.error);
    } catch {
      if (!disposed) {
        onError({ code: "unavailable", message: "Overlay is unavailable" });
      }
    }
  }
  // 지운 표면이나 옛 generation의 늦은 조작과 응답은 결과로도 오류로도 내지 않는다.
  function live(item: Item): boolean {
    return !disposed && nodes.get(item.surface.surfaceId) === item;
  }
  async function finish(item: Item, input: OverlayResult) {
    if (!live(item) || item.terminal !== "idle") return;
    item.terminal = "pending";
    let error: OverlayError;
    try {
      const result = await api.result(input);
      if (result.ok) {
        item.terminal = "done";
        return;
      }
      error = result.error;
    } catch {
      error = { code: "unavailable", message: "Overlay is unavailable" };
    }
    item.terminal = "idle";
    if (live(item)) onError(error);
  }
  function pointer(
    surface: OverlaySurface,
    event: PointerEvent,
    type: "pointer" | "drag-end",
  ) {
    if (!current) return;
    const x = Math.min(
      current.bounds.x + current.bounds.width - 1,
      Math.max(current.bounds.x, Math.round(event.clientX + current.bounds.x)),
    );
    const y = Math.min(
      current.bounds.y + current.bounds.height - 1,
      Math.max(current.bounds.y, Math.round(event.clientY + current.bounds.y)),
    );
    void send({
      surfaceId: surface.surfaceId,
      generation: surface.generation,
      type,
      pointerId: event.pointerId,
      x,
      y,
      bounds: {
        ...surface.anchorRect,
        width: Math.max(1, x - surface.anchorRect.x),
        height: Math.max(1, y - surface.anchorRect.y),
      },
    });
  }
  // drag는 shell에서 이미 누른 채로 시작할 수 있다(경계 끌기). 그때는 이 표면이 pointerdown을 받지
  // 못하므로 누른 버튼(buttons)으로 움직임을 받는다.
  function drag(node: HTMLElement, surface: OverlaySurface) {
    const held = (event: PointerEvent) =>
      node.hasPointerCapture(event.pointerId) || (event.buttons & 1) === 1;
    node.addEventListener(
      "pointerdown",
      (event) => node.setPointerCapture(event.pointerId),
    );
    node.addEventListener("pointermove", (event) => {
      if (!held(event) || !current) return;
      pointer(surface, event, "pointer");
    });
    node.addEventListener("pointerup", (event) => {
      pointer(surface, event, "drag-end");
      if (node.hasPointerCapture(event.pointerId)) {
        node.releasePointerCapture(event.pointerId);
      }
    });
    node.addEventListener("pointercancel", (event) => {
      if (node.hasPointerCapture(event.pointerId)) {
        node.releasePointerCapture(event.pointerId);
      }
      void send({
        surfaceId: surface.surfaceId,
        generation: surface.generation,
        type: "drag-cancel",
      });
    });
  }
  function create(surface: OverlaySurface): Item {
    const node = root.ownerDocument.createElement("section");
    node.dataset.surfaceId = surface.surfaceId;
    node.dataset.kind = surface.kind;
    node.className = `${classes.surface ?? ""} ${classes[surface.kind] ?? ""}`;
    node.style.zIndex = `var(--z-${zToken[surface.kind]})`;
    root.append(node);
    if (surface.kind === "drag") {
      drag(node, surface);
      return {
        node,
        surface,
        unmount: () => {},
        watchers: new Set(),
        terminal: "idle",
      };
    }
    const identity = {
      surfaceId: surface.surfaceId,
      generation: surface.generation,
    };
    const item: Item = {
      node,
      surface,
      unmount: () => {},
      watchers: new Set(),
      terminal: "idle",
    };
    nodes.set(surface.surfaceId, item);
    item.unmount = mount(node, surface, {
      select(choiceId) {
        void finish(item, { ...identity, type: "selected", choiceId });
      },
      close() {
        void finish(item, { ...identity, type: "closed" });
      },
      query(text) {
        if (live(item) && item.terminal === "idle") {
          void send({ ...identity, type: "query", text });
        }
      },
      watch(listener) {
        item.watchers.add(listener);
        return () => item.watchers.delete(listener);
      },
    });
    return item;
  }
  function remove(id: string, item: Item) {
    nodes.delete(id);
    item.unmount();
    item.node.remove();
  }
  function update(state: OverlaySnapshot) {
    if (disposed) return;
    current = state;
    for (const [id, item] of nodes) {
      const next = state.surfaces.find((surface) => surface.surfaceId === id);
      if (!next || next.generation !== item.surface.generation) {
        remove(id, item);
      }
    }
    for (const surface of state.surfaces) {
      const known = nodes.get(surface.surfaceId);
      const item = known ?? create(surface);
      nodes.set(surface.surfaceId, item);
      // snapshot은 매번 새 값으로 온다. 행이 실제로 바뀐 때만 표면에 알린다.
      if (
        known &&
        JSON.stringify(known.surface.model) !== JSON.stringify(surface.model)
      ) {
        known.surface = surface;
        for (const watcher of known.watchers) watcher(surface);
      }
      // main이 정한 native rect를 view-local 좌표로 그대로 놓는다.
      item.node.style.left = `${surface.rect.x}px`;
      item.node.style.top = `${surface.rect.y}px`;
      item.node.style.width = `${surface.rect.width}px`;
      item.node.style.height = `${surface.rect.height}px`;
    }
  }
  const subscribe = () =>
    api.subscribe((event) => {
      if (!disposed && "surfaces" in event) update(event);
    }, (error) => {
      if (!disposed) onError(error);
    });
  let unsubscribe = subscribe();
  return {
    update,
    retryReady() {
      if (disposed) return;
      unsubscribe();
      unsubscribe = subscribe();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      current = undefined;
      unsubscribe();
      for (const [id, item] of nodes) remove(id, item);
      root.replaceChildren();
    },
  };
}

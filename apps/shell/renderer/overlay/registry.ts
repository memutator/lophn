import {
  interactive,
  type OverlayApi,
  type OverlayError,
  type OverlayKind,
  type OverlayResult,
  type OverlaySnapshot,
  type OverlaySurface,
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

// registry는 native overlay 하나 안의 sibling만 만든다. owner labels는 textContent로만 쓴다.
export function overlayRegistry(
  root: HTMLElement,
  api: OverlayApi,
  classes: Record<string, string>,
  onError: (error: OverlayError) => void,
) {
  const nodes = new Map<
    string,
    { node: HTMLElement; surface: OverlaySurface }
  >();
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
  function close(surface: OverlaySurface) {
    void send({
      surfaceId: surface.surfaceId,
      generation: surface.generation,
      type: "closed",
    });
  }
  function update(state: OverlaySnapshot) {
    if (disposed) return;
    current = state;
    for (const [id, item] of nodes) {
      if (!state.surfaces.some((surface) => surface.surfaceId === id)) {
        item.node.remove();
        nodes.delete(id);
      }
    }
    for (const surface of state.surfaces) {
      let item = nodes.get(surface.surfaceId);
      const fresh = !item;
      if (!item) {
        const node = root.ownerDocument.createElement("section");
        node.dataset.surfaceId = surface.surfaceId;
        node.dataset.kind = surface.kind;
        node.className = `${classes.surface} ${classes[surface.kind] ?? ""}`;
        node.style.zIndex = `var(--z-${zToken[surface.kind]})`;
        if (interactive(surface.kind)) node.tabIndex = -1;
        if (surface.kind === "tooltip") node.setAttribute("role", "tooltip");
        if (interactive(surface.kind)) {
          node.setAttribute(
            "role",
            surface.kind === "menu"
              ? "menu"
              : ["dialog", "palette"].includes(surface.kind)
              ? "dialog"
              : "group",
          );
          node.setAttribute("aria-label", surface.model.label);
        }
        const label = root.ownerDocument.createElement("div");
        label.textContent = surface.model.label;
        node.append(label);
        if (surface.model.text) {
          const text = root.ownerDocument.createElement("p");
          text.textContent = surface.model.text;
          node.append(text);
        }
        for (
          const choice of interactive(surface.kind) ? surface.model.choices : []
        ) {
          const button = root.ownerDocument.createElement("button");
          button.textContent = choice.label;
          if (surface.kind === "menu") button.setAttribute("role", "menuitem");
          button.disabled = choice.disabled ?? false;
          button.addEventListener("click", () => {
            void send({
              surfaceId: surface.surfaceId,
              generation: surface.generation,
              type: "selected",
              choiceId: choice.id,
            });
          });
          node.append(button);
        }
        node.addEventListener("keydown", (event) => {
          if (event.key === "Escape" && interactive(surface.kind)) {
            event.stopPropagation();
            close(surface);
          }
        });
        if (["menu", "popover", "sheet"].includes(surface.kind)) {
          node.addEventListener("focusout", (event) => {
            if (!node.contains(event.relatedTarget as Node | null)) {
              close(surface);
            }
          });
        }
        if (surface.kind === "drag") {
          node.addEventListener(
            "pointerdown",
            (event) => node.setPointerCapture(event.pointerId),
          );
          node.addEventListener("pointermove", (event) => {
            if (!node.hasPointerCapture(event.pointerId) || !current) return;
            pointer(surface, event, "pointer");
          });
          node.addEventListener("pointerup", (event) => {
            if (!node.hasPointerCapture(event.pointerId)) return;
            pointer(surface, event, "drag-end");
            node.releasePointerCapture(event.pointerId);
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
        root.append(node);
        item = { node, surface };
        nodes.set(surface.surfaceId, item);
      }
      const { node } = item;
      node.style.left = `${surface.rect.x}px`;
      node.style.top = `${surface.rect.y}px`;
      node.style.width = `${surface.rect.width}px`;
      node.style.height = `${surface.rect.height}px`;
      if (fresh && interactive(surface.kind)) {
        (node.querySelector<HTMLElement>("button:not(:disabled)") ?? node)
          .focus();
      }
    }
  }
  const outside = (event: PointerEvent) => {
    for (const item of nodes.values()) {
      if (
        item.surface.kind === "sheet" &&
        !item.node.contains(event.target as Node)
      ) close(item.surface);
    }
  };
  root.ownerDocument.addEventListener("pointerdown", outside);
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
      root.ownerDocument.removeEventListener("pointerdown", outside);
      nodes.clear();
      root.replaceChildren();
    },
  };
}

import {
  interactive,
  type OverlayApi,
  type OverlayDragUpdate,
  type OverlayError,
  type OverlayIdentity,
  type OverlayOpen,
  type OverlayOutcome,
  type OverlayQuery,
  type OverlayReply,
} from "../../ipc/overlay.ts";

type Completion = OverlayOutcome | OverlayDragUpdate | OverlayQuery;
type Opener = {
  element: HTMLElement;
  focus: boolean;
  identity?: OverlayIdentity;
  pointer?: OverlayDragUpdate;
  query?: OverlayQuery;
  terminal?: OverlayOutcome;
};

// opener DOM은 shell renderer에 남긴다. main에 DOM id나 business payload를 보내지 않는다.
export function overlayConsumer(
  api: OverlayApi,
  onResult: (result: Completion) => void,
  onError: (error: OverlayError) => void,
) {
  let disposed = false;
  const unavailable = () => ({
    ok: false as const,
    error: { code: "unavailable" as const, message: "Overlay is unavailable" },
  });
  const openers = new Map<string, Opener>();
  function complete(event: Completion, opener: Opener) {
    if (
      disposed || openers.get(event.requestId) !== opener ||
      !opener.identity || event.surfaceId !== opener.identity.surfaceId ||
      event.generation !== opener.identity.generation
    ) return;
    if (event.type === "pointer" || event.type === "query") {
      onResult(event);
      return;
    }
    openers.delete(event.requestId);
    if (opener.focus && opener.element.isConnected) opener.element.focus();
    onResult(event);
  }
  const unsubscribe = api.subscribe((event) => {
    if (disposed || !("requestId" in event)) return;
    const opener = openers.get(event.requestId);
    if (!opener) return;
    if (opener.identity) complete(event, opener);
    else {
      const terminal = opener.terminal;
      if (
        terminal?.surfaceId === event.surfaceId &&
        terminal.generation === event.generation
      ) return;
      if (event.type === "pointer") opener.pointer = event;
      else if (event.type === "query") opener.query = event;
      else opener.terminal = event;
    }
  }, (error) => {
    if (!disposed) onError(error);
  });
  return {
    async open(input: OverlayOpen, element: HTMLElement) {
      if (disposed) return unavailable();
      if (openers.has(input.requestId)) {
        return {
          ok: false as const,
          error: {
            code: "conflict" as const,
            message: "request is already active",
          },
        };
      }
      const opener: Opener = { element, focus: interactive(input.kind) };
      openers.set(input.requestId, opener);
      let result: OverlayReply<OverlayIdentity>;
      try {
        result = await api.open(input);
      } catch {
        result = unavailable();
      }
      if (openers.get(input.requestId) !== opener) return result;
      if (!result.ok) openers.delete(input.requestId);
      else {
        opener.identity = result.value;
        const { pointer, query, terminal } = opener;
        opener.pointer = undefined;
        opener.query = undefined;
        opener.terminal = undefined;
        if (pointer) complete(pointer, opener);
        if (query) complete(query, opener);
        if (terminal) complete(terminal, opener);
      }
      return result;
    },
    close: api.close,
    update: api.update,
    dispose() {
      disposed = true;
      unsubscribe();
      openers.clear();
    },
  };
}

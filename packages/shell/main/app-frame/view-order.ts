export interface ViewHost<T> {
  addChildView(view: T): void;
  removeChildView(view: T): void;
}

// native view 순서를 바꾸는 자리는 여기뿐이다. overlay 열기는 app visibility를 건드리지 않는다.
export function viewOrder<T>(host: ViewHost<T>) {
  let overlay: T | undefined;
  return {
    overlay(view: T) {
      overlay = view;
      host.addChildView(view);
    },
    attach(view: T) {
      host.addChildView(view);
      if (overlay) host.addChildView(overlay);
    },
    raise() {
      if (overlay) host.addChildView(overlay);
    },
    remove(view: T) {
      host.removeChildView(view);
      if (overlay === view) overlay = undefined;
    },
  };
}

/**
 * 앱 view의 세 층: pane view(layer 0) < floated view(layer 1..) < overlay. 같은 층에서는
 * 나중에 붙은 것이 위다. 창마다 하나를 만든다. Electron의 addChildView는 이미 child인
 * view를 다시 넣으면 맨 위로 옮기므로, 붙인 view와 그 위에 있어야 할 view를 차례로 다시 넣는다.
 */
export function appViewOrder<T>(host: ViewHost<T>, raiseOverlay: () => void) {
  // 붙은 순서대로. 같은 layer에서 나중에 붙은 것이 뒤에 온다.
  const attached: { view: T; layer: number }[] = [];
  return {
    attach(view: T, layer: number) {
      const at = attached.findIndex((item) => item.view === view);
      // bounds만 바뀐 호출마다 다시 쌓지 않는다.
      if (at >= 0 && attached[at]!.layer === layer) return;
      if (at >= 0) attached.splice(at, 1);
      attached.push({ view, layer });
      host.addChildView(view);
      // 방금 붙인 view보다 layer가 큰 것을 layer 순(같으면 붙은 순)으로 다시 위에 둔다.
      const above = attached.filter((item) =>
        item.view !== view && item.layer > layer
      ).sort((a, b) => a.layer - b.layer);
      for (const item of above) host.addChildView(item.view);
      raiseOverlay();
    },
    remove(view: T) {
      const at = attached.findIndex((item) => item.view === view);
      if (at >= 0) attached.splice(at, 1);
      host.removeChildView(view);
    },
  };
}

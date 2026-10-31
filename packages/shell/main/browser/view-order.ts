// browser native view(크기 준 popup·DevTools)의 층 순서. 앱 view·artifact view는 renderer의
// `<webview>`라 층이 DOM이다. overlay view는 app-frame/view-order.ts가 따로 위에 둔다.
export interface ViewHost<T> {
  addChildView(view: T): void;
  removeChildView(view: T): void;
}

export interface BrowserViewOrder<T> {
  /** view를 layer에 맞춰 위에 둔다. bounds만 바뀐 같은 layer 호출은 다시 쌓지 않는다. */
  attach(view: T, layer: number): void;
  remove(view: T): void;
}

/**
 * native view의 두 층(pane view(layer 0) < floated view(layer 1..)) 위에 overlay를 둔다. 같은 층에서는
 * 나중에 붙은 것이 위다. 창마다 하나를 만든다. Electron의 addChildView는 이미 child인
 * view를 다시 넣으면 맨 위로 옮기므로, 붙인 view와 그 위에 있어야 할 view를 차례로 다시 넣는다.
 */
export function browserViewOrder<T>(
  host: ViewHost<T>,
  raiseOverlay: () => void,
): BrowserViewOrder<T> {
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
      const above = attached
        .filter((item) => item.view !== view && item.layer > layer)
        .sort((a, b) => a.layer - b.layer);
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

/** 창마다 하나의 층 순서. 창이 닫혀 WeakMap에서 사라지면 기억도 함께 사라진다. */
export function windowBrowserViewOrders<
  W extends { contentView: ViewHost<T> },
  T,
>(raiseOverlay: (window: W) => void): (window: W) => BrowserViewOrder<T> {
  const orders = new WeakMap<W, BrowserViewOrder<T>>();
  return (window) => {
    let order = orders.get(window);
    if (order === undefined) {
      order = browserViewOrder<T>(window.contentView, () =>
        raiseOverlay(window),
      );
      orders.set(window, order);
    }
    return order;
  };
}

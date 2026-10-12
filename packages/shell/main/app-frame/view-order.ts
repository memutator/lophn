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

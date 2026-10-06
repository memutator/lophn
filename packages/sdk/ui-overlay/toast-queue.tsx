import {
  createContext,
  type ReactNode,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type Clock,
  Toast,
  type ToastProps,
  ToastStack,
  type Timer,
} from "@lophn/design/components";

export type ToastOptions = Omit<ToastProps, "onClose" | "timer" | "clock"> & {
  onClose?: () => void;
};

export interface ToastQueue {
  // 띄운 toast의 id를 돌려준다. 같은 id로 먼저 닫을 수 있다.
  show(options: ToastOptions): string;
  dismiss(id: string): void;
}

const ToastContext = createContext<ToastQueue | null>(null);

export interface ToastProviderProps {
  children: ReactNode;
  timer?: Timer;
  clock?: Clock;
}

// toast를 provider 아래에 쌓는다. 앱 안에서는 앱 view 안에 그리고 lophn 화면의 층을 빌리지 않는다.
export function ToastProvider({ children, timer, clock }: ToastProviderProps) {
  const [shown, setShown] = useState<
    readonly { id: string; options: ToastOptions }[]
  >([]);
  const next = useRef(0);
  const queue = useMemo<ToastQueue>(() => ({
    show(options) {
      next.current += 1;
      const id = `toast-${next.current}`;
      setShown((list) => [...list, { id, options }]);
      return id;
    },
    dismiss(id) {
      setShown((list) => list.filter((item) => item.id !== id));
    },
  }), []);
  return (
    <ToastContext.Provider value={queue}>
      {children}
      {shown.length > 0 && (
        <ToastStack>
          {shown.map(({ id, options }) => (
            <Toast
              key={id}
              {...options}
              timer={timer}
              clock={clock}
              onClose={() => {
                queue.dismiss(id);
                options.onClose?.();
              }}
            />
          ))}
        </ToastStack>
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastQueue {
  const queue = useContext(ToastContext);
  if (!queue) throw new Error("useToast needs a ToastProvider");
  return queue;
}

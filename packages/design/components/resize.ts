import {
  createContext,
  type RefObject,
  useContext,
  useLayoutEffect,
  useState,
} from "react";

export interface Size {
  readonly width: number;
  readonly height: number;
}

// 페이지 틀과 표는 viewport가 아니라 자기 칸의 크기를 본다(shell/design-system#R23).
// 관측 대상에는 padding·border를 두지 않아 content 크기가 곧 칸 크기다.
export interface ResizeSource {
  observe(element: Element, onSize: (size: Size) => void): () => void;
}

export const domResizeSource: ResizeSource = {
  observe(element, onSize) {
    const observer = new ResizeObserver((entries) => {
      const last = entries[entries.length - 1];
      if (last) {
        onSize({
          width: last.contentRect.width,
          height: last.contentRect.height,
        });
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  },
};

const ResizeSourceContext = createContext<ResizeSource>(domResizeSource);

// 테스트와 embedder가 관측 방법을 바꿔 끼운다.
export const ResizeSourceProvider = ResizeSourceContext.Provider;

export function useObservedSize(
  ref: RefObject<Element | null>,
): Size | undefined {
  const source = useContext(ResizeSourceContext);
  const [size, setSize] = useState<Size>();
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    return source.observe(
      element,
      (next) =>
        setSize((current) =>
          current?.width === next.width && current.height === next.height
            ? current
            : next
        ),
    );
  }, [ref, source]);
  return size;
}

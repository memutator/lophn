// 대화 안 찾기의 상태와 화면 강조. 대화 줄 DOM의 글 노드를 그대로 훑어 찾고, React DOM은 건드리지 않는다.
// 일치는 CSS Custom Highlight API(Chromium)로 칠한다. Electron 밖에서 그 API가 없으면 세기와 scroll만 한다.
import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

/** 한 번에 칠하는 일치 수. 넘으면 더 세지 않는다. */
const MATCH_CAP = 500;

const MATCH_HIGHLIGHT = "conversation-find";
const CURRENT_HIGHLIGHT = "conversation-find-current";

type HighlightApi = {
  readonly create: new (...ranges: Range[]) => object;
  readonly registry: {
    set(name: string, highlight: object): void;
    delete(name: string): void;
  };
};

function highlightApi(): HighlightApi | null {
  // DOM type 선언이 Custom Highlight API를 아직 모를 수 있다. 있는지만 보고 쓰는 모양을 확인한다.
  if (!("Highlight" in window) || !("CSS" in globalThis)) return null;
  const create: unknown = window.Highlight;
  const css: unknown = globalThis.CSS;
  if (typeof create !== "function") return null;
  if (typeof css !== "object" || css === null || !("highlights" in css)) {
    return null;
  }
  const registry: unknown = css.highlights;
  if (typeof registry !== "object" || registry === null) return null;
  if (!("set" in registry) || typeof registry.set !== "function") return null;
  if (!("delete" in registry) || typeof registry.delete !== "function") {
    return null;
  }
  // 위에서 생성자와 set/delete를 확인한 값이다.
  const construct = create as HighlightApi["create"];
  const highlights = registry as HighlightApi["registry"];
  return { create: construct, registry: highlights };
}

function clearHighlights(): void {
  const api = highlightApi();
  api?.registry.delete(MATCH_HIGHLIGHT);
  api?.registry.delete(CURRENT_HIGHLIGHT);
}

/** root 안의 글 노드에서 query가 나오는 자리 전부. 글 노드를 넘는 일치는 없다(한 노드 안에서만 찾는다). */
function collectRanges(root: HTMLElement, query: string): Range[] {
  const needle = query.toLowerCase();
  const ranges: Range[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (
    let node = walker.nextNode();
    node !== null && ranges.length < MATCH_CAP;
    node = walker.nextNode()
  ) {
    const text = node.nodeValue ?? "";
    const hay = text.toLowerCase();
    let at = hay.indexOf(needle);
    while (at !== -1 && ranges.length < MATCH_CAP) {
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + needle.length);
      ranges.push(range);
      at = hay.indexOf(needle, at + needle.length);
    }
  }
  return ranges;
}

export interface ConversationFind {
  readonly open: boolean;
  readonly query: string;
  /** 지금 고른 일치(0부터). 일치가 없으면 0이다. */
  readonly current: number;
  readonly total: number;
  setQuery: (query: string) => void;
  /** 찾기 줄을 연다. text가 있으면 그 글로 시작한다(검색 결과에서 넘어올 때). */
  show: (text?: string) => void;
  close: () => void;
  /** 다음(1)·이전(-1) 일치. 끝에서 돈다. */
  step: (direction: 1 | -1) => void;
}

/**
 * `root`(대화 줄의 scroll 틀) 안 글에서 찾는다. `seed`가 오면 그 글로 찾기 줄을 연다(다른 session의 검색
 * 결과를 눌렀을 때). 연 채로 대화가 자라면 다시 센다.
 */
export function useConversationFind(
  root: RefObject<HTMLElement | null>,
  seed: string | null,
  onSeedUsed: () => void,
): ConversationFind {
  const [open, setOpen] = useState(seed !== null);
  const [query, setQueryState] = useState(seed ?? "");
  const [current, setCurrent] = useState(0);
  const [total, setTotal] = useState(0);
  // 강조는 Range 배열을 ref에 두고, 다시 칠할 때만 이 값을 올린다.
  const [version, setVersion] = useState(0);
  const ranges = useRef<Range[]>([]);
  const before = useRef<HTMLElement | null>(null);

  // 밖에서 온 query로 연다. 한 번 쓰고 지워 session을 다시 열 때 또 열지 않게 한다.
  useEffect(() => {
    if (seed === null) return;
    setQueryState(seed);
    setCurrent(0);
    setOpen(true);
    onSeedUsed();
    // onSeedUsed는 호출 때마다 새 함수일 수 있다. seed가 바뀔 때만 쓴다.
  }, [seed]);

  const apply = useCallback(() => {
    const element = root.current;
    const needle = query.trim();
    if (!open || element === null || needle === "") {
      ranges.current = [];
      setTotal(0);
      setCurrent(0);
      setVersion((value) => value + 1);
      return;
    }
    const found = collectRanges(element, needle);
    ranges.current = found;
    setTotal(found.length);
    setCurrent((value) =>
      found.length === 0 ? 0 : Math.min(value, found.length - 1),
    );
    setVersion((value) => value + 1);
  }, [open, query, root]);

  useEffect(() => {
    apply();
  }, [apply]);

  // 본문이 늦게 오거나 새 말이 와도 일치를 다시 센다.
  useEffect(() => {
    if (!open) return;
    const element = root.current;
    if (element === null) return;
    let frame = 0;
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => apply());
    });
    observer.observe(element, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [open, apply, root]);

  // 지금 일치를 칠한다. 대화가 바뀌어도 다시 칠한다.
  useEffect(() => {
    const api = highlightApi();
    if (api === null) return;
    const found = ranges.current;
    if (!open || found.length === 0) {
      clearHighlights();
      return;
    }
    api.registry.set(MATCH_HIGHLIGHT, new api.create(...found));
    const active = found[current];
    if (active === undefined) api.registry.delete(CURRENT_HIGHLIGHT);
    else api.registry.set(CURRENT_HIGHLIGHT, new api.create(active));
  }, [open, current, version]);

  // 지금 일치를 가운데로 가져온다.
  useEffect(() => {
    if (!open) return;
    const active = ranges.current[current];
    if (active === undefined) return;
    const node = active.startContainer;
    const holder =
      node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element);
    holder?.scrollIntoView({ block: "center" });
  }, [open, current, query, version]);

  // 줄을 닫거나 화면이 사라지면 강조를 남기지 않는다.
  useEffect(
    () => () => {
      clearHighlights();
    },
    [],
  );

  const show = useCallback((text?: string) => {
    const active = document.activeElement;
    if (active instanceof HTMLElement) before.current = active;
    if (text !== undefined) setQueryState(text);
    setCurrent(0);
    setOpen(true);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    clearHighlights();
    before.current?.focus();
  }, []);

  const setQuery = useCallback((next: string) => {
    setQueryState(next);
    setCurrent(0);
  }, []);

  const step = useCallback((direction: 1 | -1) => {
    setCurrent((value) => {
      const count = ranges.current.length;
      if (count === 0) return 0;
      return (value + direction + count) % count;
    });
  }, []);

  return {
    open,
    query,
    current,
    total,
    setQuery,
    show,
    close,
    step,
  };
}

// 앱 page가 올린 탭 머리 줄(ipc/app-tab-head.ts)을 이 화면이 선 card 칸의 머리 줄(shell/card-head.tsx)에 그린다.
// 앱은 글과 id만 보내고 그리는 것은 shell component다. 누르면 그 id를 page로 돌려보낸다. card 밖(floated 패널,
// detached 창, 세션 카드)이면 그리지 않고 page에 shown=false를 알려 앱이 스스로 그리게 한다.
import { type ReactNode, useContext, useEffect, useRef, useState } from "react";
import { Button } from "@lophn/ui/primitives";
import { Tab, TabList, Tabs } from "@lophn/ui/navigation";

import type { TabHead, TabHeadEvent } from "../../ipc/app-tab-head.ts";
import { CardHeadContext, type CardHeadSpec } from "../shell/card-head.tsx";
import type { WebviewHost } from "./webview-host.tsx";
import styles from "./app-tab-head.module.css";

// ⋯ 메뉴의 탭 기본 항목(close, float 등)과 id가 겹치지 않게 단다.
const MENU_PREFIX = "app-head:";

/**
 * shell이 앱 머리 줄에 더하는 것(앱 화면 탭의 Annotate). center가 있으면 앱이 올린 머리 줄 대신 이것만 그린다(Annotate 중에는
 * 앱 화면을 누를 수 없어 앱 단추가 뜻이 없다). 없으면 actions를 앱 단추 앞에 둔다. 모양이 바뀌면 key도 바꾼다.
 */
export interface ShellHead {
  readonly key: string;
  readonly actions: ReactNode;
  readonly center?: ReactNode;
}

export function useAppTabHead(input: {
  host: WebviewHost | null;
  /** 그릇의 element key. */
  viewKey: string;
  /** false면 머리 줄을 받지도 올리지도 않는다(세션 카드처럼 남의 머리 줄 아래 선 화면). */
  enabled: boolean;
  /** 경로의 첫 칸. 앱 이름이다. */
  label: string;
  /** 앱이 머리 줄을 올리지 않아도 shell이 두는 것. */
  shellHead?: ShellHead | undefined;
}): void {
  const { host, viewKey, enabled, label } = input;
  const setCardHead = useContext(CardHeadContext);
  const [head, setHead] = useState<TabHead | null>(null);
  const live = enabled && host !== null && viewKey !== "";
  // 단추의 callback은 최신 값을 읽으므로 key가 바뀔 때만 다시 올린다.
  const shellHead = useRef(input.shellHead);
  shellHead.current = input.shellHead;
  const shellKey = input.shellHead?.key ?? null;

  useEffect(() => {
    if (!live) return;
    const off = host!.onTabHead(viewKey, setHead);
    return () => {
      off();
      setHead(null);
    };
  }, [live, host, viewKey]);

  useEffect(() => {
    if (!live) return;
    const shown = setCardHead !== null;
    host!.sendTabHead(viewKey, { type: "shown", shown });
    return () => host!.sendTabHead(viewKey, { type: "shown", shown: false });
  }, [live, host, viewKey, setCardHead]);

  useEffect(() => {
    const shell = shellHead.current;
    if (!live || setCardHead === null) return;
    if (shell?.center !== undefined) {
      setCardHead({ center: shell.center, actions: shell.actions });
      return () => setCardHead(null);
    }
    if (head === null && shell === undefined) return;
    const send = (event: TabHeadEvent) => host!.sendTabHead(viewKey, event);
    setCardHead(cardHeadOf(head ?? {}, label, send, shell?.actions));
    return () => setCardHead(null);
  }, [live, host, viewKey, setCardHead, head, label, shellKey]);
}

function cardHeadOf(
  head: TabHead,
  label: string,
  send: (event: TabHeadEvent) => void,
  extra: ReactNode | undefined,
): CardHeadSpec {
  const spec: {
    -readonly [K in keyof CardHeadSpec]: CardHeadSpec[K];
  } = {};
  if (head.nav !== undefined) {
    spec.nav = {
      canBack: head.nav.canBack,
      canForward: head.nav.canForward,
      onBack: () => send({ type: "back" }),
      onForward: () => send({ type: "forward" }),
    };
  }
  if (
    head.crumbs !== undefined ||
    head.status !== undefined ||
    head.tabs !== undefined
  ) {
    spec.center = <HeadCenter head={head} label={label} send={send} />;
  }
  if (head.actions !== undefined || extra !== undefined) {
    spec.actions = (
      <span className={styles.actions}>
        {extra}
        {head.actions?.map((action) => (
          <Button
            key={action.id}
            size="sm"
            variant={action.primary ? "primary" : "ghost"}
            disabled={action.disabled || action.busy}
            aria-busy={action.busy || undefined}
            data-app-head-action={action.id}
            onClick={() => send({ type: "action", id: action.id })}
          >
            {action.label}
          </Button>
        ))}
      </span>
    );
  }
  if (head.menu !== undefined) {
    spec.menu = {
      items: head.menu.map((item) => ({
        id: `${MENU_PREFIX}${item.id}`,
        label: item.label,
        ...(item.disabled ? { disabled: true } : {}),
      })),
      onSelect: (id) =>
        send({ type: "menu", id: id.slice(MENU_PREFIX.length) }),
    };
  }
  return spec;
}

// 기본 경로(앱 이름)를 대신 그리므로 같은 모양으로 앱 이름부터 둔다.
function HeadCenter({
  head,
  label,
  send,
}: {
  head: TabHead;
  label: string;
  send: (event: TabHeadEvent) => void;
}) {
  const crumbs = [label, ...(head.crumbs ?? [])].filter((crumb) => crumb);
  return (
    <span className={styles.center}>
      <span className={styles.crumbs}>
        {crumbs.map((crumb, index) => (
          <span key={index} className={styles.crumb}>
            {index > 0 ? <span className={styles.sep}>/</span> : null}
            {crumb}
          </span>
        ))}
      </span>
      {head.tabs === undefined ? null : (
        <span className={styles.tabs}>
          <Tabs
            value={head.tabs.selected ?? ""}
            onValueChange={(id) => send({ type: "tab", id })}
          >
            <TabList>
              {head.tabs.items.map((item) => (
                <Tab
                  key={item.id}
                  value={item.id}
                  size="sm"
                  disabled={item.disabled}
                >
                  {item.label}
                </Tab>
              ))}
            </TabList>
          </Tabs>
        </span>
      )}
      {head.status === undefined ? null : (
        <span className={styles.status}>{head.status}</span>
      )}
    </span>
  );
}

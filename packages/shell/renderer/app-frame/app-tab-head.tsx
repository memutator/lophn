// 앱 page가 올린 탭 머리 줄(ipc/app-tab-head.ts)을 이 화면이 선 card 칸의 머리 줄(parts/card-head)에 그린다.
// 앱은 글과 id만 보내고 그리는 것은 shell component다. 누르면 그 id를 page로 돌려보낸다. card 밖(floated 패널,
// detached 창, 세션 카드)이면 그리지 않고 page에 shown=false를 알려 앱이 스스로 그리게 한다.
// tray popup과 sidebar panel은 card가 아니지만 자기 머리 줄을 가져, CardHeadContext를 직접 달고(useHeadSlot, HeadSlotScope)
// 같은 spec을 HeadControls로 그린다. 그 둘은 같은 spec을 만드는 길(cardHeadOf)을 쓴다.
// 다른 기계의 앱 화면이면 머리 줄에 그 기계의 꼬리표("On <이름>")가 늘 선다(앱이 머리 줄을 올리지 않아도).
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { t } from "@lophn/i18n";
import { type MenuItem, Menu, Tooltip } from "@lophn/ui/overlay";
import { Button, IconButton } from "@lophn/ui/primitives";
import { Tab, TabList, Tabs } from "@lophn/ui/navigation";

import type { TabHead, TabHeadEvent } from "../../ipc/app-tab-head.ts";
import {
  CardHeadContext,
  type CardHeadSetter,
  type CardHeadSpec,
} from "../parts/card-head/card-head.tsx";
import {
  machineItemOf,
  useMachinesView,
  useScopeMachine,
} from "../desktop/machines/context.tsx";
import { actionIcons, shellIcons } from "../icons/mod.ts";
import type { WebviewHost } from "./webview-host.tsx";
import styles from "./app-tab-head.module.css";

// ⋯ 메뉴의 탭 기본 항목(close, float 등)과 id가 겹치지 않게 단다.
const MENU_PREFIX = "app-head:";

/**
 * shell이 앱 머리 줄에 더하는 것(앱 화면 탭의 Annotate). center가 있으면 앱이 올린 머리 줄 대신 center와 actions만 그린다(Annotate 중에는
 * 앱 화면을 누를 수 없어 앱 단추가 뜻이 없다). 없으면 actions는 앱 단추 앞에, menu는 ⋯ 메뉴의 앱 항목 앞에 둔다. 모양이 바뀌면 key도 바꾼다.
 */
export interface ShellHead {
  readonly key: string;
  readonly actions?: ReactNode;
  readonly menu?: {
    /** id는 앱 항목(`app-head:`)이나 탭 기본 항목과 겹치지 않게 짓는다. */
    readonly items: readonly MenuItem[];
    readonly onSelect: (id: string) => void;
  };
  readonly center?: ReactNode;
}

/**
 * card 칸이 없는 자리(tray popup, sidebar panel)가 앱 화면이 올린 머리 줄을 받는 칸. setter를 화면 둘레의
 * HeadSlotScope에 달고, spec을 자기 머리 줄에 HeadControls로 그린다.
 */
export function useHeadSlot(): readonly [CardHeadSpec | null, CardHeadSetter] {
  const [spec, setSpec] = useState<CardHeadSpec | null>(null);
  const set = useCallback((next: CardHeadSpec | null) => setSpec(next), []);
  return [spec, set];
}

// tray popup처럼 좁은 머리 줄은 앱 단추만 icon 단추로 그린다(경로·탭·상태·⋯ 메뉴는 그리지 않는다).
const HeadActionsOnlyContext = createContext(false);

// 프레임이 이미 앱 이름을 제목으로 보이는 자리(tray, sidebar, float, 카드)에서 경로 첫 칸(앱 이름)을 뺀다.
const HeadRootContext = createContext<string | null>(null);

/** useHeadSlot의 setter를 화면 둘레에 단다. 이 안의 앱 화면은 머리 줄을 이 칸에 올리고 경로 첫 칸(앱 이름)은 뺀다. */
export function HeadSlotScope({
  set,
  actionsOnly = false,
  children,
}: {
  set: CardHeadSetter;
  /** true면 앱 단추만 icon 단추로 그린다(tray popup). */
  actionsOnly?: boolean;
  children: ReactNode;
}) {
  return (
    <CardHeadContext.Provider value={set}>
      <HeadActionsOnlyContext.Provider value={actionsOnly}>
        <HeadRootContext.Provider value="">{children}</HeadRootContext.Provider>
      </HeadActionsOnlyContext.Provider>
    </CardHeadContext.Provider>
  );
}

/** useHeadSlot의 spec을 한 줄에 그린다: 가운데(경로·탭·상태), ⋯ 앞 단추, ⋯ 메뉴. nav는 그리지 않는다. */
export function HeadControls({ spec }: { spec: CardHeadSpec | null }) {
  if (spec === null) return null;
  return (
    <>
      {spec.center === undefined ? null : (
        <span className={styles.slotCenter}>{spec.center}</span>
      )}
      {spec.actions}
      {spec.menu === undefined ? null : (
        <Menu
          placement="corner-end"
          items={spec.menu.items}
          onSelect={spec.menu.onSelect}
          trigger={
            <IconButton
              icon={shellIcons.more}
              label={t("shell.button.head-menu")}
              size="sm"
              data-app-head-menu=""
            />
          }
        />
      )}
    </>
  );
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
  const root = useContext(HeadRootContext);
  const actionsOnly = useContext(HeadActionsOnlyContext);
  const [head, setHead] = useState<TabHead | null>(null);
  const live = enabled && host !== null && viewKey !== "";
  // 단추의 callback은 최신 값을 읽으므로 key가 바뀔 때만 다시 올린다.
  const shellHead = useRef(input.shellHead);
  shellHead.current = input.shellHead;
  const shellKey = input.shellHead?.key ?? null;
  const machine = useScopeMachine();
  const machinesView = useMachinesView();
  const machineName =
    machine === null
      ? null
      : machineItemOf(machinesView, machine).name ||
        t("machines.label.unknown-name");

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
    if (head === null && shell === undefined && machineName === null) return;
    const send = (event: TabHeadEvent) => host!.sendTabHead(viewKey, event);
    const tag =
      machineName === null ? undefined : (
        <span className={styles.machine} data-machine-tag="">
          {t("app-space.label.on-machine", { name: machineName })}
        </span>
      );
    setCardHead(
      cardHeadOf(head ?? {}, root ?? label, send, shell, actionsOnly, tag),
    );
    return () => setCardHead(null);
  }, [
    machineName,
    live,
    host,
    viewKey,
    setCardHead,
    head,
    label,
    root,
    shellKey,
    actionsOnly,
  ]);
}

function cardHeadOf(
  head: TabHead,
  label: string,
  send: (event: TabHeadEvent) => void,
  shell: ShellHead | undefined,
  actionsOnly: boolean,
  tag: ReactNode | undefined,
): CardHeadSpec {
  if (actionsOnly) return actionsOnlyHeadOf(head, send);
  const extra = shell?.actions;
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
  if (head.actions !== undefined || extra !== undefined || tag !== undefined) {
    spec.actions = (
      <span className={styles.actions}>
        {tag}
        {extra}
        {head.actions?.map((action) => (
          <Button
            key={action.id}
            size="sm"
            variant={action.primary ? "primary" : "ghost"}
            icon={action.icon && actionIcons[action.icon]}
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
  const shellMenu = shell?.menu;
  if (head.menu !== undefined || shellMenu !== undefined) {
    spec.menu = {
      items: [
        ...(shellMenu?.items ?? []),
        ...(head.menu ?? []).map((item) => ({
          id: `${MENU_PREFIX}${item.id}`,
          label: item.label,
          ...(item.disabled ? { disabled: true } : {}),
        })),
      ],
      onSelect: (id) => {
        if (id.startsWith(MENU_PREFIX)) {
          send({ type: "menu", id: id.slice(MENU_PREFIX.length) });
        } else shellMenu?.onSelect(id);
      },
    };
  }
  return spec;
}

// tray popup 머리: 앱 단추만 그린다. icon이 있으면 icon 단추(label은 tooltip·접근성 이름), 없으면 작은 글 단추다.
function actionsOnlyHeadOf(
  head: TabHead,
  send: (event: TabHeadEvent) => void,
): CardHeadSpec {
  if (head.actions === undefined) return {};
  return {
    actions: (
      <span className={styles.actions}>
        {head.actions.map((action) => {
          const onClick = () => send({ type: "action", id: action.id });
          const disabled = action.disabled || action.busy;
          return action.icon === undefined ? (
            <Button
              key={action.id}
              size="sm"
              variant="ghost"
              disabled={disabled}
              aria-busy={action.busy || undefined}
              data-app-head-action={action.id}
              onClick={onClick}
            >
              {action.label}
            </Button>
          ) : (
            <Tooltip key={action.id} content={action.label}>
              <IconButton
                icon={actionIcons[action.icon]}
                label={action.label}
                size="sm"
                disabled={disabled}
                aria-busy={action.busy || undefined}
                data-app-head-action={action.id}
                onClick={onClick}
              />
            </Tooltip>
          );
        })}
      </span>
    ),
  };
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

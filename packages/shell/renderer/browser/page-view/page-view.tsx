// 다른 기계의 page 하나를 보고 다루는 탭 본문(`browser-tab.md` "멀리서 보기"). 보는 동안 `page_view/watch` lease를 잡고
// PAGE_VIEW_RENEW_MS마다 갱신하며, 탭이 닫히거나 창이 안 보이면 놓는다. 그 탭의 `PageViewChanged`가 오면 snapshot을 다시 읽고,
// 읽는 중이면 끝난 뒤 한 번만 더 읽는다(읽어 간 만큼만 다음 frame이 온다). 다룰 수 있으면(snapshot의 control) 그림의
// 누르기·끌기·굴리기, key, 쳐진 글(IME 포함)과 이 컴퓨터에서 붙여넣은 글이 `page_view/input`이 되고, 머리 줄에 뒤로·다시 읽기·
// 주소 칸과 잡기·놓기가 선다. 그 기계에서 page가 닫히면(not_found) 닫혔다는 한 줄만 남고 lease를 놓는다.
import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type WheelEvent,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { ErrorState, Loading, Skeleton } from "@lophn/ui/feedback";
import { Toast } from "@lophn/ui/overlay";
import { Button, IconButton } from "@lophn/ui/primitives";
import { t } from "@lophn/i18n";

import {
  PAGE_VIEW_RENEW_MS,
  type PageFrame,
  type PageInput,
} from "../../../../protocol/lophn-agent/page-view.ts";
import { useFollowedRead } from "../../desktop/connection/core-read.ts";
import { useEventClient } from "../../desktop/connection/events/hooks.tsx";
import { browserIcons } from "../../icons/mod.ts";
import { useCardHead } from "../../parts/card-head/card-head.tsx";
import { AddressInput, withScheme } from "./address-input.tsx";
import styles from "./page-view.module.css";
import type { PageSnapshot, PageViewSource } from "./source.ts";

// 누른 채 끄는 move와 굴리기는 초당 이만큼까지 보낸다. 연결 하나에 요청이 넘치지 않게 한다.
const MOVE_EVERY_MS = 1000 / 30;

const MODIFIER_KEYS = new Set(["Control", "Shift", "Alt", "Meta"]);

// `text` 입력 하나의 글자 상한(`pageInputSchema`).
const TEXT_MAX = 1000;

function subscribeVisibility(listener: () => void): () => void {
  document.addEventListener("visibilitychange", listener);
  return () => document.removeEventListener("visibilitychange", listener);
}

/** on이고 창이 보이는 동안 lease를 잡고 갱신한다. */
function useLease(source: PageViewSource, tab: string, on: boolean): void {
  const visible = useSyncExternalStore(
    subscribeVisibility,
    () => document.visibilityState === "visible",
  );
  useEffect(() => {
    if (!visible || !on) return;
    const renew = () => void source.watch(tab, true);
    renew();
    const timer = setInterval(renew, PAGE_VIEW_RENEW_MS);
    return () => {
      clearInterval(timer);
      void source.watch(tab, false);
    };
  }, [source, tab, visible, on]);
}

/**
 * keydown 하나를 page의 key 입력으로. 글자는 여기서 보내지 않고 숨은 입력칸의 input·compositionend가 `text`로 보낸다(IME 글이
 * 한 길로 온다). Ctrl·Meta·Alt를 낀 조합과 이름 있는 key(Enter, Backspace, 화살표, Tab…)만 agent `press`의 key 이름이 된다.
 * Ctrl·Cmd+V는 paste가 이 컴퓨터의 clipboard 글을 보내도록 지나간다.
 */
function keyOf(event: KeyboardEvent): PageInput | null {
  if (
    event.nativeEvent.isComposing ||
    event.key === "Process" ||
    MODIFIER_KEYS.has(event.key)
  ) {
    return null;
  }
  const chord = event.ctrlKey || event.metaKey || event.altKey;
  if (!chord && [...event.key].length === 1) return null;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v") {
    return null;
  }
  const parts = [
    ...(event.ctrlKey ? ["Control"] : []),
    ...(event.altKey ? ["Alt"] : []),
    ...(event.metaKey ? ["Meta"] : []),
    ...(event.shiftKey ? ["Shift"] : []),
    event.key === " " ? "Space" : event.key,
  ];
  return { type: "key", key: parts.join("+") };
}

/** 글을 `text` 입력으로. 한 입력의 상한(1000자)을 넘으면 나눈다. */
function textInputs(text: string): PageInput[] {
  const chars = [...text];
  const inputs: PageInput[] = [];
  for (let at = 0; at < chars.length; at += TEXT_MAX) {
    inputs.push({
      type: "text",
      text: chars.slice(at, at + TEXT_MAX).join(""),
    });
  }
  return inputs;
}

/** 그린 그림 위의 점을 frame의 page CSS px로 옮긴다. */
function pointOf(
  event: { clientX: number; clientY: number; currentTarget: Element },
  frame: PageFrame,
): { x: number; y: number } {
  const box = event.currentTarget.getBoundingClientRect();
  const at = (offset: number, size: number, full: number) =>
    Math.round(Math.min(Math.max(offset / size, 0), 1) * full);
  return {
    x: at(event.clientX - box.left, box.width, frame.width),
    y: at(event.clientY - box.top, box.height, frame.height),
  };
}

function Screen({
  frame,
  still,
  onInput,
}: {
  frame: PageFrame;
  /** 그리지 않는 page의 마지막 그림이다. */
  still: boolean;
  /** null이면 보기만 한다. */
  onInput: ((input: PageInput) => void) | null;
}) {
  const pressed = useRef(false);
  const lastMove = useRef(0);
  const wheel = useRef({ dx: 0, dy: 0, at: 0 });
  const keys = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const sendText = (text: string) => {
    for (const input of textInputs(text)) onInput?.(input);
  };
  const handlers =
    onInput === null
      ? {}
      : {
          onPointerDown(event: PointerEvent<HTMLDivElement>) {
            if (event.button !== 0) return;
            // 그림을 누르면 key와 글을 받는 숨은 입력칸에 focus가 간다.
            event.preventDefault();
            keys.current?.focus();
            event.currentTarget.setPointerCapture(event.pointerId);
            pressed.current = true;
            onInput({
              type: "pointer",
              phase: "down",
              ...pointOf(event, frame),
            });
          },
          onPointerMove(event: PointerEvent<HTMLDivElement>) {
            if (!pressed.current) return;
            if (event.timeStamp - lastMove.current < MOVE_EVERY_MS) return;
            lastMove.current = event.timeStamp;
            onInput({
              type: "pointer",
              phase: "move",
              ...pointOf(event, frame),
            });
          },
          onPointerUp(event: PointerEvent<HTMLDivElement>) {
            if (!pressed.current) return;
            pressed.current = false;
            onInput({ type: "pointer", phase: "up", ...pointOf(event, frame) });
          },
          onPointerCancel() {
            pressed.current = false;
          },
          // 굴린 양은 모아 두었다가 MOVE_EVERY_MS마다 한 번 보낸다.
          onWheel(event: WheelEvent<HTMLDivElement>) {
            const sum = wheel.current;
            sum.dx += event.deltaX;
            sum.dy += event.deltaY;
            if (event.timeStamp - sum.at < MOVE_EVERY_MS) return;
            const dx = Math.round(sum.dx);
            const dy = Math.round(sum.dy);
            wheel.current = { dx: 0, dy: 0, at: event.timeStamp };
            if (dx === 0 && dy === 0) return;
            onInput({ type: "scroll", ...pointOf(event, frame), dx, dy });
          },
        };
  return (
    <div
      className={styles.screen}
      style={{ aspectRatio: `${frame.width} / ${frame.height}` }}
      data-page-screen=""
      data-control={onInput === null ? undefined : ""}
      data-still={still ? "" : undefined}
      {...handlers}
    >
      <img
        className={styles.picture}
        src={`data:${frame.media_type};base64,${frame.data_base64}`}
        alt=""
        draggable={false}
      />
      {onInput === null ? null : (
        // 글은 이 칸에 쳐진 대로(IME 조합이 끝난 글 포함) 보내고 칸을 비운다.
        <textarea
          ref={keys}
          className={styles.keys}
          aria-label={t("machines.page.keys")}
          autoComplete="off"
          spellCheck={false}
          data-page-keys=""
          // 창의 단축키가 먼저 가져간 key(defaultPrevented)는 보내지 않는다.
          onKeyDown={(event) => {
            if (event.defaultPrevented) return;
            const input = keyOf(event);
            if (input === null) return;
            event.preventDefault();
            onInput(input);
          }}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={(event) => {
            composing.current = false;
            sendText(event.data);
            event.currentTarget.value = "";
          }}
          onInput={(event) => {
            if (composing.current) return;
            sendText(event.currentTarget.value);
            event.currentTarget.value = "";
          }}
          onPaste={(event) => {
            event.preventDefault();
            sendText(event.clipboardData.getData("text/plain"));
          }}
        />
      )}
    </div>
  );
}

/** agent가 다루는 중이면 그 줄. 다룰 수 있으면 [Take control]·[Hand back]이 붙는다. */
function AgentBar({
  snapshot,
  onControl,
}: {
  snapshot: PageSnapshot;
  onControl: ((held: boolean) => void) | null;
}) {
  if (!snapshot.agent && !snapshot.held) return null;
  return (
    <div
      className={styles.agent}
      data-page-agent={snapshot.held ? "held" : "agent"}
    >
      <span className={styles.agentText}>
        {snapshot.held
          ? t("machines.page.held")
          : snapshot.by === null
            ? t("machines.page.agent-using-unnamed")
            : t("machines.page.agent-using", { agent: snapshot.by })}
      </span>
      {onControl === null ? null : (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onControl(!snapshot.held)}
        >
          {t(
            snapshot.held
              ? "browser.button.agent-release"
              : "browser.button.agent-take",
          )}
        </Button>
      )}
    </div>
  );
}

/** 주소 칸. 고치는 글(draft)은 이 칸이 들고 null이면 지금 url을 보인다. */
function Address({ url, onGo }: { url: string; onGo(url: string): void }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <div className={styles.address}>
      <AddressInput
        value={draft ?? url}
        label={t("browser.label.address")}
        onChange={setDraft}
        onBlur={() => setDraft(null)}
        onSubmit={() => {
          const target = withScheme(draft ?? "");
          if (target !== "") onGo(target);
          setDraft(null);
        }}
      />
    </div>
  );
}

export function PageView({
  source,
  tab,
  machineName,
  onTitle,
}: {
  source: PageViewSource;
  tab: string;
  machineName: string;
  /** page 제목이 바뀌었다(탭 이름이 따라간다). */
  onTitle?(title: string): void;
}) {
  const client = useEventClient();
  // 그 기계에서 page가 닫혔다(not_found). 옛 그림 대신 닫혔다는 한 줄을 보이고 lease를 놓는다.
  const [closed, setClosed] = useState(false);
  const { loaded, reload } = useFollowedRead(
    async () => {
      const read = await source.snapshot(tab);
      if (!read.ok && read.code === "not_found") setClosed(true);
      return read;
    },
    [],
    tab,
  );
  useEffect(
    () =>
      client.subscribe({ types: ["PageViewChanged"] }, (message) => {
        if (
          message.kind === "event" &&
          message.event.type === "PageViewChanged" &&
          message.event.payload.tab === tab
        ) {
          reload();
        }
      }),
    [client, tab, reload],
  );
  useLease(source, tab, !closed);
  const [notice, setNotice] = useState<string | null>(null);
  const name = { name: machineName };
  const snapshot = closed || loaded.state !== "ready" ? null : loaded.value;
  const control = snapshot?.control === true;
  const title = snapshot?.title ?? "";
  useEffect(() => {
    if (title !== "") onTitle?.(title);
  }, [title, onTitle]);

  // 허락이 빠졌으면(forbidden) snapshot을 다시 읽어 보기만 하는 화면이 된다. 누르기·key의 다른 실패는 다음 입력이 다시 해 보므로
  // 알리지 않고, 사람이 고른 행동(주소, 뒤로, 다시 읽기, 잡기)의 실패만 알린다.
  const settle = (
    sent: { ok: true } | { ok: false; code: string },
    chosen: boolean,
  ) => {
    if (sent.ok) return;
    if (sent.code === "not_found") setClosed(true);
    else if (sent.code === "forbidden") reload();
    else if (chosen) setNotice(t("machines.page.error.action", name));
  };
  const send = (input: PageInput) =>
    void source
      .input(tab, input)
      .then((sent) =>
        settle(
          sent,
          input.type === "navigate" ||
            input.type === "back" ||
            input.type === "reload",
        ),
      );
  const setControl = (held: boolean) =>
    void source.control(tab, held).then((sent) => {
      settle(sent, true);
      if (sent.ok) reload();
    });

  const center: ReactNode =
    snapshot !== null && control ? (
      <Address
        url={snapshot.url}
        onGo={(url) => send({ type: "navigate", url })}
      />
    ) : (
      <span className={styles.url}>{snapshot?.url ?? ""}</span>
    );
  const actions =
    snapshot === null ? null : (
      <AgentBar snapshot={snapshot} onControl={control ? setControl : null} />
    );
  const inCard = useCardHead(
    {
      ...(control
        ? {
            nav: {
              canBack: true,
              canForward: false,
              onBack: () => send({ type: "back" }),
              onForward: () => {},
              onReload: () => send({ type: "reload" }),
            },
          }
        : {}),
      center,
      actions,
    },
    [
      source,
      tab,
      machineName,
      control,
      snapshot?.url,
      snapshot?.agent,
      snapshot?.held,
      snapshot?.by,
    ],
  );

  if (closed) {
    return (
      <div className={styles.page} data-page-closed={tab}>
        <p className={styles.line}>{t("machines.page.closed", name)}</p>
      </div>
    );
  }
  if (loaded.state === "failed") {
    return (
      <ErrorState target={t("machines.page.target-one")} onRetry={reload} />
    );
  }
  return (
    <div className={`${styles.page} ${styles.wide}`} data-page-view={tab}>
      {notice === null ? null : (
        <div className={styles.toastSlot}>
          <Toast title={notice} tone="error" onClose={() => setNotice(null)} />
        </div>
      )}
      {inCard ? null : (
        <div className={styles.toolbar}>
          {control ? (
            <IconButton
              icon={browserIcons.back}
              label={t("browser.button.back")}
              size="sm"
              onClick={() => send({ type: "back" })}
            />
          ) : null}
          {control ? (
            <IconButton
              icon={browserIcons.reload}
              label={t("browser.button.reload")}
              size="sm"
              onClick={() => send({ type: "reload" })}
            />
          ) : null}
          {center}
          {actions}
        </div>
      )}
      <Loading loading={snapshot === null} placeholder={<Skeleton lines={6} />}>
        {snapshot === null ? null : (
          <>
            {control ? null : (
              <p className={styles.line} data-page-view-only="">
                {t("machines.page.view-only", name)}
              </p>
            )}
            {snapshot.painting ? null : (
              <p className={styles.line} data-page-not-painting="">
                {t("machines.page.not-painting", name)}
              </p>
            )}
            {snapshot.frame === null ? (
              <p className={styles.line} data-page-waiting="">
                {t("machines.page.waiting")}
              </p>
            ) : (
              <Screen
                frame={snapshot.frame}
                still={!snapshot.painting}
                onInput={control ? send : null}
              />
            )}
          </>
        )}
      </Loading>
    </div>
  );
}

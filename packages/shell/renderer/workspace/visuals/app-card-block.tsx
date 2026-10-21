// 세션 앱 카드. 답 안의 앱 카드를 그 앱의 card 크기 화면으로 main이 연 native view에 보인다. 판을 싣은 카드는
// 만든 때의 판에 고정된 live 표시이며 지금 판이 다르면 contract_changed, 앱이 없어지면 unavailable로 두고 다른 판으로
// 바꾸지 않는다. 판을 싣지 않은 카드는 지금 판을 연다. view는 message·block 표시 참조에 묶여 열리고 보이는 사각형만
// main에 간다. 카드를 열어도 command 권한은 늘지 않는다(view에는 command 통로가 없다).
import { useEffect, useState } from "react";
import { ErrorState, Loading, Skeleton } from "@lophn/ui/feedback";
import { t } from "@lophn/wording";

import type { AppFrameViewState } from "../../../ipc/app-frame.ts";
import { type AppRead, useAppViews } from "../../app-frame/app-views.tsx";
import { EmbeddedView } from "../../app-frame/embedded-view.tsx";
import { ViewChrome } from "../../app-frame/view-chrome.tsx";
import type { AppCardRef } from "./registry.ts";
import styles from "./visuals.module.css";

type Settled = "contract_changed" | "unavailable" | "not_card";

const NOTICE = {
  contract_changed: "app-card.notice.contract-changed",
  unavailable: "app-card.notice.unavailable",
  not_card: "app-card.notice.not-card",
} as const satisfies Record<Settled, string>;

interface AppCardBlockProps {
  card: AppCardRef;
  /** 카드가 든 확정 메시지와 블록 key. view가 이 자리에 묶인다. */
  message: string;
  block: string;
  /** 오류 문구에 쓰는 블록 제목. */
  label: string;
}

function notice(settled: Settled) {
  return (
    <p className={styles.unavailable} data-app-card-state={settled}>
      {t(NOTICE[settled])}
    </p>
  );
}

/** 판을 읽어 카드를 열지, 연 뒤에도 그 판인지 정한다. */
function settledOf(read: AppRead, release: string | null): Settled | null {
  if (!read.ok) return read.code === "not_found" ? "unavailable" : null;
  if (read.value.archived) return "unavailable";
  return release === null || read.value.release === release
    ? null
    : "contract_changed";
}

export function AppCardBlock(
  { card, message, block, label }: AppCardBlockProps,
) {
  const deps = useAppViews();
  const [facts, setFacts] = useState<AppRead | null>(null);
  const [settled, setSettled] = useState<Settled | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<AppFrameViewState | null>(null);

  useEffect(() => {
    if (deps === null) return;
    let live = true;
    setFacts(null);
    setSettled(null);
    void deps.app(card.app).then((read) => {
      if (!live) return;
      setFacts(read);
      setSettled(settledOf(read, card.release));
    });
    return () => {
      live = false;
    };
  }, [deps, card.app, card.release, attempt]);

  // 연결을 잃으면 판이 바뀌었는지 다시 본다. 바뀌었으면 view를 닫고 그 이유만 남긴다.
  const observe = (next: AppFrameViewState) => {
    setState(next);
    if (card.release !== null && next.release !== card.release) {
      setSettled("contract_changed");
      return;
    }
    if (next.connectionState !== "unavailable" || deps === null) return;
    void deps.app(card.app).then((read) => {
      const found = settledOf(read, card.release);
      if (found !== null) setSettled(found);
    });
  };

  if (deps === null) {
    return (
      <p className={styles.unavailable} data-visual-app-card="">
        {t("conversation.notice.visual-app-card")}
      </p>
    );
  }
  if (settled !== null) return notice(settled);
  if (facts === null) {
    return (
      <Loading loading placeholder={<Skeleton lines={3} />}>{null}</Loading>
    );
  }
  if (!facts.ok) {
    return (
      <ErrorState
        target={label}
        onRetry={() => setAttempt((count) => count + 1)}
      />
    );
  }
  return (
    <div
      className={styles.appCard}
      data-visual-app-card={card.app}
      data-app-card-state="open"
    >
      <ViewChrome
        name={facts.value.name}
        mode="live"
        connection={state?.connectionState ?? null}
        viewSession={state?.view_session ?? null}
        health={state?.viewHealth}
        onReopen={(view_session) =>
          void deps.views.reopenView({ view_session }).catch(() => {})}
      />
      <div className={styles.appCardView}>
        <EmbeddedView
          views={deps.views}
          app={card.app}
          mode="live"
          {...(card.release === null ? {} : { release: card.release })}
          screen={card.view}
          size="card"
          card={{ message, block }}
          label={label}
          onState={observe}
          onFailed={(code) => {
            if (code === "conflict") setSettled("contract_changed");
            else if (code === "invalid_input" || code === "forbidden") {
              setSettled("not_card");
            }
          }}
        />
      </div>
    </div>
  );
}

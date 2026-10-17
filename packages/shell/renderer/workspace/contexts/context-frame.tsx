// Context 탭의 틀: 머리(이름·Context 표시·목적·적용된 판 줄·판 목록)와 하위 탭 Overview · Search ·
// Violations · Glossary · Contract. 하위 탭 본문은 부른 쪽이 renderPanel로 넣는다.
// context는 Project Manager가 대화에서 만들고 고친다. 이 머리에는 agent를 부르는 단추가 없고,
// 사람이 하는 일은 옛 판으로 되돌리기([Restore]) 하나다.
import { type ReactNode, useEffect, useState } from "react";
import { Button } from "@lophn/ui/primitives";
import { Tab, TabList, TabPanel, Tabs } from "@lophn/ui/navigation";
import { ErrorState, Skeleton } from "@lophn/ui/feedback";
import { Toast } from "@lophn/ui/overlay";
import type { Clock, Timer } from "@lophn/ui/shared";
import { formatRelativeTime, t } from "@lophn/wording";

import { ContextTitle } from "./context-frame-title.tsx";
import { ContextVersions } from "./context-versions.tsx";
import { errorReason } from "./error-reason.ts";
import { SUB_TABS, type SubTab } from "./shared.ts";
import type {
  BundleEntry,
  CheckReport,
  ContextDetail,
  ContextsSource,
} from "./source.ts";
import { useContextRead } from "./use-context-read.ts";
import styles from "./context-frame.module.css";

export interface ContextFrameProps {
  readonly source: ContextsSource;
  /** context ID. */
  readonly context: string;
  /** 지금 고른 하위 탭. 바꾸는 일은 onSub로 부른 쪽이 한다. */
  readonly sub: SubTab;
  readonly onSub: (sub: SubTab) => void;
  /** 고른 하위 탭의 본문. */
  readonly renderPanel: (sub: SubTab) => ReactNode;
  /** 읽은 context 이름. 복원한 탭이 이름을 얻는다. */
  readonly onTitle?: (title: string) => void;
  /** "applied 2 hours ago"를 재는 지금. 기본은 현재 시각. */
  readonly now?: Date;
  /** 탭 안 알림이 닫히기까지를 재는 timer. 시험과 gallery가 시간을 세우려고 주입한다. */
  readonly timer?: Timer & Clock;
}

interface Loaded {
  readonly detail: ContextDetail;
  /** 판 이력. 번호 내림차순. */
  readonly bundles: readonly BundleEntry[];
}

type Notice =
  | { readonly kind: "restored"; readonly number: number }
  | { readonly kind: "failed"; readonly reason: string };

function appliedCheck(loaded: Loaded): CheckReport | null {
  const applied = loaded.detail.applied;
  if (applied === null) return null;
  return loaded.bundles.find((entry) => entry.bundle.id === applied.id)
    ?.check ?? null;
}

async function loadFrame(
  source: ContextsSource,
  context: string,
): Promise<Loaded | null> {
  const [detail, bundles] = await Promise.all([
    source.get(context),
    source.bundles(context),
  ]);
  if (!detail.ok || !bundles.ok) return null;
  return { detail: detail.value, bundles: bundles.value };
}

function subLabel(sub: SubTab, violations: number): string {
  switch (sub) {
    case "overview":
      return t("contexts.label.sub-overview");
    case "search":
      return t("contexts.label.sub-search");
    case "violations":
      return violations > 0
        ? t("contexts.label.sub-violations-count", {
          count: String(violations),
        })
        : t("contexts.label.sub-violations");
    case "glossary":
      return t("contexts.label.sub-glossary");
    case "contract":
      return t("contexts.label.sub-contract");
  }
}

/** "Version r3 · applied 2 hours ago · tests passed". 적용된 판이 없으면 null. */
function versionLine(loaded: Loaded, now: Date): string | null {
  const { applied } = loaded.detail;
  const check = appliedCheck(loaded);
  if (applied === null || applied.number === null || check === null) {
    return null;
  }
  const when = formatRelativeTime(
    new Date(check.finished_at ?? check.started_at),
    now,
  );
  const values = { number: String(applied.number), when };
  if (check.status === "passed") {
    return t("contexts.label.frame-version-passed", values);
  }
  if (check.status === "failed") {
    return t("contexts.label.frame-version-failed", values);
  }
  return t("contexts.label.frame-version-checking", values);
}

export function ContextFrame(props: ContextFrameProps): ReactNode {
  const { source, context, sub, onSub, renderPanel, onTitle } = props;
  const { read, reload, refresh } = useContextRead(
    () => loadFrame(source, context),
    [source, context],
  );
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const title = read.state === "ready" ? read.value.detail.context.title : null;
  useEffect(() => {
    if (title !== null) onTitle?.(title);
  }, [title]);

  if (read.state === "loading") return <Skeleton lines={3} />;
  if (read.state === "failed") {
    return (
      <ErrorState
        target={t("contexts.label.frame-chip")}
        onRetry={reload}
      />
    );
  }
  const loaded = read.value;
  const item = loaded.detail.context;
  const version = versionLine(loaded, props.now ?? new Date());

  const restore = async (entry: BundleEntry) => {
    setRestoring(entry.bundle.id);
    const result = await source.rollback({
      context,
      bundle: entry.bundle.id,
    });
    setRestoring(null);
    setNotice(
      result.ok
        ? { kind: "restored", number: entry.bundle.number ?? 0 }
        : { kind: "failed", reason: errorReason(result.message) },
    );
    refresh();
  };

  return (
    <div className={styles.frame}>
      {notice === null ? null : (
        <div className={styles.tabToast}>
          <Toast
            title={notice.kind === "restored"
              ? t("contexts.title.restored", { number: String(notice.number) })
              : t("contexts.error.restore-failed")}
            body={notice.kind === "restored"
              ? t("contexts.note.restored")
              : notice.reason}
            tone={notice.kind === "failed" ? "error" : "neutral"}
            duration="brief"
            onClose={() => setNotice(null)}
            timer={props.timer}
            clock={props.timer}
          />
        </div>
      )}
      <div className={styles.head} data-context-head="">
        <ContextTitle name={item.title} purpose={item.purpose}>
          <Button
            size="sm"
            variant="ghost"
            aria-expanded={versionsOpen}
            data-versions-toggle=""
            onClick={() => setVersionsOpen(!versionsOpen)}
          >
            {versionsOpen
              ? t("contexts.button.frame-versions-hide")
              : t("contexts.button.frame-versions-show")}
          </Button>
        </ContextTitle>
        {version === null
          ? null
          : <p className={styles.line} data-version="">{version}</p>}
        {sub === "contract"
          ? (
            <p className={styles.note} data-note="">
              {t("contexts.label.frame-note")}
            </p>
          )
          : null}
      </div>
      {versionsOpen
        ? (
          <ContextVersions
            bundles={loaded.bundles}
            applied={loaded.detail.applied?.id ?? null}
            restoring={restoring}
            now={props.now ?? new Date()}
            onRestore={(entry) => void restore(entry)}
          />
        )
        : null}
      <section aria-label={t("contexts.label.frame-sub-tabs")}>
        <Tabs value={sub} onValueChange={(value) => onSub(value as SubTab)}>
          <TabList>
            {SUB_TABS.map((value) => (
              <Tab key={value} value={value}>
                {subLabel(value, item.violation_mark)}
              </Tab>
            ))}
          </TabList>
          {SUB_TABS.map((value) => (
            <TabPanel key={value} value={value}>
              {value === sub ? renderPanel(value) : null}
            </TabPanel>
          ))}
        </Tabs>
      </section>
    </div>
  );
}

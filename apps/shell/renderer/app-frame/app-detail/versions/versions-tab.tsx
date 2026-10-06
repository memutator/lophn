// Version 탭(flow change-app 6·10, restore-app-release 1·5). 안쪽의 release는 화면에서 Version이다.
// 준비(저장)·적용·시작 확인·Task 확인·당시 Test result는 서로 다른 결과로 따로 보이고, 한 줄로
// 합치지 않는다. 고르기는 사람 결정이라 confirmation window로 보낸다.
import { useEffect, useState } from "react";
import { Button, StatusMark } from "@lophn/design/components";
import { formatDate, t } from "@lophn/wording";

import { Loadable } from "../loadable.tsx";
import {
  appliedText,
  changeLines,
  dataConverts,
  detailGroups,
  type PreviewOpen,
  taskChecksText,
  testResultText,
  versionStatusText,
  versionStatusTone,
} from "../model.ts";
import type { AppDetailSource, StartCheck, VersionRow } from "../source.ts";
import { useRead } from "../use-read.ts";
import styles from "../app-detail.module.css";

export interface VersionsTabProps {
  app: string;
  source: AppDetailSource;
  now: () => Date;
  preview: PreviewOpen | null;
  onPreview(next: PreviewOpen | null): void;
}

type Notice = "decide-failed" | "preview-failed";

const POLL_MS = 4000;

export function VersionsTab(
  { app, source, now, preview, onPreview }: VersionsTabProps,
) {
  // 결정 창을 연 Version과 그때의 상태. 상태가 바뀌면 기다리는 중이 아니다.
  const [requested, setRequested] = useState<ReadonlyMap<string, string>>(
    new Map(),
  );
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = useState<
    { version: string; kind: Notice } | null
  >(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);

  const list = useRead(() => source.versions(app), [app, source], {
    pollMs: polling ? POLL_MS : undefined,
    now,
  });
  const start = useRead(() => source.startCheck(app), [app, source], { now });

  const versions = list.loaded.state === "ready"
    ? list.loaded.value.versions
    : [];
  const busy = versions.some((version) => version.status === "activating") ||
    versions.some((version) => requested.get(version.id) === version.status);
  useEffect(() => setPolling(busy), [busy]);

  async function choose(version: VersionRow): Promise<void> {
    setNotice(null);
    const reply = await source.decide({
      kind: "use_version",
      app,
      release: version.id,
    });
    if (reply.ok) {
      setRequested(new Map(requested).set(version.id, version.status));
    } else setNotice({ version: version.id, kind: "decide-failed" });
  }

  async function openPreview(version: VersionRow): Promise<void> {
    setNotice(null);
    setOpening(version.id);
    const blueprint = await source.blueprint(app, version.id);
    const screen = blueprint.ok ? blueprint.value?.fullScreen ?? null : null;
    if (screen === null) {
      setOpening(null);
      setNotice({ version: version.id, kind: "preview-failed" });
      return;
    }
    const reply = await source.startPreview(app, version.id);
    setOpening(null);
    if (!reply.ok) {
      setNotice({ version: version.id, kind: "preview-failed" });
      return;
    }
    onPreview({
      release: version.id,
      number: version.number,
      screen,
      nonce: reply.value.nonce,
    });
  }

  return (
    <div className={styles.tab} data-tab-body="version">
      <Loadable
        read={list}
        target={t("app-detail.label.versions-target")}
        now={now}
      >
        {(value) => {
          const current = value.versions.find((version) =>
            version.id === value.current
          );
          const others = value.versions.filter((version) =>
            version.id !== value.current
          );
          return (
            <>
              <section className={styles.section} data-section="current">
                <h3 className={styles.heading}>
                  {t("app-detail.heading.current-version")}
                </h3>
                {current
                  ? (
                    <VersionCard
                      version={current}
                      isCurrent
                      source={source}
                      now={now}
                      start={start.loaded.state === "ready"
                        ? start.loaded.value
                        : undefined}
                    />
                  )
                  : (
                    <p className={styles.state} data-no-current="">
                      {t("app-detail.note.no-current")}
                    </p>
                  )}
              </section>
              <section className={styles.section} data-section="others">
                <h3 className={styles.heading}>
                  {t("app-detail.heading.other-versions")}
                </h3>
                {others.length === 0
                  ? (
                    <p className={styles.state} data-no-versions="">
                      {t("app-detail.note.no-other-versions")}
                    </p>
                  )
                  : (
                    <ul className={styles.list}>
                      {others.map((version) => (
                        <VersionCard
                          key={version.id}
                          version={version}
                          isCurrent={false}
                          source={source}
                          now={now}
                          expanded={opened.has(version.id)}
                          onExpand={() =>
                            setOpened(
                              opened.has(version.id)
                                ? new Set(
                                  [...opened].filter((id) => id !== version.id),
                                )
                                : new Set(opened).add(version.id),
                            )}
                          waiting={requested.get(version.id) === version.status}
                          notice={notice?.version === version.id
                            ? notice.kind
                            : null}
                          previewing={preview?.release === version.id}
                          opening={opening === version.id}
                          canPreview
                          onChoose={() => void choose(version)}
                          onPreview={() => void openPreview(version)}
                          onClosePreview={() => onPreview(null)}
                        />
                      ))}
                    </ul>
                  )}
              </section>
            </>
          );
        }}
      </Loadable>
    </div>
  );
}

interface VersionCardProps {
  version: VersionRow;
  isCurrent: boolean;
  source: AppDetailSource;
  now: () => Date;
  start?: StartCheck | null;
  expanded?: boolean;
  onExpand?: () => void;
  waiting?: boolean;
  notice?: Notice | null;
  previewing?: boolean;
  opening?: boolean;
  canPreview?: boolean;
  onChoose?: () => void;
  onPreview?: () => void;
  onClosePreview?: () => void;
}

function VersionCard(props: VersionCardProps) {
  const { version, isCurrent, source, now } = props;
  const shown = isCurrent || props.expanded === true;
  const canUse = !isCurrent &&
    (version.status === "prepared" || version.status === "superseded" ||
      version.status === "failed");
  const Wrapper = isCurrent ? "div" : "li";
  return (
    <Wrapper
      className={styles.row}
      data-version={version.id}
      data-status={version.status}
    >
      <div className={styles.rowHead}>
        <span className={styles.title}>
          {t("app-detail.label.version", { number: String(version.number) })}
        </span>
        <StatusMark
          tone={versionStatusTone(version.status)}
          label={versionStatusText(version.status)}
        />
      </div>
      {version.status === "failed"
        ? (
          <p className={styles.warning} data-apply-failed="">
            {t("app-detail.error.apply-failed", {
              number: String(version.number),
            })}
          </p>
        )
        : null}
      {props.waiting
        ? (
          <p className={styles.text} role="status" data-decision-waiting="">
            {t("app-detail.note.decision-waiting")}
          </p>
        )
        : null}
      {props.notice === "decide-failed"
        ? (
          <p className={styles.warning} role="alert" data-decision-failed="">
            {t("app-detail.error.decision-failed")}
          </p>
        )
        : null}
      {props.notice === "preview-failed"
        ? (
          <p className={styles.warning} role="alert" data-preview-failed="">
            {t("app-detail.error.preview-failed")}
          </p>
        )
        : null}
      {shown
        ? (
          <VersionFacts
            version={version}
            isCurrent={isCurrent}
            source={source}
            now={now}
            start={props.start}
          />
        )
        : null}
      {props.expanded === true
        ? <Changes release={version.id} source={source} now={now} />
        : null}
      {!isCurrent
        ? (
          <div className={styles.actions}>
            <Button size="sm" onClick={props.onExpand} data-version-expand="">
              {props.expanded === true
                ? t("app-detail.button.hide-changes")
                : t("app-detail.button.see-changes")}
            </Button>
            {version.status === "prepared"
              ? props.previewing
                ? (
                  <Button
                    size="sm"
                    onClick={props.onClosePreview}
                    data-preview-close=""
                  >
                    {t("app-detail.button.close-preview")}
                  </Button>
                )
                : (
                  <Button
                    size="sm"
                    disabled={props.canPreview !== true ||
                      props.opening === true}
                    onClick={props.onPreview}
                    data-preview-open=""
                  >
                    {t("app-detail.button.open-preview")}
                  </Button>
                )
              : null}
            {canUse
              ? (
                <Button
                  size="sm"
                  variant="primary"
                  disabled={props.waiting === true}
                  onClick={props.onChoose}
                  data-use-version=""
                >
                  {t("app-detail.button.use-version")}
                </Button>
              )
              : null}
          </div>
        )
        : null}
    </Wrapper>
  );
}

// 준비·적용·시작 확인·Task 확인·Test result. 서로 다른 사실이라 줄을 따로 둔다.
function VersionFacts(
  { version, isCurrent, source, now, start }: {
    version: VersionRow;
    isCurrent: boolean;
    source: AppDetailSource;
    now: () => Date;
    start?: StartCheck | null;
  },
) {
  const tests = useRead(
    () => source.testResults(version.tests),
    [version.id, source],
    { now },
  );
  const task = useRead(
    () =>
      version.ticket === null
        ? Promise.resolve({ ok: true as const, value: null })
        : source.taskChecks(version.ticket),
    [version.id, source],
    { now },
  );
  const started = isCurrent && start !== undefined
    ? start !== null && start.release === version.id && start.ready
    : null;
  return (
    <>
      <dl className={styles.facts} data-facts="">
        <dt>{t("app-detail.label.fact-saved")}</dt>
        <dd data-fact="saved">
          {formatDate(new Date(version.createdAt), "en", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        </dd>
        <dt>{t("app-detail.label.fact-applied")}</dt>
        <dd data-fact="applied">{appliedText(version.status)}</dd>
        {started !== null
          ? (
            <>
              <dt>{t("app-detail.label.fact-start")}</dt>
              <dd data-fact="start">
                {started
                  ? t("app-detail.label.start-ok")
                  : t("app-detail.label.start-unconfirmed")}
              </dd>
            </>
          )
          : null}
        {version.ticket !== null
          ? (
            <>
              <dt>{t("app-detail.label.fact-task")}</dt>
              <dd data-fact="task">
                {task.loaded.state === "ready" && task.loaded.value !== null
                  ? taskChecksText(task.loaded.value)
                  : task.loaded.state === "failed"
                  ? t("app-detail.label.task-unavailable")
                  : null}
              </dd>
            </>
          )
          : null}
        <dt>{t("app-detail.label.fact-test")}</dt>
        <dd data-fact="test">
          {tests.loaded.state === "ready"
            ? tests.loaded.value.map((result) => (
              <span key={result.id} data-test-result={result.result}>
                {testResultText(result.result)}
                {" "}
              </span>
            ))
            : tests.loaded.state === "failed"
            ? t("app-detail.label.test-unavailable")
            : null}
        </dd>
      </dl>
      <p className={styles.muted} data-test-scope="">
        {t("app-detail.note.test-scope")}
      </p>
      {version.failure !== null
        ? (
          <details className={styles.details}>
            <summary>{t("app-detail.label.details")}</summary>
            <p className={styles.mono}>{version.failure}</p>
          </details>
        )
        : null}
    </>
  );
}

// 지금 쓰는 Version과 비교한 바뀐 것. 요약은 개수, 이름은 자세히 보기.
function Changes(
  { release, source, now }: {
    release: string;
    source: AppDetailSource;
    now: () => Date;
  },
) {
  const read = useRead(() => source.compare(release), [release, source], {
    now,
  });
  return (
    <Loadable
      read={read}
      target={t("app-detail.label.changes-target")}
      now={now}
    >
      {(comparison) => {
        const lines = changeLines(comparison);
        const groups = detailGroups(comparison);
        return (
          <div className={styles.section} data-changes="">
            <h4 className={styles.heading}>
              {t("app-detail.heading.what-changes")}
            </h4>
            {lines.length === 0
              ? (
                <p className={styles.text} data-no-changes="">
                  {t("app-detail.note.no-changes")}
                </p>
              )
              : (
                <ul className={styles.detailList} data-change-lines="">
                  {lines.map((line) => (
                    <li key={line.key} className={styles.text}>
                      {line.text}
                    </li>
                  ))}
                </ul>
              )}
            {dataConverts(comparison)
              ? (
                <p className={styles.warning} data-data-warning="">
                  {t("app-detail.note.data-converts")}
                </p>
              )
              : null}
            {comparison.reviewRequired
              ? (
                <p className={styles.warning} data-review-needed="">
                  {t("app-detail.note.review-needed")}
                </p>
              )
              : null}
            {groups.length > 0
              ? (
                <details className={styles.details} data-change-details="">
                  <summary>{t("app-detail.label.details")}</summary>
                  {groups.map((group) => (
                    <div key={group.key}>
                      <h5 className={styles.heading}>{group.heading}</h5>
                      <ul className={styles.detailList}>
                        {group.items.map((item) => (
                          <li
                            key={`${item.sign}:${item.name}`}
                            className={styles.detailItem}
                          >
                            <span className={styles.sign}>
                              {item.sign === "add"
                                ? "+"
                                : item.sign === "delete"
                                ? "−"
                                : "~"}
                            </span>
                            <span className={styles.mono}>{item.name}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </details>
              )
              : null}
          </div>
        );
      }}
    </Loadable>
  );
}

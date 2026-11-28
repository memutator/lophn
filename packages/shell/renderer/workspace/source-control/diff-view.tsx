// git_diff 탭 본문(spec 5.1.3). inline 기본 + side-by-side, 이전/다음 변경(F7/Shift+F7), 공백 무시, 줄 바꿈, Open File,
// working·staged diff의 빠른 Stage/Unstage/Discard. 큰 diff·바이너리는 그리지 않고 알리며, 이미지는 앞뒤 그림을 놓는다.
import { t } from "@lophn/i18n";
import { SegmentedControl } from "@lophn/ui/input";
import { Button, IconButton, IconToggle } from "@lophn/ui/primitives";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  type FocusRoutes,
  useFocusRoutes,
} from "../../conversation/agent-keys.ts";
import type { CoreSource } from "../../desktop/connection/connection.ts";
import { sourceControlIcons } from "../../icons/mod.ts";
import type { DiffSpec } from "../worktrees/context.tsx";
import {
  createSourceControlSource,
  type GitFailure,
  type SourceControlDiffValue,
  targetOf,
} from "../worktrees/source.ts";
import { useDiffLayout } from "./diff-setting.ts";
import { ErrorCard } from "./error-card.tsx";
import {
  baseName,
  type DiffRow,
  IMAGE_EXT,
  imageMime,
  parseUnifiedDiff,
  splitRows,
} from "./model.ts";
import { DiscardDialog } from "./sc-dialogs.tsx";
import styles from "./diff-view.module.css";

const MAX_BYTES = 1024 * 1024;
const MAX_LINES = 5000;

export interface DiffViewProps {
  readonly project: string;
  readonly spec: DiffSpec;
  /** diff를 읽고 쓰는 기계의 core. */
  readonly core: CoreSource;
  /** diff 표시 모드 설정을 쓰는 이 컴퓨터의 core. */
  readonly localCore: CoreSource | undefined;
  readonly readOnly: boolean;
  /** 체크아웃의 절대 경로. 모르면 Open File을 끈다. */
  readonly root: string | null;
  readonly onOpenFile: (path: string) => void;
  /** 보이는 탭이다. 보이면 본문이 focus를 받아 F7/Shift+F7이 이 탭으로 온다. */
  readonly active: boolean;
}

function imageRevs(spec: DiffSpec): readonly [string, string] {
  if (spec.scope.kind === "staged") return ["HEAD", "index"];
  if (spec.scope.kind === "commit") {
    return [`${spec.scope.sha}^`, spec.scope.sha];
  }
  return ["index", "worktree"];
}

function ImageCompare({
  spec,
  project,
  core,
}: {
  spec: DiffSpec;
  project: string;
  core: CoreSource;
}) {
  const [images, setImages] = useState<readonly (string | null)[] | null>(null);
  useEffect(() => {
    let live = true;
    const source = createSourceControlSource(core);
    const target = targetOf(project, spec.checkout);
    void Promise.all(
      imageRevs(spec).map(async (rev) => {
        const res = await source.fileAt(target, spec.path, rev);
        return res.ok && res.value.base64 !== null && !res.value.too_large
          ? `data:${imageMime(spec.path)};base64,${res.value.base64}`
          : null;
      }),
    ).then((found) => {
      if (live) setImages(found);
    });
    return () => {
      live = false;
    };
  }, [core, project, spec]);
  if (images === null) return null;
  return (
    <div className={styles.images}>
      {[t("source-control.label.before"), t("source-control.label.after")].map(
        (label, at) => (
          <figure key={label} className={styles.image}>
            <figcaption>{label}</figcaption>
            {images[at] === null ? (
              <span className={styles.note}>
                {t("source-control.empty.image-none")}
              </span>
            ) : (
              <img
                src={images[at] ?? undefined}
                alt={`${label}: ${baseName(spec.path)}`}
              />
            )}
          </figure>
        ),
      )}
    </div>
  );
}

function Num({ value }: { value: number | undefined }) {
  return <td className={styles.num}>{value ?? ""}</td>;
}

function Line({ row }: { row: DiffRow | undefined }) {
  if (row === undefined) return <td className={styles.code} data-empty="" />;
  return (
    <td className={styles.code} data-kind={row.kind}>
      <span className={styles.mark}>
        {row.kind === "add" ? "+" : row.kind === "del" ? "−" : " "}
      </span>
      {row.text}
    </td>
  );
}

export function DiffView(props: DiffViewProps) {
  const { spec, project, core } = props;
  const source = useMemo(() => createSourceControlSource(core), [core]);
  const target = targetOf(project, spec.checkout);
  const [layout, setLayout] = useDiffLayout(props.localCore);
  const [ignoreSpace, setIgnoreSpace] = useState(false);
  const [wrap, setWrap] = useState(false);
  const [value, setValue] = useState<SourceControlDiffValue | null>(null);
  const [failure, setFailure] = useState<GitFailure | null>(null);
  const [round, setRound] = useState(0);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [at, setAt] = useState(-1);
  const root = useRef<HTMLDivElement>(null);
  const scopeKey =
    spec.scope.kind === "commit" ? `commit:${spec.scope.sha}` : spec.scope.kind;

  useEffect(() => {
    let live = true;
    void source
      .diff(target, {
        path: spec.path,
        ...(spec.scope.kind === "staged" ? { staged: true } : {}),
        ...(spec.scope.kind === "commit" ? { commit: spec.scope.sha } : {}),
        ...(ignoreSpace ? { ignore_whitespace: true } : {}),
      })
      .then((res) => {
        if (!live) return;
        if (res.ok) {
          setValue(res.value);
          setFailure(null);
        } else setFailure(res.error);
      });
    return () => {
      live = false;
    };
  }, [
    source,
    project,
    spec.path,
    scopeKey,
    ignoreSpace,
    round,
    JSON.stringify(spec.checkout),
  ]);

  // 다른 곳(패널, 터미널)에서 바꾼 것을 따라간다. working tree diff만 디스크에 따라 바뀐다.
  useEffect(() => {
    if (spec.scope.kind === "commit") return;
    const tick = () => {
      if (document.visibilityState === "visible") setRound((n) => n + 1);
    };
    globalThis.addEventListener("focus", tick);
    return () => globalThis.removeEventListener("focus", tick);
  }, [scopeKey]);

  const parsed = useMemo(
    () => (value === null ? null : parseUnifiedDiff(value.diff)),
    [value],
  );
  const tooLarge =
    value !== null &&
    (value.truncated ||
      value.diff.length > MAX_BYTES ||
      (parsed?.rows.length ?? 0) > MAX_LINES);
  const split = useMemo(
    () => (parsed === null ? null : splitRows(parsed.rows)),
    [parsed],
  );
  const hunks =
    layout === "side-by-side" ? (split?.hunks ?? []) : (parsed?.hunks ?? []);

  const go = (step: 1 | -1) => {
    if (hunks.length === 0) return;
    const next =
      at < 0
        ? step === 1
          ? 0
          : hunks.length - 1
        : (at + step + hunks.length) % hunks.length;
    setAt(next);
    root.current
      ?.querySelector(`[data-hunk="${next}"]`)
      ?.scrollIntoView({ block: "start" });
  };

  // 이전/다음 변경은 창의 command(`diff.next-change`·`diff.prev-change`)다. 본문에 focus가 들어오면 이 탭이 맡는다.
  const routes = useRef<FocusRoutes>({});
  routes.current = {
    "diff.next-change": { run: () => go(1), when: () => hunks.length > 0 },
    "diff.prev-change": { run: () => go(-1), when: () => hunks.length > 0 },
  };
  const claimKeys = useFocusRoutes(routes);
  useEffect(() => {
    const element = root.current;
    if (!props.active || element === null) return;
    if (!element.contains(document.activeElement)) {
      element.focus({ preventScroll: true });
    }
  }, [props.active]);

  const quick = async (op: "stage" | "unstage" | "discard") => {
    setBusy(true);
    const res =
      op === "stage"
        ? await source.stage(target, { paths: [spec.path] })
        : op === "unstage"
          ? await source.unstage(target, { paths: [spec.path] })
          : await source.discard(target, { paths: [spec.path] });
    setBusy(false);
    if (!res.ok) setFailure(res.error);
    setRound((n) => n + 1);
  };

  const image = IMAGE_EXT.test(spec.path);
  const writable = !props.readOnly && spec.scope.kind !== "commit";
  const hunkOf = new Map(hunks.map((row, index) => [row, index]));

  let body: ReactNode;
  if (value === null) {
    body =
      failure === null ? null : (
        <div className={styles.center}>
          <ErrorCard failure={failure} />
        </div>
      );
  } else if (image) {
    body = <ImageCompare spec={spec} project={project} core={core} />;
  } else if (value.binary || parsed?.binary === true) {
    body = <p className={styles.center}>{t("source-control.empty.binary")}</p>;
  } else if (tooLarge) {
    body = (
      <div className={styles.center}>
        <p>{t("source-control.empty.too-large")}</p>
        {props.root === null ? null : (
          <Button
            size="sm"
            onClick={() => props.onOpenFile(`${props.root}/${spec.path}`)}
          >
            {t("source-control.button.open-file")}
          </Button>
        )}
      </div>
    );
  } else if (parsed === null || parsed.rows.length === 0) {
    body = (
      <p className={styles.center}>{t("source-control.empty.no-changes")}</p>
    );
  } else if (layout === "side-by-side" && split !== null) {
    body = (
      <table className={styles.table} data-layout="split">
        <tbody>
          {split.rows.map((row, index) =>
            row.kind === "pair" ? (
              <tr key={index}>
                <Num value={row.left?.oldNo} />
                <Line
                  row={
                    row.left?.kind === "ctx" || row.left?.kind === "del"
                      ? row.left
                      : undefined
                  }
                />
                <Num value={row.right?.newNo} />
                <Line
                  row={
                    row.right?.kind === "ctx" || row.right?.kind === "add"
                      ? row.right
                      : undefined
                  }
                />
              </tr>
            ) : (
              <tr
                key={index}
                data-hunk={hunkOf.get(index)}
                data-current={hunkOf.get(index) === at || undefined}
              >
                <td
                  colSpan={4}
                  className={row.kind === "hunk" ? styles.hunk : styles.noteRow}
                >
                  {row.text}
                </td>
              </tr>
            ),
          )}
        </tbody>
      </table>
    );
  } else {
    body = (
      <table className={styles.table} data-layout="inline">
        <tbody>
          {parsed.rows.map((row, index) =>
            row.kind === "hunk" || row.kind === "note" ? (
              <tr
                key={index}
                data-hunk={hunkOf.get(index)}
                data-current={hunkOf.get(index) === at || undefined}
              >
                <td
                  colSpan={3}
                  className={row.kind === "hunk" ? styles.hunk : styles.noteRow}
                >
                  {row.text}
                </td>
              </tr>
            ) : (
              <tr key={index}>
                <Num value={row.oldNo} />
                <Num value={row.newNo} />
                <Line row={row} />
              </tr>
            ),
          )}
        </tbody>
      </table>
    );
  }

  return (
    <div
      ref={root}
      className={styles.view}
      data-key-context="gitDiff"
      data-wrap={wrap || undefined}
      data-git-diff={spec.path}
      tabIndex={-1}
      onFocus={claimKeys}
    >
      <div className={styles.toolbar}>
        <span className={styles.path}>{spec.path}</span>
        {spec.status === undefined ? null : (
          <span className={styles.badge}>{spec.status}</span>
        )}
        {parsed === null ? null : (
          <span className={styles.counts}>
            <span className={styles.add}>+{parsed.additions}</span>
            <span className={styles.del}>-{parsed.deletions}</span>
          </span>
        )}
        <span className={styles.spacer} />
        <IconButton
          size="sm"
          icon={sourceControlIcons.ahead}
          label={t("source-control.button.prev-change")}
          disabled={hunks.length === 0}
          onClick={() => go(-1)}
        />
        <IconButton
          size="sm"
          icon={sourceControlIcons.behind}
          label={t("source-control.button.next-change")}
          disabled={hunks.length === 0}
          onClick={() => go(1)}
        />
        <IconToggle
          size="sm"
          icon={sourceControlIcons.space}
          label={t("source-control.button.ignore-whitespace")}
          pressed={ignoreSpace}
          onClick={() => setIgnoreSpace((on) => !on)}
        />
        <IconToggle
          size="sm"
          icon={sourceControlIcons.wrap}
          label={t("source-control.button.wrap")}
          pressed={wrap}
          onClick={() => setWrap((on) => !on)}
        />
        <SegmentedControl
          size="sm"
          label={t("source-control.label.diff-view")}
          value={layout}
          options={[
            { value: "inline", label: t("source-control.label.view-inline") },
            {
              value: "side-by-side",
              label: t("source-control.label.view-split"),
            },
          ]}
          onValueChange={(next) =>
            setLayout(next === "side-by-side" ? "side-by-side" : "inline")
          }
        />
        {props.root === null ? null : (
          <Button
            size="sm"
            onClick={() => props.onOpenFile(`${props.root}/${spec.path}`)}
          >
            {t("source-control.button.open-file")}
          </Button>
        )}
        {writable && spec.scope.kind === "working" ? (
          <>
            <IconButton
              size="sm"
              icon={sourceControlIcons.discard}
              label={t("source-control.button.discard")}
              disabled={busy}
              onClick={() => setConfirm(true)}
            />
            <IconButton
              size="sm"
              icon={sourceControlIcons.stage}
              label={t("source-control.button.stage")}
              disabled={busy}
              onClick={() => void quick("stage")}
            />
          </>
        ) : null}
        {writable && spec.scope.kind === "staged" ? (
          <IconButton
            size="sm"
            icon={sourceControlIcons.unstage}
            label={t("source-control.button.unstage")}
            disabled={busy}
            onClick={() => void quick("unstage")}
          />
        ) : null}
      </div>
      {value !== null && failure !== null ? (
        <ErrorCard failure={failure} onDismiss={() => setFailure(null)} />
      ) : null}
      <div className={styles.scroll}>{body}</div>
      {confirm ? (
        <DiscardDialog
          name={baseName(spec.path)}
          tracked={value?.untracked === true ? 0 : 1}
          untracked={value?.untracked === true ? 1 : 0}
          onConfirm={() => {
            setConfirm(false);
            void quick("discard");
          }}
          onClose={() => setConfirm(false)}
        />
      ) : null}
    </div>
  );
}

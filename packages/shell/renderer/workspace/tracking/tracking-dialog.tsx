import { useCallback, useEffect, useRef, useState } from "react";
import {
  Button,
  Checkbox,
  Dialog,
  Field,
  Icon,
  IconButton,
  iconPixels,
  Input,
  Select,
  Tooltip,
} from "@lophn/design/components";
import { launcherIcons } from "../../icons/mod.ts";
import { t } from "@lophn/wording";

import {
  type ApplyFailure,
  applyFailure,
  changeRule,
  groupPreview,
  overlapOf,
  type PreviewFailure,
  previewFailure,
  sameRules,
  startingRules,
  usableRules,
  withoutRule,
  withRule,
} from "./model.ts";
import type {
  Preview,
  RuleSet,
  TrackedRoot,
  TrackingProject,
  TrackingSource,
} from "./source.ts";
import { PreviewList } from "./preview-list.tsx";
import styles from "./tracking.module.css";

export interface TrackingDialogProps {
  project: TrackingProject;
  source: TrackingSource;
  onClose: () => void;
  onApplied: (project: TrackingProject) => void;
}

type PreviewState =
  | { state: "preparing" }
  | { state: "failed"; failure: PreviewFailure }
  | { state: "ready"; preview: Preview };

// 추적 켜기 창. 규칙(처음에는 Markdown과 .gitignore 제안)으로 포함·제외 파일과 이유를 미리 보고,
// 다른 켜진 추적과 겹치면 막고, 미리 본 바로 그 구성으로만 켠다(documents/projects#R3–R7).
export function TrackingDialog(
  { project: initial, source, onClose, onApplied }: TrackingDialogProps,
) {
  const [project, setProject] = useState(initial);
  const [rules, setRules] = useState<RuleSet>(() => startingRules(initial));
  const [editing, setEditing] = useState(false);
  const [preview, setPreview] = useState<PreviewState>({
    state: "preparing",
  });
  const [roots, setRoots] = useState<readonly TrackedRoot[]>([]);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ApplyFailure | null>(null);
  // 늦게 온 미리보기가 새 미리보기를 덮지 않게 한다.
  const serial = useRef(0);

  const run = useCallback(
    async (target: TrackingProject, next: RuleSet) => {
      const mine = ++serial.current;
      setPreview({ state: "preparing" });
      setFailure(null);
      const [made, tracked] = await Promise.all([
        source.preview(target, next),
        source.trackedRoots(target.id),
      ]);
      if (mine !== serial.current) return;
      if (tracked.ok) setRoots(tracked.value);
      setPreview(
        made.ok ? { state: "ready", preview: made.value } : {
          state: "failed",
          failure: previewFailure(made.code, target.folders),
        },
      );
    },
    [source],
  );

  // 처음 열 때 한 번만 미리 본다. 이후는 사람이 [Preview again]으로 다시 본다.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    void run(initial, startingRules(initial));
  }, [initial, run]);

  // 미리보기 뒤 프로젝트가 바뀌었으면 현재 판을 다시 읽고 같은 규칙으로 다시 미리 본다.
  const again = async () => {
    const read = await source.project(project.id);
    const target = read.ok ? read.value : project;
    setProject(target);
    await run(target, rules);
  };

  const ready = preview.state === "ready" ? preview.preview : null;
  const stale = ready !== null && !sameRules(ready.rules, rules);
  const overlap = overlapOf(project.folders, roots);
  const canApply = ready !== null && !stale && overlap === null &&
    usableRules(rules) && !busy;

  const apply = async () => {
    if (!ready || !canApply) return;
    setBusy(true);
    setFailure(null);
    const result = await source.apply(project, ready);
    if (result.ok) {
      setBusy(false);
      onApplied(result.value);
      return;
    }
    const [current, tracked] = await Promise.all([
      source.project(project.id),
      source.trackedRoots(project.id),
    ]);
    setBusy(false);
    setFailure(
      applyFailure(
        result.code,
        ready,
        current.ok ? current.value : null,
        tracked.ok ? tracked.value : null,
      ),
    );
    if (tracked.ok) setRoots(tracked.value);
  };

  const editLabel = t("project-workspace.button.edit-rules");
  const againLabel = t("project-workspace.button.preview-again");
  const groups = ready ? groupPreview(ready.entries) : null;

  return (
    <Dialog
      open
      width="wide"
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
      title={t("project-workspace.title.tracking", {
        project: project.title,
      })}
      actions={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t("common.button.cancel")}
          </Button>
          <Button
            variant="primary"
            disabled={!canApply}
            data-apply-tracking=""
            onClick={() => void apply()}
          >
            {t("project-workspace.button.turn-on-tracking")}
          </Button>
        </>
      }
    >
      <div className={styles.body} data-tracking-dialog="">
        <section className={styles.rules} data-rules="">
          <div className={styles.rulesHead}>
            <ul className={styles.ruleSummary}>
              {rules.patterns.map((rule, index) => (
                <li key={index} className={styles.mono}>
                  {t(
                    rule.effect === "include"
                      ? "launcher.label.rule-include"
                      : "launcher.label.rule-exclude",
                    { glob: rule.glob },
                  )}
                </li>
              ))}
              {rules.useGitignore
                ? <li>{t("launcher.label.detail-gitignore")}</li>
                : null}
            </ul>
            <Tooltip content={editLabel}>
              <IconButton
                icon={launcherIcons.editRules}
                label={editLabel}
                size="sm"
                aria-expanded={editing}
                data-edit-rules=""
                onClick={() => setEditing(!editing)}
              />
            </Tooltip>
          </div>
          {editing ? <RuleEditor rules={rules} onChange={setRules} /> : null}
        </section>
        <PreviewStatus
          preview={preview}
          stale={stale}
          overlap={overlap}
          failure={failure}
          projectTitle={project.title}
          againLabel={againLabel}
          onAgain={() => void again()}
        />
        {groups && !stale ? <PreviewList groups={groups} /> : null}
      </div>
    </Dialog>
  );
}

function RuleEditor(
  { rules, onChange }: { rules: RuleSet; onChange: (next: RuleSet) => void },
) {
  const addLabel = t("project-workspace.button.add-rule");
  const removeLabel = t("project-workspace.button.remove-rule");
  const effects = [
    { value: "include", label: t("project-workspace.label.rule-include") },
    { value: "exclude", label: t("project-workspace.label.rule-exclude") },
  ];
  return (
    <div className={styles.editor} data-rule-editor="">
      <ol className={styles.ruleList}>
        {rules.patterns.map((rule, index) => (
          <li key={index} className={styles.ruleRow} data-rule={index}>
            <Field label={t("project-workspace.label.rule-effect")}>
              <Select
                size="sm"
                options={effects}
                value={rule.effect}
                onValueChange={(value) =>
                  onChange(
                    changeRule(rules, index, {
                      ...rule,
                      effect: value === "exclude" ? "exclude" : "include",
                    }),
                  )}
              />
            </Field>
            <Field label={t("project-workspace.label.rule-pattern")}>
              <Input
                size="sm"
                value={rule.glob}
                data-rule-pattern=""
                onChange={(event) =>
                  onChange(
                    changeRule(rules, index, {
                      ...rule,
                      glob: event.currentTarget.value,
                    }),
                  )}
              />
            </Field>
            <Tooltip content={removeLabel}>
              <IconButton
                icon={launcherIcons.remove}
                label={removeLabel}
                size="sm"
                data-remove-rule=""
                onClick={() =>
                  onChange(withoutRule(rules, index))}
              />
            </Tooltip>
          </li>
        ))}
      </ol>
      <div className={styles.editorFoot}>
        <Checkbox
          label={t("project-workspace.label.gitignore")}
          checked={rules.useGitignore}
          onCheckedChange={(checked) =>
            onChange({ ...rules, useGitignore: checked })}
        />
        <Tooltip content={addLabel}>
          <IconButton
            icon={launcherIcons.addRule}
            label={addLabel}
            size="sm"
            data-add-rule=""
            onClick={() =>
              onChange(withRule(rules, { effect: "include", glob: "" }))}
          />
        </Tooltip>
      </div>
    </div>
  );
}

interface PreviewStatusProps {
  preview: PreviewState;
  stale: boolean;
  overlap: { other: string; path: string } | null;
  failure: ApplyFailure | null;
  projectTitle: string;
  againLabel: string;
  onAgain: () => void;
}

// 미리보기 위 한 줄: 준비 중, 포함·제외 수, 또는 대상·영향·다음 행동 하나(shell/wording#R10).
function PreviewStatus(
  {
    preview,
    stale,
    overlap,
    failure,
    projectTitle,
    againLabel,
    onAgain,
  }: PreviewStatusProps,
) {
  const againButton = (
    <Tooltip content={againLabel}>
      <IconButton
        icon={launcherIcons.previewAgain}
        label={againLabel}
        size="sm"
        data-preview-again=""
        onClick={onAgain}
      />
    </Tooltip>
  );
  const problem = (text: string, kind: string, withAgain: boolean) => (
    <div className={styles.problem} role="alert" data-problem={kind}>
      <Icon
        icon={launcherIcons.warning}
        pixels={iconPixels("base")}
        className={styles.problemIcon}
      />
      <p className={styles.problemText}>{text}</p>
      {withAgain ? againButton : null}
    </div>
  );
  if (failure?.kind === "changed") {
    return problem(
      t("project-workspace.tracking.changed", { project: projectTitle }),
      "changed",
      true,
    );
  }
  if (failure?.kind === "overlap") {
    return problem(
      t("project-workspace.tracking.overlap", {
        other: failure.other,
        path: failure.path,
      }),
      "overlap",
      false,
    );
  }
  if (failure?.kind === "failed") {
    return problem(
      t("project-workspace.tracking.apply-failed", { project: projectTitle }),
      "apply-failed",
      false,
    );
  }
  if (preview.state === "preparing") {
    return (
      <p className={styles.status} data-preview="preparing">
        {t("project-workspace.tracking.preparing")}
      </p>
    );
  }
  if (preview.state === "failed") {
    const { failure: reason } = preview;
    if (reason.kind === "changed") {
      return problem(
        t("project-workspace.tracking.changed", { project: projectTitle }),
        "changed",
        true,
      );
    }
    if (reason.kind === "failed") {
      return problem(
        t("project-workspace.tracking.preview-failed", {
          project: projectTitle,
        }),
        "preview-failed",
        true,
      );
    }
    return problem(
      reason.folder === null
        ? t("project-workspace.tracking.unreadable-many")
        : t("project-workspace.tracking.unreadable-one", {
          folder: reason.folder,
        }),
      "unreadable",
      true,
    );
  }
  if (stale) {
    return problem(t("project-workspace.tracking.stale"), "stale", true);
  }
  const groups = groupPreview(preview.preview.entries);
  return (
    <div className={styles.summary} data-preview="ready">
      <p className={styles.status}>
        <span data-count="tracked">
          {t("project-workspace.tracking.included-count", {
            count: groups.tracked.length,
          })}
        </span>
        <span data-count="left-out">
          {t("project-workspace.tracking.excluded-count", {
            count: groups.leftOut.length,
          })}
        </span>
      </p>
      {overlap
        ? problem(
          t("project-workspace.tracking.overlap", overlap),
          "overlap",
          false,
        )
        : null}
    </div>
  );
}

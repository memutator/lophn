import type { ReactNode } from "react";
import { t } from "@lophn/wording";
import { DiffMark } from "@lophn/design/components";

import type { Display } from "../../display.ts";
import { ApprovalDecision } from "../approval/approval.tsx";
import {
  appLabel,
  facts,
  FoldedExact,
  type KindProps,
  list,
  obj,
  str,
} from "../exact.tsx";
import styles from "../kinds.module.css";

/** effect 값(read·write·external)을 한 줄 글로. 없으면 없다고 말한다. */
export function effectText(effect: unknown): string {
  switch (effect) {
    case "read":
      return t("confirmation-window.label.effect-read");
    case "write":
      return t("confirmation-window.label.effect-write");
    case "external":
      return t("confirmation-window.label.effect-external");
    default:
      return t("confirmation-window.change.none");
  }
}

function kindText(kind: string): string {
  switch (kind) {
    case "input":
      return t("confirmation-window.label.change-input");
    case "effect":
      return t("confirmation-window.label.change-effect");
    case "confirm":
      return t("confirmation-window.label.change-confirm");
    default:
      return t("confirmation-window.label.change-revert");
  }
}

function arr(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(obj) : [];
}

function Part(
  { name, title, children }: {
    name: string;
    title: string;
    children: ReactNode;
  },
) {
  return (
    <section className={styles.part} data-change={name}>
      <h3 className={styles.partHead}>{title}</h3>
      {children}
    </section>
  );
}

/** 이름 목록. 표지는 DiffMark와 글이고 색에 기대지 않는다. */
function Marked(
  { label, mark, items }: {
    label: string;
    mark: "add" | "delete" | "change";
    items: readonly string[];
  },
) {
  if (items.length === 0) return null;
  return (
    <ul className={styles.list} data-mark={mark}>
      {items.map((item) => (
        <li key={item} className={styles.item}>
          <span>
            {mark === "change" ? null : <DiffMark kind={mark} />}
            {label}
          </span>
          <span className={styles.mono}>{item}</span>
        </li>
      ))}
    </ul>
  );
}

/** 동작이 바뀐 command 하나. 효과가 바뀌면 현재·바뀐 뒤를 세로로 보인다. */
function CommandChange({ change }: { change: Record<string, unknown> }) {
  const kinds = list(change.kinds);
  const inputs = list(change.new_required_inputs);
  return (
    <li className={styles.item} data-command-change={str(change.command)}>
      <span className={styles.mono}>{str(change.command)}</span>
      <span>
        {t("confirmation-window.label.changed")}:{" "}
        {kinds.map(kindText).join(", ")}
      </span>
      {kinds.includes("effect")
        ? (
          <>
            <span data-side="before">
              {t("confirmation-window.label.current")}:{" "}
              {effectText(change.effect_from)}
            </span>
            <span data-side="after">
              {t("confirmation-window.label.next")}:{" "}
              {effectText(change.effect_to)}
            </span>
          </>
        )
        : null}
      {inputs.length > 0
        ? (
          <span>
            {t("confirmation-window.label.new-inputs")}:{" "}
            <span className={styles.mono}>{inputs.join(", ")}</span>
          </span>
        )
        : null}
    </li>
  );
}

/**
 * 이전 release와 비교한 바뀐 것. 화면·command(입력·효과·확인·되돌림)·automation·접근 추가와 축소·
 * 데이터 변경과 손실 설명을 한 묶음씩 보인다. 정적 비교는 업무 의미의 동일을 증명하지 못하므로
 * "검토 필요"는 apps가 준 review_required를 그대로 말한다.
 */
export function Changes({ compare }: { compare: Record<string, unknown> }) {
  const commandChanges = arr(compare.command_changes);
  const dataChanges = arr(compare.data_changes);
  const schema = obj(compare.data_schema);
  const screens = [
    ...list(compare.added_screens),
    ...list(compare.removed_screens),
    ...list(compare.changed_screens),
  ];
  const commands = [
    ...list(compare.added_commands),
    ...list(compare.removed_commands),
    ...list(compare.external_commands),
    ...list(compare.description_only_commands),
  ];
  const automations = [
    ...list(compare.added_automations),
    ...list(compare.removed_automations),
    ...list(compare.changed_automations),
  ];
  const access = [
    ...list(compare.added_permissions),
    ...list(compare.removed_permissions),
  ];
  const problems = list(compare.added_problem_code_warnings);
  const dataShown = dataChanges.length > 0 || schema.from !== schema.to;
  const any = screens.length + commands.length + commandChanges.length +
          automations.length + access.length + problems.length > 0 ||
    dataShown;
  return (
    <div className={styles.parts} data-changes="release">
      {compare.previous_release === null
        ? (
          <p className={styles.message} data-change="first">
            {t("confirmation-window.release.first")}
          </p>
        )
        : null}
      {compare.review_required === true
        ? (
          <p className={styles.warning} role="note" data-change="review">
            {t("confirmation-window.release.review")}
          </p>
        )
        : null}
      {!any && compare.previous_release !== null
        ? (
          <p className={styles.message} data-change="none">
            {t("confirmation-window.release.none")}
          </p>
        )
        : null}
      {screens.length > 0
        ? (
          <Part name="screens" title={t("confirmation-window.heading.screens")}>
            <Marked
              label={t("confirmation-window.label.added")}
              mark="add"
              items={list(compare.added_screens)}
            />
            <Marked
              label={t("confirmation-window.label.removed")}
              mark="delete"
              items={list(compare.removed_screens)}
            />
            <Marked
              label={t("confirmation-window.label.changed")}
              mark="change"
              items={list(compare.changed_screens)}
            />
          </Part>
        )
        : null}
      {commands.length + commandChanges.length > 0
        ? (
          <Part
            name="commands"
            title={t("confirmation-window.heading.commands")}
          >
            <Marked
              label={t("confirmation-window.label.added")}
              mark="add"
              items={list(compare.added_commands)}
            />
            <Marked
              label={t("confirmation-window.label.removed")}
              mark="delete"
              items={list(compare.removed_commands)}
            />
            {commandChanges.length > 0
              ? (
                <ul className={styles.list}>
                  {commandChanges.map((change) => (
                    <CommandChange key={str(change.command)} change={change} />
                  ))}
                </ul>
              )
              : null}
            <Marked
              label={t("confirmation-window.label.reaches-outside")}
              mark="change"
              items={list(compare.external_commands)}
            />
            <Marked
              label={t("confirmation-window.label.name-only")}
              mark="change"
              items={list(compare.description_only_commands)}
            />
          </Part>
        )
        : null}
      {automations.length > 0
        ? (
          <Part
            name="automations"
            title={t("confirmation-window.heading.automations")}
          >
            <Marked
              label={t("confirmation-window.label.added")}
              mark="add"
              items={list(compare.added_automations)}
            />
            <Marked
              label={t("confirmation-window.label.removed")}
              mark="delete"
              items={list(compare.removed_automations)}
            />
            <Marked
              label={t("confirmation-window.label.changed")}
              mark="change"
              items={list(compare.changed_automations)}
            />
          </Part>
        )
        : null}
      {access.length > 0
        ? (
          <Part name="access" title={t("confirmation-window.heading.access")}>
            <Marked
              label={t("confirmation-window.label.added")}
              mark="add"
              items={list(compare.added_permissions)}
            />
            <Marked
              label={t("confirmation-window.label.removed")}
              mark="delete"
              items={list(compare.removed_permissions)}
            />
          </Part>
        )
        : null}
      {dataShown
        ? (
          <Part name="data" title={t("confirmation-window.heading.data")}>
            <span className={styles.item}>
              {t("confirmation-window.label.data-version")}:{" "}
              <span className={styles.mono}>
                {String(schema.from)} → {String(schema.to)}
              </span>
            </span>
            <ul className={styles.list}>
              {dataChanges.map((change, index) => (
                <li key={index} className={styles.item}>
                  <span className={styles.mono}>
                    {String(change.from)} → {String(change.to)}
                  </span>
                  <span>{str(change.description)}</span>
                </li>
              ))}
            </ul>
          </Part>
        )
        : null}
      {problems.length > 0
        ? (
          <Part
            name="problems"
            title={t("confirmation-window.heading.problems")}
          >
            <Marked
              label={t("confirmation-window.label.changed")}
              mark="change"
              items={problems}
            />
          </Part>
        )
        : null}
    </div>
  );
}

/**
 * release activation. 정확한 release의 바뀐 것을 apps가 다시 비교한 값으로 보이고, 결정은 approval의
 * 허락·거절·취소와 같다. 적용(activation 시작)은 요청자가 이 결정의 증거로 따로 한다.
 * 안전 preview는 apps/preview가 읽기로 준 결과가 있을 때만 말하고 없으면 없다고 한다.
 */
export function ReleaseActivationKind(props: KindProps) {
  const shown = obj(props.view.view);
  const compare = obj(shown.compare);
  const app = appLabel(shown.app);
  const number = Number(obj(shown.version).number);
  const display: Display = {
    title: t("confirmation-window.title.release", { number, app }),
    subject: t("confirmation-window.release.subject", { number, app }),
    effect: arr(compare.data_changes).length > 0
      ? t("confirmation-window.release.effect-data")
      : t("confirmation-window.release.effect"),
    reversible: shown.reversible === true,
    revertNote: str(shown.reversibility),
    action: t("confirmation-window.button.use-version"),
    details: facts([
      [t("confirmation-window.label.requested-by"), str(shown.requester)],
      [t("confirmation-window.label.reason"), str(shown.reason)],
      [t("confirmation-window.label.expires"), str(shown.expires_at)],
    ]),
    noChange: true,
  };
  return (
    <ApprovalDecision
      {...props}
      display={display}
      exact={
        <>
          <Changes compare={compare} />
          <section className={styles.part} data-change="preview">
            <h3 className={styles.partHead}>
              {t("confirmation-window.heading.preview")}
            </h3>
            <p className={styles.item}>
              {obj(shown.preview).ready === true
                ? t("confirmation-window.release.preview-ready")
                : t("confirmation-window.release.preview-none")}
            </p>
          </section>
          <FoldedExact view={shown} />
        </>
      }
    />
  );
}

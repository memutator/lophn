import { useEffect, useState } from "react";
import { Button } from "@lophn/design/components";
import { t } from "@lophn/wording";

import styles from "./workspace.module.css";

/** 이 프로젝트에 붙은 Operator 하나. 회수한 것은 세지 않는다. */
export interface ProjectOperator {
  readonly id: string;
  readonly state: "enabled" | "paused";
}

export interface OperatorEntrySource {
  /** 이 프로젝트에 붙은 Operator. 읽지 못하면 실패다. */
  operators(
    project: string,
  ): Promise<
    | { readonly ok: true; readonly value: readonly ProjectOperator[] }
    | { readonly ok: false; readonly code: string }
  >;
}

export interface OperatorEntryProps {
  project: string;
  source: OperatorEntrySource;
  /** roles 화면에서 이 프로젝트에 Operator를 붙이는 화면을 연다. */
  onAttach: (project: string) => void;
  /** roles 화면에서 붙은 Operator 하나를 연다. */
  onOpen: (operator: string) => void;
}

// 작업대 본문 위 한 줄. 이 프로젝트에 반복 확인(Repeating check)을 맡긴 Operator가 몇 개인지 알려 주고
// roles 화면의 붙이기·상세로 보낸다. 붙이는 결정은 roles 화면과 보호 확인 창이 맡는다
// (flow set-up-operator).
export function OperatorEntry(
  { project, source, onAttach, onOpen }: OperatorEntryProps,
) {
  const [attached, setAttached] = useState<
    readonly ProjectOperator[] | null
  >(null);

  useEffect(() => {
    let live = true;
    void source.operators(project).then((result) => {
      if (live) setAttached(result.ok ? result.value : null);
    });
    return () => {
      live = false;
    };
  }, [project, source]);

  // 읽지 못하면 붙이기만 둔다. 개수를 모르면서 없다고 말하지 않는다.
  return (
    <div className={styles.operatorEntry} data-operator-entry={project}>
      <p
        className={styles.operatorText}
        data-operator-count={attached?.length ?? ""}
      >
        {attached === null
          ? null
          : attached.length === 0
          ? t("project-workspace.label.operators-none")
          : t("project-workspace.label.operators", {
            count: attached.length,
          })}
      </p>
      {attached === null || attached.length === 0 ? null : (
        <Button
          size="sm"
          variant="ghost"
          data-action="see-operators"
          onClick={() => onOpen(attached[0]!.id)}
        >
          {t("project-workspace.button.see-operators")}
        </Button>
      )}
      <Button
        size="sm"
        variant="secondary"
        data-action="attach-operator"
        onClick={() => onAttach(project)}
      >
        {t("project-workspace.button.attach-operator")}
      </Button>
    </div>
  );
}

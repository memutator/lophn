import { t } from "@lophn/wording";

import type { ConfirmationView } from "../../frame/api.ts";
import { fileDeleteDisplay, readDisplay } from "../../display.ts";
import { ConfirmationLayout, DecisionActions } from "../../layout/layout.tsx";

export interface OwnerDecisionProps {
  view: ConfirmationView;
  onDecide: (decision: string) => void;
  onCancel: () => void;
}

const FILE_DELETE = "delete_file";

/**
 * 소유 concern의 사람 결정 화면.
 * 첫 결정은 documents의 파일 지우기다. 표시 자료는 comparison에서 읽고,
 * 자료가 없으면 없다고 말한다.
 */
export function OwnerDecision(
  { view, onDecide, onCancel }: OwnerDecisionProps,
) {
  if (view.request.kind !== "owner_decision") return null;
  const request = view.request;
  const display = request.decision === FILE_DELETE
    ? fileDeleteDisplay({
      path: pathOf(inlineValue(request.input), request.comparison),
      document: textOf(request.comparison, "document"),
    })
    : readDisplay(request.comparison);
  if (display === undefined) {
    return (
      <p data-change="missing">{t("confirmation-window.change.missing")}</p>
    );
  }
  return (
    <ConfirmationLayout
      display={display}
      actions={
        <DecisionActions
          action={display.action}
          onDecide={() => onDecide(request.decision)}
          onCancel={onCancel}
        />
      }
    />
  );
}

function inlineValue(
  input: { kind: "inline"; value: Record<string, unknown> } | {
    kind: "blob";
    sha256: string;
  },
): Record<string, unknown> {
  return input.kind === "inline" ? input.value : {};
}

function pathOf(
  input: Record<string, unknown>,
  comparison: Record<string, unknown>,
): string {
  const fromComparison = comparison.path;
  if (typeof fromComparison === "string" && fromComparison !== "") {
    return fromComparison;
  }
  const target = input.target;
  if (typeof target === "object" && target !== null && "path" in target) {
    const path = (target as { path?: unknown }).path;
    if (typeof path === "string") return path;
  }
  return "";
}

function textOf(
  comparison: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = comparison[key];
  return typeof value === "string" && value !== "" ? value : undefined;
}

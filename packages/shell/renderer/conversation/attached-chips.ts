import type { AttachedChip } from "../../../protocol/lophn-agent/inputs.ts";
import type { ContextChipView } from "./composer/types.ts";

/** 위반을 붙인 chip은 위반(파일·규칙)으로, 아니면 context(이름)로 core에 보낸다. */
export function attachedOf(
  chips: readonly ContextChipView[],
): AttachedChip[] {
  return chips.map((chip): AttachedChip =>
    chip.violation === undefined
      ? { kind: "context", context: chip.context, name: chip.label }
      : {
        kind: "violation",
        context: chip.context,
        path: chip.violation.file,
        rule: chip.violation.rule,
      }
  );
}

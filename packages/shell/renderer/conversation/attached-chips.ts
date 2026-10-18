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

/** 보낸 chip을 본문 part로 쓴다. 대화에 chip이 남고, 다시 보내기가 이 part로 chip을 되살린다. */
export function attachedPartsOf(chips: readonly ContextChipView[]) {
  return chips.map((chip) =>
    chip.violation === undefined
      ? {
        kind: "attached" as const,
        attached: "context" as const,
        name: chip.label,
        context: chip.context,
      }
      : {
        kind: "attached" as const,
        attached: "violation" as const,
        name: chip.violation.file,
        line: chip.violation.rule,
        path: chip.violation.file,
        rule: chip.violation.rule,
        context: chip.context,
      }
  );
}

interface AttachedPart {
  readonly attached: string;
  readonly name: string;
  readonly path?: string | undefined;
  readonly rule?: string | undefined;
  readonly context?: string | undefined;
}

/** 본문의 attached part에서 `SendMessage.attached`를 되살린다. 모양이 모자란 part는 건너뛴다. */
export function attachedOfParts(
  parts: readonly ({ readonly kind: string } & Partial<AttachedPart>)[],
): AttachedChip[] {
  return parts.flatMap((part): AttachedChip[] => {
    if (part.kind !== "attached" || part.context === undefined) return [];
    if (part.attached === "context") {
      return [{ kind: "context", context: part.context, name: part.name! }];
    }
    return part.attached === "violation" && part.path !== undefined &&
        part.rule !== undefined
      ? [{
        kind: "violation",
        context: part.context,
        path: part.path,
        rule: part.rule,
      }]
      : [];
  });
}

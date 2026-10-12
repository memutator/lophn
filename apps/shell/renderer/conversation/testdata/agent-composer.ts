// Agent composer test의 입력. 순수 data와 builder이고 시각·id는 고정한다.
import type { SendMode } from "../delivery-state.ts";
import { type Draft, EMPTY_DRAFT } from "../drafts.ts";
import type { AgentComposerProps } from "../composer/agent-composer.tsx";
import type { ContextChipView } from "../composer/types.ts";
import { pickerProps, SONNET } from "./model-picker.ts";

export function draftOf(text: string, mode: SendMode = "request"): Draft {
  return { ...EMPTY_DRAFT, text, selection: [text.length, text.length], mode };
}

/** toast의 [Ask Context Engineer]로 연 session의 첫 context: 사건 대상이다. */
export const VIOLATIONS_CHIP: ContextChipView = {
  id: "ctx_01h455vb4pex5v6nkc6gd5fc01",
  label: "2 contract violations in eval-loop",
};

export interface ComposerCalls {
  readonly drafts: Partial<Draft>[];
  readonly removed: string[];
  readonly sent: SendMode[];
  attached: number;
  permissions: number;
  stopped: number;
}

export function composerCalls(): ComposerCalls {
  return {
    drafts: [],
    removed: [],
    sent: [],
    attached: 0,
    permissions: 0,
    stopped: 0,
  };
}

/** 기본값: 쉬는 중, 빈 입력칸, chip 없음, Sonnet 5.5 · Medium, 프로젝트 phroner, picker 닫힘. */
export function composerProps(
  over: Partial<AgentComposerProps> = {},
  calls: ComposerCalls = composerCalls(),
): AgentComposerProps {
  return {
    draft: EMPTY_DRAFT,
    working: false,
    locked: false,
    tooLong: false,
    offline: false,
    contexts: [],
    picker: pickerProps({ scenario: SONNET, open: false }),
    slashMenu: null,
    place: { kind: "project", name: "phroner" },
    permissionSummary: "Ask first, 1 edit allowed this session",
    onDraft: (patch) => calls.drafts.push(patch),
    onRemoveContext: (id) => calls.removed.push(id),
    onAttach: () => calls.attached += 1,
    onOpenPermissions: () => calls.permissions += 1,
    onSend: (mode) => calls.sent.push(mode),
    onStop: () => calls.stopped += 1,
    ...over,
  };
}

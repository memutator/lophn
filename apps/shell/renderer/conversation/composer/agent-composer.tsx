// Agent 탭의 composer(shell/desktop#R43). 입력칸 안 아래 줄에 [+]·[model · option ▾]·[send / 일하는 중이면 Stop],
// 일하는 중에만 select(Change this work / Next request), 입력칸 밖 아래 줄에 자리 이름과 권한 요약 ▾, 입력칸
// 위에 떼어 낼 수 있는 context chip 줄이 있다. agent를 고르는 칸은 없다. 기존 composer.tsx(dock용)는 R task가
// 지울 때까지 그대로 두고, 이 파일이 Agent 탭 자리를 맡는다.
import type { ReactNode } from "react";

import type { SendMode } from "../delivery-state.ts";
import type { Draft } from "../drafts.ts";
import type { ModelPickerProps } from "../model-picker/model-picker.tsx";

/** 입력칸 위에 붙은 context chip 하나. notification의 [Ask]로 연 session은 첫 chip이 사건 대상이다. */
export interface ContextChipView {
  readonly id: string;
  /** 사건 대상 이름. */
  readonly label: string;
}

export interface AgentComposerProps {
  /** 입력 중인 글·커서·보낼 방식(draft.mode). 세션 메모리에 남는 값이다(desktop#R8). */
  draft: Draft;
  /** 일하는 중이다(run이 돌거나 질문·승인을 기다림). Stop과 보낼 방식 select가 나온다. */
  working: boolean;
  /** 보내는 중이거나 결과를 모르는 말이 있으면 글을 고치지 못한다. */
  locked: boolean;
  /** 글이 본문 상한을 넘는다. 보내지 못한다. */
  tooLong: boolean;
  /** 연결이 끊겨 지금은 보낼 수 없다. 글은 그대로 쓸 수 있다. */
  offline: boolean;
  /** 입력칸 위 context chip. 비어 있으면 줄이 없다. */
  contexts: readonly ContextChipView[];
  /** 가운데 단추. model 이름과 option 값은 picker props가 준다. */
  picker: ModelPickerProps;
  /** 입력칸 위에 뜨는 `/` 메뉴. 열지 않으면 null이다. 메뉴 모양은 slash-menu가 맡는다. */
  slashMenu: ReactNode | null;
  /** 입력칸 밖 아래 줄의 자리. 프로젝트 또는 앱 하나다. */
  place: { readonly kind: "project" | "app"; readonly name: string };
  /** 그 session의 실제 권한을 한 줄로 요약한 글(자리 권한 규칙과 이 session에서 Allow한 것). */
  permissionSummary: string;
  onDraft: (patch: Partial<Draft>) => void;
  /** chip의 ✕. 뗀다. 보내기 전에는 아무것도 보내지 않는다. */
  onRemoveContext: (id: string) => void;
  onAttach: () => void;
  /** 권한 요약을 눌렀다. Agents 화면의 Permissions로 간다. */
  onOpenPermissions: () => void;
  /** 글이나 chip을 draft.mode 방식으로 보낸다. */
  onSend: (mode: SendMode) => void;
  onStop: () => void;
}

export function AgentComposer(_props: AgentComposerProps): ReactNode {
  throw new Error("not implemented: agent-I23");
}

// Agent 탭의 composer(shell/desktop#R43). 입력칸 안 아래 줄에 [+]·[model · option ▾]·[send / 일하는 중이면 Stop],
// 일하는 중에만 select(Change this work / Next request), 입력칸 밖 아래 줄에 자리 이름과 권한 요약 ▾, 입력칸
// 위에 떼어 낼 수 있는 context chip 줄이 있다. agent를 고르는 칸은 없다. 기존 composer.tsx(dock용)는 R task가
// 지울 때까지 그대로 두고, 이 파일이 Agent 탭 자리를 맡는다.
import {
  type KeyboardEvent,
  type ReactNode,
  useLayoutEffect,
  useRef,
} from "react";
import {
  Button,
  conversationIcons,
  Field,
  Icon,
  IconButton,
  iconPixels,
  Select,
  workspaceIcons,
} from "@lophn/design/components";
import { t } from "@lophn/wording";

import type { SendMode } from "../delivery-state.ts";
import type { Draft } from "../drafts.ts";
import {
  ModelPicker,
  type ModelPickerProps,
} from "../model-picker/model-picker.tsx";
import styles from "./agent-composer.module.css";
import type { ContextChipView } from "./types.ts";

export type { ContextChipView } from "./types.ts";

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
  /** 글이 비어 있을 때 입력칸에 보이는 안내. */
  hint?: string;
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

const SEND_MODES = [
  { value: "correction", label: t("conversation.label.send-correction") },
  { value: "request", label: t("conversation.label.send-request") },
] as const;

export function AgentComposer(props: AgentComposerProps): ReactNode {
  const { draft, working, locked, tooLong, offline, contexts, picker } = props;
  const input = useRef<HTMLTextAreaElement>(null);
  // 쉬는 중에는 고칠 일이 없어 draft.mode가 correction으로 남아 있어도 새 요청으로 보낸다.
  const mode: SendMode = working ? draft.mode : "request";
  const canSend = !locked && !offline && !tooLong &&
    (draft.text.trim().length > 0 || contexts.length > 0);

  // 다시 열 때 커서를 돌려놓는다. focus는 옮기지 않는다(workspace#R13).
  useLayoutEffect(() => {
    const element = input.current;
    if (!element) return;
    const [start, end] = draft.selection;
    const max = element.value.length;
    element.setSelectionRange(Math.min(start, max), Math.min(end, max));
    // 처음 그릴 때만 돌려놓는다. 그 뒤 커서는 사람이 움직인다.
  }, []);

  const keepSelection = () => {
    const element = input.current;
    if (!element) return;
    props.onDraft({
      selection: [element.selectionStart, element.selectionEnd],
    });
  };

  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing
    ) {
      return;
    }
    event.preventDefault();
    if (canSend) props.onSend(mode);
  };

  return (
    <div className={styles.composer} data-agent-composer="">
      {offline
        ? <p className={styles.note}>{t("conversation.notice.offline")}</p>
        : null}
      <div className={styles.boxWrap}>
        {props.slashMenu === null
          ? null
          : <div className={styles.slash}>{props.slashMenu}</div>}
        <div
          className={styles.box}
          data-composer-box=""
          data-locked={locked || undefined}
        >
          {contexts.length === 0
            ? null
            : (
              <div className={styles.chips} data-composer-contexts="">
                {contexts.map((context) => (
                  <span
                    key={context.id}
                    className={styles.chip}
                    data-context-chip=""
                  >
                    <Icon
                      icon={workspaceIcons.document}
                      pixels={iconPixels("small")}
                    />
                    <span className={styles.chipText}>{context.label}</span>
                    <IconButton
                      icon={conversationIcons.removeContext}
                      label={t("conversation.button.remove-context")}
                      size="sm"
                      onClick={() => props.onRemoveContext(context.id)}
                    />
                  </span>
                ))}
              </div>
            )}
          <textarea
            ref={input}
            className={styles.input}
            rows={2}
            aria-label={t("conversation.label.composer-message")}
            value={draft.text}
            placeholder={props.hint}
            readOnly={locked}
            data-composer-input=""
            onChange={(event) =>
              props.onDraft({
                text: event.currentTarget.value,
                selection: [
                  event.currentTarget.selectionStart,
                  event.currentTarget.selectionEnd,
                ],
              })}
            onSelect={keepSelection}
            onKeyDown={keyDown}
          />
          {tooLong
            ? (
              <p className={styles.problem} data-too-long="" role="status">
                {t("conversation.error.too-long")}
              </p>
            )
            : null}
          <div className={styles.row} data-composer-row="">
            <IconButton
              icon={conversationIcons.attach}
              label={t("conversation.button.attach")}
              size="sm"
              onClick={props.onAttach}
            />
            <span className={styles.spacer} />
            <ModelPicker {...picker} />
            {working
              ? (
                <>
                  <div className={styles.sendMode} data-send-mode="">
                    <Field label={t("conversation.label.send-mode")}>
                      <Select
                        size="sm"
                        options={SEND_MODES}
                        value={draft.mode}
                        onValueChange={(next) =>
                          props.onDraft({ mode: next as SendMode })}
                      />
                    </Field>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={conversationIcons.stop}
                    data-stop=""
                    disabled={offline}
                    onClick={props.onStop}
                  >
                    {t("conversation.button.stop")}
                  </Button>
                </>
              )
              : (
                <IconButton
                  icon={conversationIcons.send}
                  label={t("conversation.button.send")}
                  variant="secondary"
                  size="sm"
                  data-send=""
                  disabled={!canSend}
                  onClick={() => props.onSend(mode)}
                />
              )}
          </div>
        </div>
      </div>
      <div className={styles.scope} data-composer-scope="">
        <span className={styles.place} data-place-kind={props.place.kind}>
          <Icon
            icon={props.place.kind === "app"
              ? workspaceIcons.appPanel
              : workspaceIcons.folder}
            pixels={iconPixels("small")}
          />
          {props.place.name}
        </span>
        <Button
          size="sm"
          variant="ghost"
          data-composer-permissions=""
          onClick={props.onOpenPermissions}
        >
          {props.permissionSummary}
          <Icon icon={conversationIcons.expand} pixels={iconPixels("base")} />
        </Button>
      </div>
    </div>
  );
}

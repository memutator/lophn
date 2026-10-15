// Agent 탭의 composer. 입력칸 안 아래 줄에 [+]·[model · option ▾]·[Stop]·[↑], 입력칸 밖 아래 줄에 project(또는 앱)
// 표시와 권한 요약 ▾, 입력칸 위에 떼어 낼 수 있는 context chip이 있다. agent를 고르는 칸은 없다(session 안에서
// agent를 바꾸지 않는다). 보내기 방식을 고르는 menu도 없다. 일하는 중 보낸 메시지는 다음 turn을 기다리고, 도는
// turn에 올리는 일은 `QueuedMessages`의 [Send now]가 한다. `/`로 시작하는 글은 명령 창이 맡는다.
import {
  type KeyboardEvent,
  type ReactNode,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  Button,
  Icon,
  IconButton,
  iconPixels,
  Popover,
} from "@lophn/design/components";
import { t } from "@lophn/wording";

import {
  conversationIcons,
  lophnSpaceIcons,
  workspaceIcons,
} from "../../icons/mod.ts";
import type {
  AgentTabSource,
  PermissionsView as PermissionsData,
} from "../agent-tab-source.ts";
import type { Draft } from "../drafts.ts";
import { ModelPicker } from "../model-picker/model-picker.tsx";
import { PermissionsView } from "../permissions-view/permissions-view.tsx";
import type { SlashEntryView } from "../slash-menu/types.ts";
import { useModelPicker } from "../use-model-picker.ts";
import { useSlashMenu } from "../use-slash-menu.tsx";
import styles from "./session-composer.module.css";
import type { ContextChipView } from "./types.ts";

export type { ContextChipView } from "./types.ts";

export interface AgentComposerProps {
  /** model 단추·picker와 `/` 명령 창이 읽는 통로. */
  source: Pick<
    AgentTabSource,
    | "commands"
    | "model"
    | "chooseModel"
    | "setModelOption"
    | "toggleFavorite"
  >;
  /** null이면 아직 만들지 않은 새 session이다. */
  session: string | null;
  agentName: string;
  /** 입력 중인 글과 커서. 세션 메모리에 남는 값이다. */
  draft: Pick<Draft, "text" | "selection">;
  /** 일하는 중이다(turn이 돌거나 질문·승인을 기다림). 보낸 글은 다음 turn을 기다리고 [Stop]이 보인다. */
  working: boolean;
  /** 보내는 중이거나 결과를 모르는 말이 있으면 글을 고치지 못한다. */
  locked: boolean;
  /** 글이 본문 상한을 넘는다. 보내지 못한다. */
  tooLong: boolean;
  /** 연결이 끊겨 지금은 보낼 수 없다. 글은 그대로 쓸 수 있다. */
  offline: boolean;
  /** archive한 session이다. 입력칸 없이 안내 한 줄만 둔다. */
  readOnly: boolean;
  /** 글이 비어 있을 때 입력칸에 보이는 안내. */
  hint?: string;
  /** 입력칸 위 context chip. 위반을 붙였으면 파일과 어긴 규칙도 보인다. 없으면 줄이 없다. */
  chip: ContextChipView | null;
  /** 입력칸 밖 아래 줄의 자리. 프로젝트 또는 앱 하나다. */
  place: { readonly kind: "project" | "app"; readonly name: string };
  /** agent grant 요약 한 줄. */
  permissionSummary: string;
  /** 권한 요약을 열 때 보이는 보기. 읽기 전에는 null이다. */
  permissions: PermissionsData | null;
  onDraft: (patch: Partial<Pick<Draft, "text" | "selection">>) => void;
  /** chip의 ✕. 뗀다. 보내기 전에는 아무것도 보내지 않는다. */
  onRemoveChip: () => void;
  onAttach: () => void;
  /** 권한 요약을 열었다. host가 `permissions`를 읽는다. */
  onLoadPermissions: () => void;
  /** 권한 보기의 [Edit in Agents]. */
  onEditPermissions: () => void;
  /** 글이나 chip을 보낸다. 일하는 중이면 다음 turn을 기다리는 줄이 된다. */
  onSend: () => void;
  onStop: () => void;
  /** `/` 창에서 명령을 골랐거나 `/이름 인자`를 보냈다. recap처럼 보기를 여는 명령은 host가 연다. */
  onCommand: (entry: SlashEntryView, argument: string) => void;
  /** model·명령 목록을 읽지 못했다. */
  onProblem: () => void;
  /** model picker의 "Change defaults…". */
  onChangeDefaults: () => void;
}

export function AgentComposer(props: AgentComposerProps): ReactNode {
  if (props.readOnly) {
    return (
      <div className={styles.composer} data-agent-composer="">
        <p className={styles.readOnly} data-read-only="">
          <Icon icon={lophnSpaceIcons.archive} pixels={iconPixels("base")} />
          {t("conversation.notice.session-archived")}
        </p>
      </div>
    );
  }
  return <OpenComposer {...props} />;
}

function OpenComposer(props: AgentComposerProps): ReactNode {
  const { draft, working, locked, tooLong, offline, chip } = props;
  const input = useRef<HTMLTextAreaElement>(null);
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  const picker = useModelPicker({
    source: props.source,
    session: props.session,
    onProblem: props.onProblem,
    onChangeDefaults: props.onChangeDefaults,
  });
  const slash = useSlashMenu({
    source: props.source,
    session: props.session,
    text: draft.text,
    agentName: props.agentName,
    working,
    onRun: props.onCommand,
    onProblem: props.onProblem,
  });
  const canSend = !locked && !offline && !tooLong &&
    (draft.text.trim().length > 0 || chip !== null);

  // 다시 열 때 커서를 돌려놓는다. focus는 옮기지 않는다.
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

  const send = () => {
    if (!canSend) return;
    if (draft.text.startsWith("/")) void slash.submit();
    else props.onSend();
  };

  const keyDown = (event: KeyboardEvent<HTMLElement>) => {
    slash.onKeyDown(event);
    if (event.defaultPrevented) return;
    if (
      event.key !== "Enter" || event.shiftKey ||
      event.nativeEvent.isComposing ||
      !(event.target as HTMLElement).matches("[data-composer-input]")
    ) {
      return;
    }
    event.preventDefault();
    send();
  };

  return (
    <div
      className={styles.composer}
      data-agent-composer=""
      onKeyDown={keyDown}
    >
      {offline
        ? <p className={styles.note}>{t("conversation.notice.offline")}</p>
        : null}
      <div className={styles.boxWrap}>
        {slash.menu === null
          ? null
          : <div className={styles.slash}>{slash.menu}</div>}
        <div
          className={styles.box}
          data-composer-box=""
          data-locked={locked || undefined}
        >
          {chip === null
            ? null
            : (
              <div className={styles.chips} data-composer-contexts="">
                <span className={styles.chip} data-context-chip="">
                  <Icon
                    icon={workspaceIcons.document}
                    pixels={iconPixels("small")}
                  />
                  <span className={styles.chipText}>{chip.label}</span>
                  {chip.violation === undefined ? null : (
                    <>
                      <span className={styles.chipDetail} data-chip-file="">
                        {chip.violation.file}
                      </span>
                      <span className={styles.chipDetail} data-chip-rule="">
                        {chip.violation.rule}
                      </span>
                    </>
                  )}
                  <IconButton
                    icon={conversationIcons.removeContext}
                    label={t("conversation.button.remove-context")}
                    size="sm"
                    onClick={props.onRemoveChip}
                  />
                </span>
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
          />
          {tooLong
            ? (
              <p className={styles.problem} data-too-long="" role="status">
                {t("conversation.error.too-long")}
              </p>
            )
            : null}
          {working && slash.menu === null
            ? (
              <p className={styles.working} data-working-note="">
                {t("conversation.notice.working-next-turn", {
                  agent: props.agentName,
                })}
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
              )
              : null}
            <IconButton
              icon={conversationIcons.send}
              label={t("conversation.button.send")}
              variant="secondary"
              size="sm"
              data-send=""
              disabled={!canSend}
              onClick={send}
            />
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
        <Popover
          open={permissionsOpen}
          onOpenChange={(next) => {
            setPermissionsOpen(next);
            if (next) props.onLoadPermissions();
          }}
          placement="beside"
          trigger={
            <Button size="sm" variant="ghost" data-composer-permissions="">
              {props.permissionSummary}
              <Icon
                icon={conversationIcons.expand}
                pixels={iconPixels("base")}
              />
            </Button>
          }
        >
          {props.permissions === null ? null : (
            <PermissionsView
              agent={props.agentName}
              permissions={props.permissions}
              popover
              onEdit={props.onEditPermissions}
            />
          )}
        </Popover>
      </div>
    </div>
  );
}

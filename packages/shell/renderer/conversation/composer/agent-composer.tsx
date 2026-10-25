// Agent 탭의 composer. 입력칸 안 아래 줄에 [+]·[model · option ▾]·[Stop]·[↑], 입력칸 밖 아래 줄에 project(또는 앱)
// 표시와 권한 요약 ▾(열린 session이면 줄 오른쪽 끝에 Skip permissions 스위치), 입력칸 안 글 위에 뗄 수 있는 첨부 줄이
// 있다. 첨부는 [+]로 고르거나 OS 파일·Explorer 파일을 끌어 놓거나 붙여 넣는다. 입력칸은 글을 따라 정한 높이까지
// 자란다. agent를 고르는 칸은 없다(session 안에서
// agent를 바꾸지 않는다). 보내기 방식을 고르는 menu도 없다. 일하는 중 보낸 메시지는 다음 turn을 기다리고, 도는
// turn에 올리는 일은 `QueuedMessages`의 [Send now]가 한다. `/`로 시작하는 글은 명령 창이 맡는다.
import {
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Button, Icon, IconButton } from "@lophn/ui/primitives";
import { Switch } from "@lophn/ui/input";
import { Popover, Tooltip } from "@lophn/ui/overlay";
import { iconPixels } from "@lophn/ui/shared";
import { t } from "@lophn/wording";

import {
  commonIcons,
  conversationIcons,
  workspaceIcons,
} from "../../icons/mod.ts";
import type {
  AgentTabSource,
  PermissionsView as PermissionsData,
} from "../agent-tab-source.ts";
import type { Draft } from "../drafts.ts";
import {
  type Attachment,
  attachmentsOf,
  withAttachments,
} from "../attachments.ts";
import { PATH_DRAG_TYPE } from "../../workspace/drag.ts";
import { AttachmentChips } from "./attachment-chips.tsx";
import { ModelPicker } from "../model-picker/model-picker.tsx";
import { PermissionsView } from "../permissions-view/permissions-view.tsx";
import type { SlashEntryView } from "../slash-menu/types.ts";
import { useModelPicker } from "../use-model-picker.ts";
import { useSlashMenu } from "../use-slash-menu.tsx";
import styles from "./agent-composer.module.css";

const IMAGE_PATH = /\.(png|jpe?g|gif|webp)$/i;

interface AgentComposerProps {
  /** model 단추·picker와 `/` 명령 창이 읽는 통로. */
  source: Pick<
    AgentTabSource,
    | "commands"
    | "model"
    | "chooseModel"
    | "setModelOption"
  >;
  /** null이면 아직 만들지 않은 새 session이다. */
  session: string | null;
  agentName: string;
  /** 입력 중인 글과 커서와 첨부. 세션 메모리에 남는 값이다. */
  draft: Pick<Draft, "text" | "selection" | "attachments">;
  /** OS 파일의 절대 경로. 경로가 없는 파일이면 null이다. 없으면 이미지만 붙는다. */
  pathOf?: (file: File) => string | null;
  /** Explorer에서 끌어 온 이미지 파일을 읽는다. 없거나 읽지 못하면 경로 chip으로 붙는다. */
  readImage?: (path: string) => Promise<File | null>;
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
  /** 입력칸 밖 아래 줄의 자리. 프로젝트 또는 앱 하나다. */
  place: { readonly kind: "project" | "app"; readonly name: string };
  /** 할당 요약 한 줄. */
  permissionSummary: string;
  /** 권한 요약을 열 때 보이는 보기. 읽기 전에는 null이다. */
  permissions: PermissionsData | null;
  /** 이 session의 skip(묻지 않고 실행). 주면 아래 줄 오른쪽 끝에 스위치를 그린다. 아직 없는 session과 archive한 session에는 주지 않는다. */
  skip?: { readonly on: boolean; readonly onChange: (on: boolean) => void };
  onDraft: (
    patch: Partial<Pick<Draft, "text" | "selection" | "attachments">>,
  ) => void;
  /** 권한 요약을 열었다. host가 `permissions`를 읽는다. */
  onLoadPermissions: () => void;
  /** 권한 보기의 [Edit in Agents]. */
  onEditPermissions: () => void;
  /** 글이나 chip을 보낸다. 일하는 중이면 다음 turn을 기다리는 줄이 된다. */
  onSend: () => void;
  onStop: () => void;
  /** `/` 창에서 명령을 골랐거나 `/이름 인자`를 보냈다. permissions처럼 보기를 여는 명령은 host가 연다. */
  onCommand: (entry: SlashEntryView, argument: string) => void;
  /** model·명령 목록을 읽지 못했다. */
  onProblem: () => void;
}

export function AgentComposer(props: AgentComposerProps): ReactNode {
  if (props.readOnly) {
    return (
      <div className={styles.composer} data-agent-composer="">
        <p className={styles.readOnly} data-read-only="">
          <Icon icon={commonIcons.archive} pixels={iconPixels("base")} />
          {t("conversation.notice.session-archived")}
        </p>
      </div>
    );
  }
  return <OpenComposer {...props} />;
}

function OpenComposer(props: AgentComposerProps): ReactNode {
  const { draft, working, locked, tooLong, offline } = props;
  const input = useRef<HTMLTextAreaElement>(null);
  const picker_ = useRef<HTMLInputElement>(null);
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  // 끌어 놓는 중이다. 입력칸 테두리로 보인다.
  const [dropping, setDropping] = useState(false);
  // 붙이지 못한 파일(경로 없음, 너무 큰 이미지)이 있었다. 다음 첨부까지 남는다.
  const [skipped, setSkipped] = useState(false);
  const picker = useModelPicker({
    source: props.source,
    session: props.session,
    onProblem: props.onProblem,
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
    (draft.text.trim().length > 0 || draft.attachments.length > 0);

  const attach = (added: readonly Attachment[], missed: number) => {
    setSkipped(missed > 0);
    if (added.length === 0) return;
    props.onDraft({
      attachments: withAttachments(draft.attachments, added),
    });
  };
  const attachFiles = (files: readonly File[]) => {
    const { attachments, skipped } = attachmentsOf(
      files,
      props.pathOf ?? (() => null),
      (image) => URL.createObjectURL(image),
    );
    attach(attachments, skipped);
  };
  const remove = (item: Attachment) => {
    if (item.kind === "image") URL.revokeObjectURL(item.url);
    props.onDraft({
      attachments: draft.attachments.filter((other) => other !== item),
    });
  };

  // 글을 따라 높이를 맞춘다. 정한 높이를 넘으면 CSS max-height에서 멈추고 안에서 scroll한다.
  useLayoutEffect(() => {
    const element = input.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, [draft.text]);

  const dragOver = (event: DragEvent<HTMLElement>) => {
    const types = event.dataTransfer.types;
    if (
      locked || (!types.includes(PATH_DRAG_TYPE) && !types.includes("Files"))
    ) {
      return;
    }
    // 칸이 같은 파일을 탭으로 열지 않게 여기서 멈춘다.
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
    setDropping(true);
  };
  const drop = (event: DragEvent<HTMLElement>) => {
    setDropping(false);
    if (locked) return;
    const path = event.dataTransfer.getData(PATH_DRAG_TYPE);
    const files = [...event.dataTransfer.files];
    if (path === "" && files.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    if (path === "") attachFiles(files);
    else void attachPath(path);
  };
  // 이미지 파일은 붙여 넣은 이미지처럼 그림으로 붙고, 그 밖은 경로 chip이다.
  const attachPath = async (path: string) => {
    const image = IMAGE_PATH.test(path) && props.readImage !== undefined
      ? await props.readImage(path)
      : null;
    if (image === null) attach([{ kind: "file", path }], 0);
    else attachFiles([image]);
  };

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
          data-drop={dropping || undefined}
          onDragOver={dragOver}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node)) {
              setDropping(false);
            }
          }}
          onDrop={drop}
        >
          <AttachmentChips
            attachments={draft.attachments}
            {...(locked ? {} : { onRemove: remove })}
          />
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
            onPaste={(event) => {
              const files = [...event.clipboardData.files];
              if (files.length === 0 || locked) return;
              event.preventDefault();
              attachFiles(files);
            }}
          />
          {skipped
            ? (
              <p
                className={styles.problem}
                data-attach-skipped=""
                role="status"
              >
                {t("conversation.error.attach-skipped")}
              </p>
            )
            : null}
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
            <Tooltip content={t("conversation.button.attach")}>
              <IconButton
                icon={conversationIcons.attach}
                label={t("conversation.button.attach")}
                variant="ghost"
                size="sm"
                data-attach=""
                disabled={locked}
                onClick={() => picker_.current?.click()}
              />
            </Tooltip>
            <input
              ref={picker_}
              type="file"
              multiple
              hidden
              onChange={(event) => {
                attachFiles([...(event.currentTarget.files ?? [])]);
                event.currentTarget.value = "";
              }}
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
        {props.skip === undefined
          ? null
          : (
            <span className={styles.skip} data-composer-skip="">
              <Switch
                label={t("conversation.label.skip-permissions")}
                size="sm"
                checked={props.skip.on}
                onCheckedChange={props.skip.onChange}
              />
            </span>
          )}
      </div>
    </div>
  );
}

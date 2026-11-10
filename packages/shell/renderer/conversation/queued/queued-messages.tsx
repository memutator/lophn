// agent가 일하는 중 보낸 메시지가 dock의 Queue card 안에 쌓이는 줄. 기본은 다음 turn에 들어가고, 줄 오른쪽 끝의
// [Send now]를 누르면 도는 turn에 steer로 들어가 대화에 steer 표시가 붙는다. 보낸 뒤 마음이 바뀌면 글을
// 고치거나 순서를 바꾸거나 줄을 뺀다. 글은 줄을 눌러 그 자리에서 고친다(Enter 저장, Esc 취소).
import {
  type KeyboardEvent,
  type ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";
import { Button, Icon, IconButton } from "@lophn/ui/primitives";
import { iconPixels } from "@lophn/ui/shared";
import { t } from "@lophn/i18n";

import {
  actionIcons,
  conversationIcons,
  workspaceIcons,
} from "../../icons/mod.ts";
import type { QueuedView } from "../agent-tab-source.ts";
import styles from "./queued-messages.module.css";

interface QueuedMessagesProps {
  items: readonly QueuedView[];
  /** 그 줄을 도는 turn에 steer로 올린다. */
  onSendNow: (id: string) => void;
  onRemove: (id: string) => void;
  /** 그 줄의 글을 고친다. */
  onEdit: (id: string, text: string) => void;
  /** 그 줄을 큐 안에서 위아래로 옮긴다. */
  onMove: (id: string, direction: "up" | "down") => void;
  /** 줄의 단추를 막는다. core 통로가 끊겼을 때 host가 켠다. */
  disabled?: boolean;
  /** `capabilities.steer`. 꺼져 있으면 [Send now]가 없다. 기본은 true다. */
  canSteer?: boolean;
  /** `capabilities.queue_edit`. 꺼져 있으면 글 고치기·옮기기·빼기가 없다. 기본은 true다. */
  canEdit?: boolean;
  /** 보냈지만 아직 줄에 오지 않은 말. 줄 끝에 흐리게 서고 누를 것이 없다. */
  pending?: { readonly id: string; readonly summary: string } | null;
}

export function QueuedMessages({
  items,
  onSendNow,
  onRemove,
  onEdit,
  onMove,
  disabled,
  canSteer = true,
  canEdit = true,
  pending = null,
}: QueuedMessagesProps): ReactElement | null {
  const [editing, setEditing] = useState<string | null>(null);
  const [text, setText] = useState("");
  const editor = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing === null) return;
    const element = editor.current;
    if (element === null) return;
    element.focus();
    element.setSelectionRange(element.value.length, element.value.length);
  }, [editing]);

  // 보내거나 뺀 줄이 사라지면 고치던 상태도 접는다.
  useEffect(() => {
    if (editing !== null && !items.some((item) => item.id === editing)) {
      setEditing(null);
      setText("");
    }
  }, [items, editing]);

  if (items.length === 0 && pending === null) return null;

  const stop = () => {
    setEditing(null);
    setText("");
  };

  const save = (id: string) => {
    const item = items.find((one) => one.id === id);
    if (item === undefined || text.trim() === "") {
      stop();
      return;
    }
    if (item.text !== text) onEdit(id, text);
    stop();
  };

  const editKeyDown = (
    event: KeyboardEvent<HTMLTextAreaElement>,
    id: string,
  ) => {
    // 조합 중인 글자를 저장하거나 취소하지 않는다(composer와 같은 보호).
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      stop();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      save(id);
    }
  };

  return (
    <ul
      className={styles.queued}
      aria-label={t("conversation.label.queued-messages")}
      data-queued=""
    >
      {items.map((item, index) => {
        const editingThis = editing === item.id;
        return (
          <li key={item.id} className={styles.row} data-queued-row="">
            <Icon
              icon={conversationIcons.request}
              pixels={iconPixels("small")}
              className={styles.icon}
            />
            <span className={styles.tag}>
              {t("conversation.label.next-turn")}
            </span>
            {editingThis ? (
              <textarea
                ref={editor}
                className={styles.editor}
                rows={2}
                aria-label={t("conversation.label.queued-edit-message", {
                  text: item.text,
                })}
                value={text}
                data-key-context="modal"
                onChange={(event) => setText(event.currentTarget.value)}
                onKeyDown={(event) => editKeyDown(event, item.id)}
              />
            ) : (
              <button
                type="button"
                className={styles.text}
                aria-label={t("conversation.label.queued-edit-message", {
                  text: item.summary,
                })}
                disabled={disabled || !canEdit}
                onClick={() => {
                  setEditing(item.id);
                  setText(item.text);
                }}
              >
                {item.summary}
              </button>
            )}
            {item.via === undefined ? null : (
              <span className={styles.viaMark} data-via={item.via}>
                {t("conversation.label.via", { app: item.via })}
              </span>
            )}
            {editingThis ? (
              <>
                <Button size="sm" variant="ghost" onClick={stop}>
                  {t("common.button.cancel")}
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  icon={actionIcons.save}
                  disabled={text.trim() === ""}
                  onClick={() => save(item.id)}
                >
                  {t("conversation.button.save")}
                </Button>
              </>
            ) : (
              <>
                {canEdit ? (
                  <>
                    <IconButton
                      icon={conversationIcons.moveUp}
                      label={t("conversation.button.queued-move-up")}
                      size="sm"
                      disabled={disabled || index === 0}
                      onClick={() => onMove(item.id, "up")}
                    />
                    <IconButton
                      icon={conversationIcons.moveDown}
                      label={t("conversation.button.queued-move-down")}
                      size="sm"
                      disabled={disabled || index === items.length - 1}
                      onClick={() => onMove(item.id, "down")}
                    />
                  </>
                ) : null}
                {canSteer ? (
                  <Button
                    size="sm"
                    icon={actionIcons.send}
                    disabled={disabled}
                    data-send-now=""
                    onClick={() => onSendNow(item.id)}
                  >
                    {t("conversation.button.send-now")}
                  </Button>
                ) : null}
                {canEdit ? (
                  <IconButton
                    icon={workspaceIcons.close}
                    label={t("conversation.button.queued-remove")}
                    size="sm"
                    disabled={disabled}
                    onClick={() => onRemove(item.id)}
                  />
                ) : null}
              </>
            )}
          </li>
        );
      })}
      {pending === null ? null : (
        <li
          key={pending.id}
          className={`${styles.row} ${styles.pending}`}
          data-queued-row=""
          data-pending=""
        >
          <Icon
            icon={conversationIcons.request}
            pixels={iconPixels("small")}
            className={styles.icon}
          />
          <span className={styles.tag}>
            {t("conversation.label.next-turn")}
          </span>
          <span className={styles.summary}>{pending.summary}</span>
        </li>
      )}
    </ul>
  );
}

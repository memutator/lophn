// Tasks 탭(flow manage-tickets, start-coding-agent). 목록은 Task 제목·상태·다음 행동이고, 상세는 [Start]·TUI
// 상태·복사할 요청 문장·검사·취소를 보인다. 사람이 새 Task를 만드는 입구도 여기다. 사람이 누르는 것이 허락이라
// 시작·취소·생성에는 확인 창이 없다(coding-agent/tickets#R22, sessions#R2). 문구는 coding-agent가 정한 상태
// 값을 wording key로 바꾼 것이다.
import { useState } from "react";
import {
  Button,
  type Clipboard,
  Field,
  Input,
  StatusMark,
  systemClipboard,
  Textarea,
} from "@lophn/design/components";
import { t } from "@lophn/wording";

import { Loadable } from "../loadable.tsx";
import { useRead } from "../use-read.ts";
import styles from "../app-detail.module.css";
import {
  nextText,
  stateText,
  stateTone,
  validBody,
  validTitle,
} from "./model.ts";
import { TaskDetailView } from "./task-detail.tsx";
import type { TaskRow, TasksSource } from "./source.ts";

export interface TasksTabProps {
  app: string;
  source: TasksSource;
  now: () => Date;
  /** 복사할 요청 문장을 쓰는 곳. 테스트가 바꿔 끼운다. */
  clipboard?: Clipboard;
  /** 열 때 고를 Task(`lophn://things-to-confirm/<tkt id>` 링크). */
  initialTask?: string | null;
  /** 열 때 새 Task 입력을 펼칠지(`lophn://things-to-confirm/<app id>` 링크). */
  initialCreate?: boolean;
}

export function TasksTab(
  {
    app,
    source,
    now,
    clipboard = systemClipboard,
    initialTask = null,
    initialCreate = false,
  }: TasksTabProps,
) {
  const [selected, setSelected] = useState<string | null>(initialTask);
  return (
    <div className={styles.tab} data-tab-body="tasks">
      {selected === null
        ? (
          <TaskList
            app={app}
            source={source}
            now={now}
            initialCreate={initialCreate}
            onOpen={setSelected}
          />
        )
        : (
          <TaskDetailView
            app={app}
            ticket={selected}
            source={source}
            now={now}
            clipboard={clipboard}
            onBack={() => setSelected(null)}
          />
        )}
    </div>
  );
}

function TaskList(
  { app, source, now, initialCreate, onOpen }: {
    app: string;
    source: TasksSource;
    now: () => Date;
    initialCreate: boolean;
    onOpen: (ticket: string) => void;
  },
) {
  const tasks = useRead(() => source.list(app), [app, source], { now });
  const [creating, setCreating] = useState(initialCreate);
  return (
    <>
      <div className={styles.actions}>
        <Button
          size="sm"
          data-action="new-task"
          aria-expanded={creating}
          onClick={() => setCreating(!creating)}
        >
          {t("app-detail.button.new-task")}
        </Button>
      </div>
      {creating
        ? (
          <CreateForm
            app={app}
            source={source}
            onCancel={() => setCreating(false)}
            onCreated={(ticket) => {
              setCreating(false);
              tasks.reload();
              onOpen(ticket);
            }}
          />
        )
        : null}
      <Loadable
        read={tasks}
        target={t("app-detail.label.tasks-target")}
        now={now}
      >
        {(rows) =>
          rows.length === 0
            ? (
              <p className={styles.state} data-tasks-empty="">
                {t("app-detail.note.tasks-empty")}
              </p>
            )
            : (
              <ul className={styles.list} data-tasks-list="">
                {rows.map((row) => (
                  <TaskItem key={row.id} row={row} onOpen={onOpen} />
                ))}
              </ul>
            )}
      </Loadable>
    </>
  );
}

function TaskItem(
  { row, onOpen }: { row: TaskRow; onOpen: (ticket: string) => void },
) {
  return (
    <li className={styles.row} data-task={row.state}>
      <div className={styles.rowHead}>
        <button
          type="button"
          className={`${styles.title} ${styles.link}`}
          data-task-open=""
          onClick={() => onOpen(row.id)}
        >
          {row.title}
        </button>
        <StatusMark tone={stateTone(row.state)} label={stateText(row.state)} />
      </div>
      {row.next === null
        ? null
        : (
          <p className={styles.text} data-task-next={row.next}>
            {nextText(row.next)}
          </p>
        )}
    </li>
  );
}

// 사람이 하는 말은 제목·원하는 결과·이유뿐이다. 채택·조건은 접수가 정리하므로 양식을 채우게 하지 않고
// 준비 중으로 만든다.
function CreateForm(
  { app, source, onCancel, onCreated }: {
    app: string;
    source: TasksSource;
    onCancel: () => void;
    onCreated: (ticket: string) => void;
  },
) {
  const [title, setTitle] = useState("");
  const [what, setWhat] = useState("");
  const [why, setWhy] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "failed">("idle");
  const valid = validTitle(title) && validBody(what) && validBody(why);

  async function create(): Promise<void> {
    if (!valid) return;
    setState("busy");
    const result = await source.create(app, {
      title: title.trim(),
      what: what.trim(),
      why: why.trim(),
    });
    if (result.ok) onCreated(result.value.ticket);
    else setState("failed");
  }

  return (
    <form
      className={styles.section}
      data-create-form=""
      onSubmit={(event) => {
        event.preventDefault();
        void create();
      }}
    >
      <Field label={t("app-detail.label.create-title")}>
        <Input
          value={title}
          autoComplete="off"
          data-create-title=""
          onChange={(event) => setTitle(event.currentTarget.value)}
        />
      </Field>
      <Field label={t("app-detail.label.create-what")}>
        <Textarea
          value={what}
          data-create-what=""
          onChange={(event) => setWhat(event.currentTarget.value)}
        />
      </Field>
      <Field label={t("app-detail.label.create-why")}>
        <Textarea
          value={why}
          data-create-why=""
          onChange={(event) => setWhy(event.currentTarget.value)}
        />
      </Field>
      <p className={styles.muted}>{t("app-detail.note.create")}</p>
      <div className={styles.actions}>
        <Button
          size="sm"
          type="submit"
          variant="primary"
          data-action="create-task"
          disabled={!valid || state === "busy"}
        >
          {t("app-detail.button.create-task")}
        </Button>
        <Button
          size="sm"
          type="button"
          variant="ghost"
          data-action="cancel-create"
          onClick={onCancel}
        >
          {t("app-detail.button.cancel-create")}
        </Button>
      </div>
      {state === "failed"
        ? (
          <p className={styles.warning} role="alert" data-create-failed="">
            {t("app-detail.error.create-failed")}
          </p>
        )
        : null}
    </form>
  );
}

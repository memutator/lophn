// ticket [Start](flow start-coding-agent 2, manage-tickets 2·5). 누르는 것이 허락이라 확인 창이 없다. harness·
// 연결·폴더는 사람이 고르고, 값이 하나뿐이면 미리 골라 둔다. 등록된 project 폴더가 여럿이면 폴더를 고른 뒤에야
// 누를 수 있다. 시작하지 못하면 이유 한 문장만 보이고 다른 harness·폴더로 바꿔 시작하지 않는다.
import { type ReactNode, useState } from "react";
import { Button } from "@lophn/design/components";
import { t } from "@lophn/wording";

import { harnessName } from "../../../desktop/lophn-space/settings/connections/model.ts";
import { Loadable } from "../loadable.tsx";
import { useRead } from "../use-read.ts";
import styles from "../app-detail.module.css";
import { startErrorText } from "./model.ts";
import type { StartChoices, StartOutcome, TaskDetail, TasksSource } from "./source.ts";

export interface StartPanelProps {
  app: string;
  task: TaskDetail;
  source: TasksSource;
  now: () => Date;
  /** 시작을 접수한 뒤. 화면이 TUI 상태를 다시 읽는다. */
  onStarted: () => void;
}

function Choice<T>(
  { label, options, chosen, onChoose, kind }: {
    label: string;
    options: readonly { key: string; text: string; value: T }[];
    chosen: string | null;
    onChoose: (key: string, value: T) => void;
    kind: string;
  },
): ReactNode {
  return (
    <div className={styles.section} data-start-choice={kind}>
      <h5 className={styles.heading}>{label}</h5>
      <div className={styles.actions}>
        {options.map((option) => (
          <Button
            key={option.key}
            size="sm"
            variant={chosen === option.key ? "primary" : "secondary"}
            aria-pressed={chosen === option.key}
            data-start-option=""
            onClick={() => onChoose(option.key, option.value)}
          >
            {option.text}
          </Button>
        ))}
      </div>
    </div>
  );
}

export function StartPanel(
  { app, task, source, now, onStarted }: StartPanelProps,
) {
  const choices = useRead(() => source.startChoices(app), [app, source], {
    now,
  });
  return (
    <section className={styles.section} data-section="start">
      <h5 className={styles.heading}>{t("app-detail.heading.task-start")}</h5>
      <Loadable
        read={choices}
        target={t("app-detail.label.tasks-target")}
        now={now}
      >
        {(value) => (
          <StartForm
            task={task}
            source={source}
            choices={value}
            onStarted={onStarted}
          />
        )}
      </Loadable>
    </section>
  );
}

type Press =
  | { readonly state: "idle" }
  | { readonly state: "starting" }
  | { readonly state: "started" }
  | { readonly state: "refused"; readonly outcome: Extract<StartOutcome, { ok: false }> }
  | { readonly state: "failed" };

function StartForm(
  { task, source, choices, onStarted }: {
    task: TaskDetail;
    source: TasksSource;
    choices: StartChoices;
    onStarted: () => void;
  },
) {
  const [harness, setHarness] = useState<string | null>(
    choices.harnesses.length === 1 ? choices.harnesses[0]!.id : null,
  );
  const [connection, setConnection] = useState<string | null>(
    choices.connections.length === 1 ? choices.connections[0]!.id : null,
  );
  const [folder, setFolder] = useState<string | null>(
    choices.folders.length === 1 ? choices.folders[0]!.folder_ref : null,
  );
  const [press, setPress] = useState<Press>({ state: "idle" });

  if (choices.harnesses.length === 0) {
    return (
      <p className={styles.muted} data-start-missing="harness">
        {t("app-detail.note.start-no-harness")}
      </p>
    );
  }
  if (choices.connections.length === 0) {
    return (
      <p className={styles.muted} data-start-missing="connection">
        {t("app-detail.note.start-no-connection")}
      </p>
    );
  }
  if (choices.folders.length === 0) {
    return (
      <p className={styles.muted} data-start-missing="folder">
        {t("app-detail.note.start-no-folder")}
      </p>
    );
  }

  const chosenHarness = choices.harnesses.find((item) => item.id === harness);
  const chosenFolder = choices.folders.find((item) => item.folder_ref === folder);
  const ready = chosenHarness !== undefined && connection !== null &&
    chosenFolder !== undefined;

  async function start(): Promise<void> {
    if (
      chosenHarness === undefined || connection === null ||
      chosenFolder === undefined
    ) return;
    setPress({ state: "starting" });
    const result = await source.start({
      ticket: task.id,
      revision: task.revision,
      connection,
      harness: chosenHarness.id,
      profile: chosenHarness.profile,
      project: chosenFolder.project,
      folderRef: chosenFolder.folder_ref,
    });
    if (!result.ok) setPress({ state: "failed" });
    else if (result.value.ok) {
      setPress({ state: "started" });
      onStarted();
    } else setPress({ state: "refused", outcome: result.value });
  }

  return (
    <>
      {choices.harnesses.length > 1
        ? (
          <Choice
            kind="harness"
            label={t("app-detail.label.start-harness")}
            chosen={harness}
            onChoose={(key) => setHarness(key)}
            options={choices.harnesses.map((item) => ({
              key: item.id,
              text: harnessName(item.id),
              value: item.id,
            }))}
          />
        )
        : null}
      {choices.connections.length > 1
        ? (
          <Choice
            kind="connection"
            label={t("app-detail.label.start-connection")}
            chosen={connection}
            onChoose={(key) => setConnection(key)}
            options={choices.connections.map((item) => ({
              key: item.id,
              text: item.label,
              value: item.id,
            }))}
          />
        )
        : null}
      {choices.folders.length > 1
        ? (
          <Choice
            kind="folder"
            label={t("app-detail.label.start-folder")}
            chosen={folder}
            onChoose={(key) => setFolder(key)}
            options={choices.folders.map((item) => ({
              key: item.folder_ref,
              text: t("app-detail.label.start-folder-option", {
                project: item.project_name,
                path: item.path,
              }),
              value: item.folder_ref,
            }))}
          />
        )
        : null}
      <p className={styles.muted} data-start-with="">
        {t("app-detail.note.start-with", {
          harness: chosenHarness === undefined
            ? t("app-detail.label.start-not-chosen")
            : harnessName(chosenHarness.id),
          folder: chosenFolder === undefined
            ? t("app-detail.label.start-not-chosen")
            : chosenFolder.path,
        })}
      </p>
      <div className={styles.actions}>
        <Button
          size="sm"
          variant="primary"
          data-action="start"
          disabled={!ready || press.state === "starting" ||
            press.state === "started"}
          onClick={() => void start()}
        >
          {t("app-detail.button.start")}
        </Button>
      </div>
      {press.state === "started"
        ? (
          <p className={styles.muted} role="status" data-start-result="started">
            {t("app-detail.note.start-opened")}
          </p>
        )
        : null}
      {press.state === "refused"
        ? (
          <p className={styles.warning} role="alert" data-start-result="refused">
            {press.outcome.ownTerminal
              ? t("app-detail.error.start-own-terminal")
              : startErrorText(press.outcome.reason)}
          </p>
        )
        : null}
      {press.state === "failed"
        ? (
          <p className={styles.warning} role="alert" data-start-result="failed">
            {t("app-detail.error.start-failed")}
          </p>
        )
        : null}
    </>
  );
}

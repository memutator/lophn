// Settings › Remote의 "Computers you view". 다른 기계의 lophn을 이 컴퓨터가 보려고 짝지은 목록이다: 붙여 넣은 pairing text로
// 짝짓고, 별명을 붙이고, 지우고, 시작 때 여는 기계를 고른다. 이 컴퓨터의 창에서만 그린다(다른 기계 창의 Settings는 자리 표시다).
// 지우면 다시 짝지어야 보여서 먼저 한 번 묻는다. 시작 기계를 지우면 그 일을 같이 알린다.
import { useState } from "react";
import { t } from "@lophn/i18n";
import { Field, Input, Select, Textarea } from "@lophn/ui/input";
import { Dialog } from "@lophn/ui/overlay";
import { Button } from "@lophn/ui/primitives";

import { actionIcons } from "../../../icons/mod.ts";
import { useMachines, useMachinesView } from "../../machines/context.tsx";
import type {
  MachineItem,
  MachinesSource,
  MachinesView,
  PairOutcome,
} from "../../machines/source.ts";
import { MachineStatus } from "../../machines/status.tsx";
import { NamedControl } from "../general/named-control.tsx";
import styles from "../settings.module.css";
import viewedStyles from "./viewed-machines.module.css";

const PAIR_ERRORS = {
  invalid_text: "machines.error.pair-invalid-text",
  unreachable: "machines.error.pair-unreachable",
  refused: "machines.error.pair-refused",
  expired: "machines.error.pair-expired",
  closed: "machines.error.pair-closed",
  this_computer: "machines.error.pair-this-computer",
  unavailable: "machines.error.pair-unavailable",
} as const;

const LAST = "last";

export function ViewedMachines() {
  const source = useMachines();
  const view = useMachinesView();
  if (source === null || view === null || source.thisWindow() !== null) {
    return null;
  }
  return (
    <section className={styles.groupBlock} data-machines-viewed={view.state}>
      <h2 className={styles.groupTitle}>{t("machines.heading.viewed")}</h2>
      {view.state === "starting" ? (
        <p className={styles.lineHelp}>{t("machines.notice.starting")}</p>
      ) : view.state === "unreadable" ? (
        <p className={styles.notice} data-machines-unreadable="">
          {t("machines.error.unreadable")}
        </p>
      ) : (
        <Ready source={source} view={view} />
      )}
    </section>
  );
}

function Ready({
  source,
  view,
}: {
  source: MachinesSource;
  view: MachinesView;
}) {
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [removing, setRemoving] = useState<MachineItem | null>(null);
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const [pairing, setPairing] = useState(false);
  const [pairFailed, setPairFailed] = useState<
    Extract<PairOutcome, { ok: false }>["reason"] | null
  >(null);
  const [paired, setPaired] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  async function act(run: Promise<{ ok: boolean }>): Promise<boolean> {
    const done = await run;
    setFailed(!done.ok);
    return done.ok;
  }

  async function pair(): Promise<void> {
    setPairing(true);
    setPaired(null);
    const outcome = await source.pair(text.trim());
    setPairing(false);
    if (!outcome.ok) {
      setPairFailed(outcome.reason);
      return;
    }
    setPairFailed(null);
    setAdding(false);
    setText("");
    setPaired(
      source.get().machines.find((one) => one.id === outcome.machine)?.name ??
        "",
    );
  }

  const startId = view.start.mode === "machine" ? view.start.machine : LAST;
  const startOptions = [
    { value: LAST, label: t("machines.option.last") },
    ...(view.thisComputer === null
      ? []
      : [{ value: view.thisComputer.id, label: view.thisComputer.name }]),
    ...view.machines
      .filter((one) => one.status !== "removed" || one.id === startId)
      .map((one) => ({ value: one.id, label: one.name })),
  ];

  return (
    <>
      <ul className={styles.lines} data-machines-list="">
        {view.machines.map((machine) =>
          renaming?.id === machine.id ? (
            <li
              key={machine.id}
              className={styles.line}
              data-machine-form={machine.id}
            >
              <div className={styles.lineMain}>
                <Field label={t("machines.label.name")}>
                  <Input
                    value={renaming.name}
                    placeholder={machine.announcedName ?? machine.name}
                    maxLength={64}
                    autoFocus
                    onChange={(event) =>
                      setRenaming({ id: machine.id, name: event.target.value })
                    }
                  />
                </Field>
              </div>
              <div className={styles.lineControl}>
                <div className={styles.actions}>
                  {machine.alias === null ? null : (
                    <Button
                      data-machine-use-own-name=""
                      onClick={() =>
                        void act(source.rename(machine.id, null)).then(
                          (done) => done && setRenaming(null),
                        )
                      }
                    >
                      {t("machines.button.use-own-name")}
                    </Button>
                  )}
                  <Button onClick={() => setRenaming(null)}>
                    {t("settings.button.cancel")}
                  </Button>
                  <Button
                    variant="primary"
                    icon={actionIcons.save}
                    data-machine-save=""
                    onClick={() => {
                      const alias = renaming.name.trim();
                      void act(
                        source.rename(
                          machine.id,
                          alias === "" || alias === machine.announcedName
                            ? null
                            : alias,
                        ),
                      ).then((done) => done && setRenaming(null));
                    }}
                  >
                    {t("settings.button.save")}
                  </Button>
                </div>
              </div>
            </li>
          ) : (
            <li
              key={machine.id}
              className={styles.line}
              data-machine-row={machine.id}
            >
              <div className={styles.lineMain}>
                <span className={styles.productName}>{machine.name}</span>
                {machine.alias !== null &&
                machine.announcedName !== null &&
                machine.alias !== machine.announcedName ? (
                  <span className={styles.caption}>
                    {t("machines.label.announced-name", {
                      name: machine.announcedName,
                    })}
                  </span>
                ) : null}
                <span>
                  <MachineStatus machine={machine} full />
                </span>
              </div>
              <div className={styles.lineControl}>
                <div className={styles.actions}>
                  <Button
                    icon={actionIcons.edit}
                    data-machine-rename=""
                    onClick={() =>
                      setRenaming({
                        id: machine.id,
                        name: machine.alias ?? "",
                      })
                    }
                  >
                    {t("machines.button.rename")}
                  </Button>
                  <Button
                    variant="secondary"
                    icon={actionIcons.remove}
                    data-machine-remove=""
                    onClick={() => setRemoving(machine)}
                  >
                    {t("machines.button.remove")}
                  </Button>
                </div>
              </div>
            </li>
          ),
        )}
        {view.machines.length === 0 ? null : (
          <li className={styles.line} data-machines-start="">
            <NamedControl
              name={t("machines.label.start")}
              labelClass={styles.lineName}
            >
              {({ label, provide }) => (
                <>
                  <div className={styles.lineMain}>
                    {label}
                    <span className={styles.lineHelp}>
                      {t("machines.note.start")}
                    </span>
                  </div>
                  <div className={styles.lineControl}>
                    {provide(
                      <Select
                        options={startOptions}
                        value={startId}
                        onValueChange={(value) =>
                          void act(
                            source.setStart(
                              value === LAST
                                ? { mode: "last" }
                                : { mode: "machine", machine: value },
                            ),
                          )
                        }
                      />,
                    )}
                  </div>
                </>
              )}
            </NamedControl>
          </li>
        )}
        {adding ? (
          <li className={styles.line} data-machines-add-form="">
            <div className={styles.lineMain}>
              <Field
                label={t("machines.label.pairing-text")}
                help={t("machines.note.add")}
                {...(pairFailed === null
                  ? {}
                  : { error: t(PAIR_ERRORS[pairFailed]) })}
              >
                <Textarea
                  data-machines-text=""
                  rows={4}
                  value={text}
                  autoFocus
                  spellCheck={false}
                  onChange={(event) => setText(event.target.value)}
                />
              </Field>
            </div>
            <div className={styles.lineControl}>
              <div className={styles.actions}>
                <Button
                  onClick={() => {
                    setAdding(false);
                    setPairFailed(null);
                    setText("");
                  }}
                >
                  {t("settings.button.cancel")}
                </Button>
                <Button
                  variant="primary"
                  icon={actionIcons.connect}
                  data-machines-pair=""
                  disabled={pairing || text.trim() === ""}
                  onClick={() => void pair()}
                >
                  {t("machines.button.pair")}
                </Button>
              </div>
            </div>
          </li>
        ) : (
          <li className={styles.line} data-machines-add="">
            <div className={styles.lineMain}>
              <span className={styles.lineHelp}>{t("machines.note.add")}</span>
            </div>
            <div className={styles.lineControl}>
              <Button
                icon={actionIcons.add}
                data-machines-add-button=""
                onClick={() => setAdding(true)}
              >
                {t("machines.button.add")}
              </Button>
            </div>
          </li>
        )}
      </ul>
      {paired === null ? null : (
        <p className={styles.notice} data-machines-paired="">
          {t("machines.notice.paired", { name: paired })}
        </p>
      )}
      {failed ? (
        <p className={styles.rejected} role="alert">
          {t("machines.error.action-failed")}
        </p>
      ) : null}
      <Dialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title={t("machines.title.remove", { name: removing?.name ?? "" })}
        actions={
          <>
            <Button onClick={() => setRemoving(null)}>
              {t("settings.button.cancel")}
            </Button>
            <Button
              variant="danger"
              icon={actionIcons.remove}
              data-machine-remove-confirm=""
              onClick={() => {
                if (removing === null) return;
                const id = removing.id;
                setRemoving(null);
                void act(source.remove(id));
              }}
            >
              {t("machines.button.remove")}
            </Button>
          </>
        }
      >
        <p className={viewedStyles.dialogText}>
          {t("machines.note.remove", { name: removing?.name ?? "" })}
        </p>
        {removing !== null &&
        view.start.mode === "machine" &&
        view.start.machine === removing.id ? (
          <p className={viewedStyles.dialogText} data-machine-remove-start="">
            {t("machines.note.remove-start", { name: removing.name })}
          </p>
        ) : null}
      </Dialog>
    </>
  );
}

// App details의 Machines 절. 폴더로 맞추는 앱에만 선다. 기계마다 돌리는 release와(범위 밖이면) lophn 판, 이 기계가 새
// release를 따라가는 상태, 다른 release라 기다리는 변경과 그 이유를 보인다. 올리기는 각 기계에서 하므로 올리는 단추는 없다.
// 동의를 기다리면 지금 동의 카드가 쓰는 대기 panel을 연다.
import { Button } from "@lophn/ui/primitives";
import { t } from "@lophn/i18n";

import { useWaitingPanel } from "../../desktop/connection/waiting/waiting-layer.tsx";
import { actionIcons } from "../../icons/mod.ts";
import { Loadable } from "./loadable.tsx";
import { useReadOnly } from "./read-only.ts";
import { useMachinesView } from "./reads.ts";
import type { MachineLine, MachinesView } from "./source.ts";
import styles from "./app-section.module.css";

function followNote(
  follow: MachinesView["follow"],
  here: MachineLine,
): string | null {
  const target = follow.target ?? t("machine-update.status.newer-release");
  switch (follow.step) {
    case "current":
      return null;
    case "installing":
    case "activating":
      return t("machine-update.status.follow-updating", { release: target });
    case "waiting_consent":
      return t("machine-update.status.follow-waiting-consent");
    case "declined":
      return t("machine-update.status.follow-declined");
    case "lophn_update":
      return t("machine-update.status.follow-lophn-update");
    case "install_failed":
    case "activation_failed":
      return t("machine-update.status.follow-failed", {
        reason: follow.reason ?? "",
        release: here.release ?? "",
      });
    case "diverged":
      return t("machine-update.status.follow-diverged");
  }
}

function peerNotes(row: MachineLine): string[] {
  const notes: string[] = [];
  if (row.exchange === "update_this") {
    notes.push(
      t("machine-update.status.exchange-update-this", { machine: row.name }),
    );
  } else if (row.exchange === "update_peer") {
    notes.push(
      t("machine-update.status.exchange-update-peer", { machine: row.name }),
    );
  }
  for (const held of row.held) {
    notes.push(
      held.why === "newer_release"
        ? t("machine-update.status.held-newer", {
            count: held.changes,
            machine: row.name,
          })
        : held.why === "diverged"
          ? t("machine-update.status.held-diverged", { machine: row.name })
          : t("machine-update.status.held-older", { machine: row.name }),
    );
    if (held.full) {
      notes.push(t("machine-update.status.held-full", { machine: row.name }));
    }
  }
  return notes;
}

function MachineItem({
  row,
  notes,
  onOpenWaiting,
}: {
  row: MachineLine;
  notes: readonly string[];
  onOpenWaiting: (() => void) | null;
}) {
  return (
    <div className={styles.item} data-machine={row.machine}>
      <div className={styles.row}>
        <span className={styles.stack}>
          <span className={styles.text}>
            <span className={styles.state}>{row.name}</span>
            {row.thisMachine ? (
              <span className={styles.counts}>
                {t("machine-update.status.this-computer")}
              </span>
            ) : null}
            {row.release === null ? null : (
              <span className={styles.name} data-machine-release="">
                {row.release}
              </span>
            )}
            {row.exchange === "ok" || row.lophnVersion === null ? null : (
              <span className={styles.counts}>
                {t("machine-update.status.lophn-version", {
                  version: row.lophnVersion,
                })}
              </span>
            )}
          </span>
          {notes.map((note) => (
            <p key={note} className={styles.note}>
              {note}
            </p>
          ))}
        </span>
        {onOpenWaiting === null ? null : (
          <span className={styles.action}>
            <Button
              size="sm"
              icon={actionIcons.open}
              onClick={onOpenWaiting}
              data-open-waiting=""
            >
              {t("machine-update.status.open-waiting")}
            </Button>
          </span>
        )}
      </div>
    </div>
  );
}

export function MachinesSection({
  app,
  now,
}: {
  app: string;
  now: () => Date;
}) {
  const read = useMachinesView(app);
  const { setOpen } = useWaitingPanel();
  // 동의 card는 그 컴퓨터의 사람 것이라 이 컴퓨터의 대기 panel로 열 수 없다.
  const readOnly = useReadOnly();
  const loaded = read.loaded;
  // 폴더로 맞추지 않는 앱에는 절이 없다. 처음 읽기가 끝나지 않았거나 실패하면 그 앱이 폴더로 맞추는지 몰라 비워 둔다.
  if (loaded.state !== "ready" || loaded.value === null) return null;
  return (
    <section
      className={styles.section}
      aria-label={t("machine-update.status.heading")}
      data-app-machines=""
    >
      <div className={styles.head}>
        <h4 className={styles.label}>{t("machine-update.status.heading")}</h4>
      </div>
      <Loadable
        read={read}
        target={t("machine-update.status.target")}
        now={now}
      >
        {(view) =>
          view === null ? null : (
            <>
              <div>
                {view.machines.map((row) => {
                  const note = row.thisMachine
                    ? followNote(view.follow, row)
                    : null;
                  return (
                    <MachineItem
                      key={row.machine}
                      row={row}
                      notes={
                        row.thisMachine
                          ? note === null
                            ? []
                            : [note]
                          : peerNotes(row)
                      }
                      onOpenWaiting={
                        row.thisMachine &&
                        !readOnly &&
                        view.follow.step === "waiting_consent"
                          ? () => setOpen(true)
                          : null
                      }
                    />
                  );
                })}
              </div>
              {view.follow.step !== "current" ||
              view.machines.some(
                (row) => row.held.length > 0 || row.exchange !== "ok",
              ) ? (
                <p className={styles.note}>
                  {t("machine-update.status.keeps-running")}
                </p>
              ) : null}
            </>
          )
        }
      </Loadable>
    </section>
  );
}

// Settings › Remote 맨 위의 "This computer". 폰과 다른 기기에 알리는 이 컴퓨터의 이름을 보고 바꾼다(비우면 hostname을
// 다시 따른다). 다른 컴퓨터에서 복사된 data root면 새 기계가 되었다는 사실을 알린다.
import { t } from "@lophn/i18n";
import { Input } from "@lophn/ui/input";
import { Button } from "@lophn/ui/primitives";
import { useEffect, useState, type KeyboardEvent } from "react";

import { actionIcons } from "../../../icons/mod.ts";
import { NamedControl } from "../general/named-control.tsx";
import styles from "../settings.module.css";
import remoteStyles from "./remote.module.css";
import type {
  RemoteDevice,
  RemoteMachine,
  RemoteSettingsSource,
} from "./source.ts";

interface ThisComputerProps {
  source: RemoteSettingsSource;
  /** 복제 note는 기기가 하나도 없을 때만 보인다(하나 pairing하면 사라진다). */
  devices: readonly RemoteDevice[] | "failed" | null;
}

export function ThisComputer({ source, devices }: ThisComputerProps) {
  const [machine, setMachine] = useState<RemoteMachine | null>(null);
  const [text, setText] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    void source.machine().then((read) => {
      if (!read.ok) return;
      setMachine(read.value);
      setText(read.value.name);
    });
  }, [source]);

  if (machine === null) return null;

  async function save(name: string | null): Promise<void> {
    const saved = await source.renameMachine(name);
    setFailed(!saved.ok);
    if (!saved.ok) return;
    setMachine(saved.value);
    setText(saved.value.name);
  }

  function commit(): void {
    const next = text.trim();
    // 비우면 저장하지 않고 지금 이름으로 돌아간다. hostname으로 되돌리는 길은 단추다.
    if (next === "") setText(machine!.name);
    else if (next !== machine!.name) void save(next);
  }

  const cloned =
    machine.clonedFrom !== null &&
    devices !== null &&
    devices !== "failed" &&
    devices.length === 0;

  return (
    <section
      className={`${styles.groupBlock} ${remoteStyles.section}`}
      data-remote-this-computer=""
    >
      <h2 className={styles.groupTitle}>
        {t("settings.heading.this-computer")}
      </h2>
      <ul className={styles.lines}>
        <NamedControl
          name={t("settings.label.computer-name")}
          labelClass={styles.lineName}
        >
          {({ label, provide }) => (
            <li className={styles.line} data-remote-row="computer-name">
              <div className={styles.lineMain}>{label}</div>
              <div className={styles.lineControl}>
                {provide(
                  <Input
                    value={text}
                    maxLength={64}
                    onChange={(event) => setText(event.target.value)}
                    onBlur={commit}
                    onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
                      if (event.key === "Enter") event.currentTarget.blur();
                    }}
                  />,
                )}
                {machine.nameSource === "person" ? (
                  <Button
                    icon={actionIcons.reset}
                    data-remote-computer-name-reset=""
                    onClick={() => void save(null)}
                  >
                    {t("settings.button.computer-name-reset")}
                  </Button>
                ) : (
                  <span
                    className={styles.lineHelp}
                    data-remote-computer-name-follows=""
                  >
                    {t("settings.note.computer-name-follows", {
                      hostname: machine.hostname,
                    })}
                  </span>
                )}
              </div>
            </li>
          )}
        </NamedControl>
      </ul>
      <div className={remoteStyles.below}>
        <p className={styles.lineHelp}>
          {t("settings.note.computer-name-next-connect")}
        </p>
      </div>
      {failed ? (
        <p className={styles.rejected} role="alert">
          {t("settings.error.value-not-saved")}
        </p>
      ) : null}
      {cloned ? (
        <div className={remoteStyles.below}>
          <p className={styles.notice} data-remote-cloned="">
            {t("settings.notice.computer-cloned")}
          </p>
        </div>
      ) : null}
    </section>
  );
}

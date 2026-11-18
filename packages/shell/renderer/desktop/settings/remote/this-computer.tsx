// Settings › Remote 맨 위의 "This computer". 명단과 다른 기기에 보이는 이 컴퓨터의 이름을 보고 바꾼다(비우면 hostname을
// 다시 따른다). 다른 컴퓨터에서 복사된 data root면 새 기계가 되었다는 사실을 알린다.
import { t } from "@lophn/i18n";
import { Input } from "@lophn/ui/input";
import { Button } from "@lophn/ui/primitives";
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { actionIcons } from "../../../icons/mod.ts";
import { useStateChanged } from "../../connection/core-read.ts";
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
  /** 복제 note는 이 컴퓨터 밖의 기기가 하나도 없을 때만 보인다(하나 들이면 사라진다). */
  devices: readonly RemoteDevice[] | "failed" | null;
  /** 이름을 바꿨다. 명단의 이 컴퓨터 항목도 그 이름을 따른다. */
  onRenamed: () => void;
}

export function ThisComputer({
  source,
  devices,
  onRenamed,
}: ThisComputerProps) {
  const [machine, setMachine] = useState<RemoteMachine | null>(null);
  const [text, setText] = useState("");
  const [failed, setFailed] = useState(false);
  // 사람이 칸에 친 글이 있다. 없으면 칸은 지금 이름을 따르고, 떠날 때 아무것도 저장하지 않는다. 다른 곳(다른 컴퓨터의 명단,
  // CLI)이 이름을 바꾼 뒤 옛 글을 사람이 지은 이름으로 되써 넣지 않게 한다.
  const edited = useRef(false);

  const load = useCallback(() => {
    void source.machine().then((read) => {
      if (!read.ok) return;
      setMachine(read.value);
      if (!edited.current) setText(read.value.name);
    });
  }, [source]);
  useEffect(load, [load]);
  // `machine/rename`은 event가 없다. 다른 컴퓨터가 바꾼 이름은 명단(`remote_devices`)을 따라 이 기계 이름이 된다.
  useStateChanged(["settings", "remote_devices"], load);

  if (machine === null) return null;

  async function save(name: string | null): Promise<void> {
    const saved = await source.renameMachine(name);
    setFailed(!saved.ok);
    if (!saved.ok) return;
    edited.current = false;
    setMachine(saved.value);
    setText(saved.value.name);
    onRenamed();
  }

  function commit(): void {
    const next = text.trim();
    // 비우면 저장하지 않고 지금 이름으로 돌아간다. hostname으로 되돌리는 길은 단추다.
    if (!edited.current || next === "" || next === machine!.name) {
      edited.current = false;
      setText(machine!.name);
    } else void save(next);
  }

  const cloned =
    machine.clonedFrom !== null &&
    devices !== null &&
    devices !== "failed" &&
    devices.every((one) => one.thisComputer);

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
                    onChange={(event) => {
                      edited.current = true;
                      setText(event.target.value);
                    }}
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

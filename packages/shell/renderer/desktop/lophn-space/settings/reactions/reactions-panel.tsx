// Settings › Reactions. 새 일을 여는 domain event 다섯마다 Off, Open without asking, Ask를 고른다.
// 기본은 열고 묻지 않음이다. call을 닫는 event는 항목이 없다.
import { useCallback, useState } from "react";
import {
  ErrorState,
  Loading,
  Select,
  Skeleton,
} from "@lophn/design/components";
import { t } from "@lophn/wording";

import { NamedControl } from "../general/named-control.tsx";
import { useReload } from "../use-reload.ts";
import styles from "../settings.module.css";
import { MODE_OPTIONS, REACTION_ROWS } from "./model.ts";
import type {
  ReactionEvent,
  ReactionMode,
  ReactionModes,
  ReactionsSource,
} from "./source.ts";

export interface ReactionsPanelProps {
  source: ReactionsSource;
}

type Loaded =
  | { readonly state: "loading" }
  | { readonly state: "failed" }
  | { readonly state: "ready"; readonly modes: ReactionModes };

export function ReactionsPanel({ source }: ReactionsPanelProps) {
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  const [failed, setFailed] = useState<ReactionEvent | null>(null);

  const load = useCallback(() => {
    void source.modes().then((read) => {
      setLoaded(
        read.ok ? { state: "ready", modes: read.value } : { state: "failed" },
      );
    });
  }, [source]);
  useReload(source, load);

  async function choose(
    modes: ReactionModes,
    event: ReactionEvent,
    mode: ReactionMode,
  ): Promise<void> {
    setFailed(null);
    setLoaded({ state: "ready", modes: { ...modes, [event]: mode } });
    const saved = await source.choose(event, mode);
    if (saved.ok) return;
    // 저장하지 못했으면 앞의 값으로 돌아간다.
    setLoaded({ state: "ready", modes });
    setFailed(event);
  }

  if (loaded.state === "failed") {
    return (
      <ErrorState
        target={t("settings.label.reactions-target")}
        onRetry={() => {
          setLoaded({ state: "loading" });
          load();
        }}
      />
    );
  }
  const modes = loaded.state === "ready" ? loaded.modes : null;
  return (
    <div data-reactions="">
      <h1 className={styles.paneTitle}>{t("settings.label.tab-reactions")}</h1>
      <p className={styles.lead}>{t("settings.intro.reactions")}</p>
      <Loading loading={modes === null} placeholder={<Skeleton lines={5} />}>
        <ul className={styles.lines}>
          {modes === null ? null : REACTION_ROWS.map((row) => (
            <li
              key={row.event}
              className={styles.line}
              data-reaction={row.event}
            >
              <NamedControl
                name={t(row.name)}
                invalid={failed === row.event}
                labelClass={styles.lineName}
              >
                {({ label, provide }) => (
                  <>
                    <div className={styles.lineMain}>
                      {label}
                      <span className={styles.lineHelp}>{t(row.when)}</span>
                      <span className={styles.caption}>{t(row.opens)}</span>
                      {failed === row.event
                        ? (
                          <span className={styles.rejected} role="alert">
                            {t("settings.error.value-not-saved")}
                          </span>
                        )
                        : null}
                    </div>
                    <div className={styles.lineControl}>
                      {provide(
                        <Select
                          options={MODE_OPTIONS.map((option) => ({
                            value: option.value,
                            label: t(option.label),
                          }))}
                          value={modes[row.event]}
                          onValueChange={(value) =>
                            void choose(
                              modes,
                              row.event,
                              value as ReactionMode,
                            )}
                        />,
                      )}
                    </div>
                  </>
                )}
              </NamedControl>
            </li>
          ))}
        </ul>
        <p className={`${styles.lineHelp} ${styles.groupBlock}`}>
          {t("settings.note.reactions-ask")}
        </p>
      </Loading>
    </div>
  );
}

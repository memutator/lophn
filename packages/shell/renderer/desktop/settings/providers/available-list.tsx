import { type ReactNode, useCallback, useEffect, useState } from "react";
import { Button } from "@lophn/ui/primitives";
import { ErrorState, Loading, Skeleton } from "@lophn/ui/feedback";
import { Dialog } from "@lophn/ui/overlay";
import { commonIcons } from "../../../icons/mod.ts";
import { t } from "@lophn/wording";

import { ProviderName } from "./provider-name.tsx";
import type {
  ProviderDefinitionRow,
  ProviderSettingsSource,
} from "./settings-source.ts";
import styles from "./provider-list.module.css";

export type Loaded<Row> =
  | { readonly state: "loading" }
  | { readonly state: "failed" }
  | { readonly state: "ready"; readonly rows: readonly Row[] };

/** Add a provider 목록을 읽는다. 다시 읽다 실패해도 이미 보이는 목록은 지우지 않는다(처음 읽기만 실패를 보인다). */
export function useAvailable(source: ProviderSettingsSource) {
  const [available, setAvailable] = useState<Loaded<ProviderDefinitionRow>>({
    state: "loading",
  });
  const load = useCallback(async (): Promise<void> => {
    const read = await source.available();
    setAvailable((previous) =>
      read.ok
        ? { state: "ready", rows: read.value }
        : previous.state === "ready"
        ? previous
        : { state: "failed" }
    );
  }, [source]);
  const retry = useCallback((): void => {
    setAvailable({ state: "loading" });
    void load();
  }, [load]);
  return { available, load, retry };
}

interface AvailableListProps {
  available: Loaded<ProviderDefinitionRow>;
  onRetry: () => void;
  onChoose: (definition: ProviderDefinitionRow) => void;
}

/** Add a provider 목록(내장 정의, Custom provider 줄, 줄마다 [+ Connect]). Settings → Providers와 Connect provider 대화창이 함께 쓴다. */
export function AvailableList(
  { available, onRetry, onChoose }: AvailableListProps,
): ReactNode {
  if (available.state === "failed") {
    return (
      <ErrorState
        target={t("settings.label.available-target")}
        onRetry={onRetry}
      />
    );
  }
  return (
    <Loading
      loading={available.state === "loading"}
      placeholder={<Skeleton lines={3} />}
    >
      <ul className={styles.group}>
        {(available.state === "ready" ? available.rows : []).map((
          definition,
        ) => (
          <li
            key={definition.key}
            className={styles.item}
            data-available={definition.key}
          >
            <span className={styles.identity}>
              <ProviderName name={definition.name} />
              {definition.hint === null
                ? null
                : (
                  <span className={styles.hint} data-hint="">
                    {definition.hint}
                  </span>
                )}
            </span>
            <Button
              size="sm"
              icon={commonIcons.add}
              data-action="connect"
              onClick={() => onChoose(definition)}
            >
              {t("settings.button.connect")}
            </Button>
          </li>
        ))}
      </ul>
    </Loading>
  );
}

interface ConnectProviderDialogProps {
  source: ProviderSettingsSource;
  onChoose: (definition: ProviderDefinitionRow) => void;
  onClose: () => void;
}

/** 정의를 고르는 대화창. 열려 있는 동안만 mount한다. 고르면 다음 대화창(ConnectDialog)은 부른 쪽이 연다. */
export function ConnectProviderDialog(
  { source, onChoose, onClose }: ConnectProviderDialogProps,
): ReactNode {
  const { available, load, retry } = useAvailable(source);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t("settings.heading.add-provider")}
      actions={<Button onClick={onClose}>{t("settings.button.cancel")}</Button>}
    >
      <AvailableList
        available={available}
        onRetry={retry}
        onChoose={onChoose}
      />
    </Dialog>
  );
}

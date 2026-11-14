import { type ReactNode, useMemo } from "react";
import { Button } from "@lophn/ui/primitives";
import { ErrorState, Loading, Skeleton } from "@lophn/ui/feedback";
import { Dialog } from "@lophn/ui/overlay";
import { actionIcons } from "../../../icons/mod.ts";
import { t } from "@lophn/i18n";

import {
  providerDefinitions,
  providerList,
} from "../../../../../protocol/lophn-agent/providers.ts";
import { type Loaded, useCoreRead } from "../../connection/core-read.ts";
import { bothLoaded } from "../loaded.ts";
import { availableOf } from "./core-source.ts";
import { ProviderName } from "./provider-name.tsx";
import type { ProviderDefinitionRow } from "./settings-source.ts";
import styles from "./provider-list.module.css";

/** Add a provider 목록. 연결된 provider가 바뀌면(다른 창에서도) 다시 읽는다. */
export function useAvailable() {
  const providers = useCoreRead(providerList, {});
  const definitions = useCoreRead(providerDefinitions, {});
  const available = useMemo(
    () =>
      bothLoaded(providers.loaded, definitions.loaded, (listed, defined) =>
        availableOf(listed.providers, defined.definitions),
      ),
    [providers.loaded, definitions.loaded],
  );
  const retry = () => {
    providers.reload();
    definitions.reload();
  };
  return { available, retry };
}

interface AvailableListProps {
  available: Loaded<readonly ProviderDefinitionRow[]>;
  onRetry: () => void;
  onChoose: (definition: ProviderDefinitionRow) => void;
}

/** Add a provider 목록(내장 정의, Custom provider 줄, 줄마다 [+ Connect]). Settings → Providers와 Connect provider 대화창이 함께 쓴다. */
export function AvailableList({
  available,
  onRetry,
  onChoose,
}: AvailableListProps): ReactNode {
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
        {(available.state === "ready" ? available.value : []).map(
          (definition) => (
            <li
              key={definition.key}
              className={styles.item}
              data-available={definition.key}
            >
              <span className={styles.availableIdentity}>
                <ProviderName name={definition.name} />
                {definition.hint === null ? null : (
                  <span className={styles.hint} data-hint="">
                    {definition.hint}
                  </span>
                )}
              </span>
              <Button
                size="sm"
                icon={actionIcons.connect}
                data-action="connect"
                onClick={() => onChoose(definition)}
              >
                {t("settings.button.connect")}
              </Button>
            </li>
          ),
        )}
      </ul>
    </Loading>
  );
}

interface ConnectProviderDialogProps {
  onChoose: (definition: ProviderDefinitionRow) => void;
  onClose: () => void;
}

/** 정의를 고르는 대화창. 열려 있는 동안만 mount한다. 고르면 다음 대화창(ConnectDialog)은 부른 쪽이 연다. */
export function ConnectProviderDialog({
  onChoose,
  onClose,
}: ConnectProviderDialogProps): ReactNode {
  const { available, retry } = useAvailable();
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

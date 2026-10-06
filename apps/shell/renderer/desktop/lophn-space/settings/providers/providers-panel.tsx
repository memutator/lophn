// settings의 연결 자리. 등록된 연결마다 카드 하나를 보이고 계정은 카드 안에서 다룬다.
import { useCallback, useState } from "react";
import { ErrorState, Loading, Skeleton } from "@lophn/design/components";
import { t } from "@lophn/wording";

import { sortProviders } from "../model.ts";
import type { ProviderRow, SettingsSource } from "../source.ts";
import { useReload } from "../use-reload.ts";
import styles from "../settings.module.css";
import { ProviderCard } from "./provider-card.tsx";

type Loaded =
  | { readonly state: "loading" }
  | { readonly state: "failed" }
  | { readonly state: "ready"; readonly rows: readonly ProviderRow[] };

export function ProvidersPanel({ source }: { source: SettingsSource }) {
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  const load = useCallback(() => {
    void source.providers().then((result) => {
      setLoaded(
        result.ok
          ? { state: "ready", rows: sortProviders(result.value) }
          : { state: "failed" },
      );
    });
  }, [source]);
  useReload(source, load);

  if (loaded.state === "failed") {
    return (
      <ErrorState
        target={t("settings.label.providers-target")}
        onRetry={() => {
          setLoaded({ state: "loading" });
          load();
        }}
      />
    );
  }
  if (loaded.state === "ready" && loaded.rows.length === 0) {
    return <p className={styles.empty}>{t("settings.providers.empty")}</p>;
  }
  return (
    <Loading
      loading={loaded.state === "loading"}
      placeholder={<Skeleton lines={4} />}
    >
      <div className={styles.groups} data-providers="">
        {(loaded.state === "ready" ? loaded.rows : []).map((provider) => (
          <ProviderCard
            key={provider.id}
            source={source}
            provider={provider}
            onChanged={load}
          />
        ))}
      </div>
    </Loading>
  );
}

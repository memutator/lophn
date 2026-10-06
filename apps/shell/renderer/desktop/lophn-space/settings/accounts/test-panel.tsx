// 연결 테스트(flow connect-provider 6, manage-provider-accounts 7). 사람이 [Run test]를 누를 때만 부르고,
// 결과와 모르는 비용을 0으로 채우지 않는다. 문서나 대화는 보내지 않고 고정한 작은 글만 쓴다.
import { useEffect, useState } from "react";
import { Button, Field, Select } from "@lophn/design/components";
import { t } from "@lophn/wording";

import type {
  AccountRow,
  ProviderRow,
  SettingsSource,
  TestResult,
} from "../source.ts";
import styles from "../settings.module.css";

export interface TestPanelProps {
  source: SettingsSource;
  provider: ProviderRow;
  account: AccountRow;
  /** 테스트가 끝나면 부른다. 사용량을 다시 읽는다. */
  onDone: () => void;
}

type Models =
  | { readonly state: "loading" }
  | { readonly state: "failed" }
  | { readonly state: "ready"; readonly names: readonly string[] };

type Outcome =
  | { readonly state: "idle" }
  | { readonly state: "running" }
  | { readonly state: "done"; readonly results: readonly TestResult[] }
  | { readonly state: "absent" }
  | { readonly state: "failed" };

function resultText(result: TestResult): string {
  if (result.result === "success") {
    return t("settings.test.worked", { kind: result.kind });
  }
  if (result.result === "failure") {
    return t("settings.test.failed", { kind: result.kind });
  }
  return t("settings.test.not-tested", { kind: result.kind });
}

export function TestPanel(
  { source, provider, account, onDone }: TestPanelProps,
) {
  const [models, setModels] = useState<Models>({ state: "loading" });
  const [model, setModel] = useState("");
  const [outcome, setOutcome] = useState<Outcome>({ state: "idle" });

  useEffect(() => {
    let live = true;
    void source.models(provider.definition).then((loaded) => {
      if (!live) return;
      if (!loaded.ok || loaded.value.length === 0) {
        setModels({ state: "failed" });
        return;
      }
      setModels({ state: "ready", names: loaded.value });
      setModel(loaded.value[0]!);
    });
    return () => {
      live = false;
    };
  }, [source, provider.definition]);

  async function run(): Promise<void> {
    setOutcome({ state: "running" });
    const tested = await source.testConnection({
      provider: provider.id,
      account: account.key,
      model,
    });
    if (tested.ok) setOutcome({ state: "done", results: tested.value });
    else {
      setOutcome({
        state: tested.code === "not_found" ? "absent" : "failed",
      });
    }
    onDone();
  }

  if (models.state === "loading") {
    return <p className={styles.muted}>{t("settings.test.loading-models")}</p>;
  }
  if (models.state === "failed") {
    return (
      <p className={styles.muted} data-test="no-models">
        {t("settings.test.no-models")}
      </p>
    );
  }
  return (
    <div className={styles.form} data-test-panel="">
      <p className={styles.text}>{t("settings.test.about")}</p>
      <div className={styles.inline}>
        <Field label={t("settings.label.test-model")}>
          <Select
            options={models.names.map((name) => ({
              value: name,
              label: name,
            }))}
            value={model}
            onValueChange={setModel}
          />
        </Field>
        <Button
          size="sm"
          data-action="start-test"
          disabled={outcome.state === "running" || model === ""}
          onClick={() => void run()}
        >
          {t("settings.button.start-test")}
        </Button>
      </div>
      {outcome.state === "running"
        ? <p className={styles.muted}>{t("settings.test.running")}</p>
        : null}
      {outcome.state === "done"
        ? (
          <ul className={styles.results} data-test-results="">
            {outcome.results.map((result) => (
              <li
                key={result.kind}
                className={styles.text}
                data-test-result={result.kind}
                data-result={result.result ?? "none"}
              >
                {resultText(result)}
              </li>
            ))}
            <li className={styles.muted}>{t("settings.test.cost-note")}</li>
          </ul>
        )
        : null}
      {outcome.state === "absent"
        ? (
          <p className={styles.notice} role="status" data-test="absent">
            {t("settings.test.absent")}
          </p>
        )
        : null}
      {outcome.state === "failed"
        ? (
          <p className={styles.notice} role="status" data-test="failed">
            {t("settings.test.not-started")}
          </p>
        )
        : null}
    </div>
  );
}

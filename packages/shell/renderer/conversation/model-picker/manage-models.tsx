// Manage models 창. picker에 보일 model을 켜고 끄고, 새 provider를 붙이는 길이다. 위에서부터 설명 한 줄과
// 오른쪽 위 [Connect provider], 검색칸 하나, provider 묶음이다. 묶음 머리는 vendor 아이콘, provider 이름, provider toggle이고
// 그 아래 model마다 toggle이 있다. toggle은 줄 오른쪽 끝의 고정 열에 둔다. custom provider 머리에는 [Refresh models]가 있고,
// 목록을 주지 않는 custom provider 묶음에는 model 이름을 더하는 칸이 있다. 자료는 props로 받고 core를 모른다.
import { useState } from "react";
import { Button, Icon } from "@lophn/ui/primitives";
import { Dialog } from "@lophn/ui/overlay";
import { Field, Input, Switch } from "@lophn/ui/input";
import { iconPixels } from "@lophn/ui/shared";
import { t } from "@lophn/wording";

import { commonIcons } from "../../icons/mod.ts";
import { ProviderHeading } from "./model-picker.tsx";
import styles from "./manage-models.module.css";
import type { ManageProviderView } from "./types.ts";

export interface ManageModelsProps {
  /** 아직 읽는 중이면 null이다. */
  providers: readonly ManageProviderView[] | null;
  onClose: () => void;
  /** [Connect provider]. 연결 대화창이 이 창 위에 열린다. */
  onConnect: () => void;
  onToggleModel: (
    provider: string,
    modelName: string,
    hidden: boolean,
  ) => void;
  /** provider toggle. 그 provider의 지금 model 전부를 끄거나(hidden) 켠다. */
  onToggleProvider: (provider: string, hidden: boolean) => void;
  /** custom provider의 목록을 다시 읽는다. 성공하면 true다. 실패해도 앞 목록은 그대로다. */
  onRefresh: (provider: string) => Promise<boolean>;
  /** 목록을 주지 않는 custom provider에 이름을 더한다. 성공하면 true다. */
  onAddName: (provider: string, modelName: string) => Promise<boolean>;
}

/** Switch의 라벨은 눈에는 숨기고 화면 읽기용으로만 둔다. */
function Toggle(
  { label, on, disabled, onChange }: {
    label: string;
    on: boolean;
    disabled?: boolean;
    onChange: (on: boolean) => void;
  },
) {
  return (
    <span className={`${styles.toggleCell} ${styles.hiddenLabel}`}>
      <Switch
        label={label}
        checked={on}
        disabled={disabled}
        onCheckedChange={onChange}
      />
    </span>
  );
}

function AddName(
  { provider, onAdd }: {
    provider: ManageProviderView;
    onAdd: (modelName: string) => Promise<void>;
  },
) {
  const [name, setName] = useState("");
  const trimmed = name.trim();
  const add = () => {
    if (trimmed === "") return;
    void onAdd(trimmed).then(() => setName(""));
  };
  return (
    <div className={styles.addName} data-manage-section="add-name">
      <Field
        label={t("conversation.label.custom-model", {
          provider: provider.name,
        })}
      >
        <Input
          value={name}
          autoComplete="off"
          onChange={(event) => setName(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") add();
          }}
        />
      </Field>
      <Button size="sm" disabled={trimmed === ""} onClick={add}>
        {t("conversation.button.add-model")}
      </Button>
    </div>
  );
}

function ProviderGroup(
  { provider, query, busy, props, onRefresh, onAddName }: {
    provider: ManageProviderView;
    query: string;
    busy: boolean;
    props: ManageModelsProps;
    onRefresh: (provider: string) => void;
    onAddName: (provider: string, modelName: string) => Promise<void>;
  },
) {
  const needle = query.trim().toLowerCase();
  const shown = provider.models.filter((model) =>
    needle === "" || model.modelName.toLowerCase().includes(needle)
  );
  // 검색 중에는 맞는 model이 없는 묶음을 숨긴다.
  if (needle !== "" && shown.length === 0) return null;
  const anyOn = provider.models.some((model) => !model.hidden);
  return (
    <section
      className={styles.group}
      data-manage-section="provider"
      data-provider={provider.id}
    >
      <div className={styles.groupHead}>
        <ProviderHeading label={provider.name} />
        {provider.refreshable
          ? (
            <Button
              size="sm"
              variant="ghost"
              data-refresh-models=""
              disabled={busy}
              onClick={() => onRefresh(provider.id)}
            >
              {t("conversation.button.refresh-models")}
            </Button>
          )
          : null}
        <Toggle
          label={t("conversation.label.provider-toggle", {
            provider: provider.name,
          })}
          on={anyOn}
          disabled={provider.models.length === 0}
          onChange={(on) => props.onToggleProvider(provider.id, !on)}
        />
      </div>
      {provider.models.length === 0
        ? (
          <p className={styles.note}>
            {t("conversation.notice.no-listed-models")}
          </p>
        )
        : null}
      {shown.map((model) => (
        <div
          key={model.modelName}
          className={styles.row}
          data-model={model.modelName}
        >
          <span className={styles.name}>{model.modelName}</span>
          <Toggle
            label={model.modelName}
            on={!model.hidden}
            onChange={(on) =>
              props.onToggleModel(provider.id, model.modelName, !on)}
          />
        </div>
      ))}
      {provider.canAddName && needle === ""
        ? (
          <>
            <p className={styles.note}>
              {t("conversation.notice.custom-model")}
            </p>
            <AddName
              provider={provider}
              onAdd={(modelName) => onAddName(provider.id, modelName)}
            />
          </>
        )
        : null}
    </section>
  );
}

export function ManageModelsDialog(props: ManageModelsProps) {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  // 창 안 한 줄: 다시 읽기나 이름 더하기가 실패했다.
  const [problem, setProblem] = useState<
    "refresh-models" | "add-model" | null
  >(null);
  const refresh = async (provider: string) => {
    setBusy(true);
    setProblem(null);
    const refreshed = await props.onRefresh(provider);
    setBusy(false);
    if (!refreshed) setProblem("refresh-models");
  };
  const addName = async (provider: string, modelName: string) => {
    setProblem(null);
    if (!await props.onAddName(provider, modelName)) setProblem("add-model");
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      title={t("conversation.title.manage-models")}
      width="wide"
      actions={
        <Button onClick={props.onClose}>{t("common.button.close")}</Button>
      }
    >
      <div className={styles.manage} data-manage-models="">
        <div className={styles.lead}>
          <p className={styles.leadText}>
            {t("conversation.notice.manage-models-lead")}
          </p>
          <Button size="sm" variant="secondary" onClick={props.onConnect}>
            <Icon icon={commonIcons.add} pixels={iconPixels("base")} />
            {t("conversation.button.connect-provider")}
          </Button>
        </div>
        <Field label={t("conversation.label.search-models")}>
          <Input
            value={query}
            autoComplete="off"
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </Field>
        {problem === null ? null : (
          <p
            className={styles.note}
            role="status"
            data-manage-section="problem"
          >
            {problem === "add-model"
              ? t("conversation.error.add-model")
              : t("conversation.error.refresh-models")}
          </p>
        )}
        <div className={styles.list}>
          {props.providers !== null && props.providers.length === 0
            ? (
              <p className={styles.note}>
                {t("conversation.notice.no-providers")}
              </p>
            )
            : null}
          {(props.providers ?? []).map((provider) => (
            <ProviderGroup
              key={provider.id}
              provider={provider}
              query={query}
              busy={busy}
              props={props}
              onRefresh={(id) => void refresh(id)}
              onAddName={addName}
            />
          ))}
        </div>
      </div>
    </Dialog>
  );
}

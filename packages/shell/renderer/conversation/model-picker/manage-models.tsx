// Manage models 창. picker에 보일 model을 켜고 끄고, model마다 한도를 고치고, 새 provider를 붙이는 길이다. 위에서부터 설명 한 줄과
// 오른쪽 위 [Connect provider], 검색칸 하나, provider 묶음이다. 묶음 머리는 vendor 아이콘, provider 이름, provider toggle이고
// 그 아래 model마다 입력 media icon, context 한도(아는 것만), [Edit], toggle이 있다. toggle은 줄 오른쪽 끝의 고정 열에 둔다.
// [Edit]은 연결된 모든 provider의 model에 있고, custom provider는 정보 전체를, 내장·구독 provider는 한도 셋만 고친다
// (model-info-form.tsx). [Refresh models]는 목록을 알려 주는 provider(custom·일부 내장)에, [Add model]은 custom 묶음에만 있다.
// 자료는 props로 받고 core를 모른다.
import { useState } from "react";
import { Button, Icon } from "@lophn/ui/primitives";
import { Dialog, Tooltip } from "@lophn/ui/overlay";
import { Field, Input, Switch } from "@lophn/ui/input";
import { iconPixels } from "@lophn/ui/shared";
import { t } from "@lophn/i18n";

import type { UserModelInfo } from "../../../../protocol/lophn-agent/models.ts";
import { actionIcons, commonIcons, modelIcons } from "../../icons/mod.ts";
import {
  ModelInfoForm,
  type ModelInfoMode,
  type ModelInfoOutcome,
} from "./model-info-form.tsx";
import { ProviderHeading } from "./model-picker.tsx";
import styles from "./manage-models.module.css";
import type { ManageModelView, ManageProviderView } from "./types.ts";

export interface ManageModelsProps {
  /** 아직 읽는 중이면 null이다. */
  providers: readonly ManageProviderView[] | null;
  /** 연결한 provider의 목록을 읽은 결과 한 줄. */
  notice?: string;
  /** 열자마자 이 provider의 Add model form을 연다. lead는 form 맨 위 한 줄이다. */
  initialForm?: { provider: string; lead: string };
  /** 읽지 못했다. 앞서 읽은 것이 있으면 그대로 두고 창 안에 한 줄만 보인다. */
  loadFailed?: boolean;
  onClose: () => void;
  /** [Connect provider]. 연결 대화창이 이 창 위에 열린다. */
  onConnect: () => void;
  onToggleModel: (provider: string, modelName: string, shown: boolean) => void;
  /** provider toggle. 그 provider의 지금 model 전부를 켜거나(shown) 끈다. */
  onToggleProvider: (provider: string, shown: boolean) => void;
  /** model 목록을 알려 주는 provider의 목록을 다시 읽는다. 성공하면 true다. 실패해도 앞 목록은 그대로다. */
  onRefresh: (provider: string) => Promise<boolean>;
  /** model의 정보를 저장한다. custom은 전부, 내장·구독은 한도 셋만 담고 나머지 칸은 null이다. 새 model이면 이름이 새로 생긴다. */
  onSaveInfo: (
    provider: string,
    modelName: string,
    info: UserModelInfo,
  ) => Promise<ModelInfoOutcome>;
  /** 사람이 적은 model 정보를 지운다. 내장·구독 provider에서는 그 model이 catalog에 남고 사람이 적은 한도만 사라진다. */
  onRemoveInfo: (
    provider: string,
    modelName: string,
  ) => Promise<ModelInfoOutcome>;
}

/** 열려 있는 model 정보 form. modelName이 null이면 새 model(custom)이다. */
interface FormTarget {
  readonly provider: string;
  readonly modelName: string | null;
  readonly info: UserModelInfo | null;
  readonly mode: ModelInfoMode;
  readonly lead?: string;
}

/** context 한도의 짧은 글: 131072는 128K, 1000000은 1M. 1024의 배수는 1024로, 아니면 1000으로 센다. */
function shortLimit(limit: number): string {
  const scaled = (binary: number, decimal: number, mark: string) => {
    const value =
      limit % binary === 0
        ? limit / binary
        : Math.round((limit / decimal) * 10) / 10;
    return `${value}${mark}`;
  };
  if (limit >= 1_000_000) return scaled(1_048_576, 1_000_000, "M");
  if (limit >= 1000) return scaled(1024, 1000, "K");
  return String(limit);
}

/** model 줄의 입력 media icon들과 context 한도. 모르는 것은 보이지 않는다. */
function ModelFacts({ model }: { model: ManageModelView }) {
  // 사람이 적은 한도가 있으면 그 값이 실제로 쓰는 값이다.
  const context = model.info?.context_limit ?? model.contextLimit;
  return (
    <>
      {model.inputMedia === null ? null : (
        <span className={styles.media} data-manage-section="media">
          {model.inputMedia.map((media) => {
            const name = t(`conversation.label.media-${media}`);
            return (
              <Tooltip key={media} content={name}>
                <span
                  className={styles.mediaIcon}
                  role="img"
                  aria-label={name}
                  tabIndex={0}
                >
                  <Icon icon={modelIcons[media]} pixels={iconPixels("base")} />
                </span>
              </Tooltip>
            );
          })}
        </span>
      )}
      {context === null ? null : (
        <Tooltip
          content={t("conversation.label.model-context", {
            limit: context.toLocaleString("en-US"),
          })}
        >
          <span className={styles.context} tabIndex={0}>
            {shortLimit(context)}
          </span>
        </Tooltip>
      )}
    </>
  );
}

/** Switch의 라벨은 눈에는 숨기고 화면 읽기용으로만 둔다. */
function Toggle({
  label,
  on,
  disabled,
  onChange,
}: {
  label: string;
  on: boolean;
  disabled?: boolean;
  onChange: (on: boolean) => void;
}) {
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

function ProviderGroup({
  provider,
  query,
  busy,
  props,
  onRefresh,
  onForm,
}: {
  provider: ManageProviderView;
  query: string;
  busy: boolean;
  props: ManageModelsProps;
  onRefresh: (provider: string) => void;
  onForm: (target: FormTarget) => void;
}) {
  const [openOff, setOpenOff] = useState(false);
  const needle = query.trim().toLowerCase();
  const shown = provider.models.filter(
    (model) => needle === "" || model.modelName.toLowerCase().includes(needle),
  );
  // 검색 중에는 맞는 model이 없는 묶음을 숨긴다.
  if (needle !== "" && shown.length === 0) return null;
  const anyOn = provider.models.some((model) => model.shown);
  // 하나라도 켰으면 꺼진 model은 한 줄로 접는다. 하나도 안 켰으면 고를 것이 모두 보여야 한다. 검색은 접힘을 무시한다.
  const folds = anyOn && needle === "";
  const on = folds ? shown.filter((model) => model.shown) : shown;
  const off = folds ? shown.filter((model) => !model.shown) : [];
  const row = (model: ManageModelView) => (
    <div
      key={model.modelName}
      className={styles.row}
      data-model={model.modelName}
    >
      <span className={styles.name}>{model.modelName}</span>
      <ModelFacts model={model} />
      <Button
        size="sm"
        variant="ghost"
        icon={actionIcons.edit}
        data-edit-model=""
        onClick={() =>
          onForm({
            provider: provider.id,
            modelName: model.modelName,
            info: model.info,
            mode: provider.custom ? "custom" : "limits",
          })
        }
      >
        {t("conversation.button.edit-model")}
      </Button>
      <Toggle
        label={model.modelName}
        on={model.shown}
        onChange={(next) =>
          props.onToggleModel(provider.id, model.modelName, next)
        }
      />
    </div>
  );
  return (
    <section
      className={styles.group}
      data-manage-section="provider"
      data-provider={provider.id}
    >
      <div className={styles.groupHead}>
        <ProviderHeading label={provider.name} />
        {provider.refreshable ? (
          <Button
            size="sm"
            variant="ghost"
            icon={actionIcons.refresh}
            data-refresh-models=""
            disabled={busy}
            onClick={() => onRefresh(provider.id)}
          >
            {t("conversation.button.refresh-models")}
          </Button>
        ) : null}
        <Toggle
          label={t("conversation.label.provider-toggle", {
            provider: provider.name,
          })}
          on={anyOn}
          disabled={provider.models.length === 0}
          onChange={(on) => props.onToggleProvider(provider.id, on)}
        />
      </div>
      {provider.models.length === 0 ? (
        <p className={styles.note}>
          {t("conversation.notice.no-listed-models")}
        </p>
      ) : null}
      {on.map(row)}
      {off.length === 0 ? null : (
        <>
          <button
            type="button"
            className={styles.offToggle}
            aria-expanded={openOff}
            data-off-models=""
            onClick={() => setOpenOff((was) => !was)}
          >
            <Icon
              icon={openOff ? commonIcons.collapse : commonIcons.expand}
              pixels={iconPixels("base")}
            />
            {t("conversation.button.off-models", { count: off.length })}
          </button>
          {openOff ? off.map(row) : null}
        </>
      )}
      {provider.custom && needle === "" ? (
        <div className={styles.addModel} data-manage-section="add-model">
          <p className={styles.note}>{t("conversation.notice.custom-model")}</p>
          <Button
            size="sm"
            variant="secondary"
            icon={actionIcons.add}
            onClick={() =>
              onForm({
                provider: provider.id,
                modelName: null,
                info: null,
                mode: "custom",
              })
            }
          >
            {t("conversation.button.add-model")}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

export function ManageModelsDialog(props: ManageModelsProps) {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  // 창 안 한 줄: 다시 읽기가 실패했다.
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [form, setForm] = useState<FormTarget | null>(() =>
    props.initialForm === undefined
      ? null
      : { ...props.initialForm, modelName: null, info: null, mode: "custom" },
  );
  const refresh = async (provider: string) => {
    setBusy(true);
    setRefreshFailed(false);
    const refreshed = await props.onRefresh(provider);
    setBusy(false);
    if (!refreshed) setRefreshFailed(true);
  };
  return (
    <>
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
            <Button
              size="sm"
              variant="secondary"
              icon={actionIcons.connect}
              onClick={props.onConnect}
            >
              {t("conversation.button.connect-provider")}
            </Button>
          </div>
          {props.notice === undefined ? null : (
            <p
              className={styles.note}
              role="status"
              data-manage-section="found"
            >
              {props.notice}
            </p>
          )}
          <Field label={t("conversation.label.search-models")}>
            <Input
              value={query}
              autoComplete="off"
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
          </Field>
          {refreshFailed || props.loadFailed ? (
            <p
              className={styles.note}
              role="status"
              data-manage-section="problem"
            >
              {props.loadFailed
                ? t("conversation.error.load-models")
                : t("conversation.error.refresh-models")}
            </p>
          ) : null}
          <div className={styles.list}>
            {props.providers !== null && props.providers.length === 0 ? (
              <p className={styles.note}>
                {t("conversation.notice.no-providers")}
              </p>
            ) : null}
            {(props.providers ?? []).map((provider) => (
              <ProviderGroup
                key={provider.id}
                provider={provider}
                query={query}
                busy={busy}
                props={props}
                onRefresh={(id) => void refresh(id)}
                onForm={setForm}
              />
            ))}
          </div>
        </div>
      </Dialog>
      {form === null ? null : (
        <ModelInfoForm
          modelName={form.modelName}
          info={form.info}
          mode={form.mode}
          lead={form.lead}
          onClose={() => setForm(null)}
          onSave={(modelName, info) =>
            props.onSaveInfo(form.provider, modelName, info)
          }
          onRemove={() =>
            props.onRemoveInfo(form.provider, form.modelName ?? "")
          }
        />
      )}
    </>
  );
}

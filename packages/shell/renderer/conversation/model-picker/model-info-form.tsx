// model 정보 form. Manage models 창 위에 열리는 Dialog 하나다. custom provider의 model은 정보 전체를 적고([Add model]은 빈 form,
// 행의 [Edit]은 채운 form), 내장·구독 provider의 model은 한도 셋(context·input·output)만 적는다. 한도는 비우면 그 model이
// 원래 쓰는 값(provider·catalog)을 따르고 회색 placeholder로만 보인다. 가격은 비우면 모름이고 0은 무료다. 저장은 위에서 받은
// 함수가 하고, 판이 어긋나면(conflict) form 값은 그대로 두고 한 줄만 보인다.
import { useState } from "react";
import { Button, IconButton } from "@lophn/ui/primitives";
import { Dialog, Tooltip } from "@lophn/ui/overlay";
import { Field, Input, Select, Switch } from "@lophn/ui/input";
import { t } from "@lophn/i18n";

import type { UserModelInfo } from "../../../../protocol/lophn-agent/models.ts";
import { EFFORT_VALUES } from "../../../../protocol/lophn-agent/option-axes.ts";
import {
  EFFORT_LABELS,
  type EffortValue,
  MODEL_MEDIA,
} from "../../../../protocol/lophn-agent/resolved-model.ts";
import { actionIcons, modelIcons } from "../../icons/mod.ts";
import styles from "./model-info-form.module.css";
import type { ModelMedia } from "./types.ts";

/** 적지 않은 칸을 turn이 채우는 값(core의 목록 밖 model 기본값과 같다). 화면은 placeholder로만 보인다. */
const DEFAULT_CONTEXT = 131072;
const DEFAULT_OUTPUT = 4096;

/** form이 다루는 범위. custom provider의 model은 정보 전체를, 내장·구독 provider의 model은 한도 셋만 적는다. */
export type ModelInfoMode = "custom" | "limits";

/** 저장·지우기의 결과. conflict는 읽은 뒤 판이 바뀐 것이다. */
export type ModelInfoOutcome = "saved" | "conflict" | "failed";

export interface ModelInfoFormProps {
  /** 이름. 새 model이면 null이고, 고칠 때는 읽기만 한다. */
  modelName: string | null;
  /** 고칠 model의 지금 정보. 새 model이거나 정보가 없으면 null이다. */
  info: UserModelInfo | null;
  /** 정보 전체를 적는가(custom), 한도만 적는가(내장·구독). */
  mode: ModelInfoMode;
  /** form 맨 위에 보일 한 줄(연결한 provider가 목록을 주지 않았다는 안내). */
  lead?: string;
  onClose: () => void;
  onSave: (modelName: string, info: UserModelInfo) => Promise<ModelInfoOutcome>;
  /** 사람이 적은 정보를 지운다. custom은 그 model의 항목을 지우고, 내장·구독은 한도 override를 지워 원래 값을 따르게 한다. 고칠 때만 있다. */
  onRemove: () => Promise<ModelInfoOutcome>;
}

interface FormState {
  name: string;
  context: string;
  input: string;
  output: string;
  tools: boolean;
  inputMedia: readonly ModelMedia[];
  outputMedia: readonly ModelMedia[];
  effortOn: boolean;
  efforts: readonly EffortValue[];
  /** 빈 글이면 model에 맡긴다. */
  effortDefault: string;
  priceInput: string;
  priceOutput: string;
  priceCacheRead: string;
  priceCacheWrite: string;
}

const text = (value: number | null) => (value === null ? "" : String(value));
const price = (value: string | null | undefined) => value ?? "";

function stateOf(modelName: string | null, info: UserModelInfo | null) {
  return {
    name: modelName ?? "",
    context: text(info?.context_limit ?? null),
    input: text(info?.input_limit ?? null),
    output: text(info?.output_limit ?? null),
    // 적지 않은 tool 지원은 turn이 켠 것으로 돈다.
    tools: info?.supports_tools ?? true,
    inputMedia: info?.input_media ?? ["text"],
    outputMedia: info?.output_media ?? ["text"],
    effortOn: info?.effort != null,
    efforts: info?.effort?.values ?? [],
    effortDefault: info?.effort?.default_value ?? "",
    priceInput: price(info?.price?.input),
    priceOutput: price(info?.price?.output),
    priceCacheRead: price(info?.price?.cache_read),
    priceCacheWrite: price(info?.price?.cache_write),
  } satisfies FormState;
}

type Problems = Partial<
  Record<
    | "name"
    | "context"
    | "input"
    | "output"
    | "effort"
    | "priceInput"
    | "priceOutput"
    | "priceCacheRead"
    | "priceCacheWrite",
    string
  >
>;

const limitOf = (value: string): number | null | "invalid" => {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const number = Number(trimmed);
  return /^\d+$/.test(trimmed) && Number.isSafeInteger(number) && number > 0
    ? number
    : "invalid";
};

const priceOf = (value: string): string | null | "invalid" => {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  return /^\d+(\.\d+)?$/.test(trimmed) ? trimmed : "invalid";
};

/** form 값을 저장할 정보로 옮긴다. 틀린 칸이 있으면 칸별 오류를 돌려준다. 한도만 적는 form은 나머지 칸을 비운다(그 model의 원래 값을 따른다). */
function infoOf(
  form: FormState,
  mode: ModelInfoMode,
): { info: UserModelInfo } | { problems: Problems } {
  const problems: Problems = {};
  if (form.name.trim() === "") {
    problems.name = t("conversation.error.model-name-required");
  }
  const limit = (field: "context" | "input" | "output") => {
    const value = limitOf(form[field]);
    if (value === "invalid") {
      problems[field] = t("conversation.error.model-limit-invalid");
      return null;
    }
    return value;
  };
  const rate = (
    field: "priceInput" | "priceOutput" | "priceCacheRead" | "priceCacheWrite",
  ) => {
    const value = priceOf(form[field]);
    if (value === "invalid") {
      problems[field] = t("conversation.error.model-price-invalid");
      return null;
    }
    return value;
  };
  const context = limit("context");
  const input = limit("input");
  const output = limit("output");
  if (mode === "custom" && form.effortOn && form.efforts.length === 0) {
    problems.effort = t("conversation.error.model-effort-none");
  }
  const rates = {
    input: mode === "custom" ? rate("priceInput") : null,
    output: mode === "custom" ? rate("priceOutput") : null,
    cache_read: mode === "custom" ? rate("priceCacheRead") : null,
    cache_write: mode === "custom" ? rate("priceCacheWrite") : null,
  };
  if (Object.keys(problems).length > 0) return { problems };
  if (mode === "limits") {
    // 내장·구독 provider의 model은 catalog와 provider가 정한 나머지를 그대로 쓴다.
    return {
      info: {
        context_limit: context,
        input_limit: input,
        output_limit: output,
        supports_tools: null,
        input_media: null,
        output_media: null,
        effort: null,
        price: null,
      },
    };
  }
  return {
    info: {
      context_limit: context,
      input_limit: input,
      output_limit: output,
      supports_tools: form.tools,
      input_media: [...form.inputMedia],
      output_media: [...form.outputMedia],
      effort: form.effortOn
        ? {
            values: [...form.efforts],
            default_value:
              form.effortDefault === ""
                ? null
                : (form.effortDefault as EffortValue),
          }
        : null,
      price: Object.values(rates).every((value) => value === null)
        ? null
        : rates,
    },
  };
}

/** media 다섯 개의 icon toggle. text는 켜진 채 잠겨 있다. */
function MediaToggles({
  label,
  value,
  onChange,
}: {
  label: string;
  value: readonly ModelMedia[];
  onChange: (value: readonly ModelMedia[]) => void;
}) {
  return (
    <div className={styles.line}>
      <span className={styles.lineLabel}>{label}</span>
      <div className={styles.toggles} role="group" aria-label={label}>
        {MODEL_MEDIA.map((media) => {
          const on = value.includes(media);
          const name = t(`conversation.label.media-${media}`);
          return (
            <Tooltip key={media} content={name}>
              <IconButton
                icon={modelIcons[media]}
                label={name}
                size="sm"
                variant={on ? "secondary" : "ghost"}
                aria-pressed={on}
                disabled={media === "text"}
                onClick={() =>
                  onChange(
                    on
                      ? value.filter((item) => item !== media)
                      : MODEL_MEDIA.filter(
                          (item) => item === media || value.includes(item),
                        ),
                  )
                }
              />
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}

const MODEL_DEFAULT = "model";

export function ModelInfoForm(props: ModelInfoFormProps) {
  const editing = props.modelName !== null;
  const [form, setForm] = useState<FormState>(() =>
    stateOf(props.modelName, props.info),
  );
  const [problems, setProblems] = useState<Problems>({});
  const [outcome, setOutcome] = useState<
    "conflict" | "save-failed" | "remove-failed" | null
  >(null);
  const [busy, setBusy] = useState(false);
  const set = (change: Partial<FormState>) => {
    setForm((now) => ({ ...now, ...change }));
    setOutcome(null);
  };

  const finish = async (
    failed: "save-failed" | "remove-failed",
    run: () => Promise<ModelInfoOutcome>,
  ) => {
    setBusy(true);
    setOutcome(null);
    const result = await run();
    setBusy(false);
    if (result === "saved") props.onClose();
    else setOutcome(result === "conflict" ? result : failed);
  };
  const save = () => {
    const parsed = infoOf(form, props.mode);
    if ("problems" in parsed) {
      setProblems(parsed.problems);
      return;
    }
    setProblems({});
    void finish("save-failed", () =>
      props.onSave(form.name.trim(), parsed.info),
    );
  };
  // 한도만 적는 form은 수를 부르지 않고 "Automatic"만 보인다: 그 model이 provider와 catalog에서 받는 값은 화면이 정하지 않는다.
  const limitsOnly = props.mode === "limits";
  const automatic = t("conversation.label.model-limit-auto");

  const number = (
    field: "context" | "input" | "output",
    label: string,
    placeholder: string,
  ) => (
    <Field label={label} error={problems[field]}>
      <Input
        type="number"
        min={1}
        step={1}
        inputMode="numeric"
        autoComplete="off"
        value={form[field]}
        placeholder={placeholder}
        onChange={(event) => set({ [field]: event.currentTarget.value })}
      />
    </Field>
  );
  const rate = (
    field: "priceInput" | "priceOutput" | "priceCacheRead" | "priceCacheWrite",
    label: string,
  ) => (
    <Field label={label} error={problems[field]}>
      <Input
        inputMode="decimal"
        autoComplete="off"
        value={form[field]}
        placeholder={t("conversation.label.model-price-unknown")}
        onChange={(event) => set({ [field]: event.currentTarget.value })}
      />
    </Field>
  );

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      title={
        !editing
          ? t("conversation.title.add-model")
          : limitsOnly
            ? t("conversation.title.model-limits")
            : t("conversation.title.edit-model")
      }
      width="wide"
      actions={
        <>
          {!editing ? null : limitsOnly ? (
            // 내장·구독 provider의 model은 catalog에 그대로 있으므로 지우는 것이 아니라 사람이 적은 한도를 지운다.
            props.info === null ? null : (
              <Button
                variant="secondary"
                icon={actionIcons.reset}
                disabled={busy}
                onClick={() => void finish("remove-failed", props.onRemove)}
              >
                {t("conversation.button.reset-model-limits")}
              </Button>
            )
          ) : (
            <Button
              variant="danger"
              icon={actionIcons.remove}
              disabled={busy}
              onClick={() => void finish("remove-failed", props.onRemove)}
            >
              {t("conversation.button.remove-model")}
            </Button>
          )}
          <Button variant="secondary" onClick={props.onClose}>
            {t("common.button.cancel")}
          </Button>
          <Button
            variant="primary"
            icon={actionIcons.save}
            disabled={busy}
            onClick={save}
          >
            {t("conversation.button.save")}
          </Button>
        </>
      }
    >
      <div className={styles.form} data-model-info="">
        {props.lead === undefined ? null : (
          <p className={styles.note} role="status">
            {props.lead}
          </p>
        )}
        <Field label={t("conversation.label.model-name")} error={problems.name}>
          <Input
            autoComplete="off"
            value={form.name}
            disabled={editing}
            onChange={(event) => set({ name: event.currentTarget.value })}
          />
        </Field>
        <div className={styles.limits}>
          {number(
            "context",
            t("conversation.label.model-context-limit"),
            limitsOnly ? automatic : String(DEFAULT_CONTEXT),
          )}
          {number(
            "input",
            t("conversation.label.model-input-limit"),
            limitsOnly
              ? automatic
              : t("conversation.label.model-input-limit-default"),
          )}
          {number(
            "output",
            t("conversation.label.model-output-limit"),
            limitsOnly ? automatic : String(DEFAULT_OUTPUT),
          )}
        </div>
        <p className={styles.note}>
          {limitsOnly
            ? t("conversation.notice.model-limits-inherit")
            : t("conversation.notice.model-limits")}
        </p>
        {limitsOnly ? null : (
          <>
            <Switch
              label={t("conversation.label.model-tools")}
              checked={form.tools}
              onCheckedChange={(tools) => set({ tools })}
            />
            <MediaToggles
              label={t("conversation.label.model-input-media")}
              value={form.inputMedia}
              onChange={(inputMedia) => set({ inputMedia })}
            />
            <MediaToggles
              label={t("conversation.label.model-output-media")}
              value={form.outputMedia}
              onChange={(outputMedia) => set({ outputMedia })}
            />
            <p className={styles.note}>
              {t("conversation.notice.model-media")}
            </p>
            <Switch
              label={t("conversation.label.model-reasoning")}
              checked={form.effortOn}
              onCheckedChange={(effortOn) => set({ effortOn })}
            />
            {form.effortOn ? (
              <>
                <div className={styles.line}>
                  <span className={styles.lineLabel}>
                    {t("conversation.label.model-effort-values")}
                  </span>
                  <div
                    className={styles.chips}
                    role="group"
                    aria-label={t("conversation.label.model-effort-values")}
                  >
                    {EFFORT_VALUES.map((value) => {
                      const on = form.efforts.includes(value);
                      return (
                        <Button
                          key={value}
                          size="sm"
                          variant={on ? "secondary" : "ghost"}
                          aria-pressed={on}
                          onClick={() => {
                            const efforts = EFFORT_VALUES.filter((item) =>
                              item === value
                                ? !on
                                : form.efforts.includes(item),
                            );
                            // 고르지 않은 값을 기본으로 둘 수 없다.
                            set({
                              efforts,
                              effortDefault: efforts.includes(
                                form.effortDefault as EffortValue,
                              )
                                ? form.effortDefault
                                : "",
                            });
                          }}
                        >
                          {EFFORT_LABELS[value]}
                        </Button>
                      );
                    })}
                  </div>
                </div>
                {problems.effort === undefined ? null : (
                  <p className={styles.error} role="alert">
                    {problems.effort}
                  </p>
                )}
                <Field label={t("conversation.label.model-effort-default")}>
                  <Select
                    value={
                      form.effortDefault === ""
                        ? MODEL_DEFAULT
                        : form.effortDefault
                    }
                    onValueChange={(value) =>
                      set({
                        effortDefault: value === MODEL_DEFAULT ? "" : value,
                      })
                    }
                    options={[
                      {
                        value: MODEL_DEFAULT,
                        label: t("conversation.label.model-effort-model"),
                      },
                      ...form.efforts.map((value) => ({
                        value,
                        label: EFFORT_LABELS[value],
                      })),
                    ]}
                  />
                </Field>
              </>
            ) : null}
            <div
              className={styles.prices}
              role="group"
              aria-label={t("conversation.label.model-prices")}
            >
              <span className={styles.lineLabel}>
                {t("conversation.label.model-prices")}
              </span>
              <div className={styles.priceFields}>
                {rate("priceInput", t("conversation.label.model-price-input"))}
                {rate(
                  "priceOutput",
                  t("conversation.label.model-price-output"),
                )}
                {rate(
                  "priceCacheRead",
                  t("conversation.label.model-price-cache-read"),
                )}
                {rate(
                  "priceCacheWrite",
                  t("conversation.label.model-price-cache-write"),
                )}
              </div>
              <p className={styles.note}>
                {t("conversation.notice.model-prices")}
              </p>
            </div>
          </>
        )}
        {outcome === null ? null : (
          <p className={styles.error} role="alert" data-model-info-problem="">
            {outcome === "conflict"
              ? t("conversation.error.model-info-conflict")
              : outcome === "save-failed"
                ? t("conversation.error.model-info-failed")
                : limitsOnly
                  ? t("conversation.error.model-info-reset-failed")
                  : t("conversation.error.model-info-remove-failed")}
          </p>
        )}
      </div>
    </Dialog>
  );
}

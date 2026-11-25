// workflow.yaml의 선언적 inputs 폼. protocol의 resolveInputDefaults·evaluateInputWhen을 그대로 써서
// core의 validateWorkflowInputs와 같은 가시성·기본값 규칙으로 9종 입력 칸을 그린다.
import { type ReactNode, useState } from "react";
import { Checkbox, Field, Input, Select, Textarea } from "@lophn/ui/input";
import { Icon } from "@lophn/ui/primitives";
import { iconPixels } from "@lophn/ui/shared";
import { t } from "@lophn/i18n";

import {
  evaluateInputWhen,
  resolveInputDefaults,
  type WorkflowInputField,
  type WorkflowInputOption,
  type WorkflowInputPathKind,
  type WorkflowInputsDeclaration,
} from "../../../protocol/workflows/inputs.ts";
import { editorIcons } from "../icons/mod.ts";
import type { CallableAgentOptionView } from "../workspace/source.ts";
import styles from "./inputs-form.module.css";

/** core의 validateWorkflowInputs와 같은 고정점 반복으로 현재 보이는 입력 키 집합을 구한다. */
export function visibleInputKeys(
  declarations: WorkflowInputsDeclaration,
  rawValues: Readonly<Record<string, unknown>>,
): Set<string> {
  const entries = Object.entries(declarations);
  const resolved = resolveInputDefaults(declarations, rawValues);
  let visible = new Set(entries.map(([key]) => key));
  for (let pass = 0; pass <= entries.length; pass += 1) {
    const effective: Record<string, unknown> = {};
    for (const key of visible) {
      if (resolved[key] !== undefined) effective[key] = resolved[key];
    }
    const next = new Set<string>();
    for (const [key, field] of entries) {
      if (evaluateInputWhen(field.when, effective)) {
        next.add(key);
      }
    }
    if (
      next.size === visible.size &&
      [...next].every((key) => visible.has(key))
    ) {
      return next;
    }
    visible = next;
  }
  return visible;
}

function normalizeOptions(
  options: readonly WorkflowInputOption[] | undefined,
): readonly { value: string; label: string }[] {
  return (options ?? []).map((opt) =>
    typeof opt === "string"
      ? { value: opt, label: opt }
      : { value: opt.value, label: opt.label ?? opt.value },
  );
}

function defaultPathPlaceholder(
  kind: WorkflowInputPathKind | undefined,
): string {
  if (kind === "file") return t("workflow.placeholder.input-path-file");
  if (kind === "dir") return t("workflow.placeholder.input-path-dir");
  return t("workflow.placeholder.input-path-any");
}

function fieldLabel(key: string, field: WorkflowInputField): string {
  const base = field.label ?? key;
  return field.required
    ? t("workflow.label.input-required", { label: base })
    : base;
}

function Message({ help, error }: { help?: string; error?: string }) {
  const text = error ?? help;
  if (text === undefined) return null;
  const invalid = error !== undefined;
  return (
    <p className={styles.message} data-tone={invalid ? "error" : "help"}>
      {invalid ? (
        <Icon
          icon={editorIcons.problem}
          pixels={iconPixels("base")}
          className={styles.errorIcon}
        />
      ) : null}
      <span>{text}</span>
    </p>
  );
}

export interface InputsFormProps {
  declarations: WorkflowInputsDeclaration;
  values: Readonly<Record<string, unknown>>;
  errors?: Readonly<Record<string, string>>;
  callableAgents?: readonly CallableAgentOptionView[];
  disabled?: boolean;
  /** 이 key의 칸만 그린다(step마다 자기 입력을 나눠 보일 때). 없으면 모두 그린다. 보일지는 여전히 전체 값으로 정한다. */
  keys?: readonly string[];
  onChange: (key: string, value: unknown) => void;
  /** 기본값과 다른 필드 옆/아래에 표시할 인라인 행동(예: 기본값으로 저장). */
  renderFieldAction?: (key: string) => ReactNode;
}

export function InputsForm({
  declarations,
  values,
  errors = {},
  callableAgents = [],
  disabled = false,
  keys,
  onChange,
  renderFieldAction,
}: InputsFormProps) {
  const [numberDrafts, setNumberDrafts] = useState<
    Readonly<Record<string, string>>
  >({});
  const visible = visibleInputKeys(declarations, values);
  const entries = Object.entries(declarations).filter(
    ([key]) => visible.has(key) && (keys === undefined || keys.includes(key)),
  );
  if (entries.length === 0) return null;

  return (
    <div className={styles.form} data-inputs-form="">
      {entries.map(([key, field]) => {
        const label = fieldLabel(key, field);
        const value = values[key];
        const error = errors[key];
        const action = renderFieldAction?.(key);
        const actionRow =
          action === undefined || action === null ? null : (
            <div className={styles.fieldAction} data-input-action={key}>
              {action}
            </div>
          );
        const control = (() => {
          switch (field.type) {
            case "string":
              return (
                <Field label={label} help={field.description} error={error}>
                  <Input
                    type="text"
                    value={typeof value === "string" ? value : ""}
                    placeholder={field.placeholder}
                    disabled={disabled}
                    onChange={(event) => onChange(key, event.target.value)}
                  />
                </Field>
              );
            case "text":
              return (
                <Field label={label} help={field.description} error={error}>
                  <Textarea
                    rows={3}
                    value={typeof value === "string" ? value : ""}
                    placeholder={field.placeholder}
                    disabled={disabled}
                    onChange={(event) => onChange(key, event.target.value)}
                  />
                </Field>
              );
            case "number": {
              const shown =
                numberDrafts[key] !== undefined
                  ? numberDrafts[key]
                  : typeof value === "number"
                    ? String(value)
                    : typeof value === "string"
                      ? value
                      : "";
              return (
                <Field label={label} help={field.description} error={error}>
                  <Input
                    type="number"
                    min={field.min}
                    max={field.max}
                    step="any"
                    value={shown}
                    placeholder={field.placeholder}
                    disabled={disabled}
                    onChange={(event) => {
                      const raw = event.target.value;
                      setNumberDrafts((prev) => ({ ...prev, [key]: raw }));
                      if (raw.trim() === "") {
                        onChange(
                          key,
                          field.default === undefined ? undefined : "",
                        );
                        return;
                      }
                      const parsed = Number(raw);
                      onChange(key, Number.isFinite(parsed) ? parsed : raw);
                    }}
                  />
                </Field>
              );
            }
            case "boolean":
              return (
                <div
                  className={styles.group}
                  data-invalid={error !== undefined || undefined}
                >
                  <Checkbox
                    label={label}
                    checked={value === true}
                    disabled={disabled}
                    onCheckedChange={(checked) => onChange(key, checked)}
                  />
                  <Message help={field.description} error={error} />
                </div>
              );
            case "select": {
              const options = normalizeOptions(field.options);
              return (
                <Field label={label} help={field.description} error={error}>
                  <Select
                    value={typeof value === "string" ? value : ""}
                    onValueChange={(next) => onChange(key, next)}
                    options={options}
                    placeholder={
                      field.placeholder ??
                      t("workflow.placeholder.input-select")
                    }
                    disabled={disabled}
                  />
                </Field>
              );
            }
            case "multiselect": {
              const options = normalizeOptions(field.options);
              const selected = Array.isArray(value)
                ? value.filter(
                    (item): item is string => typeof item === "string",
                  )
                : [];
              const selectedSet = new Set(selected);
              const toggle = (optionValue: string, checked: boolean) => {
                const nextSet = new Set(selectedSet);
                if (checked) nextSet.add(optionValue);
                else nextSet.delete(optionValue);
                const ordered = options
                  .map((opt) => opt.value)
                  .filter((val) => nextSet.has(val));
                onChange(key, ordered);
              };
              return (
                <fieldset
                  className={styles.fieldset}
                  data-invalid={error !== undefined || undefined}
                >
                  <legend className={styles.legend}>{label}</legend>
                  <div className={styles.options}>
                    {options.map((opt) => (
                      <Checkbox
                        key={opt.value}
                        label={opt.label}
                        checked={selectedSet.has(opt.value)}
                        disabled={disabled}
                        onCheckedChange={(checked) =>
                          toggle(opt.value, checked)
                        }
                      />
                    ))}
                  </div>
                  <Message help={field.description} error={error} />
                </fieldset>
              );
            }
            case "agent": {
              if (callableAgents.length > 0) {
                const options = callableAgents.map((agent) => ({
                  value: agent.name,
                  label: agent.label ?? agent.name,
                }));
                return (
                  <Field label={label} help={field.description} error={error}>
                    <Select
                      value={typeof value === "string" ? value : ""}
                      onValueChange={(next) => onChange(key, next)}
                      options={options}
                      placeholder={
                        field.placeholder ??
                        t("workflow.placeholder.input-select-agent")
                      }
                      disabled={disabled}
                    />
                  </Field>
                );
              }
              return (
                <Field label={label} help={field.description} error={error}>
                  <Input
                    type="text"
                    value={typeof value === "string" ? value : ""}
                    placeholder={
                      field.placeholder ?? t("workflow.placeholder.input-agent")
                    }
                    disabled={disabled}
                    onChange={(event) => {
                      const raw = event.target.value;
                      onChange(
                        key,
                        raw === "" && field.default === undefined
                          ? undefined
                          : raw,
                      );
                    }}
                  />
                </Field>
              );
            }
            case "path":
              return (
                <Field label={label} help={field.description} error={error}>
                  <Input
                    type="text"
                    value={typeof value === "string" ? value : ""}
                    placeholder={
                      field.placeholder ?? defaultPathPlaceholder(field.kind)
                    }
                    disabled={disabled}
                    onChange={(event) => {
                      const raw = event.target.value;
                      onChange(
                        key,
                        raw === "" && field.default === undefined
                          ? undefined
                          : raw,
                      );
                    }}
                  />
                </Field>
              );
            case "project":
              return (
                <Field label={label} help={field.description} error={error}>
                  <Input
                    type="text"
                    value={typeof value === "string" ? value : ""}
                    placeholder={
                      field.placeholder ??
                      t("workflow.placeholder.input-project")
                    }
                    disabled={disabled}
                    onChange={(event) => {
                      const raw = event.target.value;
                      onChange(
                        key,
                        raw === "" && field.default === undefined
                          ? undefined
                          : raw,
                      );
                    }}
                  />
                </Field>
              );
          }
        })();
        return (
          <div key={key} className={styles.item} data-input-field={key}>
            {control}
            {actionRow}
          </div>
        );
      })}
    </div>
  );
}

// 선언된 검색의 입력 form. 선언의 입력 이름·타입에서 그린다: 고르는 입력은
// 타이핑으로 후보를 거르는 combobox, 여럿 고르는 입력은 chip, 범위 입력은 시작·끝 두 칸. 그릴 수
// 없는 입력 타입이면 form 대신 이유만 보인다.
// 문구 key는 packages/design/wording/en.ts에 이미 있다. 구현은 en.ts를 고치지 않고 아래 key만 t()로 쓴다:
//   contexts.button.input-save-view
//   contexts.button.input-search
//   contexts.label.input-chip-on
//   contexts.label.input-from
//   contexts.label.input-no-matches
//   contexts.label.input-to
//   contexts.note.input-unsupported
import { type ReactNode, useId } from "react";
import { Button } from "@lophn/ui/primitives";
import { Field, Input } from "@lophn/ui/input";
import { t } from "@lophn/wording";

import { PickCombobox } from "./search-input-form-combobox.tsx";
import styles from "./search-input-form.module.css";
import type {
  DeclaredSearch,
  OptionValue,
  PickOption,
  SearchInputValues,
} from "./source.ts";
import type { RangeValue } from "./shared.ts";

interface SearchInputFormProps {
  readonly search: DeclaredSearch;
  /** 채워 둔 값. 고르는 입력은 후보 value(여럿이면 value 목록), 범위는 RangeValue, 글은 문자열. */
  readonly values: SearchInputValues;
  /** 입력 이름 → 후보. 후보에 없는 값은 고를 수 없다. */
  readonly options: Readonly<Record<string, readonly PickOption[]>>;
  readonly onChange: (name: string, value: unknown) => void;
  /** [Search]. */
  readonly onSearch: () => void;
  /** [Save as view]. */
  readonly onSaveView: () => void;
}

type DeclaredInput = DeclaredSearch["inputs"][number];

const DRAWABLE: readonly string[] = ["entity", "value", "range", "text"];

export function SearchInputForm(props: SearchInputFormProps): ReactNode {
  const { search } = props;
  const unsupported = search.inputs.find((input) =>
    !DRAWABLE.includes(input.type)
  );
  if (unsupported) {
    return (
      <div className={styles.unsupported}>
        <p className={styles.note} data-unsupported="">
          {t("contexts.note.input-unsupported", { type: unsupported.type })}
        </p>
      </div>
    );
  }
  return (
    <div className={styles.form}>
      {search.inputs.map((input) => (
        <InputField key={input.name} input={input} {...props} />
      ))}
      <div className={styles.actions}>
        <Button variant="primary" onClick={props.onSearch}>
          {t("contexts.button.input-search")}
        </Button>
        <Button onClick={props.onSaveView}>
          {t("contexts.button.input-save-view")}
        </Button>
      </div>
    </div>
  );
}

function InputField(
  { input, values, options, onChange, onSearch }:
    & SearchInputFormProps
    & { readonly input: DeclaredInput },
) {
  const inputId = useId();
  const value = values[input.name];
  const candidates = options[input.name] ?? [];
  const picks = input.type === "entity" || input.type === "value";

  if (input.type === "range") {
    const range = rangeOf(value);
    return (
      <div className={styles.group} role="group" data-input={input.name}>
        <span className={styles.label} data-input-label="">{input.label}</span>
        <div className={styles.rangeRow}>
          <Field label={t("contexts.label.input-from")}>
            <Input
              value={range.from}
              onChange={(event) =>
                onChange(input.name, { ...range, from: event.target.value })}
            />
          </Field>
          <Field label={t("contexts.label.input-to")}>
            <Input
              value={range.to}
              onChange={(event) =>
                onChange(input.name, { ...range, to: event.target.value })}
            />
          </Field>
        </div>
      </div>
    );
  }

  if (picks && input.many) {
    const chosen = listOf(value);
    return (
      <div className={styles.group} role="group" data-input={input.name}>
        <span className={styles.label} data-input-label="">{input.label}</span>
        <div className={styles.chips}>
          {candidates.map((option) => {
            const on = chosen.includes(option.value);
            return (
              <Button
                key={`${typeof option.value}:${option.value}`}
                variant={on ? "secondary" : "ghost"}
                size="sm"
                aria-pressed={on}
                onClick={() =>
                  onChange(
                    input.name,
                    on
                      ? chosen.filter((item) => item !== option.value)
                      : [...chosen, option.value],
                  )}
              >
                {on
                  ? t("contexts.label.input-chip-on", { value: option.label })
                  : option.label}
              </Button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.group} data-input={input.name}>
      <label
        className={styles.label}
        htmlFor={inputId}
        data-input-label=""
      >
        {input.label}
      </label>
      {picks
        ? (
          <PickCombobox
            inputId={inputId}
            options={candidates}
            value={optionValueOf(value)}
            onPick={(next) => onChange(input.name, next)}
          />
        )
        : (
          <input
            id={inputId}
            className={styles.control}
            value={typeof value === "string"
              ? value
              : value == null
              ? ""
              : String(value)}
            onChange={(event) => onChange(input.name, event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onSearch();
            }}
          />
        )}
    </div>
  );
}

function rangeOf(value: unknown): RangeValue {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const { from, to } = value as Record<string, unknown>;
    return { from: textOf(from), to: textOf(to) };
  }
  return { from: "", to: "" };
}

function textOf(value: unknown): string {
  return value === undefined || value === null ? "" : String(value);
}

/** 고른 후보의 value. 문자열·숫자·불리언이 아니면 고른 것이 없는 빈 글자다. */
function optionValueOf(value: unknown): OptionValue {
  return typeof value === "string" || typeof value === "number" ||
      typeof value === "boolean"
    ? value
    : "";
}

function listOf(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

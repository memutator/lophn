// composer의 model 단추와 picker, option 축 묶음, Agents 화면의 form이 쓰는 Model 칸. 위에서부터 검색칸,
// Favorites, provider 묶음(vendor 아이콘), 고른 model의 option 축이다. 화면 코드에는 model 이름도 option 값도
// 없다. 정렬·거르기·option 축·기본 값 맞춤은 model catalog가 계산해 props로 주고, 이 component는 받은 순서대로
// 그린다. model을 바꾸면 값은 조용히 맞고 알림은 없다.
import { createContext, type KeyboardEvent, type ReactNode } from "react";
import {
  Button,
  Field,
  Icon,
  iconPixels,
  Popover,
  Select,
  VendorIcon,
  vendorOf,
} from "@lophn/design/components";
import { conversationIcons } from "../../icons/mod.ts";
import { t } from "@lophn/wording";

import styles from "./model-picker.module.css";
import type {
  ModelPickerProps,
  ModelSelectionView,
  PickerModelRef,
  PickerModelRow,
} from "./types.ts";

export type {
  ModelPickerProps,
  ModelSelectionView,
  PickerAxisView,
  PickerLayoutView,
  PickerModelRef,
  PickerModelRow,
  PickerProviderGroup,
} from "./types.ts";

/**
 * 별표 찍은 model을 여러 picker가 함께 쓰게 하고 싶은 host가 감싼다. 이름은 찍은 순서다. picker는
 * `layout`의 별표를 읽고 눌림을 props로 알려 이 값을 읽지 않는다.
 */
interface Favorites {
  readonly names: readonly string[];
  readonly toggle: (name: string) => void;
}

export const FavoritesContext = createContext<Favorites | null>(null);

function same(first: PickerModelRef, second: PickerModelRef): boolean {
  return first.provider === second.provider &&
    first.modelName === second.modelName;
}

function ModelRow(
  { row, current, showProvider, onPick, onToggleFavorite }: {
    row: PickerModelRow;
    current: boolean;
    showProvider: boolean;
    onPick: (model: PickerModelRef) => void;
    onToggleFavorite: (model: PickerModelRef) => void;
  },
) {
  const model = { provider: row.provider, modelName: row.modelName };
  const starLabel = t(
    row.starred
      ? "conversation.button.favorite-remove"
      : "conversation.button.favorite-add",
    { model: row.modelName },
  );
  // 줄 안의 별에서 올라온 key는 줄을 고른 것으로 치지 않는다.
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onPick(model);
  };
  return (
    <div
      role="option"
      tabIndex={0}
      aria-selected={current}
      data-model={row.modelName}
      className={styles.row}
      onClick={() => onPick(model)}
      onKeyDown={keyDown}
    >
      <span className={styles.check}>
        {current
          ? (
            <Icon
              icon={conversationIcons.current}
              pixels={iconPixels("base")}
            />
          )
          : null}
      </span>
      <span className={styles.name}>{row.modelName}</span>
      {showProvider
        ? <span className={styles.provider}>{row.providerLabel}</span>
        : null}
      <button
        type="button"
        className={styles.star}
        aria-label={starLabel}
        aria-pressed={row.starred}
        onClick={(event) => {
          event.stopPropagation();
          onToggleFavorite(model);
        }}
      >
        <Icon icon={conversationIcons.favorite} pixels={iconPixels("base")} />
      </button>
    </div>
  );
}

/** 고른 model의 option 축만 보인다. 없으면 없다고 말한다. */
export function OptionAxes(
  { selection, onChange }: {
    selection: Pick<ModelSelectionView, "axes" | "optionValues">;
    onChange: (axis: string, value: string) => void;
  },
) {
  if (selection.axes.length === 0) {
    return (
      <p className={styles.note}>
        {t("conversation.notice.no-model-options")}
      </p>
    );
  }
  return selection.axes.map((axis) => (
    <div key={axis.id} className={styles.axis}>
      <span className={styles.axisLabel}>{axis.label}</span>
      <div className={styles.values} role="group" aria-label={axis.label}>
        {axis.values.map((item) => {
          const on = selection.optionValues[axis.id] === item.value;
          return (
            <Button
              key={item.value}
              size="sm"
              variant={on ? "secondary" : "ghost"}
              aria-pressed={on}
              onClick={() => onChange(axis.id, item.value)}
            >
              {item.label}
            </Button>
          );
        })}
      </div>
    </div>
  ));
}

/** provider 묶음 머리: vendor 아이콘과 이름. 모르는 이름이면 아이콘이 없다. */
function ProviderHeading({ label }: { label: string }) {
  const vendor = vendorOf(label);
  return (
    <h3 className={`${styles.heading} ${styles.vendor}`}>
      {vendor === undefined ? null : <VendorIcon vendor={vendor} size={14} />}
      {label}
    </h3>
  );
}

// 단추 글은 model 이름 뒤에 값이 있는 축의 표시 이름을 catalog가 준 순서대로 이어 붙인 것이다.
function buttonText(props: ModelPickerProps): string {
  const values = props.axes.flatMap((axis) => {
    const chosen = axis.values.find((item) =>
      item.value === props.optionValues[axis.id]
    );
    return chosen ? [chosen.label] : [];
  });
  return [props.currentLabel, ...values].join(" · ");
}

export function ModelPicker(props: ModelPickerProps): ReactNode {
  const { layout, current } = props;
  const empty = layout.favorites.length === 0 &&
    layout.providers.every((group) => group.models.length === 0);
  return (
    <Popover
      open={props.open}
      onOpenChange={props.onOpenChange}
      trigger={
        <Button size="sm" variant="ghost" data-model-button="">
          {buttonText(props)}
          <Icon icon={conversationIcons.expand} pixels={iconPixels("base")} />
        </Button>
      }
    >
      <div className={styles.picker} data-model-picker="">
        <label className={styles.search} data-picker-section="search">
          <Icon icon={conversationIcons.search} pixels={iconPixels("base")} />
          <input
            className={styles.searchInput}
            aria-label={t("conversation.label.search-models")}
            placeholder={t("conversation.label.search-models")}
            value={props.query}
            onChange={(event) => props.onQueryChange(event.currentTarget.value)}
          />
        </label>
        <div
          className={styles.list}
          role="listbox"
          aria-label={t("conversation.label.model-list")}
        >
          {empty
            ? (
              <p className={styles.note}>
                {t("conversation.notice.no-models")}
              </p>
            )
            : null}
          {layout.favorites.length === 0
            ? null
            : (
              <div data-picker-section="favorites" role="presentation">
                <h3 className={styles.heading}>
                  {t("conversation.label.favorites")}
                </h3>
                {layout.favorites.map((row) => (
                  <ModelRow
                    key={`${row.provider}/${row.modelName}`}
                    row={row}
                    current={same(row, current)}
                    showProvider
                    onPick={props.onPick}
                    onToggleFavorite={props.onToggleFavorite}
                  />
                ))}
              </div>
            )}
          {layout.providers.map((group) => (
            <div
              key={group.provider}
              data-picker-section="provider"
              data-provider={group.provider}
              role="presentation"
            >
              <ProviderHeading label={group.label} />
              {group.models.map((row) => (
                <ModelRow
                  key={row.modelName}
                  row={row}
                  current={same(row, current)}
                  showProvider={false}
                  onPick={props.onPick}
                  onToggleFavorite={props.onToggleFavorite}
                />
              ))}
            </div>
          ))}
        </div>
        <div className={styles.axes} data-picker-section="axes">
          <OptionAxes selection={props} onChange={props.onOptionChange} />
        </div>
        <div className={styles.foot} data-picker-section="defaults">
          <Button size="sm" variant="ghost" onClick={props.onChangeDefaults}>
            {t("conversation.button.change-defaults")}
          </Button>
        </div>
      </div>
    </Popover>
  );
}

const INHERIT = "inherit";

/**
 * Model 칸. 처음에는 위 층의 값을 따르고(`inherited`), 바꾸면 바뀐 칸만 저장된다는 뜻으로 Changed와 [Reset]이
 * 붙는다. 아래 option 축은 지금 model이 가진 것만 보인다. 선택지와 축은 catalog가 준 값이다.
 */
export function ModelField(
  {
    label,
    inheritLabel,
    choices,
    inherited,
    value,
    onChange,
    onOptionChange,
    overrideNote,
  }: {
    label: string;
    /** "Use project default — Haiku 5.5 (from Workspace)" 같은 따르기 선택지의 글. */
    inheritLabel: string;
    /** 고를 수 있는 model. `value`는 `ModelSelectionView.model`과 같은 값이다. */
    choices: readonly { readonly value: string; readonly label: string }[];
    inherited: ModelSelectionView;
    /** 이 칸에서 고른 값. 따르는 중이면 null이다. */
    value: ModelSelectionView | null;
    /** model을 골랐다. 따르기를 골랐으면 null이다. 새 model의 option은 catalog의 기본값이다. */
    onChange: (model: string | null) => void;
    onOptionChange: (axis: string, value: string) => void;
    overrideNote?: string;
  },
) {
  const effective = value ?? inherited;
  return (
    <div className={styles.field}>
      <Field label={label}>
        <Select
          options={[{ value: INHERIT, label: inheritLabel }, ...choices]}
          value={value === null ? INHERIT : value.model}
          onValueChange={(next) => onChange(next === INHERIT ? null : next)}
        />
      </Field>
      <div className={styles.fieldAxes}>
        <OptionAxes selection={effective} onChange={onOptionChange} />
      </div>
      {value === null ? null : (
        <p className={styles.changedRow}>
          <span className={styles.changed}>
            {t("conversation.label.model-changed")}
          </span>
          {overrideNote === undefined
            ? null
            : <span className={styles.changedNote}>{overrideNote}</span>}
          <Button size="sm" variant="ghost" onClick={() => onChange(null)}>
            {t("conversation.button.model-reset")}
          </Button>
        </p>
      )}
    </div>
  );
}

// composer의 model 단추와 picker(shell/desktop#R44, lophn-agent/harness/model#R21·R25·R26). 화면 코드에는
// model 이름도 option 값도 없다. 정렬·거르기·option 축·값 맞춤 알림은 model catalog 쪽 모듈
// (harness/model의 options·picker-order)이 계산해 props로 주고, 이 component는 받은 순서대로 그린다.
// renderer는 contracts·design·sdk만 import하므로 그 모듈을 부르는 연결은 core source 쪽 몫이다.
import type { KeyboardEvent, ReactNode } from "react";
import {
  Button,
  conversationIcons,
  Icon,
  iconPixels,
  Popover,
} from "@lophn/design/components";
import { t } from "@lophn/wording";

import styles from "./model-picker.module.css";

/** model 하나. 같은 이름이 provider마다 있을 수 있어 provider와 이름의 쌍으로 구별한다. */
export interface PickerModelRef {
  /** provider(계정) id. */
  readonly provider: string;
  readonly modelName: string;
}

export interface PickerModelRow extends PickerModelRef {
  /** 줄에 보이는 provider 이름. Favorites 줄에서 어느 provider의 것인지 알린다. */
  readonly providerLabel: string;
  /** 별표가 켜졌는지. Favorites 줄은 항상 켜져 있고, provider 묶음 줄은 즐겨찾기에 있으면 켜진다. */
  readonly starred: boolean;
}

export interface PickerProviderGroup {
  readonly provider: string;
  /** 묶음 머리 글(Anthropic 등). */
  readonly label: string;
  readonly models: readonly PickerModelRow[];
}

/** 검색을 반영한 목록. Favorites는 별표를 찍은 순서 그대로이고 검색 중에도 먼저다(R26). */
export interface PickerLayoutView {
  readonly favorites: readonly PickerModelRow[];
  readonly providers: readonly PickerProviderGroup[];
}

/** 고른 model이 가진 option 축 하나(effort, speed 등). 순서와 표시 이름은 catalog가 정한다. */
export interface PickerAxisView {
  readonly id: string;
  readonly label: string;
  readonly values: readonly {
    readonly value: string;
    readonly label: string;
  }[];
}

/** model을 바꿔 값을 맞췄다는 알림 한 건. 문구는 shell/wording이 만든다. */
export interface PickerNoticeView {
  readonly axisLabel: string;
  /** 맞추기 전 값의 표시 이름(XHigh). */
  readonly fromLabel: string;
  /** 맞춘 뒤 값의 표시 이름(High). */
  readonly toLabel: string;
}

export interface ModelPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 이 session에서 고른 model. */
  current: PickerModelRef;
  /** 고른 model의 표시 이름(Sonnet 5.5). 단추와 알림 문구에 쓴다. */
  currentLabel: string;
  /** 고른 model이 가진 축. 없으면 빈 배열이다. */
  axes: readonly PickerAxisView[];
  /** 축 id → 고른 값. 없는 축은 모델에 맡김이라 단추에 붙이지 않는다. */
  optionValues: Readonly<Record<string, string>>;
  /** 검색칸의 글. */
  query: string;
  layout: PickerLayoutView;
  /** 방금 model을 바꾸며 맞춘 값. 비어 있으면 알림이 없다. */
  notices: readonly PickerNoticeView[];
  onQueryChange: (query: string) => void;
  onPick: (model: PickerModelRef) => void;
  /** 별표를 눌렀다. 줄을 고른 것으로 치지 않는다. */
  onToggleFavorite: (model: PickerModelRef) => void;
  onOptionChange: (axis: string, value: string) => void;
  /** "Change defaults…" 를 눌렀다. Settings › Agents로 간다(R50). */
  onChangeDefaults: () => void;
}

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

function Axes(
  { axes, optionValues, onOptionChange }: Pick<
    ModelPickerProps,
    "axes" | "optionValues" | "onOptionChange"
  >,
) {
  if (axes.length === 0) {
    return (
      <p className={styles.note}>
        {t("conversation.notice.no-model-options")}
      </p>
    );
  }
  return axes.map((axis) => (
    <div key={axis.id} className={styles.axis}>
      <span className={styles.axisLabel}>{axis.label}</span>
      <div className={styles.values} role="group" aria-label={axis.label}>
        {axis.values.map((item) => {
          const on = optionValues[axis.id] === item.value;
          return (
            <Button
              key={item.value}
              size="sm"
              variant={on ? "secondary" : "ghost"}
              aria-pressed={on}
              onClick={() => onOptionChange(axis.id, item.value)}
            >
              {item.label}
            </Button>
          );
        })}
      </div>
    </div>
  ));
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
              <h3 className={styles.heading}>{group.label}</h3>
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
          <Axes
            axes={props.axes}
            optionValues={props.optionValues}
            onOptionChange={props.onOptionChange}
          />
        </div>
        {props.notices.map((notice) => (
          <p key={notice.axisLabel} className={styles.alert} role="status">
            {t("conversation.notice.model-value-fitted", {
              axis: notice.axisLabel,
              from: notice.fromLabel,
              to: notice.toLabel,
              model: props.currentLabel,
            })}
          </p>
        ))}
        <p className={styles.note} data-picker-section="scope">
          {t("conversation.notice.model-session-only")}
        </p>
        <div className={styles.foot} data-picker-section="defaults">
          <Button size="sm" variant="ghost" onClick={props.onChangeDefaults}>
            {t("conversation.button.change-defaults")}
          </Button>
        </div>
      </div>
    </Popover>
  );
}

// composer의 model 단추와 picker(shell/desktop#R44, lophn-agent/harness/model#R21·R25·R26). 화면 코드에는
// model 이름도 option 값도 없다. 정렬·거르기·option 축·값 맞춤 알림은 model catalog 쪽 모듈
// (contracts/lophn-agent의 model-picker)이 계산해 props로 주고, 이 component는 받은 순서대로 그린다.
// renderer는 contracts·design·sdk만 import하므로 그 모듈을 부르는 연결은 core source 쪽 몫이다.
import type { KeyboardEvent, ReactNode } from "react";
import { Button, Icon, iconPixels, Popover } from "@lophn/design/components";
import { conversationIcons } from "../../icons/mod.ts";
import { t } from "@lophn/wording";

import styles from "./model-picker.module.css";
import type {
  ModelPickerProps,
  PickerModelRef,
  PickerModelRow,
} from "./types.ts";

export type {
  ModelPickerProps,
  PickerAxisView,
  PickerLayoutView,
  PickerModelRef,
  PickerModelRow,
  PickerNoticeView,
  PickerProviderGroup,
} from "./types.ts";

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
          {t(
            props.scope === "definition"
              ? "conversation.notice.model-definition"
              : "conversation.notice.model-session-only",
          )}
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

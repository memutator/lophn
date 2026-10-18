// model을 고르는 picker 하나. composer의 작은 단추(ModelPicker)와 Settings·Operator·project의 칸(ModelPickerField)이 같은
// Popover 목록을 쓴다. 위에서부터 층 한 줄(대화만), 검색칸, 따르기 줄(있을 때), Favorites, provider 묶음(vendor 아이콘),
// 이름 직접 적기, 고른 model의 option 축, 맨 아래 Connect provider와 Change defaults(대화만)다. 화면 코드에는 model 이름도
// option 값도 없다. 정렬·거르기·option 축·기본 값 맞춤은 model catalog가 계산해 props로 주고, 이 component는 받은
// 순서대로 그린다. model을 바꾸면 값은 조용히 맞고 알림은 없다.
import {
  createContext,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  useState,
} from "react";
import { VendorIcon, vendorOf } from "../../parts/vendor-icon/vendor-icon.tsx";
import { Button, Icon } from "@lophn/ui/primitives";
import { Popover, PopoverRow } from "@lophn/ui/overlay";
import { iconPixels } from "@lophn/ui/shared";
import {
  commonIcons,
  conversationIcons,
  settingsEntryIcon,
} from "../../icons/mod.ts";
import { useConnectProvider } from "../../desktop/settings/providers/connect-host.tsx";
import { t } from "@lophn/wording";

import styles from "./model-picker.module.css";
import { TypedModelRow } from "./typed-model.tsx";
import type {
  ModelPickerProps,
  PickerModelRef,
  PickerModelRow,
  PickerProviderGroup,
} from "./types.ts";

export type {
  FollowView,
  ModelPickerProps,
  PickerAxisView,
  PickerLayoutView,
  PickerModelRef,
  PickerModelRow,
  PickerProviderGroup,
  TypedModelView,
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
    selection: Pick<ModelPickerProps, "axes" | "optionValues">;
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

/** 지금 model이 어느 층에서 왔는지 한 줄로 말한다. 층을 모르면 줄이 없다. */
function LayerLine({ layer }: { layer: ModelPickerProps["layer"] }) {
  if (layer === null) return null;
  return (
    <p className={styles.layer} data-picker-section="layer">
      {t("conversation.label.model-layer", { layer })}
    </p>
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

function providerNameOf(props: ModelPickerProps): string | undefined {
  const { current, layout, typed } = props;
  return layout.providers.find((group) => group.provider === current.provider)
    ?.label ??
    typed.providers.find((item) => item.id === current.provider)?.name;
}

/** Popover 안 목록. `inChat`이면 층 줄과 Change defaults가 있다(칸 모양 trigger는 층 줄을 칸 아래에 둔다). */
function PickerBody(
  { props, inChat, fresh, onConnect }: {
    props: ModelPickerProps;
    inChat: boolean;
    /** 방금 연결한 provider. 묶음이 맨 위로 오고 강조된다. */
    fresh: string | null;
    onConnect: (() => void) | null;
  },
) {
  const { layout, current, follow } = props;
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const refresh = async (provider: string) => {
    setRefreshing(provider);
    setRefreshFailed(false);
    const refreshed = await props.onRefreshModels(provider);
    setRefreshing(null);
    setRefreshFailed(!refreshed);
  };
  const ready = props.axesReady !== false;
  const noProviders = ready && props.query.trim() === "" &&
    layout.favorites.length === 0 && layout.providers.length === 0 &&
    props.typed.providers.length === 0;
  const empty = layout.favorites.length === 0 &&
    layout.providers.length === 0 && follow === undefined;
  const groups: readonly PickerProviderGroup[] = fresh === null
    ? layout.providers
    : [
      ...layout.providers.filter((group) => group.provider === fresh),
      ...layout.providers.filter((group) => group.provider !== fresh),
    ];
  // 따르는 중이면 따르기 줄에만 표시가 있다.
  const marked = (row: PickerModelRef) =>
    follow?.on !== true && same(row, current);
  return (
    <div className={styles.picker} data-model-picker="">
      {inChat ? <LayerLine layer={props.layer} /> : null}
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
        {follow === undefined ? null : (
          <div
            role="option"
            tabIndex={0}
            aria-selected={follow.on}
            data-follow=""
            className={styles.row}
            onClick={follow.onFollow}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              follow.onFollow();
            }}
          >
            <span className={styles.check}>
              {follow.on
                ? (
                  <Icon
                    icon={conversationIcons.current}
                    pixels={iconPixels("base")}
                  />
                )
                : null}
            </span>
            <span className={styles.name}>{follow.label}</span>
          </div>
        )}
        {noProviders
          ? (
            <p className={styles.note}>
              {t("conversation.notice.no-providers")}
            </p>
          )
          : empty
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
                  current={marked(row)}
                  showProvider
                  onPick={props.onPick}
                  onToggleFavorite={props.onToggleFavorite}
                />
              ))}
            </div>
          )}
        {groups.map((group) => (
          <div
            key={group.provider}
            data-picker-section="provider"
            data-provider={group.provider}
            data-fresh={group.provider === fresh ? "" : undefined}
            className={group.provider === fresh ? styles.fresh : undefined}
            role="presentation"
          >
            <div className={styles.groupHead}>
              <ProviderHeading label={group.label} />
              {group.refreshable
                ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    data-refresh-models=""
                    disabled={refreshing !== null}
                    onClick={() => void refresh(group.provider)}
                  >
                    {t("conversation.button.refresh-models")}
                  </Button>
                )
                : null}
            </div>
            {group.models.length === 0
              ? (
                <p className={styles.note}>
                  {t("conversation.notice.no-listed-models")}
                </p>
              )
              : null}
            {group.models.map((row) => (
              <ModelRow
                key={row.modelName}
                row={row}
                current={marked(row)}
                showProvider={false}
                onPick={props.onPick}
                onToggleFavorite={props.onToggleFavorite}
              />
            ))}
          </div>
        ))}
      </div>
      {refreshFailed
        ? (
          <p
            className={styles.note}
            role="status"
            data-picker-section="refresh-failed"
          >
            {t("conversation.error.refresh-models")}
          </p>
        )
        : null}
      <TypedModelRow typed={props.typed} currentProvider={current.provider} />
      {ready && current.modelName !== ""
        ? (
          <div className={styles.axes} data-picker-section="axes">
            <OptionAxes selection={props} onChange={props.onOptionChange} />
          </div>
        )
        : null}
      {onConnect === null && !inChat
        ? null
        : (
          <div className={styles.foot} data-picker-section="foot">
            {onConnect === null ? null : (
              <PopoverRow onSelect={onConnect}>
                <Icon icon={commonIcons.add} pixels={iconPixels("base")} />
                {t("conversation.button.connect-provider")}
              </PopoverRow>
            )}
            {inChat
              ? (
                <PopoverRow onSelect={props.onChangeDefaults}>
                  <Icon icon={settingsEntryIcon} pixels={iconPixels("base")} />
                  {t("conversation.button.change-defaults")}
                </PopoverRow>
              )
              : null}
          </div>
        )}
    </div>
  );
}

/**
 * trigger만 다른 Popover 하나. Connect provider 줄은 `useConnectProvider()`가 null이 아닐 때만 있다. 누르면 목록을 닫고
 * 연결 대화창을 열고, 끝나면 목록을 다시 열어 새 provider의 묶음을 맨 위에 강조한다(새 id를 못 찾았으면 그냥 연다).
 */
function PickerPopover(
  { props, trigger, inChat }: {
    props: ModelPickerProps;
    trigger: ReactElement;
    inChat: boolean;
  },
) {
  const connect = useConnectProvider();
  const [fresh, setFresh] = useState<string | null>(null);
  return (
    <Popover
      open={props.open}
      onOpenChange={(open) => {
        if (!open) setFresh(null);
        props.onOpenChange(open);
      }}
      trigger={trigger}
    >
      <PickerBody
        props={props}
        inChat={inChat}
        fresh={fresh}
        onConnect={connect === null ? null : () => {
          props.onOpenChange(false);
          connect.open({
            onConnected: (id) => {
              setFresh(id);
              props.onOpenChange(true);
            },
          });
        }}
      />
    </Popover>
  );
}

/** composer의 작은 단추 trigger. */
export function ModelPicker(props: ModelPickerProps): ReactNode {
  return (
    <PickerPopover
      props={props}
      inChat
      trigger={
        <Button size="sm" variant="ghost" data-model-button="">
          {buttonText(props)}
          <Icon icon={conversationIcons.expand} pixels={iconPixels("base")} />
        </Button>
      }
    />
  );
}

/**
 * 칸 모양 trigger(고른 model과 provider, vendor 아이콘). 따르는 칸은 따르기 줄의 글을 보인다. 바꾼 칸(`reset`)에는
 * Changed와 [Reset]이 붙고, 지금 model의 층 한 줄이 칸 아래에 있다.
 */
export function ModelPickerField(
  { props, label, reset }: {
    props: ModelPickerProps;
    label: string;
    /** 바꾼 칸이면 값을 되돌리는 길. 따르는 중이거나 되돌릴 위 층이 없으면 없다. */
    reset?: { readonly note?: string; readonly onReset: () => void };
  },
) {
  const provider = providerNameOf(props);
  const vendor = provider === undefined ? undefined : vendorOf(provider);
  const following = props.follow?.on === true;
  return (
    <div className={styles.field} data-model-field="">
      <span className={styles.fieldLabel}>{label}</span>
      <PickerPopover
        props={props}
        inChat={false}
        trigger={
          <button
            type="button"
            className={styles.fieldTrigger}
            data-model-button=""
          >
            <span className={styles.fieldValue}>
              {following
                ? <span className={styles.name}>{props.follow?.label}</span>
                : props.current.modelName === ""
                ? (
                  <span className={styles.fieldEmpty}>
                    {t("agents.label.no-model-chosen")}
                  </span>
                )
                : (
                  <>
                    {vendor === undefined
                      ? null
                      : <VendorIcon vendor={vendor} size={14} />}
                    <span className={styles.name}>
                      {props.current.modelName}
                    </span>
                    {provider === undefined
                      ? null
                      : <span className={styles.provider}>{provider}</span>}
                  </>
                )}
            </span>
            <Icon icon={conversationIcons.expand} pixels={iconPixels("base")} />
          </button>
        }
      />
      <LayerLine layer={props.layer} />
      {props.axesReady !== false && props.current.modelName !== ""
        ? <OptionAxes selection={props} onChange={props.onOptionChange} />
        : null}
      {reset === undefined ? null : (
        <p className={styles.changedRow}>
          <span className={styles.changed}>
            {t("conversation.label.model-changed")}
          </span>
          {reset.note === undefined
            ? null
            : <span className={styles.changedNote}>{reset.note}</span>}
          <Button size="sm" variant="ghost" onClick={reset.onReset}>
            {t("conversation.button.model-reset")}
          </Button>
        </p>
      )}
    </div>
  );
}

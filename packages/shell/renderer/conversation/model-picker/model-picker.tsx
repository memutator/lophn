// model을 고르는 picker 하나. composer의 작은 단추(ModelPicker)와 Settings·agent·project의 칸(ModelPickerField)이 같은
// Popover 목록을 쓴다. 위에서부터 층 한 줄(대화만), 검색칸, 따르기 줄(있을 때), provider 묶음(vendor 아이콘),
// 고른 model의 option 축, 맨 아래 Manage models 한 줄이다. 화면 코드에는 model 이름도
// option 값도 없다. 정렬·거르기·option 축·기본 값 맞춤은 model catalog가 계산해 props로 주고, 이 component는 받은
// 순서대로 그린다. 보일 model을 켜고 끄는 일과 provider 연결은 Manage models 창이 한다. model을 바꾸면 값은 조용히 맞고 알림은 없다.

import { t } from "@lophn/i18n";
import { Popover, PopoverRow } from "@lophn/ui/overlay";
import { Button, Icon } from "@lophn/ui/primitives";
import { iconPixels } from "@lophn/ui/shared";
import type { ReactElement, ReactNode } from "react";
import {
  actionIcons,
  commonIcons,
  conversationIcons,
} from "../../icons/mod.ts";
import { VendorIcon, vendorOf } from "../../parts/vendor-icon/vendor-icon.tsx";

import { useManageModels } from "./manage-context.ts";
import styles from "./model-picker.module.css";
import type { ModelPickerProps, PickerModelRef } from "./types.ts";

export type {
  FollowView,
  ModelPickerProps,
  PickerAxisView,
  PickerLayoutView,
  PickerModelRef,
  PickerProviderGroup,
} from "./types.ts";

function same(first: PickerModelRef, second: PickerModelRef): boolean {
  return (
    first.provider === second.provider && first.modelName === second.modelName
  );
}

function ModelRow({
  row,
  current,
  onPick,
}: {
  row: PickerModelRef;
  current: boolean;
  onPick: (model: PickerModelRef) => void;
}) {
  return (
    <div
      role="option"
      tabIndex={0}
      aria-selected={current}
      data-model={row.modelName}
      className={styles.row}
      onClick={() => onPick(row)}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onPick(row);
      }}
    >
      <span className={styles.check}>
        {current ? (
          <Icon icon={conversationIcons.current} pixels={iconPixels("base")} />
        ) : null}
      </span>
      <span className={styles.name}>{row.label ?? row.modelName}</span>
    </div>
  );
}

/** 고른 model의 option 축만 보인다. 없으면 없다고 말한다. */
export function OptionAxes({
  selection,
  onChange,
}: {
  selection: Pick<ModelPickerProps, "axes" | "optionValues">;
  onChange: (axis: string, value: string) => void;
}) {
  if (selection.axes.length === 0) {
    return (
      <p className={styles.note}>{t("conversation.notice.no-model-options")}</p>
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
export function ProviderHeading({ label }: { label: string }) {
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

function providerNameOf(props: ModelPickerProps): string | undefined {
  const { current, layout } = props;
  return layout.providers.find((group) => group.provider === current.provider)
    ?.label;
}

/** Popover 안 목록. `inChat`이면 층 줄이 있다(칸 모양 trigger는 층 줄을 칸 아래에 둔다). */
function PickerBody({
  props,
  inChat,
  onManage,
}: {
  props: ModelPickerProps;
  inChat: boolean;
  /** Manage models 줄. null이면 줄이 없다(기본 model 대화창 안의 picker). */
  onManage: (() => void) | null;
}) {
  const { layout, current, follow } = props;
  const ready = props.axesReady !== false;
  const empty = layout.providers.length === 0 && follow === undefined;
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
              {follow.on ? (
                <Icon
                  icon={conversationIcons.current}
                  pixels={iconPixels("base")}
                />
              ) : null}
            </span>
            <span className={styles.name}>{follow.label}</span>
          </div>
        )}
        {empty ? (
          <p className={styles.note}>
            {props.query.trim() === ""
              ? t("conversation.notice.no-shown-models")
              : t("conversation.notice.no-models")}
          </p>
        ) : null}
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
                current={marked(row)}
                onPick={props.onPick}
              />
            ))}
          </div>
        ))}
      </div>
      {ready && current.modelName !== "" ? (
        <div className={styles.axes} data-picker-section="axes">
          <OptionAxes selection={props} onChange={props.onOptionChange} />
        </div>
      ) : null}
      {onManage === null ? null : (
        <div className={styles.foot} data-picker-section="foot">
          <PopoverRow onSelect={onManage}>
            <Icon icon={commonIcons.settings} pixels={iconPixels("base")} />
            {t("conversation.button.manage-models")}
          </PopoverRow>
        </div>
      )}
    </div>
  );
}

/**
 * trigger만 다른 Popover 하나. Manage models 줄은 `useManageModels()`가 null이 아닐 때만 있다. 누르면 목록을 닫고
 * Manage models 창을 연다.
 */
function PickerPopover({
  props,
  trigger,
  inChat,
}: {
  props: ModelPickerProps;
  trigger: ReactElement;
  inChat: boolean;
}) {
  const manage = useManageModels();
  return (
    <Popover
      open={props.open}
      onOpenChange={props.onOpenChange}
      trigger={trigger}
    >
      <PickerBody
        props={props}
        inChat={inChat}
        onManage={
          manage === null
            ? null
            : () => {
                props.onOpenChange(false);
                manage.open();
              }
        }
      />
    </Popover>
  );
}

/** composer의 작은 단추 trigger. model 이름 하나만 보이고, option 값은 옆의 축 단추가 보인다. */
export function ModelPicker(props: ModelPickerProps): ReactNode {
  return (
    <PickerPopover
      props={props}
      inChat
      trigger={
        <Button
          size="sm"
          variant="ghost"
          trailingIcon={conversationIcons.expand}
          data-model-button=""
        >
          {props.currentLabel}
        </Button>
      }
    />
  );
}

/**
 * 칸 모양 trigger(고른 model과 provider, vendor 아이콘). 따르는 칸은 따르기 줄의 글을 보인다. 바꾼 칸(`reset`)에는
 * Changed와 [Reset]이 붙고, 지금 model의 층 한 줄이 칸 아래에 있다. 저장하지 못했으면(`error`) option 축 바로 아래에
 * 빨간 한 줄이 붙는다. 칸 밖에 두면 무엇이 안 됐는지 모른다.
 */
export function ModelPickerField({
  props,
  label,
  reset,
  error,
}: {
  props: ModelPickerProps;
  label: string;
  /** 바꾼 칸이면 값을 되돌리는 길. 따르는 중이거나 되돌릴 위 층이 없으면 없다. */
  reset?: { readonly note?: string; readonly onReset: () => void };
  /** 고른 값을 저장하지 못한 이유 한 줄. */
  error?: string;
}) {
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
              {following ? (
                <span className={styles.name}>{props.follow?.label}</span>
              ) : props.current.modelName === "" ? (
                <span className={styles.fieldEmpty}>
                  {t("agents.label.no-model-chosen")}
                </span>
              ) : (
                <>
                  {vendor === undefined ? null : (
                    <VendorIcon vendor={vendor} size={14} />
                  )}
                  <span className={styles.name}>{props.current.modelName}</span>
                  {provider === undefined ? null : (
                    <span className={styles.provider}>{provider}</span>
                  )}
                </>
              )}
            </span>
            <Icon icon={conversationIcons.expand} pixels={iconPixels("base")} />
          </button>
        }
      />
      <LayerLine layer={props.layer} />
      {props.axesReady !== false && props.current.modelName !== "" ? (
        <OptionAxes selection={props} onChange={props.onOptionChange} />
      ) : null}
      {error === undefined ? null : (
        <p className={styles.fieldError} role="alert" data-model-field-error="">
          <Icon icon={commonIcons.failed} pixels={iconPixels("base")} />
          <span>{error}</span>
        </p>
      )}
      {reset === undefined ? null : (
        <p className={styles.changedRow}>
          <span className={styles.changed}>
            {t("conversation.label.model-changed")}
          </span>
          {reset.note === undefined ? null : (
            <span className={styles.changedNote}>{reset.note}</span>
          )}
          <Button
            size="sm"
            variant="ghost"
            icon={actionIcons.reset}
            onClick={reset.onReset}
          >
            {t("conversation.button.model-reset")}
          </Button>
        </p>
      )}
    </div>
  );
}

import * as Radix from "@radix-ui/react-select";
import { Check, ChevronDown, Monitor } from "lucide-react";
import { useContext, useId } from "react";
import { t } from "@lophn/i18n";
import { FieldContext } from "../field/field-context.ts";
import { Icon } from "../../primitives/icon/icon.tsx";
import {
  componentMark,
  controlIconPixels,
  cx,
  iconPixels,
  pixels,
} from "../../_shared/shared.ts";
import { tokens } from "../../../tokens.ts";
import selectStyles from "../select/select.module.css";
import styles from "./machine-selector.module.css";

export type MachineOptionStatus =
  | "online"
  | "offline"
  | "connecting"
  | "update";

export interface MachineOption {
  /** Machine id (e.g. `mch_...` or a caller-chosen key). */
  id: string;
  /** Human-readable computer name. */
  name: string;
  /** Connection state shown with a semantic status dot. */
  status?: MachineOptionStatus;
  /** True when this option represents the current computer. */
  current?: boolean;
  /** Short secondary note under the name (e.g. "Direct", "Offline", "Last seen 3h ago"). */
  detail?: string;
  /** Prevents picking this machine when it cannot be used. */
  disabled?: boolean;
}

export interface MachineSelectorProps {
  /** Computers to choose from. */
  machines: readonly MachineOption[];
  /** Selected machine id, or `null` for "all" when `allowAll` is set (or unselected). */
  value: string | null;
  /** Called with the chosen machine id, or `null` when "all" is chosen. */
  onValueChange: (id: string | null) => void;
  /** Adds an "All machines" choice (`value === null`) for filtering or branching across machines. */
  allowAll?: boolean;
  /** Label for the `allowAll` choice. Defaults to "All machines". */
  allLabel?: string;
  /** Control height: compact `"sm"` or default `"md"`. */
  size?: "sm" | "md";
  /** `"select"` renders a compact dropdown; `"pills"` renders an inline chip row for 2–4 machines. */
  variant?: "select" | "pills";
  /** Shown when `value` is `null` and `allowAll` is false. */
  placeholder?: string;
  /** Disables the whole selector. */
  disabled?: boolean;
  /** Accessible name when rendered outside a `Field`. */
  ariaLabel?: string;
}

// Sentinel for Radix Select (which requires non-empty strings) so `allowAll` maps cleanly to `null`
// without colliding with any real machine id.
const ALL_VALUE = "\0__lophn_all_machines__";

const DOT_CLASS: Record<MachineOptionStatus, string> = {
  online: styles.dotOnline,
  offline: styles.dotOffline,
  connecting: styles.dotConnecting,
  update: styles.dotUpdate,
};

function StatusDot({ status }: { status?: MachineOptionStatus }) {
  if (status === undefined) return null;
  return (
    <span
      aria-hidden="true"
      data-status={status}
      className={cx(styles.dot, DOT_CLASS[status])}
    />
  );
}

function statusFallbackDetail(
  status?: MachineOptionStatus,
): string | undefined {
  switch (status) {
    case "offline":
      return t("machines.status.offline");
    case "connecting":
      return t("machines.status.connecting");
    case "update":
      return t("machines.status.update");
    case "online":
    case undefined:
      return undefined;
  }
}

// Picks a computer (or "All machines") to scope a view or setting. Uses a dropdown by default or an inline pill row for a few machines.
export function MachineSelector({
  machines,
  value,
  onValueChange,
  allowAll = false,
  allLabel,
  size = "md",
  variant = "select",
  placeholder,
  disabled = false,
  ariaLabel,
}: MachineSelectorProps) {
  const field = useContext(FieldContext);
  const groupName = useId();
  const resolvedAllLabel = allLabel ?? t("machines.label.all");
  const resolvedPlaceholder = placeholder ?? t("machines.label.choose-machine");
  const resolvedAriaLabel =
    ariaLabel ?? (field === null ? t("machines.label.computer") : undefined);

  if (variant === "pills") {
    return (
      <div
        id={field?.id}
        role="radiogroup"
        aria-label={resolvedAriaLabel}
        data-size={size}
        data-variant="pills"
        data-invalid={field?.invalid || undefined}
        className={cx(styles.pills, styles[size])}
        {...componentMark("MachineSelector")}
      >
        {allowAll && (
          <label className={styles.pillOption}>
            <input
              type="radio"
              name={groupName}
              value={ALL_VALUE}
              checked={value === null}
              disabled={disabled}
              className={styles.pillInput}
              onChange={() => onValueChange(null)}
            />
            <span className={styles.pill}>
              <Icon icon={Monitor} pixels={controlIconPixels(size)} />
              <span className={styles.pillName}>{resolvedAllLabel}</span>
            </span>
          </label>
        )}
        {machines.map((option) => (
          <label key={option.id} className={styles.pillOption}>
            <input
              type="radio"
              name={groupName}
              value={option.id}
              checked={value === option.id}
              disabled={disabled || option.disabled}
              className={styles.pillInput}
              onChange={() => onValueChange(option.id)}
            />
            <span className={styles.pill}>
              {option.status === undefined ? (
                <Icon icon={Monitor} pixels={controlIconPixels(size)} />
              ) : (
                <StatusDot status={option.status} />
              )}
              <span className={styles.pillName}>{option.name}</span>
              {option.current && (
                <span className={styles.pillCurrent}>
                  {t("machines.label.current")}
                </span>
              )}
            </span>
          </label>
        ))}
      </div>
    );
  }

  const selected =
    value === null ? undefined : machines.find((one) => one.id === value);
  const radixValue = value === null ? (allowAll ? ALL_VALUE : "") : value;

  return (
    <Radix.Root
      value={radixValue}
      onValueChange={(next) => onValueChange(next === ALL_VALUE ? null : next)}
      disabled={disabled}
    >
      <Radix.Trigger
        id={field?.id}
        aria-label={resolvedAriaLabel}
        data-size={size}
        data-variant="select"
        data-invalid={field?.invalid || undefined}
        className={cx(selectStyles.trigger, selectStyles[size], styles.trigger)}
        {...componentMark("MachineSelector")}
      >
        <span className={styles.triggerMain}>
          <span className={styles.triggerIcon} aria-hidden="true">
            <Icon icon={Monitor} pixels={controlIconPixels(size)} />
          </span>
          {selected !== undefined && <StatusDot status={selected.status} />}
          <span className={styles.triggerText}>
            <Radix.Value placeholder={resolvedPlaceholder}>
              {value === null
                ? allowAll
                  ? resolvedAllLabel
                  : undefined
                : (selected?.name ?? value)}
            </Radix.Value>
          </span>
        </span>
        <Radix.Icon className={selectStyles.chevron}>
          <Icon icon={ChevronDown} pixels={controlIconPixels(size)} />
        </Radix.Icon>
      </Radix.Trigger>
      <Radix.Portal>
        <Radix.Content
          className={selectStyles.content}
          position="popper"
          side="bottom"
          align="start"
          collisionPadding={pixels(tokens.space[2])}
          {...componentMark("MachineSelector")}
        >
          <Radix.Viewport className={selectStyles.viewport}>
            {allowAll && (
              <Radix.Item
                value={ALL_VALUE}
                className={cx(selectStyles.item, styles.item)}
              >
                <span className={styles.itemMain}>
                  <Icon icon={Monitor} pixels={iconPixels("small")} />
                  <span className={styles.itemBody}>
                    <Radix.ItemText>{resolvedAllLabel}</Radix.ItemText>
                  </span>
                </span>
                <Radix.ItemIndicator className={selectStyles.indicator}>
                  <Icon icon={Check} pixels={iconPixels("base")} />
                </Radix.ItemIndicator>
              </Radix.Item>
            )}
            {machines.map((option) => {
              const detail =
                option.detail ?? statusFallbackDetail(option.status);
              return (
                <Radix.Item
                  key={option.id}
                  value={option.id}
                  disabled={option.disabled}
                  className={cx(selectStyles.item, styles.item)}
                >
                  <span className={styles.itemMain}>
                    <StatusDot status={option.status} />
                    <span className={styles.itemBody}>
                      <span className={styles.itemHead}>
                        <span className={styles.itemName}>
                          <Radix.ItemText>{option.name}</Radix.ItemText>
                        </span>
                        {option.current && (
                          <span className={styles.currentTag}>
                            {t("machines.label.current")}
                          </span>
                        )}
                      </span>
                      {detail !== undefined && (
                        <span className={styles.itemDetail}>{detail}</span>
                      )}
                    </span>
                  </span>
                  <Radix.ItemIndicator className={selectStyles.indicator}>
                    <Icon icon={Check} pixels={iconPixels("base")} />
                  </Radix.ItemIndicator>
                </Radix.Item>
              );
            })}
          </Radix.Viewport>
        </Radix.Content>
      </Radix.Portal>
    </Radix.Root>
  );
}

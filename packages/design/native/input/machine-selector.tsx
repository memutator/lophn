import { t } from "@lophn/i18n";
import { Check, ChevronDown, Monitor } from "lucide-react-native";
import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { Dot, type DotTone, Tag } from "../feedback/status.tsx";
import { Divider, Row } from "../layout/list.tsx";
import { Sheet } from "../overlay/sheet.tsx";
import { Icon } from "../primitives/icon.tsx";
import { Text } from "../primitives/text.tsx";
import { Ink, useTheme } from "../theme.tsx";
import { useFieldLabel } from "./input.tsx";

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
  /** `"select"` renders a trigger that opens a bottom Sheet; `"pills"` renders a horizontal row of chips. */
  variant?: "select" | "pills";
  /** Shown when `value` is `null` and `allowAll` is false. */
  placeholder?: string;
  /** Disables the whole selector. */
  disabled?: boolean;
  /** Accessible name when rendered outside a `Field`. */
  ariaLabel?: string;
}

const DOT_TONE: Record<MachineOptionStatus, DotTone> = {
  online: "good",
  offline: "off",
  connecting: "neutral",
  update: "warning",
};

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

function PillDot({
  status,
  selected,
}: {
  status: MachineOptionStatus;
  selected: boolean;
}) {
  const theme = useTheme();
  if (status === "offline" && selected) {
    return (
      <View
        style={{
          width: 8,
          height: 8,
          borderRadius: 999,
          borderWidth: 1.5,
          borderColor: theme.color.ink.text,
        }}
      />
    );
  }
  return <Dot tone={DOT_TONE[status]} />;
}

// Picks a computer (or "All machines") to scope a view or setting: a sheet trigger by default, or horizontal pills.
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
  const theme = useTheme();
  const fieldLabel = useFieldLabel();
  const [open, setOpen] = useState(false);

  const resolvedAllLabel = allLabel ?? t("machines.label.all");
  const resolvedPlaceholder = placeholder ?? t("machines.label.choose-machine");
  const resolvedLabel = ariaLabel ?? fieldLabel ?? t("machines.label.computer");

  if (variant === "pills") {
    const height = size === "sm" ? 32 : 36;
    const hitSlop = Math.max(0, Math.ceil((theme.touch - height) / 2));
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        accessibilityRole="radiogroup"
        accessibilityLabel={resolvedLabel}
        contentContainerStyle={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
        }}
      >
        {allowAll && (
          <Pressable
            accessibilityRole="radio"
            accessibilityState={{
              checked: value === null,
              selected: value === null,
              disabled,
            }}
            disabled={disabled}
            hitSlop={hitSlop}
            onPress={() => onValueChange(null)}
            style={({ pressed }) => ({
              height,
              paddingHorizontal: size === "sm" ? 10 : 12,
              borderRadius: 999,
              borderWidth: 1,
              borderColor:
                value === null
                  ? theme.color.ink.background
                  : theme.color.border.base,
              backgroundColor:
                value === null
                  ? theme.color.ink.background
                  : pressed
                    ? theme.color.surface.muted
                    : theme.color.surface.base,
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              opacity: disabled ? 0.5 : 1,
            })}
          >
            <Ink
              color={
                value === null
                  ? theme.color.ink.text
                  : theme.color.text.secondary
              }
            >
              <Icon icon={Monitor} size={14} />
              <Text
                variant="detail"
                weight="medium"
                tone={value === null ? "inverse" : "secondary"}
                numberOfLines={1}
              >
                {resolvedAllLabel}
              </Text>
            </Ink>
          </Pressable>
        )}
        {machines.map((option) => {
          const selected = value === option.id;
          const itemDisabled = disabled || Boolean(option.disabled);
          return (
            <Pressable
              key={option.id}
              accessibilityRole="radio"
              accessibilityState={{
                checked: selected,
                selected,
                disabled: itemDisabled,
              }}
              disabled={itemDisabled}
              hitSlop={hitSlop}
              onPress={() => onValueChange(option.id)}
              style={({ pressed }) => ({
                height,
                paddingHorizontal: size === "sm" ? 10 : 12,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: selected
                  ? theme.color.ink.background
                  : theme.color.border.base,
                backgroundColor: selected
                  ? theme.color.ink.background
                  : pressed
                    ? theme.color.surface.muted
                    : theme.color.surface.base,
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                opacity: itemDisabled ? 0.45 : 1,
              })}
            >
              {option.status === undefined ? (
                <Icon
                  icon={Monitor}
                  size={14}
                  color={
                    selected ? theme.color.ink.text : theme.color.text.secondary
                  }
                />
              ) : (
                <PillDot status={option.status} selected={selected} />
              )}
              <Text
                variant="detail"
                weight="medium"
                tone={selected ? "inverse" : "secondary"}
                numberOfLines={1}
              >
                {option.name}
              </Text>
              {option.current && (
                <Text
                  variant="caption"
                  tone={selected ? "inverse" : "muted"}
                  numberOfLines={1}
                >
                  {t("machines.label.current")}
                </Text>
              )}
            </Pressable>
          );
        })}
      </ScrollView>
    );
  }

  const selected =
    value === null ? undefined : machines.find((one) => one.id === value);
  const triggerLabel =
    value === null
      ? allowAll
        ? resolvedAllLabel
        : resolvedPlaceholder
      : (selected?.name ?? value);
  const isPlaceholder = value === null && !allowAll;
  const height = size === "sm" ? 36 : 44;
  const hitSlop = Math.max(0, Math.ceil((theme.touch - height) / 2));

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${resolvedLabel}: ${triggerLabel}`}
        accessibilityState={{ disabled, expanded: open }}
        disabled={disabled}
        hitSlop={hitSlop}
        onPress={() => setOpen(true)}
        style={({ pressed }) => ({
          minHeight: height,
          paddingHorizontal: size === "sm" ? 10 : 12,
          borderWidth: 1,
          borderColor: open ? theme.color.focus : theme.color.border.strong,
          borderRadius: 12,
          backgroundColor: disabled
            ? theme.color.surface.subtle
            : pressed
              ? theme.color.surface.muted
              : theme.color.surface.base,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        })}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            flex: 1,
            minWidth: 0,
          }}
        >
          <Icon
            icon={Monitor}
            size={size === "sm" ? 15 : 16}
            tone={disabled ? "muted" : "secondary"}
          />
          {selected?.status !== undefined && (
            <Dot tone={DOT_TONE[selected.status]} />
          )}
          <Text
            variant={size === "sm" ? "detail" : "control"}
            tone={disabled || isPlaceholder ? "muted" : "primary"}
            numberOfLines={1}
            style={{ flexShrink: 1 }}
          >
            {triggerLabel}
          </Text>
        </View>
        <Icon
          icon={ChevronDown}
          size={16}
          tone={disabled ? "muted" : "secondary"}
        />
      </Pressable>
      <Sheet open={open} onClose={() => setOpen(false)} title={resolvedLabel}>
        {allowAll && (
          <>
            <Row
              lead={<Icon icon={Monitor} size={18} tone="secondary" />}
              title={resolvedAllLabel}
              strong={value === null}
              end={
                value === null ? (
                  <Icon icon={Check} color={theme.color.text.primary} />
                ) : undefined
              }
              onPress={() => {
                setOpen(false);
                onValueChange(null);
              }}
            />
            {machines.length > 0 && <Divider />}
          </>
        )}
        {machines.map((option, index) => {
          const isSelected = value === option.id;
          const detail = option.detail ?? statusFallbackDetail(option.status);
          return (
            <View key={option.id}>
              {index > 0 && <Divider />}
              <Row
                lead={
                  option.status !== undefined ? (
                    <Dot tone={DOT_TONE[option.status]} />
                  ) : (
                    <Icon icon={Monitor} size={18} tone="secondary" />
                  )
                }
                title={
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 8,
                      minWidth: 0,
                    }}
                  >
                    <Text
                      weight={isSelected ? "medium" : "regular"}
                      numberOfLines={1}
                      style={{ flexShrink: 1, lineHeight: 22 }}
                    >
                      {option.name}
                    </Text>
                    {option.current && <Tag>{t("machines.label.current")}</Tag>}
                  </View>
                }
                sub={detail}
                dim={option.disabled}
                end={
                  isSelected ? (
                    <Icon icon={Check} color={theme.color.text.primary} />
                  ) : undefined
                }
                onPress={
                  option.disabled
                    ? undefined
                    : () => {
                        setOpen(false);
                        onValueChange(option.id);
                      }
                }
              />
            </View>
          );
        })}
      </Sheet>
    </>
  );
}

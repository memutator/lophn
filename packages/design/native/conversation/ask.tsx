import { t } from "@lophn/i18n";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  type LucideIcon,
  TriangleAlert,
  X,
} from "lucide-react-native";
import { type ReactNode, useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { Pre } from "../feedback/display.tsx";
import { Checkbox, Radio } from "../input/choice.tsx";
import { Button } from "../primitives/button.tsx";
import { Icon } from "../primitives/icon.tsx";
import { Text } from "../primitives/text.tsx";
import { Ink, scaleText, useTheme } from "../theme.tsx";

export interface AskCardProps {
  children: ReactNode;
  /** Tighter padding for a one-line card (a folded todo list). */
  compact?: boolean;
}

// What waits on the person, docked right above the composer where the thumb is.
export function AskCard({ children, compact }: AskCardProps) {
  const theme = useTheme();
  return (
    <View
      style={{
        marginHorizontal: 12,
        marginBottom: compact ? 2 : 0,
        paddingVertical: compact ? 10 : 12,
        paddingHorizontal: 12,
        borderWidth: 1,
        borderColor: theme.color.border.base,
        borderRadius: 18,
        backgroundColor: theme.color.surface.subtle,
      }}
    >
      {children}
    </View>
  );
}

export interface AskTitleProps {
  icon?: LucideIcon;
  children: string;
}

export function AskTitle({ icon, children }: AskTitleProps) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        flexShrink: 1,
      }}
    >
      {icon && <Icon icon={icon} size={17} />}
      <Text
        variant="detail"
        weight="medium"
        numberOfLines={1}
        style={{ flexShrink: 1 }}
      >
        {children}
      </Text>
    </View>
  );
}

export interface FactProps {
  label: string;
  /** The value in a mono box. */
  value: string;
  /** The box is only as wide as the value. */
  fit?: boolean;
}

// One labelled fact of a request: the command, the secret's name.
export function Fact({ label, value, fit }: FactProps) {
  return (
    <View style={{ marginTop: 10 }}>
      <Text variant="caption" tone="muted" style={{ marginBottom: 4 }}>
        {label}
      </Text>
      <Pre fit={fit}>{value}</Pre>
    </View>
  );
}

export interface ApprovalCardProps {
  /** lophn wants to run a command */
  title: string;
  facts: readonly FactProps[];
  onDeny?: () => void;
  /** Shows Always allow. */
  onAlways?: () => void;
  onOnce?: () => void;
}

// A permission request. The most common answer (Allow once) is the largest and nearest the thumb.
export function ApprovalCard({
  title,
  facts,
  onDeny,
  onAlways,
  onOnce,
}: ApprovalCardProps) {
  return (
    <AskCard>
      <AskTitle icon={TriangleAlert}>{title}</AskTitle>
      {facts.map((fact) => (
        <Fact key={fact.label} {...fact} />
      ))}
      <View style={{ flexDirection: "row", gap: 8, marginTop: 14 }}>
        <Button block icon={X} onPress={onDeny}>
          {t("conversation.button.approval-deny")}
        </Button>
        {onAlways && (
          <Button block icon={Check} onPress={onAlways}>
            {t("conversation.button.approval-allow-always")}
          </Button>
        )}
      </View>
      <View style={{ flexDirection: "row", marginTop: 8 }}>
        <Button block variant="primary" icon={Check} onPress={onOnce}>
          {t("conversation.button.approval-allow-once")}
        </Button>
      </View>
    </AskCard>
  );
}

export interface QuestionOption {
  label: string;
  sub?: string;
}

/** The options picked (by index, in option order) and the person's own answer, if they wrote one. */
export interface QuestionAnswer {
  choices: readonly number[];
  text: string | null;
}

export interface QuestionCardProps {
  /** lophn is asking */
  title: string;
  question: string;
  options: readonly QuestionOption[];
  /** Any number of options can be picked, and one's own answer besides them. */
  multi?: boolean;
  /** Which question of how many, when there are several. */
  at?: number;
  of?: number;
  onPrev?: () => void;
  onSkip?: () => void;
  /** What is picked before the person touches anything (coming back to an answered question). */
  initial?: QuestionAnswer;
  /** Next on all but the last question, then Send. */
  nextLabel?: string;
  onNext: (answer: QuestionAnswer) => void;
}

// A question the agent asks, one at a time: pick an option (or several) or write an answer.
export function QuestionCard({
  title,
  question,
  options,
  multi = false,
  at,
  of,
  onPrev,
  onSkip,
  initial,
  nextLabel = t("conversation.button.question-next"),
  onNext,
}: QuestionCardProps) {
  const theme = useTheme();
  const [choices, setChoices] = useState<readonly number[]>(
    initial?.choices ?? [],
  );
  const [other, setOther] = useState(
    initial !== undefined && initial.text !== null,
  );
  const [text, setText] = useState(initial?.text ?? "");
  const pick = (index: number) => {
    if (!multi) {
      setChoices([index]);
      setOther(false);
    } else {
      setChoices((now) =>
        now.includes(index)
          ? now.filter((one) => one !== index)
          : [...now, index].sort((a, b) => a - b),
      );
    }
  };
  const pickOther = () => {
    if (!multi) {
      setChoices([]);
      setOther(true);
    } else setOther((now) => !now);
  };
  const ready = (choices.length > 0 || other) && (!other || text.trim() !== "");
  return (
    <AskCard>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <AskTitle>{title}</AskTitle>
        {at !== undefined && of !== undefined && (
          <Ink color={theme.color.text.muted}>
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
            >
              <Pressable
                accessibilityLabel={t("conversation.label.question-previous")}
                hitSlop={10}
                disabled={onPrev === undefined}
                onPress={onPrev}
              >
                <Icon icon={ChevronLeft} size={15} />
              </Pressable>
              <Text variant="note">
                {t("conversation.label.request-position", {
                  current: at,
                  total: of,
                })}
              </Text>
              <Pressable
                accessibilityLabel={t("conversation.label.question-following")}
                hitSlop={10}
                disabled={onSkip === undefined}
                onPress={onSkip}
              >
                <Icon icon={ChevronRight} size={15} />
              </Pressable>
            </View>
          </Ink>
        )}
      </View>
      <Text weight="semibold" style={{ marginTop: 10, lineHeight: 22 }}>
        {question}
      </Text>
      {multi && (
        <Text variant="note" tone="muted" style={{ marginTop: 2 }}>
          {t("conversation.label.question-pick-any")}
        </Text>
      )}
      <View style={{ gap: 6, marginTop: 10 }}>
        {options.map((option, index) => (
          <Option
            key={option.label}
            multi={multi}
            on={choices.includes(index)}
            onPress={() => pick(index)}
          >
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text
                variant="control"
                weight="medium"
                style={{ lineHeight: 20 }}
              >
                {option.label}
              </Text>
              {option.sub !== undefined && (
                <Text variant="small" tone="muted">
                  {option.sub}
                </Text>
              )}
            </View>
          </Option>
        ))}
        <Option multi={multi} on={other} onPress={pickOther}>
          {other ? (
            <TextInput
              value={text}
              onChangeText={setText}
              autoFocus
              placeholder={t(
                "conversation.label.question-own-answer-placeholder",
              )}
              placeholderTextColor={theme.color.text.muted}
              cursorColor={theme.color.text.primary}
              multiline
              style={{
                flex: 1,
                padding: 0,
                fontFamily: theme.font.sans,
                ...scaleText(theme, { fontSize: 15, lineHeight: 20 }),
                color: theme.color.text.primary,
              }}
            />
          ) : (
            <Text variant="control" tone="muted" style={{ lineHeight: 20 }}>
              {t("mobile.kit.label.question-other")}
            </Text>
          )}
        </Option>
      </View>
      <View
        style={{
          flexDirection: "row",
          justifyContent: "flex-end",
          marginTop: 12,
        }}
      >
        <Button
          variant="primary"
          trailingIcon={ChevronRight}
          disabled={!ready}
          onPress={() => onNext({ choices, text: other ? text.trim() : null })}
        >
          {nextLabel}
        </Button>
      </View>
    </AskCard>
  );
}

function Option({
  multi,
  on,
  onPress,
  children,
}: {
  multi: boolean;
  on: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole={multi ? "checkbox" : "radio"}
      accessibilityState={{ checked: on }}
      onPress={onPress}
      style={{
        // 60 is what the wireframe measures with its two lines; the "something else" row matches it.
        minHeight: 60,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 10,
        backgroundColor: theme.color.surface.muted,
      }}
    >
      {multi ? <Checkbox on={on} /> : <Radio on={on} />}
      {children}
    </Pressable>
  );
}

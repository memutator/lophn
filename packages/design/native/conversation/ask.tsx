import { t } from "@lophn/i18n";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  KeyRound,
  type LucideIcon,
  TriangleAlert,
  X,
} from "lucide-react-native";
import { type ReactNode, useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { Pre } from "../feedback/display.tsx";
import { Radio } from "../input/choice.tsx";
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

export type QuestionAnswer = { choice: number } | { text: string };

export interface QuestionCardProps {
  /** lophn is asking */
  title: string;
  question: string;
  options: readonly QuestionOption[];
  /** Which question of how many, when there are several. */
  at?: number;
  of?: number;
  onPrev?: () => void;
  onSkip?: () => void;
  /** First choice picked before the person touches anything. */
  initial?: number;
  /** Next on all but the last question, then Send. */
  nextLabel?: string;
  onNext: (answer: QuestionAnswer) => void;
}

const OTHER = -1;

// A question the agent asks, one at a time: pick an option or write an answer.
export function QuestionCard({
  title,
  question,
  options,
  at,
  of,
  onPrev,
  onSkip,
  initial,
  nextLabel = t("conversation.button.question-next"),
  onNext,
}: QuestionCardProps) {
  const theme = useTheme();
  const [choice, setChoice] = useState<number | undefined>(initial);
  const [text, setText] = useState("");
  const ready =
    choice !== undefined && (choice !== OTHER || text.trim() !== "");
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
      <View style={{ gap: 6, marginTop: 10 }}>
        {options.map((option, index) => (
          <Option
            key={option.label}
            on={choice === index}
            onPress={() => setChoice(index)}
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
        <Option on={choice === OTHER} onPress={() => setChoice(OTHER)}>
          {choice === OTHER ? (
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
          onPress={() =>
            choice === OTHER
              ? onNext({ text: text.trim() })
              : onNext({ choice: choice ?? 0 })
          }
        >
          {nextLabel}
        </Button>
      </View>
    </AskCard>
  );
}

function Option({
  on,
  onPress,
  children,
}: {
  on: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
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
      <Radio on={on} />
      {children}
    </Pressable>
  );
}

export interface SecretCardProps {
  /** lophn needs a secret */
  title: string;
  /** PAYMENTS_KEY → api.payments.example */
  secret: string;
  /** Where to type it instead. */
  note: string;
  onCancel?: () => void;
}

// A request for a secret. Secrets are never typed on the phone; the card says where to enter it.
export function SecretCard({ title, secret, note, onCancel }: SecretCardProps) {
  return (
    <AskCard>
      <AskTitle icon={KeyRound}>{title}</AskTitle>
      <Fact
        label={t("conversation.label.input-request-secret")}
        value={secret}
      />
      <Text variant="note" tone="muted" style={{ marginTop: 10 }}>
        {note}
      </Text>
      <View
        style={{
          flexDirection: "row",
          justifyContent: "flex-end",
          marginTop: 12,
        }}
      >
        <Button icon={X} onPress={onCancel}>
          {t("mobile.kit.button.cancel-request")}
        </Button>
      </View>
    </AskCard>
  );
}

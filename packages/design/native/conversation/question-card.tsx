import { MessageCircleQuestion } from "lucide-react-native";
import { useState } from "react";
import { View } from "react-native";
import { Checkbox } from "../input/choice.tsx";
import { Input } from "../input/input.tsx";
import { Button } from "../primitives/button.tsx";
import { Icon } from "../primitives/icon.tsx";
import { Text } from "../primitives/text.tsx";
import { useTheme } from "../theme.tsx";

export interface QuestionOption {
  label: string;
  description?: string;
}

export interface Question {
  id: string;
  text: string;
  options: readonly QuestionOption[];
  /** Any number of options may be picked. */
  multi?: boolean;
}

export interface QuestionAnswer {
  id: string;
  /** Labels of the picked options. */
  picked: string[];
  /** The person's own words, when they wrote any. */
  other?: string;
}

export interface QuestionCardProps {
  questions: readonly Question[];
  onSubmit: (answers: QuestionAnswer[]) => void;
  /** The answers are on their way; the card stops taking input. */
  busy?: boolean;
}

interface Draft {
  picked: string[];
  other: string;
}

const answered = (draft: Draft | undefined) =>
  draft !== undefined && (draft.picked.length > 0 || draft.other.trim() !== "");

// One question at a time. All answers go together on the last one.
export function QuestionCard({ questions, onSubmit, busy }: QuestionCardProps) {
  const theme = useTheme();
  const [at, setAt] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const question = questions[at];
  if (question === undefined) return null;
  const draft = drafts[question.id] ?? { picked: [], other: "" };
  const update = (next: Draft) => setDrafts({ ...drafts, [question.id]: next });
  const last = at === questions.length - 1;

  const pick = (label: string, on: boolean) => {
    if (question.multi)
      update({
        ...draft,
        picked: on
          ? [...draft.picked, label]
          : draft.picked.filter((item) => item !== label),
      });
    // Picking one option replaces the person's own words; they answer one way or the other.
    else update({ picked: on ? [label] : [], other: "" });
  };

  return (
    <View
      style={{
        borderRadius: theme.radius.lg,
        borderWidth: 1,
        borderColor: theme.color.border.strong,
        backgroundColor: theme.color.surface.base,
        padding: theme.space[6],
        gap: theme.space[5],
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "flex-start",
          gap: theme.space[4],
        }}
      >
        <Icon icon={MessageCircleQuestion} tone="secondary" />
        <Text weight="semibold" grow>
          {question.text}
        </Text>
        {questions.length > 1 && (
          <Text variant="caption" tone="muted">
            {at + 1} of {questions.length}
          </Text>
        )}
      </View>
      <View>
        {question.options.map((option) => (
          <Checkbox
            key={option.label}
            shape={question.multi ? "square" : "round"}
            label={option.label}
            description={option.description}
            checked={draft.picked.includes(option.label)}
            disabled={busy}
            onChange={(on) => pick(option.label, on)}
          />
        ))}
      </View>
      <Input
        value={draft.other}
        placeholder="Something else"
        multiline
        editable={!busy}
        onChangeText={(other) =>
          update(question.multi ? { ...draft, other } : { picked: [], other })
        }
      />
      <View style={{ flexDirection: "row", gap: theme.space[4] }}>
        {at > 0 && (
          <Button variant="ghost" disabled={busy} onPress={() => setAt(at - 1)}>
            Back
          </Button>
        )}
        <View style={{ flex: 1 }}>
          <Button
            block
            variant="primary"
            disabled={busy || !answered(draft)}
            onPress={() => {
              if (!last) {
                setAt(at + 1);
                return;
              }
              onSubmit(
                questions.map((item) => {
                  const entry = drafts[item.id] ?? { picked: [], other: "" };
                  const other = entry.other.trim();
                  return {
                    id: item.id,
                    picked: entry.picked,
                    ...(other === "" ? {} : { other }),
                  };
                }),
              );
            }}
          >
            {last ? "Send answer" : "Next"}
          </Button>
        </View>
      </View>
    </View>
  );
}

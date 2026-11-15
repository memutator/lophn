import { t } from "@lophn/i18n";
import { Text } from "@lophn/ui-native";
import type { ComponentProps } from "react";

type Key = Parameters<typeof t>[0];
// Stands in for the value while the sentence is formatted, so the value can be drawn in bold where the sentence puts it.
const MARK = "\u0000";

/** One catalog sentence with one value set in semibold: "Go to **Settings › Remote**". */
export function Rich({
  id,
  name,
  value,
  ...text
}: {
  id: Key;
  name: string;
  value: string;
} & Omit<ComponentProps<typeof Text>, "children">) {
  const [before = "", after = ""] = t(id, { [name]: MARK }).split(MARK);
  return (
    <Text {...text}>
      {before}
      <Text variant={text.variant} weight="semibold">
        {value}
      </Text>
      {after}
    </Text>
  );
}

import { Screen, TopBar } from "@lophn/ui-native";
import { useNav } from "./nav.ts";

/** An empty screen with only its title, held for a place whose screen is not built yet. */
export function Placeholder({
  title,
  top,
}: {
  title: string;
  /** menu: a top-level place from the sidebar. back: a place opened from another. */
  top: "menu" | "back";
}) {
  const nav = useNav();
  return (
    <Screen
      top={
        <TopBar
          {...(top === "menu"
            ? nav.menuButton
            : { left: "back", onLeft: nav.back })}
          title={title}
        />
      }
    />
  );
}

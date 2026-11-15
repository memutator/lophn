// The phone's own look: light, dark or the phone's setting, and the text size. Kept on this phone only.
import * as SecureStore from "expo-secure-store";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export type ThemeChoice = "system" | "light" | "dark";
export type TextSize = "small" | "default" | "large";

export interface Appearance {
  readonly theme: ThemeChoice;
  readonly textSize: TextSize;
}

const KEY = "appearance";
const DEFAULT: Appearance = { theme: "system", textSize: "default" };

const AppearanceContext = createContext<{
  appearance: Appearance;
  set(next: Partial<Appearance>): void;
}>({ appearance: DEFAULT, set: () => {} });

export function AppearanceProvider({
  children,
}: {
  children: (appearance: Appearance) => ReactNode;
}) {
  const [appearance, setAppearance] = useState(DEFAULT);
  useEffect(() => {
    void SecureStore.getItemAsync(KEY).then((saved) => {
      if (saved) setAppearance({ ...DEFAULT, ...JSON.parse(saved) });
    });
  }, []);
  const value = useMemo(
    () => ({
      appearance,
      set(next: Partial<Appearance>) {
        const merged = { ...appearance, ...next };
        setAppearance(merged);
        void SecureStore.setItemAsync(KEY, JSON.stringify(merged));
      },
    }),
    [appearance],
  );
  return (
    <AppearanceContext value={value}>{children(appearance)}</AppearanceContext>
  );
}

export function useAppearance() {
  return useContext(AppearanceContext);
}

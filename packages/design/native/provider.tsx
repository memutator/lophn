import type { ReactNode } from "react";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { type Scheme, ThemeProvider } from "./theme.tsx";

export interface UiProviderProps {
  /** Follows the phone's light or dark setting when omitted. */
  scheme?: Scheme;
  children: ReactNode;
}

// Mounted once at the root of an app. Everything in the kit reads the theme, the safe-area insets and the keyboard from here.
export function UiProvider({ scheme, children }: UiProviderProps) {
  return (
    <SafeAreaProvider>
      <KeyboardProvider>
        <ThemeProvider scheme={scheme}>{children}</ThemeProvider>
      </KeyboardProvider>
    </SafeAreaProvider>
  );
}

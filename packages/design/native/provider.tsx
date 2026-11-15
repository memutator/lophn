import type { ReactNode } from "react";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { type Scheme, type TextSize, ThemeProvider } from "./theme.tsx";

export interface UiProviderProps {
  /** Follows the phone's light or dark setting when omitted. */
  scheme?: Scheme;
  /** The text size the person picked: small, default or large. Default when omitted. */
  textSize?: TextSize;
  children: ReactNode;
}

// Mounted once at the root of an app. Everything in the kit reads the theme, the safe-area insets and the keyboard from here.
export function UiProvider({ scheme, textSize, children }: UiProviderProps) {
  return (
    <SafeAreaProvider>
      <KeyboardProvider>
        <ThemeProvider scheme={scheme} textSize={textSize}>
          {children}
        </ThemeProvider>
      </KeyboardProvider>
    </SafeAreaProvider>
  );
}

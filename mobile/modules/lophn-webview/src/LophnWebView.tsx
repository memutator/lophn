import { requireNativeView } from "expo";
import type { Ref } from "react";
import type { StyleProp, ViewStyle } from "react-native";

export type NativeLophnWebViewHandle = {
  postMessage(data: string): Promise<void>;
};

// Raw native view. Use `src/webview/LophnWebView.tsx`, which drops page messages the shell does not know.
export type NativeLophnWebViewProps = {
  ref?: Ref<NativeLophnWebViewHandle>;
  // Absolute folder served at https://remote.lophn.invalid/. Paths outside it and symlinks are 404.
  root: string;
  // Path under `root` the view opens first, e.g. `index.html`.
  entry: string;
  onMessage: (event: { nativeEvent: { data: string } }) => void;
  style?: StyleProp<ViewStyle>;
};

export const NativeLophnWebView =
  requireNativeView<NativeLophnWebViewProps>("LophnWebView");

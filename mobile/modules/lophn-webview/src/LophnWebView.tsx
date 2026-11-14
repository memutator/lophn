import { requireNativeView } from "expo";
import type { Ref } from "react";
import type { StyleProp, ViewStyle } from "react-native";

export type LophnWebViewHandle = {
  postMessage(data: string): Promise<void>;
};

export type LophnWebViewProps = {
  ref?: Ref<LophnWebViewHandle>;
  // Page origin with a trailing slash. The view loads `${origin}index.html`.
  origin: string;
  onMessage: (event: { nativeEvent: { data: string } }) => void;
  style?: StyleProp<ViewStyle>;
};

export const LophnWebView =
  requireNativeView<LophnWebViewProps>("LophnWebView");

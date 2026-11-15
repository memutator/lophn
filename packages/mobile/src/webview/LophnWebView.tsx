import { type Ref, useImperativeHandle, useRef } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import {
  NativeLophnWebView,
  type NativeLophnWebViewHandle,
} from "../../modules/lophn-webview/src/LophnWebView.tsx";
import { type PageMessage, readPageMessage, type ShellMessage } from "./bridge.ts";

export type LophnWebViewHandle = {
  /** Sends to the page. Dropped until the page's first message (it asks for `state` at start). */
  send(message: ShellMessage): void;
};

export function LophnWebView(props: {
  ref?: Ref<LophnWebViewHandle>;
  root: string;
  entry: string;
  onMessage: (message: PageMessage) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const native = useRef<NativeLophnWebViewHandle>(null);
  useImperativeHandle(props.ref, () => ({
    send: (message) => void native.current?.postMessage(JSON.stringify(message)),
  }));
  return (
    <NativeLophnWebView
      ref={native}
      root={props.root}
      entry={props.entry}
      style={props.style}
      onMessage={({ nativeEvent }) => {
        const message = readPageMessage(nativeEvent.data);
        if (message) props.onMessage(message);
      }}
    />
  );
}

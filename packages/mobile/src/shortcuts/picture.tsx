// An app's icon as the PNG a home screen icon is made of. An svg or a lucide icon is drawn by a hidden `<Svg>` laid out
// off the screen and read back with `toDataURL`, so it needs the running app's view tree (the menu that asks is on
// screen). Android draws a png or webp itself. No icon, or one that cannot be drawn, gives the in-app mark: the app's
// first letter on its tone.
import { useTheme } from "@lophn/ui-native";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import * as Lucide from "lucide-react-native";
import { type ComponentType, type RefObject, useEffect, useRef, useState } from "react";
import { View } from "react-native";
import Svg, { G, parse, Rect, Text } from "react-native-svg";
import type { AppIcon } from "../../../protocol/apps/declaration/read.ts";
import { lucideComponentOf } from "../../../shell/renderer/parts/icon-upload/lucide-key.ts";
import { toneOf } from "../data/workspaces.ts";

const SIDE = 192;
// Past this the picture is taken as failed and the next way is tried.
const DRAW_MS = 3000;

export type Drawn = { icon: AppIcon | null; letter: string; tone: number };

/** What an app's picture is drawn from: its icon, or its mark (its name's first letter on its tone). */
export const drawnOf = (app: string, name: string, icon: AppIcon | null): Drawn => ({
  icon,
  letter: name.slice(0, 1).toUpperCase(),
  tone: toneOf(app),
});

/** What a picture is drawn from, short enough to keep on the pinned icon: a new key means the picture changed. */
export const pictureKey = ({ icon, letter, tone }: Drawn): string =>
  bytesToHex(sha256(utf8ToBytes(JSON.stringify([icon, letter, tone])))).slice(0, 16);

/** The app's own icon, else its mark when the icon would not draw; `onDone("")` when neither drew. */
export function IconPicture({
  drawn,
  onDone,
}: {
  drawn: Drawn;
  onDone: (png: string) => void;
}) {
  const [now, setNow] = useState(drawn);
  return (
    <Picture
      key={now.icon === null ? "mark" : "icon"}
      drawn={now}
      onDone={(png) => {
        if (png !== null) onDone(png);
        else if (now.icon !== null) setNow({ ...now, icon: null });
        else onDone("");
      }}
    />
  );
}

/** Draws `drawn` once and hands back its PNG as base64, or null when it could not be drawn. */
export function Picture({
  drawn,
  onDone,
}: {
  drawn: Drawn;
  onDone: (png: string | null) => void;
}) {
  const theme = useTheme();
  const ref = useRef<Svg | null>(null);
  const { icon } = drawn;
  const body = svgOf(drawn, theme.color.chart[drawn.tone] ?? theme.color.chart[0]!, ref);
  useEffect(() => {
    if (icon !== null && "content_type" in icon && icon.content_type !== "image/svg+xml") {
      onDone(icon.data);
      return;
    }
    if (body === null) {
      onDone(null);
      return;
    }
    let done = false;
    const finish = (png: string | null) => {
      if (done) return;
      done = true;
      onDone(png);
    };
    const late = setTimeout(() => finish(null), DRAW_MS);
    // After layout: the native view is not drawn in the effect's own frame.
    const next = setTimeout(() => {
      if (ref.current === null) finish(null);
      else ref.current.toDataURL(finish, { width: SIDE, height: SIDE });
    }, 0);
    return () => {
      clearTimeout(late);
      clearTimeout(next);
    };
  }, []);
  return (
    <View
      pointerEvents="none"
      style={{ position: "absolute", left: -10000, top: 0, width: SIDE, height: SIDE }}
    >
      {body}
    </View>
  );
}

function svgOf(
  { icon, letter }: Drawn,
  tone: string,
  ref: RefObject<Svg | null>,
) {
  if (icon !== null && "content_type" in icon) {
    if (icon.content_type !== "image/svg+xml") return null;
    let ast: ReturnType<typeof parse> = null;
    try {
      ast = parse(atob(icon.data));
    } catch {
      return null;
    }
    if (ast === null) return null;
    const { width, height, viewBox } = ast.props;
    return (
      <Svg
        ref={ref}
        {...ast.props}
        viewBox={
          typeof viewBox === "string"
            ? viewBox
            : `0 0 ${parseFloat(String(width)) || SIDE} ${parseFloat(String(height)) || SIDE}`
        }
        width={SIDE}
        height={SIDE}
      >
        {ast.children}
      </Svg>
    );
  }
  const Glyph =
    icon === null
      ? undefined
      : (lucideComponentOf(Lucide as unknown as Record<string, unknown>, icon.lucide) as
          | ComponentType<{ size: number; color: string; strokeWidth: number }>
          | undefined);
  // The in-app mark's look: white on the app's tone. A nested lucide `<Svg>` ignores x and y, so a G moves it.
  return (
    <Svg ref={ref} width={SIDE} height={SIDE} viewBox={`0 0 ${SIDE} ${SIDE}`}>
      <Rect x={0} y={0} width={SIDE} height={SIDE} fill={tone} />
      {Glyph !== undefined ? (
        <G transform={`translate(${SIDE / 4} ${SIDE / 4})`}>
          <Glyph size={SIDE / 2} color="#ffffff" strokeWidth={2} />
        </G>
      ) : (
        <Text
          x={SIDE / 2}
          y={SIDE / 2 + 34}
          fontSize={96}
          fontWeight="600"
          fill="#ffffff"
          textAnchor="middle"
        >
          {letter}
        </Text>
      )}
    </Svg>
  );
}

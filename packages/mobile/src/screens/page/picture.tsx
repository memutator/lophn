// A page's picture fitted into the space it gets, and the fingers on it turned into the page's input: a tap is a pointer
// down and up, a drag sends moves while pressed, two fingers scroll. Points are a share of the drawn size carried over to
// the frame's CSS px, which is what the computer takes.
import { useRef, useState } from "react";
import { type GestureResponderEvent, Image, View } from "react-native";
import type {
  PageFrame,
  PageInput,
} from "../../../../protocol/lophn-agent/page-view.ts";

// A drag sends at most this often (30 a second); a scroll adds up what came between.
const SEND_EVERY_MS = 33;
// A finger that moves less than this (screen px) before it lifts is a tap.
const SLOP = 6;

type Touches = GestureResponderEvent["nativeEvent"]["touches"];
type Point = { x: number; y: number };

// What the fingers do now. press: one finger down, not moved yet, so nothing is sent until it moves or lifts (a second
// finger turns it into a scroll without a click).
type Gesture =
  | { kind: "idle" }
  | { kind: "press"; at: Point; screen: Point }
  | { kind: "drag"; at: Point; sentAt: number }
  | { kind: "scroll"; screen: Point; pending: Point; sentAt: number };

const middle = (touches: Touches, key: "page" | "location"): Point => {
  let x = 0;
  let y = 0;
  for (const one of touches) {
    x += key === "page" ? one.pageX : one.locationX;
    y += key === "page" ? one.pageY : one.locationY;
  }
  return { x: x / touches.length, y: y / touches.length };
};

export function PagePicture({
  frame,
  dim,
  onInput,
}: {
  frame: PageFrame;
  /** The computer does not draw the page now: the last picture stays, faded. */
  dim: boolean;
  /** Null when this phone may only watch. */
  onInput: ((input: PageInput) => void) | null;
}) {
  const [box, setBox] = useState<{ width: number; height: number } | null>(null);
  const gesture = useRef<Gesture>({ kind: "idle" });

  const ratio = frame.width / frame.height;
  const width =
    box === null ? 0 : Math.min(box.width, box.height * ratio);
  const height = width / ratio;
  const scale = width === 0 ? 1 : frame.width / width;
  const toPage = (x: number, y: number): Point => ({
    x: Math.min(frame.width, Math.max(0, x * scale)),
    y: Math.min(frame.height, Math.max(0, y * scale)),
  });

  const send = (input: PageInput) => onInput?.(input);
  const pointer = (phase: "down" | "move" | "up", at: Point) =>
    send({ type: "pointer", phase, ...at });
  const flush = (now: Gesture & { kind: "scroll" }, at: Point) => {
    const dx = Math.round(now.pending.x);
    const dy = Math.round(now.pending.y);
    if (dx === 0 && dy === 0) return;
    send({ type: "scroll", ...at, dx, dy });
    now.pending = { x: now.pending.x - dx, y: now.pending.y - dy };
  };

  const start = (event: GestureResponderEvent) => {
    const { touches, locationX, locationY, pageX, pageY } = event.nativeEvent;
    gesture.current =
      touches.length >= 2
        ? {
            kind: "scroll",
            screen: middle(touches, "page"),
            pending: { x: 0, y: 0 },
            sentAt: 0,
          }
        : {
            kind: "press",
            at: toPage(locationX, locationY),
            screen: { x: pageX, y: pageY },
          };
  };

  const move = (event: GestureResponderEvent) => {
    const { touches, locationX, locationY, pageX, pageY, timestamp } =
      event.nativeEvent;
    const now = gesture.current;
    if (touches.length >= 2) {
      if (now.kind === "drag") pointer("up", now.at);
      if (now.kind !== "scroll") {
        gesture.current = {
          kind: "scroll",
          screen: middle(touches, "page"),
          pending: { x: 0, y: 0 },
          sentAt: 0,
        };
        return;
      }
      const screen = middle(touches, "page");
      // Fingers going up move the page's content up: the page scrolls down.
      now.pending = {
        x: now.pending.x - (screen.x - now.screen.x) * scale,
        y: now.pending.y - (screen.y - now.screen.y) * scale,
      };
      now.screen = screen;
      if (timestamp - now.sentAt >= SEND_EVERY_MS) {
        now.sentAt = timestamp;
        const at = middle(touches, "location");
        flush(now, toPage(at.x, at.y));
      }
      return;
    }
    const at = toPage(locationX, locationY);
    if (now.kind === "press") {
      if (Math.hypot(pageX - now.screen.x, pageY - now.screen.y) < SLOP) return;
      pointer("down", now.at);
      pointer("move", at);
      gesture.current = { kind: "drag", at, sentAt: timestamp };
    } else if (now.kind === "drag") {
      now.at = at;
      if (timestamp - now.sentAt >= SEND_EVERY_MS) {
        now.sentAt = timestamp;
        pointer("move", at);
      }
    }
    // One finger left of a scroll: nothing until both lift.
  };

  const end = (event: GestureResponderEvent) => {
    const { locationX, locationY } = event.nativeEvent;
    const now = gesture.current;
    gesture.current = { kind: "idle" };
    if (now.kind === "press") {
      pointer("down", now.at);
      pointer("up", now.at);
    } else if (now.kind === "drag") {
      pointer("up", toPage(locationX, locationY));
    } else if (now.kind === "scroll") {
      flush(now, toPage(locationX, locationY));
    }
  };

  return (
    <View
      style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
      onLayout={(event) => setBox(event.nativeEvent.layout)}
    >
      {width > 0 && (
        <View
          style={{ width, height, opacity: dim ? 0.45 : 1 }}
          onStartShouldSetResponder={() => onInput !== null}
          onMoveShouldSetResponder={() => onInput !== null}
          onResponderTerminationRequest={() => false}
          onResponderGrant={start}
          onResponderMove={move}
          onResponderRelease={end}
          onResponderTerminate={end}
        >
          <Image
            source={{ uri: `data:${frame.media_type};base64,${frame.data_base64}` }}
            style={{ width, height }}
            pointerEvents="none"
            fadeDuration={0}
          />
        </View>
      )}
    </View>
  );
}

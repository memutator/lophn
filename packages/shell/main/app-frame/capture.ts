// annotation 보내기 때 screenshot을 만든다. annotation마다 페이지에 윤곽과 번호 표지를 그리게 한 뒤
// 앱 view 전체를 capture하고, 페이지가 알려 준 범위로 잘라 정해진 크기로 줄인다. 어느 단계든
// 실패하면 null이고 보내기는 그 annotation을 screenshot 없이 보낸다.
import { Buffer } from "node:buffer";
import { z } from "zod";

import {
  ANNOTATE_PAGE_CLEAR_CAPTURE,
  ANNOTATE_PAGE_PREPARE_CAPTURE,
  annotatePageCaptureReadySchema,
  type AnnotateViewPort,
} from "../../ipc/annotation.ts";

/** 표지를 그릴 때까지 페이지를 기다리는 시간. */
export const CAPTURE_WAIT_MS = 2000;
/** 올리는 이미지의 긴 변 상한(px). */
export const SCREENSHOT_LONG_SIDE = 1600;
/** protocol `ANNOTATION_SCREENSHOT_MAX_BYTES`의 사본. shell main은 protocol을 import하지 못한다. */
export const SCREENSHOT_MAX_BYTES = 2 * 1024 * 1024;

export type Crop = { x: number; y: number; width: number; height: number };
export type Viewport = { width: number; height: number };

// 페이지가 capture-ready에 viewport 크기를 같이 싣는다(crop이 viewport CSS px라 PNG px로 바꾸는 데
// 필요하다). ipc/annotation.ts의 계약에는 아직 없다.
export const captureReadySchema = annotatePageCaptureReadySchema.extend({
  viewport: z.strictObject({
    width: z.number().positive(),
    height: z.number().positive(),
  }),
});
export type CaptureReady = z.infer<typeof captureReadySchema>;

/** PNG를 crop(viewport CSS px)으로 잘라 한도 안으로 줄인다. 못 하면 던진다. */
export type CropAndFit = (
  png: Uint8Array,
  crop: Crop,
  viewport: Viewport,
) => Uint8Array;

/** electron `nativeImage`로 하는 실제 구현. 이미지는 PNG 그대로 다룬다. */
export function nativeCropAndFit(native: {
  createFromBuffer(buffer: Buffer): NativeImageLike;
}): CropAndFit {
  return (png, crop, viewport) => {
    const image = native.createFromBuffer(Buffer.from(png));
    const size = image.getSize();
    const sx = size.width / viewport.width;
    const sy = size.height / viewport.height;
    const x0 = Math.max(0, Math.floor(crop.x * sx));
    const y0 = Math.max(0, Math.floor(crop.y * sy));
    const x1 = Math.min(size.width, Math.ceil((crop.x + crop.width) * sx));
    const y1 = Math.min(size.height, Math.ceil((crop.y + crop.height) * sy));
    if (x1 <= x0 || y1 <= y0) throw new Error("crop is outside the view");
    let out = image.crop({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 });
    out = shrink(out, SCREENSHOT_LONG_SIDE / longSide(out));
    let bytes = out.toPNG();
    if (bytes.length > SCREENSHOT_MAX_BYTES) {
      // 한 번 더 줄인다. 그래도 넘으면 던진다.
      out = shrink(out, Math.sqrt(SCREENSHOT_MAX_BYTES / bytes.length) * 0.9);
      bytes = out.toPNG();
      if (bytes.length > SCREENSHOT_MAX_BYTES) {
        throw new Error("screenshot is too large");
      }
    }
    return new Uint8Array(bytes);
  };
}

/** `nativeImage`가 주는 이미지 중 쓰는 칸. */
export interface NativeImageLike {
  getSize(): { width: number; height: number };
  crop(rect: Crop): NativeImageLike;
  resize(size: { width: number; height: number }): NativeImageLike;
  toPNG(): Buffer;
}

function longSide(image: NativeImageLike): number {
  const { width, height } = image.getSize();
  return Math.max(width, height);
}

function shrink(image: NativeImageLike, scale: number): NativeImageLike {
  if (scale >= 1) return image;
  const { width, height } = image.getSize();
  return image.resize({
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
  });
}

export interface CapturerDeps {
  cropAndFit: CropAndFit;
}

export function createCapturer(deps: CapturerDeps) {
  const waiting = new Map<string, (ready: CaptureReady | null) => void>();
  const keyOf = (view_session: string, n: number) => `${view_session}#${n}`;

  return {
    /** 페이지가 `annotate:capture-ready`를 보냈다. 기다리는 annotation이 아니면 버린다. */
    ready(view_session: string, ready: CaptureReady): void {
      waiting.get(keyOf(view_session, ready.n))?.(ready);
    },

    /** annotation 하나의 이미지. 실패하면 null이다. */
    async shoot(port: AnnotateViewPort, n: number): Promise<Uint8Array | null> {
      const key = keyOf(port.view_session, n);
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const ready = await new Promise<CaptureReady | null>((resolve) => {
          waiting.set(key, resolve);
          timer = setTimeout(() => resolve(null), CAPTURE_WAIT_MS);
          port.send(ANNOTATE_PAGE_PREPARE_CAPTURE, { n });
        });
        if (ready === null) return null;
        const png = await port.capture();
        if (!port.current()) return null;
        return deps.cropAndFit(png, ready.crop, ready.viewport);
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
        waiting.delete(key);
        port.send(ANNOTATE_PAGE_CLEAR_CAPTURE, {});
      }
    },
  };
}

export type Capturer = ReturnType<typeof createCapturer>;

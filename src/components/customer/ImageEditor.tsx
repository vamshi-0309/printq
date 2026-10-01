"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PaperSize } from "@/components/customer/PrintOptions";

/**
 * Adjust a photo before it is uploaded: zoom and drag to crop, rotate in 90°
 * steps, black & white, fit-to-page or actual size, paper and copies.
 *
 * WHAT GETS PRINTED IS WHAT IS UPLOADED
 * Rotation, crop and black & white are baked into a new image file here, in
 * the browser, and that file is what /api/upload receives. The agent never
 * gets the original plus a list of instructions to apply — there is nothing
 * for it to apply, so nothing it can get wrong. Fit/actual size, paper and
 * copies are print settings, carried on the order like any other.
 *
 * The source is downscaled to at most MAX_EDGE pixels on its longest side
 * first: a 48-megapixel phone photo is far more than any A3 print needs, and
 * keeping it would make the upload slow and the canvas run out of memory on
 * cheaper phones.
 */

const MAX_EDGE = 4000;
const MAX_ZOOM = 4;

export interface ImageEdit {
  file: File;
  colorMode: "bw" | "color";
  fitMode: "fit" | "actual";
  paperSize: PaperSize;
  copies: number;
  orientation: "portrait" | "landscape";
}

export function ImageEditor({
  file,
  enabledPaperSizes,
  initial,
  onDone,
  onCancel,
}: {
  file: File;
  enabledPaperSizes: PaperSize[];
  initial: { colorMode: "bw" | "color"; paperSize: PaperSize; copies: number };
  onDone: (edit: ImageEdit) => void;
  onCancel: () => void;
}) {
  const [source, setSource] = useState<HTMLCanvasElement | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rotation, setRotation] = useState(0); // quarter turns
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0.5, y: 0.5 }); // window centre, 0..1 of the rotated image
  const [colorMode, setColorMode] = useState(initial.colorMode);
  const [fitMode, setFitMode] = useState<"fit" | "actual">("fit");
  const [paperSize, setPaperSize] = useState<PaperSize>(initial.paperSize);
  const [copies, setCopies] = useState(initial.copies);
  const [baking, setBaking] = useState(false);
  const previewRef = useRef<HTMLCanvasElement | null>(null);
  const drag = useRef<{ x: number; y: number; pan: { x: number; y: number } } | null>(null);

  // Decode once, downscaled.
  useEffect(() => {
    let cancelled = false;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement("canvas");
      c.width = Math.round(img.naturalWidth * scale);
      c.height = Math.round(img.naturalHeight * scale);
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
      setSource(c);
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      setLoadError("This image couldn't be opened. Try a JPG or PNG.");
      URL.revokeObjectURL(url);
    };
    img.src = url;
    return () => {
      cancelled = true;
    };
  }, [file]);

  // The source turned by the chosen number of quarter turns.
  const rotated = useMemo(() => {
    if (!source) return null;
    const quarter = ((rotation % 4) + 4) % 4;
    const c = document.createElement("canvas");
    const swap = quarter % 2 === 1;
    c.width = swap ? source.height : source.width;
    c.height = swap ? source.width : source.height;
    const ctx = c.getContext("2d")!;
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate((quarter * Math.PI) / 2);
    ctx.drawImage(source, -source.width / 2, -source.height / 2);
    return c;
  }, [source, rotation]);

  /** The crop window in rotated-image pixels. */
  const window_ = useMemo(() => {
    if (!rotated) return null;
    const w = rotated.width / zoom;
    const h = rotated.height / zoom;
    const x = Math.min(Math.max(pan.x * rotated.width - w / 2, 0), rotated.width - w);
    const y = Math.min(Math.max(pan.y * rotated.height - h / 2, 0), rotated.height - h);
    return { x, y, w, h };
  }, [rotated, zoom, pan]);

  const draw = useCallback(
    (target: HTMLCanvasElement, maxWidth: number | null) => {
      if (!rotated || !window_) return;
      const scale = maxWidth ? Math.min(1, maxWidth / window_.w) : 1;
      target.width = Math.max(1, Math.round(window_.w * scale));
      target.height = Math.max(1, Math.round(window_.h * scale));
      const ctx = target.getContext("2d")!;
      ctx.filter = colorMode === "bw" ? "grayscale(1)" : "none";
      ctx.drawImage(rotated, window_.x, window_.y, window_.w, window_.h, 0, 0, target.width, target.height);
      ctx.filter = "none";
      // `filter` is not supported everywhere; fall back to a pixel pass.
      if (colorMode === "bw" && !("filter" in ctx)) grayscalePixels(ctx, target.width, target.height);
    },
    [rotated, window_, colorMode]
  );

  useEffect(() => {
    if (previewRef.current) draw(previewRef.current, 900);
  }, [draw]);

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, pan };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drag.current || zoom <= 1) return;
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const dx = (e.clientX - drag.current.x) / rect.width / zoom;
    const dy = (e.clientY - drag.current.y) / rect.height / zoom;
    setPan({
      x: clamp(drag.current.pan.x - dx, 0, 1),
      y: clamp(drag.current.pan.y - dy, 0, 1),
    });
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  const finish = async () => {
    if (!window_) return;
    setBaking(true);
    try {
      const out = document.createElement("canvas");
      draw(out, null);
      const png = file.type === "image/png";
      const blob: Blob | null = await new Promise((resolve) =>
        out.toBlob(resolve, png ? "image/png" : "image/jpeg", 0.92)
      );
      if (!blob) throw new Error("export failed");
      const stem = file.name.replace(/\.[^.]+$/, "").slice(0, 80) || "photo";
      const edited = new File([blob], `${stem}-print.${png ? "png" : "jpg"}`, { type: blob.type });
      onDone({
        file: edited,
        colorMode,
        fitMode,
        paperSize,
        copies,
        orientation: out.width > out.height ? "landscape" : "portrait",
      });
    } catch {
      setLoadError("Couldn't prepare the image. Try again, or use a different photo.");
    } finally {
      setBaking(false);
    }
  };

  if (loadError) {
    return (
      <div className="space-y-3">
        <p role="alert" className="border-l-2 border-magenta bg-magenta/[0.05] px-3 py-2.5 text-[12.5px] text-magenta">
          {loadError}
        </p>
        <button type="button" onClick={onCancel} className="w-full border border-line py-3 text-[13.5px] text-ink-soft">
          Choose another file
        </button>
      </div>
    );
  }

  const seg = (active: boolean) =>
    `flex-1 border px-2 py-2.5 text-[13px] font-medium transition-colors ${
      active ? "border-ink bg-ink text-paper" : "border-line text-ink-soft hover:text-ink"
    }`;

  return (
    <div className="space-y-5">
      <div>
        <p className="font-data text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
          Adjust your photo
        </p>
        <div className="mt-2 flex items-center justify-center border border-line bg-paper-grey/60 p-3">
          {source ? (
            <canvas
              ref={previewRef}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              className={`max-h-[50vh] max-w-full touch-none bg-paper shadow-sm ${zoom > 1 ? "cursor-grab active:cursor-grabbing" : ""} ${
                fitMode === "actual" ? "scale-90" : ""
              }`}
              aria-label="Photo preview. Drag to move the crop when zoomed in."
            />
          ) : (
            <span className="h-48 w-full animate-pulse bg-line" />
          )}
        </div>
        <p className="mt-1.5 text-[11.5px] text-ink-soft">
          {zoom > 1 ? "Drag the photo to choose what's kept." : "Zoom in to crop."} What you see is exactly what prints.
        </p>
      </div>

      <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-4">
        <span className="text-[12.5px] text-ink-soft">Zoom</span>
        <input
          type="range"
          min={1}
          max={MAX_ZOOM}
          step={0.05}
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
          aria-label="Zoom"
          className="w-full accent-cyan"
        />

        <span className="text-[12.5px] text-ink-soft">Rotate</span>
        <div className="flex gap-2">
          <button type="button" onClick={() => setRotation((r) => r - 1)} className="flex-1 border border-line py-2.5 text-[13px] text-ink hover:bg-paper-grey" aria-label="Rotate left 90 degrees">
            ⟲ 90°
          </button>
          <button type="button" onClick={() => setRotation((r) => r + 1)} className="flex-1 border border-line py-2.5 text-[13px] text-ink hover:bg-paper-grey" aria-label="Rotate right 90 degrees">
            ⟳ 90°
          </button>
        </div>

        <span className="text-[12.5px] text-ink-soft">Colour</span>
        <div className="flex">
          <button type="button" className={seg(colorMode === "bw")} onClick={() => setColorMode("bw")}>Black &amp; white</button>
          <button type="button" className={seg(colorMode === "color")} onClick={() => setColorMode("color")}>Colour</button>
        </div>

        <span className="text-[12.5px] text-ink-soft">Size</span>
        <div className="flex">
          <button type="button" className={seg(fitMode === "fit")} onClick={() => setFitMode("fit")}>Fit to page</button>
          <button type="button" className={seg(fitMode === "actual")} onClick={() => setFitMode("actual")}>Actual size</button>
        </div>

        {enabledPaperSizes.length > 1 && (
          <>
            <span className="text-[12.5px] text-ink-soft">Paper</span>
            <div className="flex">
              {enabledPaperSizes.map((s) => (
                <button key={s} type="button" className={seg(paperSize === s)} onClick={() => setPaperSize(s)}>
                  {s}
                </button>
              ))}
            </div>
          </>
        )}

        <span className="text-[12.5px] text-ink-soft">Copies</span>
        <div className="inline-flex w-fit items-stretch border border-line">
          <button type="button" onClick={() => setCopies((c) => Math.max(1, c - 1))} className="h-11 w-11 text-lg text-ink" aria-label="One fewer copy">−</button>
          <span className="flex w-12 items-center justify-center border-x border-line font-data text-[15px] font-semibold text-ink">{copies}</span>
          <button type="button" onClick={() => setCopies((c) => Math.min(500, c + 1))} className="h-11 w-11 text-lg text-ink" aria-label="One more copy">+</button>
        </div>
      </div>

      <div className="flex gap-2">
        <button type="button" onClick={onCancel} className="border border-line px-4 py-3 text-[13.5px] text-ink-soft hover:border-ink hover:text-ink">
          Back
        </button>
        <button
          type="button"
          onClick={finish}
          disabled={!source || baking}
          className="flex-1 border border-ink bg-ink py-3 text-[14px] font-medium text-paper disabled:opacity-40"
        >
          {baking ? "Preparing…" : "Use this photo"}
        </button>
      </div>
    </div>
  );
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

function grayscalePixels(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const data = ctx.getImageData(0, 0, w, h);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    const y = Math.round(0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]);
    px[i] = px[i + 1] = px[i + 2] = y;
  }
  ctx.putImageData(data, 0, 0);
}

"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";

export function ShopQr({ shopSlug, appUrl }: { shopSlug: string; appUrl: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const customerUrl = `${appUrl}/p/${shopSlug}`;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // The bitmap stays at 480px so the code is crisp when printed, but the
    // library writes an inline style.width to match it — which beats the
    // `w-60` class and made the canvas render 480px wide, pushing a phone
    // into horizontal scroll. The displayed size is reasserted afterwards.
    void QRCode.toCanvas(canvas, customerUrl, {
      width: 480,
      margin: 2,
      color: { dark: "#0A1F3C", light: "#FFFFFF" },
    }).then(() => {
      canvas.style.width = "100%";
      canvas.style.maxWidth = "240px";
      canvas.style.height = "auto";
    });
    QRCode.toDataURL(customerUrl, { width: 1200, margin: 2, color: { dark: "#0A1F3C", light: "#FFFFFF" } }).then(
      setDataUrl
    );
  }, [customerUrl]);

  const downloadPng = () => {
    if (!dataUrl) return;
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `printq-${shopSlug}-qr.png`;
    a.click();
  };

  const copyUrl = async () => {
    await navigator.clipboard.writeText(customerUrl);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-center border border-line bg-paper p-8">
        <canvas
          ref={canvasRef}
          className="h-auto w-full max-w-60"
          aria-label="Shop QR code"
        />
        <p className="font-data mt-4 break-all text-center text-sm text-ink-soft">{customerUrl}</p>
      </div>
      {/* Wraps: three side-by-side buttons overflow a 375px phone. */}
      <div className="flex flex-wrap gap-3">
        <button
          onClick={downloadPng}
          className="border border-ink bg-ink px-4 py-2 text-sm font-medium text-paper hover:bg-ink-soft"
        >
          Download PNG
        </button>
        <button
          onClick={copyUrl}
          className="border border-line px-4 py-2 text-sm font-medium text-ink hover:border-ink"
        >
          Copy customer URL
        </button>
        <button
          onClick={() => window.print()}
          className="border border-line px-4 py-2 text-sm font-medium text-ink hover:border-ink"
        >
          Print poster
        </button>
      </div>

      {/* Printable poster - only visible in print output via @media print in globals.css */}
      <div id="qr-poster" className="hidden print:flex print:min-h-screen print:flex-col print:items-center print:justify-center">
        <p className="font-display text-3xl font-bold text-ink">Scan to print</p>
        {dataUrl && <img src={dataUrl} alt="" className="mt-8 h-96 w-96" />}
        <p className="mt-8 text-lg text-ink-soft">Upload your document · Pay · Get your token</p>
      </div>
    </div>
  );
}

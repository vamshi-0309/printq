"use client";

/**
 * Upload with real progress.
 *
 * `fetch` cannot report upload progress, so the previous implementation faked
 * it with a timer that crept to 90% regardless of what the network was doing —
 * on a slow connection it sat at 90% for a long time, and on a failure it had
 * already shown near-completion. XMLHttpRequest exposes genuine
 * `upload.onprogress` events, so the bar reflects bytes actually sent.
 */

export type UploadProgress = {
  loaded: number;
  total: number;
  /** 0-100, or null while the total length is still unknown. */
  percent: number | null;
};

export type UploadHandle<T> = {
  promise: Promise<T>;
  abort: () => void;
};

export class UploadError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
  }
}

export function uploadWithProgress<T>(
  url: string,
  formData: FormData,
  onProgress: (p: UploadProgress) => void
): UploadHandle<T> {
  const xhr = new XMLHttpRequest();

  const promise = new Promise<T>((resolve, reject) => {
    xhr.open("POST", url, true);

    xhr.upload.onprogress = (e) => {
      onProgress({
        loaded: e.loaded,
        total: e.total,
        percent: e.lengthComputable ? Math.round((e.loaded / e.total) * 100) : null,
      });
    };

    // The bytes are gone, but the server still has to read and answer. Hold at
    // 99 so the bar never claims completion before the response arrives.
    xhr.upload.onload = () => {
      onProgress({ loaded: 1, total: 1, percent: 99 });
    };

    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // Non-JSON response — handled below.
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress({ loaded: 1, total: 1, percent: 100 });
        resolve(body as T);
        return;
      }

      const message =
        body && typeof body === "object" && "error" in body
          ? String((body as { error: unknown }).error)
          : `Upload failed (${xhr.status}).`;
      reject(new UploadError(message, xhr.status));
    };

    xhr.onerror = () =>
      reject(new UploadError("Upload failed. Check your connection and try again."));
    xhr.ontimeout = () => reject(new UploadError("The upload timed out. Try again."));
    xhr.onabort = () => reject(new UploadError("Upload cancelled."));

    // Generous: a 50 MB file on a weak mobile connection is legitimately slow.
    xhr.timeout = 5 * 60 * 1000;
    xhr.send(formData);
  });

  return { promise, abort: () => xhr.abort() };
}

/** "1.2 MB" / "864 KB" — sized for a phone screen. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

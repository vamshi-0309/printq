/**
 * Filename helpers with no dependencies.
 *
 * This lives apart from documentPages.ts on purpose. That module statically
 * imports pdf-lib and fflate, which are server-only; when the client-side
 * DocumentPreview imported `extensionOf` from there, the bundler pulled the
 * whole of pdf-lib into the customer bundle — about 1.5 MB of JavaScript
 * delivered to a phone before it could show an upload button. Keeping the
 * pure helpers dependency-free stops one small import dragging a parser in.
 */

/** Lowercase extension including the dot, e.g. ".pdf". Empty when there is none. */
export function extensionOf(filename: string): string {
  const i = filename.lastIndexOf(".");
  return i === -1 ? "" : filename.slice(i).toLowerCase();
}

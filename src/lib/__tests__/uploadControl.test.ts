import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Regression guard for the mobile file picker.
 *
 * THE BUG
 *   The upload control was a <button> whose onClick called .click() on a
 *   1x1 `sr-only` <input type="file">. Desktop browsers and mobile emulators
 *   allow that, so it looked fine in testing — but real iOS Safari and several
 *   Android WebViews refuse to open the picker for a programmatic .click() on
 *   an input that is effectively invisible. On an actual phone, tapping
 *   "Browse files" did nothing, and no upload request was ever made.
 *
 * THE FIX
 *   A <label htmlFor> associated with the input. Label activation is native
 *   HTML behaviour: it needs no JavaScript, no user-activation heuristic, and
 *   behaves identically on Android Chrome and iOS Safari.
 *
 * These are source-level assertions rather than DOM tests — the project has no
 * DOM testing library, and the property worth protecting is structural: the
 * control must not go back to depending on a scripted click. The runtime proof
 * lives alongside this in the browser check, which loads the page with
 * JavaScript disabled and confirms the picker still opens — something only a
 * real label/input association can do.
 */

const RAW = fs.readFileSync(
  path.resolve(process.cwd(), "src/components/customer/UploadStep.tsx"),
  "utf8"
);

/**
 * Comments are stripped before structural assertions — the file explains the
 * old <button>/.click() pattern in prose, and a naive search would match that
 * explanation rather than real markup.
 */
const SOURCE = RAW.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("upload control markup", () => {
  it("uses a label bound to the input with htmlFor", () => {
    expect(SOURCE).toMatch(/<label\s+htmlFor=\{inputId\}/);
    expect(SOURCE).toMatch(/<input[\s\S]{0,200}id=\{inputId\}/);
  });

  it("renders a real file input", () => {
    expect(SOURCE).toMatch(/type="file"/);
  });

  // The exact pattern that broke on real phones.
  it("never opens the picker with a programmatic .click()", () => {
    expect(SOURCE).not.toMatch(/\.current\??\.click\(\)/);
    expect(SOURCE).not.toMatch(/inputRef/);
  });

  it("does not wrap the trigger in a button that would swallow the tap", () => {
    // A <button> around the label would intercept activation before the label
    // could reach the input. Scoped to the idle-state JSX: the uploading state
    // returns earlier and legitimately has its own Cancel button.
    const idleJsx = SOURCE.slice(SOURCE.lastIndexOf("return ("));
    expect(idleJsx).toContain("<label");
    expect(idleJsx).not.toContain("<button");
  });

  it("keeps the input out of the label so activation cannot fire twice", () => {
    // Nesting *and* htmlFor makes some browsers reopen the picker immediately
    // after a file is chosen.
    const label = SOURCE.slice(SOURCE.indexOf("<label"), SOURCE.indexOf("</label>"));
    expect(label).not.toMatch(/type="file"/);
  });

  it("hides the input without making it unfocusable", () => {
    // display:none / hidden would drop it out of the tab order; a label cannot
    // take focus itself, so keyboard users would have no way in.
    expect(SOURCE).toMatch(/className="sr-only"/);
    expect(SOURCE).not.toMatch(/type="file"[\s\S]{0,200}hidden/);
    expect(SOURCE).not.toMatch(/type="file"[\s\S]{0,200}display:\s*none/);
  });

  it("shows focus on the drop zone for keyboard users", () => {
    expect(SOURCE).toMatch(/focus-within:/);
  });

  it("uses a hydration-stable id", () => {
    // A random id would differ between server and client render and break the
    // label association after hydration.
    expect(SOURCE).toMatch(/useId\(\)/);
    expect(SOURCE).not.toMatch(/id=\{`[^`]*\$\{Math\.random/);
  });

  it("still restricts the picker with an accept attribute", () => {
    expect(SOURCE).toMatch(/accept=\{ACCEPT\}/);
  });

  it("clears the value so the same file can be re-picked after an error", () => {
    expect(SOURCE).toMatch(/e\.target\.value = ""/);
  });
});

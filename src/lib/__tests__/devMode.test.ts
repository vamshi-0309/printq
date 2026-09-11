import { describe, it, expect } from "vitest";
import { isDevMode } from "../devMode";

/**
 * `isDevMode` is the only thing standing between a deployed build and a route
 * that mints pre-confirmed auth users, so the production kill-switch is
 * tested exhaustively rather than just on the happy path.
 *
 * `isDevMode` takes the environment as an argument precisely so this can be
 * checked without mutating the real `process.env`.
 */

type Env = NodeJS.ProcessEnv;
const env = (o: Record<string, string | undefined>) => o as Env;

describe("isDevMode", () => {
  it("is enabled in development with the explicit opt-in", () => {
    expect(isDevMode(env({ NODE_ENV: "development", PRINTQ_DEV_MODE: "true" }))).toBe(true);
  });

  it("is disabled in development without the opt-in", () => {
    expect(isDevMode(env({ NODE_ENV: "development" }))).toBe(false);
    expect(isDevMode(env({ NODE_ENV: "development", PRINTQ_DEV_MODE: "false" }))).toBe(false);
  });

  // The critical property: production always wins, whatever else is set.
  it("is disabled in production even when PRINTQ_DEV_MODE is true", () => {
    expect(isDevMode(env({ NODE_ENV: "production", PRINTQ_DEV_MODE: "true" }))).toBe(false);
  });

  it("is disabled in production for every truthy-looking opt-in value", () => {
    for (const v of ["true", "TRUE", "1", "yes", "on", " true "]) {
      expect(isDevMode(env({ NODE_ENV: "production", PRINTQ_DEV_MODE: v }))).toBe(false);
    }
  });

  it("only accepts the exact string \"true\" as the opt-in", () => {
    for (const v of ["TRUE", "True", "1", "yes", "on", " true ", ""]) {
      expect(isDevMode(env({ NODE_ENV: "development", PRINTQ_DEV_MODE: v }))).toBe(false);
    }
  });

  it("is disabled when NODE_ENV is unset and no opt-in is given", () => {
    expect(isDevMode(env({}))).toBe(false);
  });

  it("does not read the NEXT_PUBLIC_ mirror — that is a UI hint only", () => {
    // A browser-visible flag must never be able to authorise the server route.
    expect(
      isDevMode(env({ NODE_ENV: "development", NEXT_PUBLIC_PRINTQ_DEV_MODE: "true" }))
    ).toBe(false);
  });
});

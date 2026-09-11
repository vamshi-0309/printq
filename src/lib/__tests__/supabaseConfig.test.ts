import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isSupabaseConfigured } from "../supabase/client";

/**
 * `isSupabaseConfigured` decides whether the auth screens can work at all.
 * It reads `process.env` inside the function body rather than at module
 * scope, so each test can just set the env and call it directly.
 */

const URL_KEY = "NEXT_PUBLIC_SUPABASE_URL";
const ANON_KEY = "NEXT_PUBLIC_SUPABASE_ANON_KEY";

let originalUrl: string | undefined;
let originalKey: string | undefined;

beforeEach(() => {
  originalUrl = process.env[URL_KEY];
  originalKey = process.env[ANON_KEY];
});

afterEach(() => {
  if (originalUrl === undefined) delete process.env[URL_KEY];
  else process.env[URL_KEY] = originalUrl;
  if (originalKey === undefined) delete process.env[ANON_KEY];
  else process.env[ANON_KEY] = originalKey;
});

describe("isSupabaseConfigured", () => {
  it("is true for a real project URL and anon key", () => {
    process.env[URL_KEY] = "https://abcdefghijklmnop.supabase.co";
    process.env[ANON_KEY] = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.body.sig";
    expect(isSupabaseConfigured()).toBe(true);
  });

  it("is false when the anon key is empty", () => {
    process.env[URL_KEY] = "https://abcdefghijklmnop.supabase.co";
    process.env[ANON_KEY] = "";
    expect(isSupabaseConfigured()).toBe(false);
  });

  it("is false when the anon key is only whitespace", () => {
    process.env[URL_KEY] = "https://abcdefghijklmnop.supabase.co";
    process.env[ANON_KEY] = "   ";
    expect(isSupabaseConfigured()).toBe(false);
  });

  it("is false when the URL is missing", () => {
    delete process.env[URL_KEY];
    process.env[ANON_KEY] = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.body.sig";
    expect(isSupabaseConfigured()).toBe(false);
  });

  // This is the state the project was actually in: .env.local copied from
  // .env.example and never filled in.
  it("is false for the unedited .env.example placeholder", () => {
    process.env[URL_KEY] = "https://your-project.supabase.co";
    process.env[ANON_KEY] = "";
    expect(isSupabaseConfigured()).toBe(false);
  });

  it("is false for the placeholder host even if a key is present", () => {
    process.env[URL_KEY] = "https://your-project.supabase.co";
    process.env[ANON_KEY] = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.body.sig";
    expect(isSupabaseConfigured()).toBe(false);
  });
});

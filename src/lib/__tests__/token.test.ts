import { describe, it, expect } from "vitest";
import { formatToken, parseToken } from "../token";

describe("token", () => {
  it("formats small counters", () => {
    expect(formatToken(1)).toBe("A001");
    expect(formatToken(42)).toBe("A042");
    expect(formatToken(999)).toBe("A999");
  });

  it("rolls over to the next letter after 999", () => {
    expect(formatToken(1000)).toBe("B001");
    expect(formatToken(1998)).toBe("B999");
    expect(formatToken(1999)).toBe("C001");
  });

  it("round-trips format -> parse", () => {
    for (const n of [1, 42, 999, 1000, 2500]) {
      expect(parseToken(formatToken(n))).toBe(n);
    }
  });

  it("rejects invalid counters", () => {
    expect(() => formatToken(0)).toThrow();
    expect(() => formatToken(-5)).toThrow();
    expect(() => formatToken(1.5)).toThrow();
  });

  it("rejects invalid token strings", () => {
    expect(() => parseToken("42")).toThrow();
    expect(() => parseToken("AA42")).toThrow();
    expect(() => parseToken("A42")).toThrow();
  });
});

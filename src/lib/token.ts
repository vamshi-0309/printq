/**
 * Token numbers like "A042".
 *
 * The actual increment MUST happen atomically in Postgres (see
 * db/schema.sql -> get_next_token_number()), using
 * `SELECT ... FOR UPDATE` on a per-shop-per-day counter row inside the
 * same transaction that inserts the order. Generating the number in
 * application code (read-then-write) is a race condition under
 * concurrent orders - two customers can both read "41" and both get
 * token 42. Don't do that.
 *
 * This module only formats a raw integer into the display token, and
 * validates the shape - it does not decide the number.
 */

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/**
 * Formats a 1-based counter into a token like "A001".
 * After 999, rolls to the next letter (B001, ...), matching a physical
 * token-number display a shop counter could print.
 */
export function formatToken(counter: number): string {
  if (!Number.isInteger(counter) || counter < 1) {
    throw new RangeError("Token counter must be a positive integer.");
  }
  const letterIndex = Math.floor((counter - 1) / 999);
  const withinLetter = ((counter - 1) % 999) + 1;
  const letter = LETTERS[letterIndex % LETTERS.length];
  return `${letter}${String(withinLetter).padStart(3, "0")}`;
}

const TOKEN_RE = /^([A-Z])(\d{3})$/;

export function parseToken(token: string): number {
  const match = TOKEN_RE.exec(token);
  if (!match) throw new RangeError(`"${token}" is not a valid token.`);
  const letterIndex = LETTERS.indexOf(match[1]);
  const withinLetter = parseInt(match[2], 10);
  return letterIndex * 999 + withinLetter;
}

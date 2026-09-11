#!/usr/bin/env node
/**
 * Create a fully provisioned test shop against the running dev server.
 *
 *   npm run dev:shop
 *   npm run dev:shop -- --name "Sharma Xerox" --city Jaipur
 *   npm run dev:shop -- --email me@example.com --password secret123
 *
 * It sends no confirmation email: the auth user is created through the
 * dev-only /api/dev/create-user helper, which marks the address confirmed.
 * Shop provisioning then goes through the real /api/register-shop, so this
 * exercises the same code path production does.
 *
 * Requires `npm run dev` to be running, and PRINTQ_DEV_MODE=true with
 * NODE_ENV != production.
 */

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
}

const BASE = arg("base", process.env.PRINTQ_BASE_URL || "http://localhost:3000");
const stamp = Date.now();

const shopName = arg("name", `Test Xerox ${String(stamp).slice(-5)}`);
const email = arg("email", `printq.dev.${stamp}@example.com`);
const password = arg("password", `DevTest!${stamp}`);
const ownerName = arg("owner", "Dev Owner");
const phone = arg("phone", "9876543210");
const city = arg("city", "Pune");

async function post(path, body) {
  let res;
  try {
    res = await fetch(BASE + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(`Cannot reach ${BASE}. Is \`npm run dev\` running?`);
  }
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { error: text.slice(0, 200) };
  }
  return { status: res.status, data };
}

// 1. Pre-confirmed auth user (no email sent).
const user = await post("/api/dev/create-user", { email, password });

if (user.status === 404) {
  console.error(
    "\n  /api/dev/create-user returned 404 — the dev helper is disabled.\n" +
      "  Set PRINTQ_DEV_MODE=true in .env.local (and make sure NODE_ENV is not\n" +
      "  \"production\"), then restart the dev server.\n"
  );
  process.exit(1);
}
if (user.status !== 200) {
  console.error(`\n  Could not create the auth user (${user.status}): ${user.data.error}\n`);
  process.exit(1);
}

// 2. Provision the shop through the real production endpoint.
const shop = await post("/api/register-shop", {
  userId: user.data.userId,
  shopName,
  ownerName,
  phone,
  email,
  city,
});

if (shop.status !== 200) {
  console.error(`\n  Auth user was created, but shop provisioning failed (${shop.status}):`);
  console.error(`  ${shop.data.error}`);
  console.error(`  Orphaned user id: ${user.data.userId}\n`);
  process.exit(1);
}

console.log(`
  Test shop ready — no confirmation email was sent.

    Shop        ${shopName}
    Email       ${email}
    Password    ${password}

    Shop id     ${shop.data.shopId}
    Slug        ${shop.data.slug}

    Sign in     ${BASE}/login
    Customer    ${BASE}/p/${shop.data.slug}
`);

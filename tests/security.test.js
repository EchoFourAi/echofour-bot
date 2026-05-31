const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const baseUrl = "http://localhost:3000";
const encryptedLeadsPath = path.join(__dirname, "..", ".private", "leads.enc.json");

async function request(path, options = {}) {
  return fetch(`${baseUrl}${path}`, options);
}

async function expectStatus(path, expectedStatus) {
  const response = await request(path);
  assert.equal(response.status, expectedStatus, `${path} should return ${expectedStatus}`);
}

async function run() {
  await expectStatus("/leads.json", 404);
  await expectStatus("/leads.enc.json", 404);
  await expectStatus("/.private/leads.json", 404);
  await expectStatus("/.private/leads.enc.json", 404);
  await expectStatus("/package.json", 404);
  await expectStatus("/package-lock.json", 404);

  const home = await request("/");
  assert.equal(home.status, 200, "homepage should load");
  assert.equal(home.headers.get("x-frame-options"), "DENY");
  assert.equal(home.headers.get("x-content-type-options"), "nosniff");
  assert.equal(home.headers.get("cache-control"), "no-store");
  const csp = home.headers.get("content-security-policy");
  assert.ok(csp.includes("frame-ancestors 'none'"));
  assert.ok(csp.includes("script-src 'self'"));
  assert.ok(csp.includes("style-src 'self'"));
  assert.ok(!csp.includes("'unsafe-inline'"));

  const script = await request("/assets/site.js?v=20260507-security");
  assert.equal(script.status, 200, "site script should load");
  assert.equal(script.headers.get("cache-control"), "no-store");

  const css = await request("/assets/site.css?v=20260507-security");
  assert.equal(css.status, 200, "site stylesheet should load");
  assert.equal(css.headers.get("cache-control"), "no-store");

  const health = await request("/healthz");
  assert.equal(health.status, 200, "health check should load");
  const healthJson = await health.json();
  assert.equal(healthJson.ok, true);
  assert.equal(healthJson.encryptedLeadStorage, true);

  const hostile = await request("/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://evil.example"
    },
    body: JSON.stringify({ message: "test" })
  });
  assert.equal(hostile.status, 403, "hostile origins should be rejected");

  const localNetwork = await request("/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://192.168.2.55:3000"
    },
    body: JSON.stringify({ message: "I need help building an automated system for appointments." })
  });
  assert.equal(localNetwork.status, 200, "local-network phone testing origins should be allowed in development");

  const invalidLead = await request("/lead", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Gabriel",
      email: "not-an-email",
      business: "Advisor network",
      startedAt: Date.now() - 3000
    })
  });
  assert.equal(invalidLead.status, 400, "invalid email should be rejected");

  const botLead = await request("/lead", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Bot",
      email: "bot@example.com",
      business: "Spam",
      website: "https://spam.example",
      startedAt: Date.now() - 3000
    })
  });
  assert.equal(botLead.status, 204, "honeypot submissions should be silently dropped");

  const tooFast = await request("/lead", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Fast",
      email: "fast@example.com",
      business: "Test",
      startedAt: Date.now()
    })
  });
  assert.equal(tooFast.status, 400, "instant submissions should be rejected");

  const encryptedLeads = fs.readFileSync(encryptedLeadsPath, "utf8");
  assert.ok(encryptedLeads.includes("ciphertext"), "lead storage should be encrypted");
  assert.ok(!encryptedLeads.includes("@"), "lead emails should not appear in plaintext storage");

  const malformed = await request("/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{not valid json"
  });
  assert.equal(malformed.status, 400, "malformed JSON should be rejected cleanly");

  const oversized = await request("/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "x".repeat(20_000) })
  });
  assert.equal(oversized.status, 413, "oversized request bodies should be rejected");

  console.log("All security tests passed.");
}

run().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const leadPhp = fs.readFileSync(path.join(root, "lead.php"), "utf8");
const htaccess = fs.readFileSync(path.join(root, ".htaccess"), "utf8");
const gitignore = fs.readFileSync(path.join(root, ".gitignore"), "utf8");

function includesAll(source, expected, label) {
  for (const text of expected) {
    assert.ok(source.includes(text), `${label} should include ${text}`);
  }
}

includesAll(leadPhp, [
  "declare(strict_types=1)",
  "BODY_LIMIT_BYTES",
  "MIN_FORM_SECONDS",
  "MAX_FORM_MINUTES",
  "RATE_LIMIT_MAX",
  "set_security_headers",
  "X-Content-Type-Options",
  "Content-Security-Policy",
  "Cache-Control: no-store",
  "validate_config",
  "replace-with-zoho-app-password",
  "Origin not allowed",
  "filter_var($email, FILTER_VALIDATE_EMAIL)",
  "stream_context_create",
  "'verify_peer' => true",
  "'verify_peer_name' => true",
  "flock($handle, LOCK_EX)"
], "lead.php");

includesAll(htaccess, [
  "Options -Indexes",
  "Strict-Transport-Security",
  "Content-Security-Policy",
  "RewriteRule",
  ".private",
  ".git",
  "node_modules",
  "tests",
  "lead-config\\.php",
  "Require all denied"
], ".htaccess");

assert.ok(gitignore.includes("lead-config.php"), ".gitignore should keep the private PHP config out of Git");

console.log("All PHP/static security checks passed.");

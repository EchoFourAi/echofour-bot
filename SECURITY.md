# EchoFour AI Security Roadmap

Last updated: 2026-06-07

This project is a public website and lead-capture demo. The security goal is to protect visitor contact details, prevent abuse of the chat and lead endpoints, reduce browser attack surface, and prepare the app for safe deployment.

## Implemented Baseline

- Private lead storage moved from public `leads.json` to `.private/leads.json`.
- Lead records are encrypted at rest with AES-256-GCM in `.private/leads.enc.json`.
- Production should set `LEADS_ENCRYPTION_KEY` to a 32-byte base64 or hex encoded key.
- Local development generates `.private/leads.key`; this keeps local data encrypted but is not a substitute for production secret management.
- Lead retention is controlled by `LEAD_RETENTION_DAYS` and defaults to 365 days.
- Public requests to `/leads.json`, `/.private/*`, `/package.json`, and `/package-lock.json` return 404.
- Express fingerprinting is reduced with `x-powered-by` disabled.
- CORS now uses an explicit allowlist. Localhost is allowed for development; production origins should be set with `ALLOWED_ORIGINS`.
- JSON and form request bodies are limited to 12 KB.
- `/chat` and `/lead` have in-memory rate limits.
- Malformed JSON and oversized bodies return clean 400/413 responses.
- Security headers are set for content sniffing, framing, referrer behavior, permissions, and a strict content security policy.
- Homepage and legal page CSS/JavaScript are served as external files so CSP can block inline scripts and styles.
- Chat state and lead inputs are normalized and length-limited.
- Lead email addresses are validated before storage.
- The lead form includes a hidden honeypot field and form-age check to reject basic bot submissions.
- Expired lead records are pruned during lead reads and writes.
- Lead file writes use a temp file and rename to avoid partial writes.
- `.gitignore` excludes `.env`, `.private/`, logs, and dependencies from source control.
- `.env.example` documents production security environment variables.
- Unused production dependencies are removed to reduce dependency attack surface.
- Production startup fails fast if required security settings are missing.
- Lead notification email is available through SMTP environment variables only.
- `/healthz` reports non-sensitive operational status for deployment checks.
- `/.well-known/security.txt` provides a standard contact path for responsible security reports.
- `npm audit --audit-level=moderate` reports 0 vulnerabilities.
- IONOS static/PHP deployment now has `lead.php` for Zoho SMTP lead forwarding without committing SMTP credentials.
- `lead.php` validates required private config, rejects placeholder secrets, checks request size, enforces same-origin allowlisting, rate-limits submissions, validates email fields, rejects too-fast/stale submissions, silently drops honeypot submissions, and sends no-store JSON responses.
- `.htaccess` disables directory indexes, adds security headers for static/PHP hosting, and denies access to private config, dotfiles, logs, package files, development folders, tests, and dependencies if they are accidentally uploaded.
- The privacy page now names IONOS/Zoho service-provider use, warns against sensitive public-form submissions, and documents data minimization.

## Production Requirements

- Serve the app only over HTTPS.
- Configure `ALLOWED_ORIGINS` with the real production domain.
- If deployed behind a reverse proxy, set `TRUST_PROXY` to the exact trusted hop count.
- Set `NODE_ENV=production` so missing security settings fail startup.
- Configure SMTP variables for lead notifications; never commit SMTP credentials.
- On IONOS, create `lead-config.php` privately from `lead-config.example.php` and ensure `lead-config.php` is not publicly readable.
- Store leads in a real database or managed form/email service instead of local JSON.
- Encrypt sensitive data at rest where supported by the deployment platform.
- Add backups and retention rules for lead data.
- Move email notification credentials into environment variables.
- Add logging that avoids printing names, emails, phone numbers, or full messages.
- Add monitoring for 4xx/5xx spikes and repeated rate-limit hits.

## Next Security Phases

1. Deployment security: HTTPS, origin allowlist, proxy settings, environment variables, and host-level file permissions.
2. Data security: database-backed leads, encryption, retention policy, backup policy, and delete/export workflow.
3. Abuse protection: production-grade rate limit store, bot/spam protection for `/lead` and `lead.php`, and per-endpoint monitoring.
4. Admin security: authenticated dashboard, least-privilege access, audit trail, and secure session cookies.
5. Browser hardening: audit legal pages for shared CSS extraction and keep CSP strict as new pages are added.
6. AI safety: if a live AI API is added, isolate prompts, filter secrets, limit tool access, log safely, and review output before automated actions.

## Useful Checks

```powershell
npm.cmd audit --audit-level=moderate
npm.cmd test
node tests\chat-followup.test.js
node tests\french-language.test.js
node tests\industry-chat.test.js
node tests\security.test.js
```

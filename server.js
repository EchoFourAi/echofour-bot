const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const nodemailer = require("nodemailer");

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const privateDir = path.join(__dirname, ".private");
const legacyLeadsPath = path.join(__dirname, "leads.json");
const legacyPrivateLeadsPath = path.join(privateDir, "leads.json");
const leadsPath = path.join(privateDir, "leads.enc.json");
const localKeyPath = path.join(privateDir, "leads.key");
const MAX_CHAT_LENGTH = 1200;
const MAX_FIELD_LENGTH = 160;
const BODY_LIMIT = "12kb";
const MIN_FORM_SECONDS = 2;
const MAX_FORM_MINUTES = 120;
const DEFAULT_LEAD_RETENTION_DAYS = 180;
const LEAD_RETENTION_DAYS = Number(process.env.LEAD_RETENTION_DAYS) || DEFAULT_LEAD_RETENTION_DAYS;
const GENERAL_RATE_LIMIT_MAX = Number(process.env.GENERAL_RATE_LIMIT_MAX) || 240;
const CHAT_RATE_LIMIT_MAX = Number(process.env.CHAT_RATE_LIMIT_MAX) || 180;
const LEAD_RATE_LIMIT_MAX = Number(process.env.LEAD_RATE_LIMIT_MAX) || 5;
const isProduction = process.env.NODE_ENV === "production";

const defaultAllowedOrigins = [
  "http://localhost:3000",
  "http://127.0.0.1:3000"
];

const configuredOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const allowedOrigins = new Set([...defaultAllowedOrigins, ...configuredOrigins]);
const mailConfig = buildMailConfig();

if (!fs.existsSync(privateDir)) {
  fs.mkdirSync(privateDir, { recursive: true });
}

validateProductionConfig();

const leadEncryptionKey = getLeadEncryptionKey();
migrateLeadStorage();
const mailTransport = mailConfig.enabled ? nodemailer.createTransport(mailConfig.transport) : null;

app.disable("x-powered-by");

if (process.env.TRUST_PROXY) {
  app.set("trust proxy", Number(process.env.TRUST_PROXY));
}

app.use(securityHeaders);
app.use(cors({
  origin(origin, callback) {
    if (!origin || isAllowedOrigin(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error("Origin not allowed"));
  },
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type"],
  maxAge: 600
}));
app.use(express.json({ limit: BODY_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: BODY_LIMIT }));
app.use(rateLimit({ windowMs: 60 * 1000, max: GENERAL_RATE_LIMIT_MAX }));
app.use("/chat", rateLimit({ windowMs: 60 * 1000, max: CHAT_RATE_LIMIT_MAX }));
app.use("/lead", rateLimit({ windowMs: 60 * 1000, max: LEAD_RATE_LIMIT_MAX }));

app.use((error, req, res, next) => {
  if (error.message === "Origin not allowed") {
    res.status(403).json({ error: "Origin not allowed." });
    return;
  }

  next(error);
});

app.use((req, res, next) => {
  const requestedPath = decodeURIComponent(req.path).toLowerCase();

  if (
    requestedPath === "/leads.json" ||
    requestedPath === "/leads.enc.json" ||
    requestedPath.startsWith("/.private") ||
    requestedPath.includes("package-lock.json") ||
    requestedPath.includes("package.json")
  ) {
    res.status(404).send("Not found");
    return;
  }

  next();
});

app.get("/.well-known/security.txt", (req, res) => {
  res.type("text/plain");
  res.setHeader("Cache-Control", "no-store");
  res.send([
    "Contact: mailto:hello@echofourai.com",
    "Preferred-Languages: en, fr",
    "Canonical: https://echofourai.com/.well-known/security.txt",
    "Policy: https://echofourai.com/privacy.html",
    ""
  ].join("\n"));
});

app.use(express.static(path.join(__dirname), {
  dotfiles: "deny",
  etag: true,
  index: false,
  maxAge: "1h",
  setHeaders(res, filePath) {
    if (filePath.endsWith(".html") || filePath.endsWith(".js") || filePath.endsWith(".css")) {
      res.setHeader("Cache-Control", "no-store");
    }
  }
}));

app.get("/", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/healthz", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({
    ok: true,
    encryptedLeadStorage: true,
    emailNotifications: mailConfig.enabled,
    retentionDays: LEAD_RETENTION_DAYS
  });
});

function securityHeaders(req, res, next) {
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "base-uri 'self'",
      "connect-src 'self'",
      "font-src 'self'",
      "form-action 'self' mailto:",
      "frame-ancestors 'none'",
      "img-src 'self' data:",
      "object-src 'none'",
      "script-src 'self'",
      "style-src 'self'"
    ].join("; ")
  );

  if (req.secure) {
    res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
  }

  next();
}

function rateLimit({ windowMs, max }) {
  const clients = new Map();

  return function limiter(req, res, next) {
    const now = Date.now();
    const key = req.ip || req.socket.remoteAddress || "unknown";
    const current = clients.get(key);

    if (!current || current.resetAt <= now) {
      clients.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    current.count += 1;

    if (current.count > max) {
      res.setHeader("Retry-After", Math.ceil((current.resetAt - now) / 1000));
      res.status(429).json({ error: "Too many requests. Please try again shortly." });
      return;
    }

    next();
  };
}

function cleanString(value = "", maxLength = MAX_FIELD_LENGTH) {
  return String(value)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function isValidEmail(value = "") {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function buildMailConfig() {
  const required = [
    "SMTP_HOST",
    "SMTP_USER",
    "SMTP_PASS",
    "LEAD_NOTIFICATION_TO",
    "LEAD_NOTIFICATION_FROM"
  ];
  const missing = required.filter((name) => !process.env[name]);

  if (missing.length) {
    return { enabled: false, missing };
  }

  return {
    enabled: true,
    transport: {
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === "true",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    },
    from: process.env.LEAD_NOTIFICATION_FROM,
    to: process.env.LEAD_NOTIFICATION_TO
  };
}

function validateProductionConfig() {
  const missing = [];

  if (isProduction && !process.env.ALLOWED_ORIGINS) missing.push("ALLOWED_ORIGINS");
  if (isProduction && !process.env.LEADS_ENCRYPTION_KEY) missing.push("LEADS_ENCRYPTION_KEY");
  if (isProduction && !process.env.TRUST_PROXY) missing.push("TRUST_PROXY");
  if (missing.length) {
    throw new Error(`Missing production security configuration: ${[...new Set(missing)].join(", ")}`);
  }
}

function getLeadEncryptionKey() {
  if (process.env.LEADS_ENCRYPTION_KEY) {
    const rawKey = process.env.LEADS_ENCRYPTION_KEY.trim();
    const base64Key = Buffer.from(rawKey, "base64");
    if (base64Key.length === 32) return base64Key;

    const hexKey = Buffer.from(rawKey, "hex");
    if (hexKey.length === 32) return hexKey;

    throw new Error("LEADS_ENCRYPTION_KEY must be a 32-byte key encoded as base64 or hex.");
  }

  if (fs.existsSync(localKeyPath)) {
    const localKey = Buffer.from(fs.readFileSync(localKeyPath, "utf8").trim(), "base64");
    if (localKey.length === 32) return localKey;
  }

  const localKey = crypto.randomBytes(32);
  fs.writeFileSync(localKeyPath, `${localKey.toString("base64")}\n`, { mode: 0o600 });
  console.warn("Generated a local development lead encryption key. Set LEADS_ENCRYPTION_KEY in production.");
  return localKey;
}

function encryptJson(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", leadEncryptionKey, iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);

  return {
    version: 1,
    algorithm: "aes-256-gcm",
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64")
  };
}

function decryptJson(envelope) {
  if (!envelope || envelope.algorithm !== "aes-256-gcm") {
    throw new Error("Unsupported encrypted lead file format.");
  }

  const decipher = crypto.createDecipheriv("aes-256-gcm", leadEncryptionKey, Buffer.from(envelope.iv, "base64"));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64")),
    decipher.final()
  ]);

  return JSON.parse(plaintext.toString("utf8"));
}

function readPlaintextLeads(filePath) {
  if (!fs.existsSync(filePath)) return [];

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function migrateLeadStorage() {
  if (fs.existsSync(leadsPath)) return;

  const leads = [
    ...readPlaintextLeads(legacyLeadsPath),
    ...readPlaintextLeads(legacyPrivateLeadsPath)
  ];

  writeLeads(leads);

  for (const plaintextPath of [legacyLeadsPath, legacyPrivateLeadsPath]) {
    if (fs.existsSync(plaintextPath)) {
      fs.unlinkSync(plaintextPath);
    }
  }
}

function sanitizeState(data = {}) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return {};

  const allowedKeys = [
    "amount",
    "askedContact",
    "askedHandoff",
    "askedIntegration",
    "askedWorkflowDetail",
    "businessScope",
    "city",
    "confidence",
    "contact",
    "currentQuestion",
    "estimate",
    "goal",
    "handoff",
    "integration",
    "issue",
    "leadSaved",
    "mode",
    "nextStep",
    "risk",
    "stage",
    "style",
    "timeline",
    "urgent",
    "urgency",
    "workflowDetail"
  ];

  return allowedKeys.reduce((safe, key) => {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      const value = data[key];
      safe[key] = typeof value === "string" ? cleanString(value, 240) : value;
    }

    return safe;
  }, {});
}

const advisors = [
  { name: "John Carter", city: "montreal", phone: "514-111-2222" },
  { name: "Sarah Ahmed", city: "laval", phone: "450-333-4444" },
  { name: "Michael Lee", city: "montreal", phone: "514-555-6666" }
];

function extractContact(message) {
  const email = message.match(/[^\s@]+@[^\s@]+\.[^\s@]+/);
  if (email) return email[0];

  const phone = message.match(/(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}/);
  if (phone) return phone[0];

  return null;
}

function normalizeText(value = "") {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function extractFinance(data, message) {
  const m = normalizeText(message);

  if (data.stage === "done") return data;

  if (!data.goal && m.includes("invest")) {
    data.goal = message;
  }

  if (!data.amount) {
    const match = message.match(/\d+/);
    if (match) data.amount = match[0];
  }

  if (!data.contact) {
    data.contact = extractContact(message);
  }

  if (!data.style && (m.includes("self") || m.includes("myself"))) {
    data.style = "self";
  }

  if (!data.style && m.includes("advisor")) {
    data.style = "advisor";
  }

  if (!data.risk && (m.includes("low") || m.includes("medium") || m.includes("high"))) {
    data.risk = message;
  }

  if (!data.city) {
    const city = ["montreal", "laval", "toronto", "ottawa"].find((name) => m.includes(name));
    if (city) data.city = city;
  }

  if (m.includes("call") || m.includes("speak")) {
    data.urgent = true;
  }

  return data;
}

function financeFlow(data, message) {
  const m = message.toLowerCase();

  if (data.stage === "done") {
    if (m.includes("advisor") || m.includes("call")) {
      data.stage = "routing";
      return { text: "Sure. What city are you located in?", data };
    }

    return {
      text: "You are already set up. Do you want to connect with an advisor or explore more investment options?",
      data
    };
  }

  if (data.stage === "routing") {
    if (!data.city) {
      return { text: "What city are you located in?", data };
    }

    const matches = advisors.filter((advisor) => data.city.includes(advisor.city));
    const advisor = matches.length ? matches[Math.floor(Math.random() * matches.length)] : advisors[0];

    data.stage = "done";

    return {
      text: `You are connected.\n\n${advisor.name}\n${advisor.phone}`,
      data
    };
  }

  if (!data.goal) {
    return { text: "What are you looking to do? Invest, retirement, or growth?", data };
  }

  if (!data.amount) {
    return { text: "What amount are you planning to invest?", data };
  }

  if (!data.contact) {
    return {
      text: `Great. I have your goal as ${data.goal} and the amount as ${data.amount}. What email or phone number should we use for follow-up?`,
      data
    };
  }

  if (!data.style) {
    return {
      text: "Would you prefer to manage investments yourself or have an advisor manage the portfolio?",
      data
    };
  }

  if (!data.risk) {
    return {
      text: "How would you describe the risk tolerance: low, medium, or high?",
      data
    };
  }

  data.stage = "done";

  return {
    text: "Perfect. The profile is complete and ready for follow-up.",
    data
  };
}

function extractService(data, message) {
  const m = normalizeText(message);
  const automationTerms = [
    "automation",
    "automatisation",
    "workflow",
    "processus",
    "dashboard",
    "tableau",
    "crm",
    "tool",
    "outil",
    "commission",
    "grid",
    "grille",
    "advisor",
    "advisors",
    "conseiller",
    "conseillers",
    "firm",
    "cabinet",
    "agency",
    "agence",
    "client",
    "internal",
    "interne",
    "lead",
    "leads",
    "prospect",
    "prospects",
    "share",
    "part",
    "tracking",
    "suivi",
    "price",
    "pricing",
    "cost",
    "cout",
    "tarif",
    "need ai",
    "needs ai",
    "using ai",
    "with ai",
    "can ai",
    "ai agent",
    "agent",
    "chat",
    "chat assistant",
    "website",
    "web site",
    "site web",
    "website chat",
    "web chat",
    "chat widget",
    "ai assistant",
    "ai support",
    "ai intake",
    "besoin d'ia",
    "ia pour",
    "assistant ia",
    "intake ia",
    "qualify",
    "qualifier",
    "copying",
    "spreadsheets",
    "sheets",
    "summaries",
    "emails",
    "hubspot",
    "dispatch",
    "build",
    "construire",
    "screen",
    "preselection",
    "recruiting",
    "recruitment",
    "recruiter",
    "recruteur",
    "recrutement",
    "recruit",
    "candidate",
    "candidates",
    "candidat",
    "candidats",
    "resume",
    "resumes",
    "cv",
    "patient",
    "support",
    "soutien",
    "returns",
    "retours",
    "product recommendations",
    "recommandations",
    "booking",
    "bookings",
    "automated system",
    "appointment system",
    "appointments",
    "scheduling",
    "follow up",
    "follow ups",
    "follow-up",
    "follow-ups",
    "confirmation",
    "confirmations",
    "reminder",
    "reminders",
    "reservation",
    "reservations",
    "calculator",
    "call back",
    "callback",
    "chatbot",
    "membership",
    "memberships",
    "adhesion",
    "abonnement",
    "signup",
    "signups",
    "inscription",
    "inscriptions",
    "intake",
    "accueil",
    "onboarding",
    "admin assistant",
    "assistant admin"
  ];

  const hasAutomationIntent = automationTerms.some((term) => includesAutomationTerm(m, term));

  if ((!data.mode || data.mode === "service") && hasAutomationIntent) {
    data.mode = "automation";
    data.issue = inferAutomationNeed(m);
    data.urgency = m.includes("urgent") || m.includes("asap") || m.includes("this week") ? "High" : "Discovery";
    data.estimate = "Custom build";
    data.city = "Remote / Canada";
    data.confidence = 88;
  }

  if (data.mode === "automation") {
    const inferredIssue = inferAutomationNeed(m);
    if (shouldRefineAutomationIssue(data.issue, inferredIssue)) {
      data.issue = inferredIssue;
    }

    if (!data.contact) data.contact = extractContact(message);
    captureAutomationAnswer(data, message);
    if (m.includes("canada") || m.includes("all over")) data.businessScope = "Canada-wide team";
    if (!data.businessScope && (m.includes("advisor") || m.includes("conseiller"))) data.businessScope = "Advisor network";
    if (!data.businessScope && (includesAutomationTerm(m, "firm") || includesAutomationTerm(m, "cabinet"))) data.businessScope = "Professional firm";
    if (!data.timeline && (m.includes("urgent") || m.includes("asap") || m.includes("this week") || m.includes("cette semaine"))) data.timeline = "Immediate";
    if (!data.timeline && (m.includes("month") || m.includes("quarter") || m.includes("mois") || m.includes("trimestre"))) data.timeline = "This quarter";
    if (!data.integration && (m.includes("excel") || m.includes("spreadsheet") || m.includes("feuille"))) data.integration = "Excel / spreadsheet";
    if (!data.integration && m.includes("crm")) data.integration = "CRM";
    if (!data.integration && (m.includes("email") || m.includes("courriel"))) data.integration = "Email workflow";
    if (!data.integration && (m.includes("dashboard") || m.includes("tableau"))) data.integration = "Dashboard";
    data.nextStep = data.contact ? "Prepare build plan" : "Capture contact";
    data.confidence = data.contact ? 95 : 88;
    return data;
  }

  if (!data.issue) {
    data.mode = "service";
    if (m.includes("leak") || m.includes("pipe") || m.includes("water") || m.includes("fuite") || m.includes("tuyau") || m.includes("eau")) data.issue = "Leak repair";
    else if (/\bac\b/.test(m) || m.includes("hvac") || m.includes("heat") || m.includes("furnace")) data.issue = "HVAC service";
    else if (m.includes("quote") || m.includes("estimate") || m.includes("soumission") || m.includes("estimation")) data.issue = "Quote request";
    else if (m.includes("repair") || m.includes("fix") || m.includes("reparation") || m.includes("reparer")) data.issue = "Repair request";
    else data.issue = "Service request";
  }

  if (!data.urgency) {
    data.urgency = m.includes("emergency") || m.includes("urgent") || m.includes("today") || m.includes("asap") ? "High" : "Medium";
  }

  if (!data.city) {
    const city = ["montreal", "laval", "toronto", "ottawa"].find((name) => m.includes(name));
    if (city) data.city = city.charAt(0).toUpperCase() + city.slice(1);
  }

  if (!data.contact) {
    data.contact = extractContact(message);
  }

  if (!data.estimate) {
    data.estimate = data.urgency === "High" ? "$250-$600" : "$150-$300";
  }

  data.confidence = data.contact ? 94 : 82;
  return data;
}

function shouldRefineAutomationIssue(currentIssue, inferredIssue) {
  if (!inferredIssue) return false;
  if (!currentIssue) return true;
  if (currentIssue === inferredIssue) return false;

  const genericIssues = new Set([
    "Business workflow automation",
    "Custom workflow automation",
    "Custom intake assistant",
    "Custom follow-up automation",
    "Custom quote automation",
    "Custom lead qualification automation",
    "Custom support automation"
  ]);

  return genericIssues.has(currentIssue) && !genericIssues.has(inferredIssue);
}

function includesAutomationTerm(message, term) {
  if (term.includes(" ")) return message.includes(term);

  const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escapedTerm}([^a-z0-9]|$)`).test(message);
}

function captureAutomationAnswer(data, message) {
  const m = normalizeText(message);
  const cleanMessage = cleanString(message, 240);

  if (!cleanMessage || data.contact === cleanMessage) return;

  const hasWorkflowDetail = [
    "appointment",
    "appointments",
    "schedule",
    "scheduling",
    "booking",
    "follow up",
    "follow ups",
    "follow-up",
    "confirmation",
    "confirmations",
    "reminder",
    "reminders",
    "qualify",
    "qualification",
    "intake",
    "lead",
    "leads",
    "quote",
    "quotes",
    "dashboard",
    "commission",
    "grid",
    "grille",
    "grilles",
    "report",
    "reports",
    "invoice",
    "invoices",
    "email",
    "emails",
    "customer",
    "client",
    "patient",
    "candidate"
  ].some((term) => m.includes(term));

  if (!data.workflowDetail && (data.currentQuestion === "workflowDetail" || hasWorkflowDetail)) {
    data.workflowDetail = cleanMessage;
  }

  const hasHandoffDetail = [
    "email",
    "text",
    "sms",
    "call",
    "calendar",
    "crm",
    "dashboard",
    "notify",
    "notification",
    "staff",
    "team",
    "reception",
    "front desk",
    "owner",
    "manager",
    "sales",
    "book",
    "booking"
  ].some((term) => m.includes(term));

  if (!data.handoff && data.currentQuestion === "handoff" && (hasHandoffDetail || cleanMessage.length > 5)) {
    data.handoff = cleanMessage;
  }

  if (!data.integration && data.currentQuestion === "integration" && cleanMessage.length > 2) {
    data.integration = inferIntegrationFromMessage(m) || cleanMessage;
  }
}

function inferIntegrationFromMessage(message) {
  if (message.includes("excel") || message.includes("spreadsheet") || message.includes("sheet")) return "Excel / spreadsheet";
  if (message.includes("crm") || message.includes("hubspot") || message.includes("salesforce")) return "CRM";
  if (message.includes("calendar") || message.includes("calendly") || message.includes("google calendar")) return "Calendar / booking system";
  if (message.includes("email") || message.includes("gmail") || message.includes("outlook")) return "Email workflow";
  if (message.includes("dashboard") || message.includes("tableau")) return "Dashboard";
  if (message.includes("none") || message.includes("not yet") || message.includes("manual")) return "Manual / to confirm";
  return "";
}

function isAllowedOrigin(origin) {
  if (allowedOrigins.has(origin)) return true;
  if (isProduction) return false;

  try {
    const { hostname, protocol } = new URL(origin);
    const isLocalPrivateIp =
      /^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
      /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
      /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(hostname);

    return protocol === "http:" && isLocalPrivateIp;
  } catch (error) {
    return false;
  }
}

function inferAutomationNeed(message) {
  if (message.includes("chat assistant") || message.includes("website chat") || message.includes("web chat") || message.includes("chat widget") || message.includes("chatbot") || (message.includes("website") && message.includes("chat"))) return "Website chat assistant";
  if (message.includes("commission") || message.includes("grid") || message.includes("grille")) return "Commission grid automation";
  if (message.includes("plumbing") || message.includes("plumber") || message.includes("emergency call") || message.includes("dispatch")) return "Lead qualification system";
  if (message.includes("hvac") || /\bac\b/.test(message) || message.includes("furnace")) return "HVAC booking automation";
  if (message.includes("auto shop") || message.includes("vehicle") || message.includes("garage") || message.includes("vehicule")) return "Auto repair intake workflow";
  if (message.includes("legal") || message.includes("law office") || message.includes("case type") || message.includes("juridique") || message.includes("avocat")) return "Legal intake workflow";
  if (message.includes("catering") || message.includes("guest count") || message.includes("menu") || message.includes("traiteur") || message.includes("invites")) return "Catering request workflow";
  if (message.includes("enrollment") || message.includes("student") || message.includes("course") || message.includes("inscription") || message.includes("etudiant") || message.includes("cours")) return "Enrollment qualification workflow";
  if (message.includes("volunteer") || message.includes("donor") || message.includes("benevole") || message.includes("donateur")) return "Nonprofit engagement workflow";
  if (hasCustomBusinessSignal(message)) return inferCustomAutomationNeed(message);
  if (message.includes("dashboard") || message.includes("tableau")) return "Insights dashboard";
  if (message.includes("crm")) return "CRM workflow";
  if (
    (message.includes("recruit") || message.includes("recrut")) &&
    (message.includes("appointment") || message.includes("appointments") || message.includes("schedule") || message.includes("scheduling") || message.includes("follow up") || message.includes("follow ups") || message.includes("follow-up") || message.includes("confirmation") || message.includes("confirmations"))
  ) return "Recruiting appointment automation";
  if (message.includes("candidate") || message.includes("resume") || message.includes("screen") || message.includes("recruit") || message.includes("recrut") || message.includes("candidat") || message.includes("cv") || message.includes("preselection")) return "Candidate screening workflow";
  if ((message.includes("clinic") || message.includes("medical") || message.includes("patient")) && (message.includes("appointment") || message.includes("appointments") || message.includes("schedule") || message.includes("scheduling") || message.includes("follow up") || message.includes("follow ups") || message.includes("follow-up") || message.includes("confirmation") || message.includes("confirmations") || message.includes("reminder") || message.includes("reminders"))) return "Clinic appointment follow-up automation";
  if (message.includes("patient") || message.includes("clinic") || message.includes("clinique")) return "Patient intake workflow";
  if (message.includes("return") || message.includes("order") || message.includes("product recommendation") || message.includes("retour") || message.includes("commande") || message.includes("recommandation")) return "Ecommerce support automation";
  if (message.includes("booking") || message.includes("bookings") || message.includes("appointment") || message.includes("appointments") || message.includes("schedule") || message.includes("scheduling") || message.includes("reminder") || message.includes("reminders") || message.includes("reservation") || message.includes("rendez-vous")) return "Booking intake automation";
  if (message.includes("membership") || message.includes("trial class") || message.includes("adhesion") || message.includes("abonnement")) return "Membership qualification workflow";
  if (message.includes("tax") || message.includes("documents") || message.includes("impot")) return "Document intake workflow";
  if (message.includes("tenant") || message.includes("maintenance") || message.includes("locataire")) return "Maintenance request automation";
  if (message.includes("spreadsheet") || message.includes("spreadsheets") || message.includes("sheets") || message.includes("email") || message.includes("emails")) return "Email workflow";
  if (message.includes("lead") || message.includes("prospect") || message.includes("call back") || message.includes("callback")) return "Lead qualification system";
  if (message.includes("advisor") || message.includes("conseiller")) return "Advisor workflow automation";
  return inferCustomAutomationNeed(message);
}

function hasCustomBusinessSignal(message) {
  return [
    "recruiting",
    "recruitment",
    "staffing",
    "dental",
    "dentist",
    "clinic",
    "medical",
    "cleaning",
    "landscaping",
    "construction",
    "roofing",
    "roofer",
    "restaurant",
    "salon",
    "spa",
    "gym",
    "fitness",
    "accounting",
    "bookkeeping",
    "insurance",
    "agency",
    "consulting",
    "ecommerce",
    "e-commerce",
    "retail",
    "school",
    "education",
    "hotel",
    "hospitality",
    "daycare",
    "childcare",
    "storage",
    "photographer",
    "photography",
    "videographer",
    "videography",
    "coach",
    "coaching",
    "travel",
    "mortgage",
    "dealership",
    "veterinary",
    "vet clinic",
    "chiropractor",
    "physio",
    "physiotherapy",
    "home care",
    "pest control",
    "moving company",
    "solar",
    "pool service",
    "pet grooming",
    "bakery",
    "manufacturing",
    "manufacturer",
    "logistics",
    "wholesale",
    "distributor"
  ].some((term) => message.includes(term));
}

function inferCustomAutomationNeed(message) {
  const businessSignals = [
    ["recruiting", "Recruiting"],
    ["recruitment", "Recruiting"],
    ["staffing", "Staffing"],
    ["dental", "Dental"],
    ["dentist", "Dental"],
    ["clinic", "Clinic"],
    ["medical", "Medical"],
    ["real estate", "Real estate"],
    ["property", "Property management"],
    ["cleaning", "Cleaning"],
    ["landscaping", "Landscaping"],
    ["construction", "Construction"],
    ["roofing", "Roofing"],
    ["roofer", "Roofing"],
    ["restaurant", "Restaurant"],
    ["salon", "Salon"],
    ["spa", "Spa"],
    ["gym", "Fitness"],
    ["fitness", "Fitness"],
    ["accounting", "Accounting"],
    ["bookkeeping", "Bookkeeping"],
    ["insurance", "Insurance"],
    ["law", "Legal"],
    ["legal", "Legal"],
    ["agency", "Agency"],
    ["consulting", "Consulting"],
    ["ecommerce", "Ecommerce"],
    ["e-commerce", "Ecommerce"],
    ["retail", "Retail"],
    ["school", "Education"],
    ["education", "Education"],
    ["nonprofit", "Nonprofit"],
    ["non-profit", "Nonprofit"],
    ["hotel", "Hospitality"],
    ["hospitality", "Hospitality"],
    ["daycare", "Daycare"],
    ["childcare", "Childcare"],
    ["storage", "Storage"],
    ["photographer", "Photography"],
    ["photography", "Photography"],
    ["videographer", "Videography"],
    ["videography", "Videography"],
    ["coach", "Coaching"],
    ["coaching", "Coaching"],
    ["travel", "Travel"],
    ["mortgage", "Mortgage"],
    ["dealership", "Car dealership"],
    ["veterinary", "Veterinary"],
    ["vet clinic", "Veterinary"],
    ["chiropractor", "Chiropractic"],
    ["physio", "Physiotherapy"],
    ["physiotherapy", "Physiotherapy"],
    ["home care", "Home care"],
    ["pest control", "Pest control"],
    ["moving company", "Moving"],
    ["solar", "Solar"],
    ["pool service", "Pool service"],
    ["pet grooming", "Pet grooming"],
    ["bakery", "Bakery"],
    ["manufacturing", "Manufacturing"],
    ["manufacturer", "Manufacturing"],
    ["logistics", "Logistics"],
    ["wholesale", "Wholesale"],
    ["distributor", "Wholesale"]
  ];

  const workflowSignals = [
    [["tour", "tours", "showing", "showings", "test drive", "test drives"], "tour booking automation"],
    [["appointment", "appointments", "booking", "bookings", "schedule", "scheduling", "reservation", "rendez-vous"], "booking automation"],
    [["follow up", "follow ups", "follow-up", "follow-ups", "confirmation", "confirmations", "reminder", "reminders"], "follow-up automation"],
    [["quote", "estimate", "pricing", "price", "calculator", "soumission"], "quote automation"],
    [["lead", "leads", "prospect", "prospects", "qualify", "qualification"], "lead qualification automation"],
    [["email", "emails", "inbox", "courriel"], "email workflow automation"],
    [["invoice", "invoices", "payment", "payments"], "billing workflow automation"],
    [["document", "documents", "file", "files", "upload", "uploads"], "document intake automation"],
    [["dashboard", "report", "reports", "analytics", "tracking"], "dashboard automation"],
    [["support", "ticket", "tickets", "customer service"], "support automation"],
    [["custom order", "custom orders", "bulk order", "bulk orders", "parts request", "parts requests"], "order intake automation"],
    [["shipment", "shipments", "pickup", "delivery", "dimensions"], "shipment quote automation"],
    [["concierge", "guest questions", "late checkout"], "guest concierge automation"],
    [["chat", "assistant", "agent", "intake"], "intake assistant"]
  ];

  const business = businessSignals.find(([term]) => message.includes(term))?.[1] || "Custom";
  const workflows = workflowSignals
    .filter(([terms]) => terms.some((term) => message.includes(term)))
    .map(([, label]) => label);

  if (workflows.length > 1 && workflows.includes("booking automation") && workflows.includes("follow-up automation")) {
    return `${business} appointment follow-up automation`;
  }

  if (workflows.length) {
    return `${business} ${workflows[0]}`;
  }

  return business === "Custom" ? "Custom workflow automation" : `${business} workflow automation`;
}

function serviceFlow(data, language = "en", message = "") {
  if (data.mode === "automation") {
    if (!data.workflowDetail) {
      data.askedWorkflowDetail = true;
      data.currentQuestion = "workflowDetail";
      data.nextStep = "Clarify workflow";
      return {
        text: `${buildAutomationIntro(data, language)} ${buildAutomationQuestion(data.issue, "workflowDetail", language)}`,
        data
      };
    }

    if (!data.handoff) {
      data.askedHandoff = true;
      data.currentQuestion = "handoff";
      data.nextStep = "Clarify handoff";
      return {
        text: buildAutomationHandoffPrompt(data, language),
        data
      };
    }

    if (!data.integration) {
      data.askedIntegration = true;
      data.currentQuestion = "integration";
      data.nextStep = "Confirm tools";
      return {
        text: buildAutomationIntegrationPrompt(data, language),
        data
      };
    }

    if (!data.contact) {
      data.askedContact = true;
      data.currentQuestion = "contact";
      data.nextStep = "Capture contact";
      return {
        text: buildAutomationContactPrompt(data, language),
        data
      };
    }

    if (data.currentQuestion === "done") {
      const continuation = buildAutomationContinuation(data, message, language);
      if (continuation) {
        return {
          text: continuation,
          data
        };
      }
    }

    data.currentQuestion = "done";
    data.nextStep = "Prepare build plan";
    return {
      text: language === "fr"
        ? `Parfait. J'ai enregistré cette demande EchoFour pour ${translateIssue(data.issue)}. La prochaine étape est de définir le workflow, les champs de données, le tableau de bord, les intégrations et l'estimation du projet.`
        : buildAutomationSummary(data),
      data
    };
  }

  if (!data.city) {
    return { text: language === "fr" ? "Compris. Dans quelle ville êtes-vous situé?" : "Got it. What city are you located in?", data };
  }

  if (!data.contact) {
    return {
      text: language === "fr"
        ? `Merci. J'ai classé cette demande comme priorité ${translatePriority(data.urgency)} pour ${translateIssue(data.issue)} à ${data.city}. Quel courriel ou numéro de téléphone devons-nous utiliser pour le suivi?`
        : `Thanks. I have this marked as ${data.urgency.toLowerCase()} priority for ${data.issue} in ${data.city}. What email or phone number should we use for follow-up?`,
      data
    };
  }

  return {
    text: language === "fr"
      ? `Parfait. Votre demande est prête. Je l'ai envoyée à l'équipe en priorité ${translatePriority(data.urgency)}, avec une estimation de ${data.estimate}. Quelqu'un pourra faire le suivi bientôt.`
      : `Perfect. You are all set. I sent the request to the team as ${data.urgency.toLowerCase()} priority, with an estimated range of ${data.estimate}. Someone can follow up shortly.`,
    data
  };
}

function buildAutomationIntro(data, language = "en") {
  if (language === "fr") {
    const scope = data.businessScope ? ` pour ${formatScope(data.businessScope, "fr")}` : "";
    const integration = data.integration ? ` Nous pouvons le connecter à ${translateIntegration(data.integration)} si c'est là que les données se trouvent actuellement.` : "";

    return `Oui. EchoFour AI peut construire ce système${scope}. Pour ${formatProjectName(data.issue, "fr")}, nous allons cartographier les règles, automatiser les calculs et transformer le résultat en tableau de bord ou outil interne clair.${integration} Quel courriel devons-nous utiliser pour envoyer un plan de projet rapide?`;
  }

  const scope = data.businessScope ? ` for your ${formatScope(data.businessScope)}` : "";
  const integration = data.integration ? ` We can connect it with ${data.integration.toLowerCase()} if that is where the data currently lives.` : "";
  const approach = buildAutomationApproach(data.issue);

  return `Yes. EchoFour AI can build that${scope}. For ${formatProjectName(data.issue)}, ${approach}.${integration}`;
}

function buildAutomationApproach(issue = "") {
  const value = issue.toLowerCase();

  if (value.includes("appointment") || value.includes("booking") || value.includes("follow-up")) {
    return "we would map the appointment flow, reminders, confirmations, follow-ups, and the handoff to your team";
  }

  if (value.includes("chat") || value.includes("assistant") || value.includes("intake") || value.includes("qualification")) {
    return "we would define the questions, qualification rules, helpful responses, and handoff into your team or CRM";
  }

  if (value.includes("dashboard") || value.includes("commission") || value.includes("grid")) {
    return "we would map the data, automate the calculations, and turn the result into a clean dashboard or internal tool";
  }

  if (value.includes("email") || value.includes("crm")) {
    return "we would map the incoming messages, statuses, follow-ups, and handoffs between your tools";
  }

  return "we would map the workflow, fields to collect, automation rules, and final handoff";
}

function buildAutomationQuestion(issue = "", questionType = "workflowDetail", language = "en") {
  const value = issue.toLowerCase();

  if (language === "fr") {
    return "Quel est le workflow exact que vous voulez automatiser en premier?";
  }

  if (questionType === "workflowDetail") {
    if (value.includes("appointment") || value.includes("booking") || value.includes("follow-up")) {
      return "What should the assistant handle first: booking, reminders, confirmations, follow-ups, or all of those?";
    }

    if (value.includes("chat") || value.includes("assistant") || value.includes("intake") || value.includes("qualification")) {
      return "What should it collect or answer before handing someone to your team?";
    }

    if (value.includes("dashboard") || value.includes("commission") || value.includes("grid")) {
      return "What data should it track or calculate first?";
    }

    return "What exact workflow should it automate first?";
  }

  return "What detail should EchoFour account for next?";
}

function buildAutomationHandoffPrompt(data, language = "en") {
  if (language === "fr") {
    return `Compris: ${data.workflowDetail}. Que doit-il se passer apres ca: reserver au calendrier, envoyer un courriel, mettre a jour un CRM, ou notifier votre equipe?`;
  }

  return `Got it: ${data.workflowDetail}. After the assistant handles that, what should happen next: book the calendar, send an email or text, update a CRM, or notify your team?`;
}

function buildAutomationIntegrationPrompt(data, language = "en") {
  if (language === "fr") {
    return `Parfait. Je note le transfert comme: ${data.handoff}. Quels outils utilisez-vous deja pour ca: calendrier, CRM, courriel, feuille de calcul, ou rien pour l'instant?`;
  }

  return `Perfect. I have the handoff as: ${data.handoff}. What tools do you already use for this: calendar, CRM, email, spreadsheet, booking software, or nothing yet?`;
}

function buildAutomationContactPrompt(data, language = "en") {
  if (language === "fr") {
    return `Excellent. J'ai maintenant le workflow, le transfert et les outils. Quel courriel devons-nous utiliser pour envoyer le plan EchoFour?`;
  }

  return `Great. I have the workflow, handoff, and tools now. What email should we use to send the EchoFour build plan?`;
}

function buildAutomationSummary(data, language = "en") {
  if (language === "fr") {
    return `Parfait. J'ai enregistre cette demande EchoFour pour ${translateIssue(data.issue)}. Le plan couvrira le workflow: ${data.workflowDetail}; le transfert: ${data.handoff}; et les outils: ${data.integration}. La prochaine etape est de preparer l'estimation et le plan de construction.`;
  }

  return `Perfect. I captured this as an EchoFour automation inquiry for ${data.issue}. The build plan will cover the workflow: ${data.workflowDetail}; the handoff: ${data.handoff}; and the tools: ${data.integration}. Next, we can prepare the estimate and implementation plan.`;
}

function buildAutomationContinuation(data, message = "", language = "en") {
  const m = normalizeText(message);

  if (language === "fr") {
    if (m.includes("estimation") || m.includes("prix") || m.includes("cout") || m.includes("coÃ»t")) {
      return `L'estimation couvrirait le workflow, les questions de qualification, les rappels et confirmations, le transfert vers votre equipe, l'integration avec ${data.integration}, les tests, et le lancement initial. Pour ${translateIssue(data.issue)}, EchoFour preparerait normalement une portee claire avant de donner le prix final.`;
    }

    return `Oui. Pour ${translateIssue(data.issue)}, la prochaine etape est de transformer ce que vous avez donne en plan de construction: workflow, logique, transfert, outils, tests et estimation.`;
  }

  if (m.includes("estimate") || m.includes("cost") || m.includes("price") || m.includes("include") || m.includes("quote")) {
    return `The estimate would include the conversation flow, intake questions, reminder and confirmation logic, the handoff to your team, integration with ${data.integration}, testing, and the first launch plan. For ${data.issue}, EchoFour would turn the details you gave into a clear build scope before pricing it.`;
  }

  if (m.includes("reminder") || m.includes("confirmation") || m.includes("sms") || m.includes("text") || m.includes("notify") || m.includes("notification")) {
    return `Yes. For ${data.issue}, reminders and confirmations can be part of the workflow. The build plan would define who receives each message, when it should be sent, what the message should say, and how exceptions get handed to your team.`;
  }

  if (m.includes("calendar") || m.includes("crm") || m.includes("email") || m.includes("integrat")) {
    return `For tools, I have ${data.integration} noted. The build plan would confirm the exact account, CRM or system connection, what data should pass through, and what your team should receive after each completed conversation.`;
  }

  if (m.includes("need from us") || m.includes("need from me") || m.includes("what do you need") || m.includes("provide") || m.includes("requirements")) {
    return `To prepare ${data.issue}, EchoFour would need the current workflow, sample questions or requests, the handoff rules, access details for ${data.integration}, and a clear owner for launch feedback. The details you already gave would become the starting brief.`;
  }

  if (m.includes("privacy") || m.includes("secure") || m.includes("security") || m.includes("data") || m.includes("patient") || m.includes("confidential")) {
    return `Security would be part of the build plan. For ${data.issue}, EchoFour would confirm what data is collected, where it is stored, who can access it, retention expectations, and any privacy requirements before connecting ${data.integration}.`;
  }

  if (m.includes("after launch") || m.includes("go live") || m.includes("go-live") || m.includes("maintain") || m.includes("support")) {
    return `After launch, EchoFour would monitor the first conversations, tune the workflow, review handoffs with your team, and decide which improvements should come next. The first version stays focused on ${data.workflowDetail}.`;
  }

  if (m.includes("how long") || m.includes("timeline") || m.includes("when") || m.includes("launch")) {
    return `A first version would usually be scoped around one focused workflow first: ${data.workflowDetail}. The build plan would separate the quick-launch version from later improvements like extra channels, reporting, or CRM automation.`;
  }

  if (m.includes("fail") || m.includes("fails") || m.includes("wrong") || m.includes("exception") || m.includes("miss") || m.includes("backup")) {
    return `The build plan would include fallback rules. If ${data.issue} cannot complete a step, it can collect the safest details, flag the exception, and use the handoff path to your team: ${data.handoff}.`;
  }

  return `Yes. At this point the project is scoped as ${data.issue}. The next useful step is a build plan that turns the workflow, handoff, and tools into implementation steps and an estimate.`;
}

function buildAutomationFollowup(data, language = "en") {
  if (language === "fr") {
    const parts = [
      `C'est utile. J'ai classé le projet comme ${translateIssue(data.issue)}.`,
      data.businessScope ? `La portée actuelle ressemble à ${formatScope(data.businessScope, "fr")}.` : "La prochaine étape est de confirmer les utilisateurs, la source de données et le format de sortie.",
      data.integration ? `Intégration cible: ${translateIntegration(data.integration)}.` : "Nous confirmerons aussi si les données sont dans des feuilles de calcul, un CRM, des courriels ou un autre système.",
      "Pour un premier projet, EchoFour commence normalement avec un plan ciblé avant de donner une estimation finale."
    ];

    return `${parts.join(" ")} Quel courriel devons-nous utiliser pour envoyer le plan de projet?`;
  }

  const parts = [
    `That helps. I have this scoped as ${data.issue.toLowerCase()}.`,
    data.businessScope ? `The current scope looks like ${formatScope(data.businessScope)}.` : buildAutomationFollowupDetail(data.issue),
    data.integration ? `Integration target: ${data.integration}.` : "We would also confirm whether the data lives in spreadsheets, CRM, email, or another system.",
    "For most first builds, EchoFour would start with a focused project plan before giving a final estimate."
  ];

  return `${parts.join(" ")} What email should we use to send the build plan?`;
}

function buildAutomationFollowupDetail(issue = "") {
  const value = issue.toLowerCase();

  if (value.includes("appointment") || value.includes("booking") || value.includes("follow-up")) {
    return "The next step is to confirm appointment sources, reminder timing, confirmation rules, no-show handling, and team handoff.";
  }

  if (value.includes("chat") || value.includes("assistant") || value.includes("intake") || value.includes("qualification")) {
    return "The next step is to confirm the questions, answers, qualification rules, and handoff destination.";
  }

  if (value.includes("dashboard") || value.includes("commission") || value.includes("grid")) {
    return "The next step is to confirm the source data, calculation rules, approval steps, and reporting view.";
  }

  if (value.includes("email") || value.includes("crm")) {
    return "The next step is to confirm the inbox or CRM source, statuses, routing rules, and follow-up timing.";
  }

  return "The next step is to confirm the users, workflow steps, data fields, and output format.";
}

function formatProjectName(issue, language = "en") {
  if (language === "fr") return translateIssue(issue);

  const value = (issue || "this workflow").toLowerCase();
  const article = /^[aeiou]/.test(value) || value.startsWith("hvac") ? "an" : "a";
  return `${article} ${value}`;
}

function formatScope(scope, language = "en") {
  if (language === "fr") {
    if (scope === "Canada-wide team") return "votre équipe partout au Canada";
    if (scope === "Advisor network") return "votre réseau de conseillers";
    if (scope === "Professional firm") return "votre cabinet professionnel";
    return `votre ${scope.toLowerCase()}`;
  }

  if (scope === "Canada-wide team") return "Canada-wide team";
  return scope.toLowerCase();
}

function translateIssue(issue = "Business workflow automation") {
  const map = {
    "Lead qualification system": "un système de qualification des prospects",
    "Commission grid automation": "une automatisation des grilles de commission",
    "CRM workflow": "un workflow CRM",
    "Candidate screening workflow": "un workflow de présélection des candidats",
    "Patient intake workflow": "un workflow d'accueil des patients",
    "Ecommerce support automation": "une automatisation du support ecommerce",
    "Insights dashboard": "un tableau de bord d'analyse",
    "Advisor workflow automation": "une automatisation des workflows de conseillers",
    "Enrollment qualification workflow": "un workflow de qualification des inscriptions",
    "Document intake workflow": "un workflow de collecte de documents",
    "Maintenance request automation": "une automatisation des demandes de maintenance",
    "Booking intake automation": "une automatisation des demandes de réservation",
    "Nonprofit engagement workflow": "un workflow d'engagement pour organisme sans but lucratif",
    "HVAC booking automation": "une automatisation des réservations HVAC",
    "Auto repair intake workflow": "un workflow d'accueil pour réparations automobiles",
    "Legal intake workflow": "un workflow d'accueil juridique",
    "Catering request workflow": "un workflow de demandes de traiteur",
    "Business workflow automation": "une automatisation de workflow d'entreprise",
    "Leak repair": "une réparation de fuite",
    "HVAC service": "un service HVAC",
    "Quote request": "une demande de soumission",
    "Repair request": "une demande de réparation",
    "Service request": "une demande de service"
  };

  return map[issue] || issue.toLowerCase();
}

function translateIntegration(integration = "") {
  const map = {
    "Excel / spreadsheet": "Excel ou à une feuille de calcul",
    "CRM": "un CRM",
    "Email workflow": "un workflow courriel",
    "Dashboard": "un tableau de bord"
  };

  return map[integration] || integration.toLowerCase();
}

function translatePriority(priority = "") {
  const map = {
    High: "élevée",
    Medium: "moyenne",
    Discovery: "découverte"
  };

  return map[priority] || priority.toLowerCase();
}

app.post("/chat", async (req, res) => {
  const message = cleanString(req.body.message || "", MAX_CHAT_LENGTH);
  const data = sanitizeState(req.body.data);
  const industry = req.body.industry === "finance" ? "finance" : "service";
  const language = req.body.language === "fr" ? "fr" : "en";

  if (!message) {
    res.status(400).json({ error: "Message is required." });
    return;
  }

  let updated = { ...data };
  let reply = language === "fr"
    ? "Compris. Je qualifie la demande et je mets le tableau de bord à jour."
    : "Got it. I am qualifying the request and updating the dashboard now.";

  if (industry === "finance") {
    updated = extractFinance(updated, message);
    const result = financeFlow(updated, message);
    reply = result.text;
    updated = result.data;
  }

  if (industry === "service") {
    updated = extractService(updated, message);
    const result = serviceFlow(updated, language, message);
    reply = result.text;
    updated = result.data;
  }

  if (updated.contact && !updated.leadSaved) {
    await saveLead({
      name: "Chat lead",
      email: isValidEmail(updated.contact) ? updated.contact : "",
      contact: updated.contact,
      business: updated.issue || updated.goal || "Chat inquiry",
      source: "chat",
      receivedAt: new Date().toISOString()
    });
    updated.leadSaved = true;
  }

  res.json({ reply, data: updated });
});

app.post("/lead", async (req, res) => {
  const name = cleanString(req.body.name);
  const email = cleanString(req.body.email);
  const business = cleanString(req.body.business, 220);
  const workflow = cleanString(req.body.workflow, 320);
  const privacyConsent = req.body.privacyConsent === "on" || req.body.privacyConsent === true;
  const website = cleanString(req.body.website);
  const startedAt = Number(req.body.startedAt);
  const elapsedMs = Date.now() - startedAt;

  if (website) {
    res.status(204).send();
    return;
  }

  if (!Number.isFinite(startedAt) || elapsedMs < MIN_FORM_SECONDS * 1000 || elapsedMs > MAX_FORM_MINUTES * 60 * 1000) {
    res.status(400).json({ error: "Please refresh the page and try again." });
    return;
  }

  if (!name || !email || !business || !isValidEmail(email)) {
    res.status(400).json({ error: "Valid name, email, and business type are required." });
    return;
  }

  if (!privacyConsent) {
    res.status(400).json({ error: "Privacy consent is required." });
    return;
  }

  const lead = {
    name,
    email,
    business,
    workflow,
    receivedAt: new Date().toISOString()
  };

  await saveLead(lead);

  console.log("New EchoFour consultation request received:", {
    source: "contact-form",
    receivedAt: lead.receivedAt
  });
  res.json({ ok: true, message: "Consultation request received." });
});

async function saveLead(lead) {
  const leads = readLeads();
  leads.push(lead);
  writeLeads(pruneExpiredLeads(leads));
  await notifyLead(lead);
}

async function notifyLead(lead) {
  if (!mailTransport) return;

  try {
    const message = {
      from: mailConfig.from,
      to: mailConfig.to,
      subject: "New EchoFour AI consultation request",
      text: [
        "New EchoFour AI consultation request",
        "",
        `Name: ${lead.name}`,
        lead.email ? `Email: ${lead.email}` : null,
        lead.contact ? `Contact: ${lead.contact}` : null,
        `Business type: ${lead.business}`,
        lead.workflow ? `Workflow: ${lead.workflow}` : null,
        lead.source ? `Source: ${lead.source}` : null,
        `Received at: ${lead.receivedAt}`
      ].filter(Boolean).join("\n")
    };

    if (lead.email) message.replyTo = lead.email;
    await mailTransport.sendMail(message);
  } catch (error) {
    console.error("Lead notification email failed:", {
      message: error.message,
      receivedAt: lead.receivedAt
    });
  }
}

function readLeads() {
  if (!fs.existsSync(leadsPath)) return [];

  try {
    const leads = decryptJson(JSON.parse(fs.readFileSync(leadsPath, "utf8")));
    return Array.isArray(leads) ? pruneExpiredLeads(leads) : [];
  } catch (error) {
    console.error("Could not read encrypted leads:", error.message);
    return [];
  }
}

function writeLeads(leads) {
  const tempPath = `${leadsPath}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(encryptJson(pruneExpiredLeads(leads)), null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tempPath, leadsPath);
}

function pruneExpiredLeads(leads) {
  const retentionMs = LEAD_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - retentionMs;

  return leads.filter((lead) => {
    const receivedAt = Date.parse(lead.receivedAt);
    return Number.isFinite(receivedAt) && receivedAt >= cutoff;
  });
}

app.use((error, req, res, next) => {
  if (error.type === "entity.too.large") {
    res.status(413).json({ error: "Request body is too large." });
    return;
  }

  if (error instanceof SyntaxError && "body" in error) {
    res.status(400).json({ error: "Invalid JSON body." });
    return;
  }

  console.error("Unhandled server error:", {
    path: req.path,
    method: req.method,
    message: error.message
  });

  res.status(500).json({ error: "Server error." });
});

app.listen(PORT, () => {
  console.log(`EchoFour AI server running on http://localhost:${PORT}`);
});

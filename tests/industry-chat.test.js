const assert = require("node:assert");

const cases = [
  {
    industry: "Service business",
    message: "We run a plumbing company and need AI to qualify emergency calls, estimate jobs, and send leads to our team.",
    expected: ["automation", "Lead qualification system"]
  },
  {
    industry: "Plumbing leak-call automation",
    message: "We run a plumbing company and need AI to qualify emergency leak calls, collect location, estimate urgency, and send jobs to dispatch.",
    expected: ["automation", "Lead qualification system"]
  },
  {
    industry: "HVAC",
    message: "I need an AI assistant for HVAC quote requests, AC repairs, and booking appointments.",
    expected: ["automation", "HVAC booking automation"]
  },
  {
    industry: "Auto shop",
    message: "Our auto shop needs a tool to intake repair requests, identify vehicle issues, and schedule service.",
    expected: ["automation", "Auto repair intake workflow"]
  },
  {
    industry: "Financial advisor network",
    message: "I need a commission grid dashboard for advisors across Canada using Excel.",
    expected: ["automation", "Commission grid automation", "Excel / spreadsheet"]
  },
  {
    industry: "Recruiting",
    message: "We need AI to screen candidates, collect resumes, score fit, and route qualified applicants.",
    expected: ["automation"]
  },
  {
    industry: "Marketing agency",
    message: "Our agency needs a CRM workflow to qualify leads, collect budgets, and send project briefs to sales.",
    expected: ["automation", "CRM"]
  },
  {
    industry: "Real estate",
    message: "I want an AI intake assistant for real estate buyer leads, budget, location, timeline, and mortgage status.",
    expected: ["automation"]
  },
  {
    industry: "Legal office",
    message: "A law office needs an intake workflow for new clients, case type, urgency, and conflict check routing.",
    expected: ["automation", "Legal intake workflow"]
  },
  {
    industry: "Medical clinic",
    message: "Our clinic needs an admin assistant to collect patient requests, appointment type, and urgency before staff calls back.",
    expected: ["automation"]
  },
  {
    industry: "Restaurant catering",
    message: "We need a tool for catering requests, guest count, date, budget, and menu preferences.",
    expected: ["automation", "Catering request workflow"]
  },
  {
    industry: "Ecommerce",
    message: "Our ecommerce store needs AI support for order questions, returns, product recommendations, and escalation.",
    expected: ["automation"]
  },
  {
    industry: "Construction",
    message: "We need a dashboard to track project requests, estimates, site visits, and subcontractor follow-ups.",
    expected: ["automation", "Insights dashboard"]
  },
  {
    industry: "Insurance",
    message: "An insurance brokerage needs AI intake for quote requests, renewals, policy type, and advisor routing.",
    expected: ["automation"]
  },
  {
    industry: "Education",
    message: "A training company needs a workflow to qualify students, collect course interests, and send enrollment follow-ups.",
    expected: ["automation", "Enrollment qualification workflow"]
  },
  {
    industry: "Accounting",
    message: "Our accounting firm needs a client intake tool for tax season documents, deadlines, and missing information.",
    expected: ["automation"]
  },
  {
    industry: "SaaS company",
    message: "We need an AI onboarding assistant that answers product questions, collects use case details, and flags expansion leads.",
    expected: ["automation"]
  },
  {
    industry: "Property management",
    message: "We need AI to classify tenant maintenance requests, urgency, building, and notify the right vendor.",
    expected: ["automation"]
  },
  {
    industry: "Fitness studio",
    message: "A gym needs a chatbot to qualify memberships, trial class bookings, goals, and follow-up reminders.",
    expected: ["automation"]
  },
  {
    industry: "Beauty salon",
    message: "A salon needs AI booking intake for service type, stylist preference, availability, and deposit reminders.",
    expected: ["automation"]
  },
  {
    industry: "Appointment automation",
    message: "I need help building an automated system for appointments.",
    expected: ["automation", "Booking intake automation"]
  },
  {
    industry: "Nonprofit",
    message: "A nonprofit needs an automation to manage volunteer signups, donor inquiries, event questions, and follow-up emails.",
    expected: ["automation", "Nonprofit engagement workflow", "Email workflow"]
  },
  {
    industry: "Vague spreadsheet workflow",
    message: "My team spends too much time copying info between emails and spreadsheets. Can AI help?",
    expected: ["automation", "Email workflow"]
  },
  {
    industry: "Spreadsheet summaries",
    message: "We need to automate a Google Sheets tracker and send weekly summaries by email.",
    expected: ["automation", "Email workflow"]
  }
];

async function postChat(message, data = {}) {
  const response = await fetch("http://localhost:3000/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, data, industry: "service" })
  });

  assert.equal(response.status, 200, "chat endpoint should return 200");
  return response.json();
}

async function run() {
  const results = [];

  for (const testCase of cases) {
    const result = await postChat(testCase.message);
    const dataText = JSON.stringify(result.data);
    const fullText = `${result.reply} ${dataText}`;

    const missing = testCase.expected.filter((expected) => !fullText.includes(expected));
    if (result.data.mode === "automation" && result.reply.includes("What city are you located in")) {
      missing.push("no city prompt for automation inquiries");
    }

    results.push({
      industry: testCase.industry,
      ok: missing.length === 0,
      missing,
      reply: result.reply,
      data: result.data
    });
  }

  const failed = results.filter((result) => !result.ok);

  for (const result of results) {
    const mark = result.ok ? "PASS" : "FAIL";
    console.log(`\n[${mark}] ${result.industry}`);
    console.log(`Reply: ${result.reply}`);
    console.log(`Data: ${JSON.stringify(result.data)}`);
    if (result.missing.length) console.log(`Missing: ${result.missing.join(", ")}`);
  }

  if (failed.length) {
    throw new Error(`${failed.length} industry chat tests failed`);
  }

  console.log(`\nAll ${results.length} industry chat tests passed.`);
}

run().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

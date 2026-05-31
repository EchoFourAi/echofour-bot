const assert = require("node:assert");

const cases = [
  {
    label: "Appointment reminders",
    message: "Can you automate appointment reminders and follow ups for clients?",
    expected: ["automation", "Booking intake automation"]
  },
  {
    label: "Invoice workflow",
    message: "I need AI for invoices, payment follow up, and monthly reports.",
    expected: ["automation"]
  },
  {
    label: "CRM follow-up",
    message: "We need CRM follow-up automation after every new lead comes in.",
    expected: ["automation", "CRM"]
  },
  {
    label: "Spreadsheet reports",
    message: "Can you automate spreadsheet reports from Google Sheets and email the summary weekly?",
    expected: ["automation", "Email workflow"]
  },
  {
    label: "Email triage",
    message: "Our team loses time sorting customer emails and assigning them to the right person.",
    expected: ["automation", "Email workflow"]
  },
  {
    label: "Quote calculator",
    message: "We want a quote calculator that collects project details before sales calls.",
    expected: ["automation"]
  },
  {
    label: "Dashboard request",
    message: "I want a dashboard to see leads, status, and follow ups in one place.",
    expected: ["automation", "Insights dashboard"]
  },
  {
    label: "Admin assistant",
    message: "Could EchoFour build an admin assistant to collect requests and route them?",
    expected: ["automation"]
  },
  {
    label: "Booking system",
    message: "We need a booking system for appointments, deposits, and reminders.",
    expected: ["automation", "Booking intake automation"]
  },
  {
    label: "Recruiting appointment agent",
    message: "I have a recruiting website and I need an AI agent to take care of appointments, follow ups, confirmations.",
    expected: ["automation", "Recruiting appointment follow-up automation"]
  },
  {
    label: "Dental custom workflow",
    message: "I run a dental office and need an AI agent for patient questions, appointments, and reminders.",
    expected: ["automation", "Dental appointment follow-up automation"]
  },
  {
    label: "Roofing quote workflow",
    message: "I have a roofing company and want AI to collect photos, qualify leads, and prepare quote requests.",
    expected: ["automation", "Roofing quote automation"]
  },
  {
    label: "Callback system",
    message: "I want a system that qualifies people and tells my team who to call back first.",
    expected: ["automation"]
  }
];

async function postChat(message) {
  const response = await fetch("http://localhost:3000/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, data: {}, industry: "service" })
  });

  assert.equal(response.status, 200, "chat endpoint should return 200");
  return response.json();
}

async function run() {
  const failures = [];

  for (const testCase of cases) {
    const result = await postChat(testCase.message);
    const text = `${result.reply} ${JSON.stringify(result.data)}`;
    const missing = testCase.expected.filter((expected) => !text.includes(expected));

    if (result.data.mode === "automation" && result.reply.includes("What city are you located in")) {
      missing.push("no city prompt for automation inquiries");
    }

    console.log(`\n[${missing.length ? "FAIL" : "PASS"}] ${testCase.label}`);
    console.log(`Reply: ${result.reply}`);
    console.log(`Data: ${JSON.stringify(result.data)}`);
    if (missing.length) {
      console.log(`Missing: ${missing.join(", ")}`);
      failures.push(testCase.label);
    }
  }

  if (failures.length) {
    throw new Error(`${failures.length} launch phrase tests failed: ${failures.join(", ")}`);
  }

  console.log(`\nAll ${cases.length} launch phrase tests passed.`);
}

run().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

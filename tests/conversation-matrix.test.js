const assert = require("node:assert");

async function postChat(message, data = {}) {
  const response = await fetch("http://localhost:3000/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, data, industry: "service" })
  });

  assert.equal(response.status, 200, "chat endpoint should return 200");
  return response.json();
}

function assertNoBadAutomationReply(result, label) {
  assert.equal(result.data.mode, "automation", `${label}: should stay in automation mode`);
  assert.ok(!result.reply.includes("What city are you located in"), `${label}: should not ask service city question`);
  assert.ok(!result.reply.includes("automate the calculations"), `${label}: should not use dashboard language for every workflow`);
  assert.ok(!result.reply.includes("Perfect. I captured this") || result.data.currentQuestion === "done", `${label}: should not finalize before done`);
}

async function runConversation(scenario) {
  let data = {};
  const transcript = [];

  for (const turn of scenario.turns) {
    const result = await postChat(turn.message, data);
    transcript.push({ message: turn.message, reply: result.reply, data: result.data });
    data = result.data;

    assertNoBadAutomationReply(result, `${scenario.label}: ${turn.message}`);

    if (turn.issue) assert.equal(data.issue, turn.issue, `${scenario.label}: issue`);
    if (turn.nextStep) assert.equal(data.nextStep, turn.nextStep, `${scenario.label}: nextStep`);
    if (turn.currentQuestion) assert.equal(data.currentQuestion, turn.currentQuestion, `${scenario.label}: currentQuestion`);
    if (turn.replyIncludes) {
      for (const expected of turn.replyIncludes) {
        assert.ok(result.reply.includes(expected), `${scenario.label}: reply should include "${expected}"`);
      }
    }
    if (turn.replyExcludes) {
      for (const rejected of turn.replyExcludes) {
        assert.ok(!result.reply.includes(rejected), `${scenario.label}: reply should not include "${rejected}"`);
      }
    }
  }

  return { data, transcript };
}

async function run() {
  const scenarios = [
    {
      label: "Clinic appointment follow-up",
      turns: [
        {
          message: "I would like the agent to take care of appointments, follow ups, confirmations for my clinic",
          issue: "Clinic appointment follow-up automation",
          nextStep: "Clarify handoff",
          currentQuestion: "handoff",
          replyIncludes: ["After the assistant handles that"]
        },
        {
          message: "It should text the patient, update the calendar, and notify the front desk",
          nextStep: "Confirm tools",
          currentQuestion: "integration",
          replyIncludes: ["What tools do you already use"]
        },
        {
          message: "We use Google Calendar and email right now",
          nextStep: "Capture contact",
          currentQuestion: "contact",
          replyIncludes: ["workflow, handoff, and tools"]
        },
        {
          message: "clinic@example.com",
          nextStep: "Prepare build plan",
          currentQuestion: "done",
          replyIncludes: ["workflow:", "handoff:", "tools:"]
        },
        {
          message: "What would the estimate include?",
          currentQuestion: "done",
          replyIncludes: ["The estimate would include", "testing", "first launch plan"],
          replyExcludes: ["Perfect. I captured this"]
        },
        {
          message: "How long would it take to launch?",
          currentQuestion: "done",
          replyIncludes: ["first version", "quick-launch"],
          replyExcludes: ["Perfect. I captured this"]
        },
        {
          message: "What would you need from us to get started?",
          currentQuestion: "done",
          replyIncludes: ["current workflow", "handoff rules", "launch feedback"],
          replyExcludes: ["Perfect. I captured this"]
        }
      ]
    },
    {
      label: "Recruiting appointment agent",
      turns: [
        {
          message: "I have a recruiting website and I need an AI agent to take care of appointments, follow ups, confirmations",
          issue: "Recruiting appointment follow-up automation",
          nextStep: "Clarify handoff",
          currentQuestion: "handoff"
        },
        {
          message: "Send qualified candidates to Calendly and email my recruiter",
          nextStep: "Capture contact",
          currentQuestion: "contact",
          replyIncludes: ["workflow, handoff, and tools"]
        },
        {
          message: "recruiting@example.com",
          currentQuestion: "done",
          replyIncludes: ["Recruiting appointment follow-up automation", "Calendly"]
        },
        {
          message: "Can it send reminders too?",
          currentQuestion: "done",
          replyIncludes: ["reminder"],
          replyExcludes: ["Perfect. I captured this"]
        },
        {
          message: "What happens if it fails or misses something?",
          currentQuestion: "done",
          replyIncludes: ["fallback rules", "flag the exception", "handoff"],
          replyExcludes: ["Perfect. I captured this"]
        }
      ]
    },
    {
      label: "Dashboard and reporting",
      turns: [
        {
          message: "I need a commission grid dashboard for advisors across Canada using Excel",
          issue: "Commission grid automation",
          nextStep: "Clarify handoff",
          currentQuestion: "handoff"
        },
        {
          message: "Managers should receive a weekly summary and advisors should see their totals",
          nextStep: "Capture contact",
          currentQuestion: "contact",
          replyIncludes: ["workflow, handoff, and tools"]
        },
        {
          message: "advisor@example.com",
          currentQuestion: "done",
          replyIncludes: ["Commission grid automation", "Excel / spreadsheet"]
        },
        {
          message: "Can it connect to our CRM later?",
          currentQuestion: "done",
          replyIncludes: ["tools", "CRM"],
          replyExcludes: ["Perfect. I captured this"]
        },
        {
          message: "Who supports it after launch?",
          currentQuestion: "done",
          replyIncludes: ["After launch", "monitor", "improvements"],
          replyExcludes: ["Perfect. I captured this"]
        }
      ]
    },
    {
      label: "Website chat assistant",
      turns: [
        {
          message: "I need to create a chat assistant for my website",
          issue: "Website chat assistant",
          nextStep: "Clarify workflow",
          currentQuestion: "workflowDetail",
          replyIncludes: ["What should it collect or answer"]
        },
        {
          message: "It should answer service questions, collect budget, and qualify leads",
          nextStep: "Clarify handoff",
          currentQuestion: "handoff"
        },
        {
          message: "Send qualified leads to email and notify sales",
          nextStep: "Capture contact",
          currentQuestion: "contact",
          replyIncludes: ["workflow, handoff, and tools"]
        },
        {
          message: "hello@example.com",
          currentQuestion: "done",
          replyIncludes: ["Website chat assistant", "workflow:"]
        },
        {
          message: "How do you handle privacy and customer data?",
          currentQuestion: "done",
          replyIncludes: ["Security", "what data is collected", "retention"],
          replyExcludes: ["Perfect. I captured this"]
        }
      ]
    }
  ];

  for (const scenario of scenarios) {
    await runConversation(scenario);
    console.log(`[PASS] ${scenario.label}`);
  }

  console.log(`All ${scenarios.length} full conversation matrix tests passed.`);
}

run().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

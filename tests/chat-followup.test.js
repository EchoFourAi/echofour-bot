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

async function run() {
  const first = await postChat("I need a commission grid dashboard for advisors across Canada using Excel");
  assert.equal(first.data.mode, "automation");
  assert.equal(first.data.issue, "Commission grid automation");
  assert.equal(first.data.integration, "Excel / spreadsheet");
  assert.equal(first.data.nextStep, "Clarify handoff");
  assert.ok(first.reply.includes("what should happen next") || first.reply.includes("After the assistant handles that"));

  const second = await postChat("We have advisors all over Canada and want quarterly reporting", first.data);
  assert.equal(second.data.businessScope, "Canada-wide team");
  assert.equal(second.data.nextStep, "Capture contact");
  assert.ok(!second.reply.includes("What city are you located in"));
  assert.ok(second.reply.includes("workflow, handoff, and tools"));

  const websiteAssistant = await postChat("I need to create a chat assistant for my website");
  assert.equal(websiteAssistant.data.mode, "automation");
  assert.equal(websiteAssistant.data.issue, "Website chat assistant");
  assert.equal(websiteAssistant.data.nextStep, "Clarify workflow");
  assert.ok(!websiteAssistant.reply.includes("What city are you located in"));
  assert.ok(websiteAssistant.reply.includes("What should it collect or answer"));

  const websiteAssistantFollowup = await postChat("New York", websiteAssistant.data);
  assert.equal(websiteAssistantFollowup.data.mode, "automation");
  assert.equal(websiteAssistantFollowup.data.issue, "Website chat assistant");
  assert.ok(!websiteAssistantFollowup.reply.includes("What city are you located in"));
  assert.ok(websiteAssistantFollowup.reply.includes("After the assistant handles that"));

  const recruitingAgent = await postChat("I have a recruiting website and I need an AI agent to take care of appointments, follow ups, confirmations");
  assert.equal(recruitingAgent.data.mode, "automation");
  assert.equal(recruitingAgent.data.issue, "Recruiting appointment follow-up automation");
  assert.equal(recruitingAgent.data.nextStep, "Clarify handoff");
  assert.ok(!recruitingAgent.reply.includes("Business workflow automation"));
  assert.ok(!recruitingAgent.reply.includes("What city are you located in"));
  assert.ok(recruitingAgent.reply.includes("After the assistant handles that"));

  const genericStart = await postChat("I need an AI agent for my business");
  assert.equal(genericStart.data.issue, "Custom intake assistant");

  const refinedClinic = await postChat("I would like the agent to take care of appointments, follow ups, confirmations for my clinic", genericStart.data);
  assert.equal(refinedClinic.data.mode, "automation");
  assert.equal(refinedClinic.data.issue, "Clinic appointment follow-up automation");
  assert.ok(!refinedClinic.reply.includes("Custom intake assistant"));
  assert.ok(refinedClinic.reply.includes("After the assistant handles that"));
  assert.ok(!refinedClinic.reply.includes("automate the calculations"));
  assert.ok(!refinedClinic.reply.includes("What city are you located in"));

  const directClinic = await postChat("I would like the agent to take care of appointments, follow ups, confirmations for my clinic");
  assert.equal(directClinic.data.mode, "automation");
  assert.equal(directClinic.data.issue, "Clinic appointment follow-up automation");
  assert.ok(directClinic.reply.includes("After the assistant handles that"));
  assert.ok(!directClinic.reply.includes("automate the calculations"));

  const clinicHandoff = await postChat("It should text the patient, update the calendar, and notify the front desk", directClinic.data);
  assert.equal(clinicHandoff.data.handoff, "It should text the patient, update the calendar, and notify the front desk");
  assert.ok(clinicHandoff.reply.includes("What tools do you already use"));

  const clinicTools = await postChat("We use Google Calendar and email right now", clinicHandoff.data);
  assert.equal(clinicTools.data.integration, "Calendar / booking system");
  assert.ok(clinicTools.reply.includes("workflow, handoff, and tools"));

  const clinicComplete = await postChat("clinic@example.com", clinicTools.data);
  assert.equal(clinicComplete.data.currentQuestion, "done");
  assert.ok(clinicComplete.reply.includes("The build plan will cover"));

  const estimateQuestion = await postChat("What would the estimate include?", clinicComplete.data);
  assert.equal(estimateQuestion.data.currentQuestion, "done");
  assert.ok(estimateQuestion.reply.includes("The estimate would include"));
  assert.ok(estimateQuestion.reply.includes("conversation flow"));
  assert.ok(!estimateQuestion.reply.includes("Perfect. I captured this"));

  const third = await postChat("gabriel@example.com", second.data);
  assert.equal(third.data.contact, "gabriel@example.com");
  assert.equal(third.data.nextStep, "Prepare build plan");
  assert.equal(third.data.confidence, 95);
  assert.equal(third.data.leadSaved, true);
  assert.ok(third.reply.includes("workflow:"));
  assert.ok(third.reply.includes("handoff:"));
  assert.ok(third.reply.includes("tools:"));

  const service = await postChat("I need an emergency leak repair in Montreal today");
  assert.equal(service.data.mode, "service");
  assert.equal(service.data.issue, "Leak repair");
  assert.equal(service.data.city, "Montreal");
  assert.ok(service.reply.includes("What email or phone number"));

  const quote = await postChat("Can someone give me a quote for a service appointment next week in Laval?");
  assert.equal(quote.data.mode, "service");
  assert.equal(quote.data.issue, "Quote request");
  assert.equal(quote.data.city, "Laval");

  console.log("All multi-turn chat follow-up tests passed.");
}

run().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

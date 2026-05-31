const company = {
  name: "Northline Plumbing",
  emergencyCallbackWindow: "5-30 minutes",
  offersEmergencyCallback: true
};

const emergencyClosingMessage = company.offersEmergencyCallback
  ? `Thank you for contacting ${company.name}. One of our agents will contact you within the next ${company.emergencyCallbackWindow}.`
  : `Thank you for contacting ${company.name}.`;

const standardClosingMessage = `Thank you for contacting ${company.name}. Your request has been received.`;

const scenarios = {
  emergency: {
    status: "Ready for dispatch",
    score: 94,
    messages: [
      ["bot", "Hi, I can help route your plumbing emergency. What happened?"],
      ["customer", "There is water coming through the ceiling in our duplex."],
      ["bot", "Is the water still running, and have you shut off the main valve?"],
      ["customer", "Water is still dripping. We shut off the upstairs bathroom valve but not the main."],
      ["bot", "Got it. What is the address and best callback number?"],
      ["customer", "4288 Saint-Denis, Montreal. Call 514-555-0184."],
      ["bot", "This is high priority. I am preparing a dispatch summary with the leak source, location, access notes, and callback number."],
      ["bot", emergencyClosingMessage]
    ],
    job: {
      issue: "Active ceiling leak",
      location: "4288 Saint-Denis, Montreal",
      property: "Residential duplex",
      contact: "514-555-0184",
      eta: "Emergency route, 45-90 min",
      handoff: "Send to on-call dispatcher"
    },
    summary: [
      "Priority: Emergency leak",
      "Issue: Active water dripping through ceiling",
      "Location: 4288 Saint-Denis, Montreal",
      "Property: Residential duplex",
      "Customer action: Upstairs bathroom valve shut off; main valve not confirmed",
      "Callback: 514-555-0184",
      `Customer closing message: ${emergencyClosingMessage}`,
      "Suggested handoff: Dispatch on-call technician within 45-90 minutes"
    ].join("\n")
  },
  commercial: {
    status: "Qualified quote",
    score: 76,
    messages: [
      ["bot", "What type of plumbing request are you trying to schedule?"],
      ["customer", "We manage a small commercial building and need recurring drain inspections."],
      ["bot", "How many units or service areas should the team review?"],
      ["customer", "Three restaurant tenants and one shared basement utility area."],
      ["bot", "What timeline and contact should dispatch use?"],
      ["customer", "Any weekday next week. Email ops@example.com."],
      ["bot", "This looks like a commercial quote request. I will package it for estimating and follow-up."],
      ["bot", standardClosingMessage]
    ],
    job: {
      issue: "Recurring drain inspection",
      location: "Commercial property, address pending",
      property: "3 restaurant tenants + basement utility area",
      contact: "ops@example.com",
      eta: "Quote follow-up next business day",
      handoff: "Send to estimating inbox"
    },
    summary: [
      "Priority: Scheduled commercial quote",
      "Issue: Recurring drain inspection",
      "Scope: Three restaurant tenants and shared basement utility area",
      "Timeline: Any weekday next week",
      "Contact: ops@example.com",
      `Customer closing message: ${standardClosingMessage}`,
      "Suggested handoff: Estimator follow-up with site visit options"
    ].join("\n")
  }
};

const emptyJob = {
  issue: "Not captured",
  location: "Not captured",
  property: "Not captured",
  contact: "Not captured",
  eta: "Pending",
  handoff: "Pending"
};

const chatStream = document.getElementById("chatStream");
const intakeStatus = document.getElementById("intakeStatus");
const dispatchStatus = document.getElementById("dispatchStatus");
const priorityScore = document.getElementById("priorityScore");
const scoreFill = document.getElementById("scoreFill");
const summaryBox = document.getElementById("summaryBox");

const fields = {
  issue: document.getElementById("jobIssue"),
  location: document.getElementById("jobLocation"),
  property: document.getElementById("jobProperty"),
  contact: document.getElementById("jobContact"),
  eta: document.getElementById("jobEta"),
  handoff: document.getElementById("jobHandoff")
};

function renderMessages(messages) {
  chatStream.replaceChildren();
  for (const [type, text] of messages) {
    const bubble = document.createElement("div");
    bubble.className = `message ${type}`;
    bubble.textContent = text;
    chatStream.appendChild(bubble);
  }
  chatStream.scrollTop = chatStream.scrollHeight;
}

function renderJob(job) {
  fields.issue.textContent = job.issue;
  fields.location.textContent = job.location;
  fields.property.textContent = job.property;
  fields.contact.textContent = job.contact;
  fields.eta.textContent = job.eta;
  fields.handoff.textContent = job.handoff;
}

function renderScenario(name) {
  const scenario = scenarios[name];
  intakeStatus.textContent = "Qualified";
  dispatchStatus.textContent = scenario.status;
  priorityScore.textContent = `${scenario.score}%`;
  scoreFill.style.width = `${scenario.score}%`;
  renderMessages(scenario.messages);
  renderJob(scenario.job);
  summaryBox.textContent = scenario.summary;
}

function resetDemo() {
  intakeStatus.textContent = "Collecting details";
  dispatchStatus.textContent = "Waiting";
  priorityScore.textContent = "0%";
  scoreFill.style.width = "0";
  renderMessages([["bot", "Hi, I can help qualify plumbing requests and prepare them for dispatch. Choose a scenario to see the workflow."]]);
  renderJob(emptyJob);
  summaryBox.textContent = "No request has been qualified yet.";
}

document.querySelectorAll("[data-demo-step]").forEach((button) => {
  button.addEventListener("click", () => {
    const step = button.dataset.demoStep;
    if (step === "reset") {
      resetDemo();
      return;
    }
    renderScenario(step);
  });
});

document.querySelector("[data-copy-summary]").addEventListener("click", async () => {
  await navigator.clipboard.writeText(summaryBox.textContent);
});

resetDemo();

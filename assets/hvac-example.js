const company = {
  name: "AeroTemp HVAC",
  urgentCallbackWindow: "5-30 minutes",
  offersUrgentCallback: true
};

const urgentClosingMessage = company.offersUrgentCallback
  ? `Thank you for contacting ${company.name}. One of our agents will contact you within the next ${company.urgentCallbackWindow}.`
  : `Thank you for contacting ${company.name}.`;

const standardClosingMessage = `Thank you for contacting ${company.name}. Your request has been received.`;

const scenarios = {
  repair: {
    status: "Ready for booking",
    score: 91,
    messages: [
      ["bot", "Hi, I can help route your HVAC request. What system needs service?"],
      ["customer", "Our central AC stopped cooling and the house is getting hot."],
      ["bot", "Is the system running at all, and is anyone in the home medically vulnerable or elderly?"],
      ["customer", "The fan runs but warm air comes out. My mother is elderly and lives with us."],
      ["bot", "Got it. What is the address and best callback number?"],
      ["customer", "1120 Rue Everett, Laval. Call 514-555-0277."],
      ["bot", "This is high priority. I am preparing a booking summary with the AC issue, vulnerability note, address, and callback number."],
      ["bot", urgentClosingMessage]
    ],
    job: {
      issue: "AC not cooling",
      location: "1120 Rue Everett, Laval",
      property: "Central AC, residential home",
      contact: "514-555-0277",
      eta: "Urgent callback, 5-30 min",
      handoff: "Send to service coordinator"
    },
    summary: [
      "Priority: Urgent AC repair",
      "Issue: Central AC running but blowing warm air",
      "Location: 1120 Rue Everett, Laval",
      "System: Central AC, residential home",
      "Customer note: Elderly person in home; cooling issue should be prioritized",
      "Callback: 514-555-0277",
      `Customer closing message: ${urgentClosingMessage}`,
      "Suggested handoff: Service coordinator calls client and books earliest technician window"
    ].join("\n")
  },
  quote: {
    status: "Qualified quote",
    score: 78,
    messages: [
      ["bot", "What HVAC work are you looking to schedule?"],
      ["customer", "We want a quote to replace an old furnace before next winter."],
      ["bot", "What type of property is this, and do you know the current furnace age or fuel type?"],
      ["customer", "Single-family home. Gas furnace, around 18 years old."],
      ["bot", "What timeline and contact should the estimator use?"],
      ["customer", "Any weekday morning next week. Email marc@example.com."],
      ["bot", "This looks like a furnace replacement quote. I will package it for estimating and appointment follow-up."],
      ["bot", standardClosingMessage]
    ],
    job: {
      issue: "Furnace replacement quote",
      location: "Address pending",
      property: "18-year gas furnace, single-family home",
      contact: "marc@example.com",
      eta: "Estimator follow-up next business day",
      handoff: "Send to estimating calendar"
    },
    summary: [
      "Priority: Scheduled furnace quote",
      "Issue: Replace old gas furnace",
      "System: 18-year gas furnace, single-family home",
      "Timeline: Any weekday morning next week",
      "Contact: marc@example.com",
      `Customer closing message: ${standardClosingMessage}`,
      "Suggested handoff: Estimator follow-up with quote appointment options"
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
  renderMessages([["bot", "Hi, I can help qualify HVAC requests and prepare them for booking. Choose a scenario to see the workflow."]]);
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

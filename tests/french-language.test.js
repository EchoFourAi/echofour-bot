const assert = require("node:assert");

async function postChat(message, data = {}) {
  const response = await fetch("http://localhost:3000/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, data, industry: "service", language: "fr" })
  });

  assert.equal(response.status, 200, "chat endpoint should return 200");
  return response.json();
}

async function run() {
  const first = await postChat("J'ai besoin d'un outil de grilles de commission pour des conseillers partout au Canada avec Excel");
  assert.equal(first.data.mode, "automation");
  assert.equal(first.data.issue, "Commission grid automation");
  assert.equal(first.data.integration, "Excel / spreadsheet");
  assert.equal(first.data.nextStep, "Clarify handoff");
  assert.ok(first.reply.includes("Compris") || first.reply.includes("Que doit-il se passer"));

  const second = await postChat("Envoyer un courriel a l'equipe chaque trimestre", first.data);
  assert.equal(second.data.nextStep, "Capture contact");
  assert.ok(second.reply.includes("Quel courriel"));

  const third = await postChat("gabriel@example.com", second.data);
  assert.equal(third.data.contact, "gabriel@example.com");
  assert.equal(third.data.nextStep, "Prepare build plan");
  assert.ok(third.reply.includes("Parfait"));

  const service = await postChat("J'ai besoin d'une réparation urgente de fuite à Montréal aujourd'hui");
  assert.equal(service.data.mode, "service");
  assert.equal(service.data.issue, "Leak repair");
  assert.equal(service.data.city, "Montreal");
  assert.ok(service.reply.includes("Quel courriel"));

  console.log("All French language tests passed.");
}

run().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

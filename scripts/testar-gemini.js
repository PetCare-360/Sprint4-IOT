// Roda so o Vitalis Voice, isolado, contra um evento de exemplo — util pra confirmar que a chamada real ao Gemini esta funcionando, sem precisar subir o servidor inteiro.
// Uso:
// node --env-file=.env scripts/testar-gemini.js

const vitalisVoice = require("../src/vitalisVoice");
const vitalisRules = require("../src/vitalisRules");

const petExemplo = {
  petId: "PET_00123",
  nome: "Thor",
  especie: "Canino",
  raca: "Golden Retriever",
  dataNascimento: "2021-03-14",
  predisposicaoRacial: ["cardiaca"],
  ultimaConsultaEm: "2026-02-15",
  proximaVacinaEm: "2026-10-05",
  ultimaLimpezaDentariaEm: "2025-06-01",
  medicamentos: [],
  tutorPreferencias: { tom: "caloroso" },
};

const senseExemplo = {
  zScore: 4.8,
  metricaMaisRelevante: "heartRate",
  classificacao: "anomalia_alta",
  baselineProvisorio: false,
  timestamp: new Date().toISOString(),
};

async function main() {
  if (!process.env.GEMINI_API_KEY && !process.env.ANTHROPIC_API_KEY) {
    console.log("\u26a0\ufe0f  Nenhuma GEMINI_API_KEY ou ANTHROPIC_API_KEY encontrada no ambiente.");
    console.log("   Copie .env.example para .env, preencha a chave, e rode:");
    console.log("   node --env-file=.env scripts/testar-gemini.js\n");
    console.log("   Rodando mesmo assim, para mostrar o fallback de seguranca:\n");
  }

  const evento = vitalisRules.priorizar(petExemplo, senseExemplo);
  const mensagens = await vitalisVoice.gerarMensagens(petExemplo, evento);

  console.log("========================================");
  console.log("Resultado do Vitalis Voice");
  console.log("========================================");
  console.log("origem:   ", mensagens.origem);
  if (mensagens.provedor) console.log("provedor: ", mensagens.provedor, `(modelo: ${mensagens.modelo})`);
  if (mensagens.motivoFallback) {
    console.log("motivo do fallback:", mensagens.motivoFallback);
    if (mensagens.motivoFallback === "erro_llm") {
      console.log("\nCausas comuns de erro_llm com o Gemini:");
      console.log("  1. A chave foi criada em https://aistudio.google.com/app/apikey (nao no Google Cloud/Vertex AI).");
      console.log("  2. A 'Generative Language API' esta habilitada no projeto associado a chave.");
      console.log("  3. Nao ha restricao de IP/referrer na chave que bloqueie chamadas de servidor.");
      console.log("  4. O .env nao tem aspas/espacos sobrando ao redor da chave.");
      console.log("  (o erro detalhado da API, se houve, foi impresso acima por src/vitalisVoice.js)");
    }
  }
  console.log("----------------------------------------");
  console.log("Mensagem para o tutor:");
  console.log(" ", mensagens.mensagemTutor);
  console.log("----------------------------------------");
  console.log("Resumo para a clinica:");
  console.log(" ", mensagens.resumoClinica);
  console.log("========================================");

  if (mensagens.origem === "llm") {
    console.log("\u2705 Confirmado: a mensagem acima foi gerada por um LLM de verdade (nao e template).");
  } else {
    console.log("\u2139\ufe0f  Essa mensagem veio do fallback determinístico, nao do LLM.");
  }
}

main();
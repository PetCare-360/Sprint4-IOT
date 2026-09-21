const { describe, it, assert } = require("./miniTest");
const vitalisVoice = require("../src/vitalisVoice");
const vitalisRules = require("../src/vitalisRules");

describe("Vitalis Voice", () => {
  const pet = {
    petId: "P1",
    nome: "Thor",
    especie: "Canino",
    raca: "Golden Retriever",
    dataNascimento: "2021-03-14",
    tutorPreferencias: { tom: "caloroso" },
  };

  const senseUrgente = { zScore: 4.5, metricaMaisRelevante: "heartRate", classificacao: "anomalia_alta", baselineProvisorio: false, timestamp: "t" };
  const eventoUrgente = vitalisRules.priorizar(pet, senseUrgente);

  it("reprova (guardrail) mensagens que emitem diagnostico definitivo", () => {
    assert.strictEqual(vitalisVoice.passaGuardrail("O pet esta com a doenca cardiaca confirmada."), false);
  });

  it("aprova (guardrail) mensagens que apenas orientam avaliacao profissional", () => {
    assert.strictEqual(vitalisVoice.passaGuardrail("Recomendamos avaliacao veterinaria para investigar a alteracao observada."), true);
  });

  it("reprova (grounding) mensagem que cita numero que nao existe no evento", () => {
    const ok = vitalisVoice.passaGrounding("A frequencia cardiaca chegou a 999 bpm.", eventoUrgente);
    assert.strictEqual(ok, false);
  });

  it("aprova (grounding) mensagem que so cita numeros presentes no evento (score)", () => {
    const texto = `Prioridade calculada em ${eventoUrgente.scorePrioridade}.`;
    assert.strictEqual(vitalisVoice.passaGrounding(texto, eventoUrgente), true);
  });

  it("sem nenhuma chave de LLM configurada, gerarMensagens usa o fallback de seguranca e nunca deixa o tutor sem mensagem", async () => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const resultado = await vitalisVoice.gerarMensagens(pet, eventoUrgente);
    assert.strictEqual(resultado.origem, "fallback_template");
    assert.ok(resultado.mensagemTutor.length > 0);
    assert.ok(resultado.resumoClinica.length > 0);
  });

  it("mensagem de fallback para nivel urgente menciona o pet e recomenda contato com a clinica", async () => {
    const resultado = await vitalisVoice.gerarMensagens(pet, eventoUrgente);
    assert.ok(resultado.mensagemTutor.includes("Thor"));
    assert.ok(/CLYVO VET/i.test(resultado.mensagemTutor));
  });

  it("com GEMINI_API_KEY configurada, chama a API do Gemini e faz o parsing correto da resposta (fetch simulado)", async () => {
    // Este ambiente de execucao nao tem acesso de rede ao Gemini, entao simulamos
    // exatamente o formato de resposta real da API (generativelanguage.googleapis.com)
    // para provar que o parsing em src/vitalisVoice.js funciona de ponta a ponta.
    const fetchOriginal = global.fetch;
    process.env.GEMINI_API_KEY = "chave-de-teste-fake";

    let urlChamada = null;
    global.fetch = async (url, opts) => {
      urlChamada = url;
      const corpo = JSON.parse(opts.body);
      assert.ok(corpo.contents[0].parts[0].text.includes("Thor")); // prompt contem o contexto do pet
      return {
        ok: true,
        json: async () => ({
          candidates: [{
            content: {
              parts: [{
                text: JSON.stringify({
                  mensagemTutor: "Thor teve uma alteracao na frequencia cardiaca, recomendamos avaliacao veterinaria.",
                  resumoClinica: `Prioridade ${eventoUrgente.nivel}, score ${eventoUrgente.scorePrioridade}.`,
                }),
              }],
            },
          }],
        }),
      };
    };

    try {
      const resultado = await vitalisVoice.gerarMensagens(pet, eventoUrgente);
      assert.strictEqual(resultado.origem, "llm");
      assert.strictEqual(resultado.provedor, "gemini");
      assert.ok(urlChamada.includes("generativelanguage.googleapis.com"));
      assert.ok(urlChamada.includes(":generateContent"));
      assert.ok(resultado.mensagemTutor.includes("Thor"));
    } finally {
      global.fetch = fetchOriginal;
      delete process.env.GEMINI_API_KEY;
    }
  });

  it("se a API do Gemini responder mal-formada, cai no fallback em vez de quebrar", async () => {
    const fetchOriginal = global.fetch;
    process.env.GEMINI_API_KEY = "chave-de-teste-fake";
    global.fetch = async () => ({ ok: true, json: async () => ({ candidates: [] }) }); // sem texto valido

    try {
      const resultado = await vitalisVoice.gerarMensagens(pet, eventoUrgente);
      assert.strictEqual(resultado.origem, "fallback_template");
    } finally {
      global.fetch = fetchOriginal;
      delete process.env.GEMINI_API_KEY;
    }
  });
});

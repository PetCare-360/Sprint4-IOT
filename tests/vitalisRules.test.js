const { describe, it, assert } = require("./miniTest");
const vitalisRules = require("../src/vitalisRules");

describe("Vitalis Rules", () => {
  const petAltoRisco = {
    petId: "P1",
    nome: "Thor",
    raca: "Golden Retriever",
    dataNascimento: "2015-01-01", // pet senior -> soma fator de risco por idade
    predisposicaoRacial: ["cardiaca"],
    ultimaConsultaEm: "2025-01-01", // ha bastante tempo
    proximaVacinaEm: "2027-01-01",
    ultimaLimpezaDentariaEm: "2020-01-01",
    medicamentos: [{ nome: "X", dosesEsperadas30d: 30, dosesRegistradas30d: 10 }], // baixa adesao
  };

  const petBaixoRisco = {
    petId: "P2",
    nome: "Mia",
    raca: "SRD",
    dataNascimento: "2023-01-01",
    predisposicaoRacial: [],
    ultimaConsultaEm: new Date().toISOString(),
    proximaVacinaEm: "2028-01-01",
    ultimaLimpezaDentariaEm: new Date().toISOString(),
    medicamentos: [],
  };

  it("gera scorePrioridade alto e nivel urgente para pet de alto risco com anomalia forte", () => {
    const sense = { zScore: 5.0, metricaMaisRelevante: "heartRate", classificacao: "anomalia_alta", baselineProvisorio: false, timestamp: "t" };
    const evento = vitalisRules.priorizar(petAltoRisco, sense);
    assert.ok(evento.scorePrioridade >= 70, `esperava score >= 70, obteve ${evento.scorePrioridade}`);
    assert.strictEqual(evento.nivel, "urgente");
  });

  it("gera score baixo e nivel informativo para pet de baixo risco sem anomalia", () => {
    const sense = { zScore: 0.2, metricaMaisRelevante: "temperature", classificacao: "normal", baselineProvisorio: false, timestamp: "t" };
    const evento = vitalisRules.priorizar(petBaixoRisco, sense);
    assert.ok(evento.scorePrioridade < 40, `esperava score < 40, obteve ${evento.scorePrioridade}`);
    assert.strictEqual(evento.nivel, "informativo");
  });

  it("scorePrioridade de um pet de alto risco deve ser maior que o de baixo risco, mesmo com o mesmo zScore", () => {
    const sense = { zScore: 3.5, metricaMaisRelevante: "heartRate", classificacao: "anomalia_alta", baselineProvisorio: false, timestamp: "t" };
    const eventoAlto = vitalisRules.priorizar(petAltoRisco, sense);
    const eventoBaixo = vitalisRules.priorizar(petBaixoRisco, sense);
    assert.ok(eventoAlto.scorePrioridade > eventoBaixo.scorePrioridade);
  });

  it("recomenda limpeza dentaria quando ha mais de 365 dias sem registro", () => {
    const recs = vitalisRules.gerarRecomendacoes(petAltoRisco);
    assert.ok(recs.some((r) => r.tipo === "limpeza_dentaria"));
  });

  it("nao recomenda limpeza dentaria quando o registro e recente", () => {
    const recs = vitalisRules.gerarRecomendacoes(petBaixoRisco);
    assert.ok(!recs.some((r) => r.tipo === "limpeza_dentaria"));
  });

  it("calcula adesao ao tratamento corretamente", () => {
    const adesao = vitalisRules.calcularAdesaoTratamento(petAltoRisco);
    assert.strictEqual(adesao, Number((10 / 30).toFixed(2)));
  });
});

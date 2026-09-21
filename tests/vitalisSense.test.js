const { describe, it, assert } = require("./miniTest");
const vitalisSense = require("../src/vitalisSense");

describe("Vitalis Sense", () => {
  const petGrande = { petId: "P1", porte: "grande" };

  it("classifica leitura dentro do baseline como normal", () => {
    // pequena variacao natural no historico (evita desvio padrao ~0, que tornaria
    // qualquer minima oscilacao um "falso positivo" estatistico)
    const baseHr = [88, 90, 91, 89, 92, 90, 88, 91, 89, 90];
    const baseTemp = [38.4, 38.5, 38.6, 38.5, 38.4, 38.6, 38.5, 38.4, 38.5, 38.6];
    const baseAtv = [43, 45, 47, 44, 46, 45, 43, 46, 44, 45];
    const historico = baseHr.map((hr, i) => ({ temperature: baseTemp[i], heartRate: hr, activityLevel: baseAtv[i] }));
    const leituraAtual = { temperature: 38.5, heartRate: 91, activityLevel: 46, timestamp: "t" };
    const resultado = vitalisSense.analisar(petGrande, historico, leituraAtual);
    assert.strictEqual(resultado.classificacao, "normal");
    assert.strictEqual(resultado.baselineProvisorio, false);
  });

  it("detecta anomalia alta quando o valor foge muito do baseline (|z| > 3)", () => {
    const historico = Array.from({ length: 10 }, () => ({ temperature: 38.5, heartRate: 90, activityLevel: 45 }));
    const leituraAtual = { temperature: 38.5, heartRate: 160, activityLevel: 45, timestamp: "t" };
    const resultado = vitalisSense.analisar(petGrande, historico, leituraAtual);
    assert.strictEqual(resultado.classificacao, "anomalia_alta");
    assert.strictEqual(resultado.metricaMaisRelevante, "heartRate");
    assert.ok(Math.abs(resultado.zScore) > vitalisSense.LIMIAR_Z);
  });

  it("usa baseline populacional (cold start) quando ha menos de JANELA_MINIMA_AMOSTRAS leituras", () => {
    const historicoCurto = [{ temperature: 38.7, heartRate: 118, activityLevel: 70 }]; // so 1 leitura
    const leituraAtual = { temperature: 38.7, heartRate: 118, activityLevel: 70, timestamp: "t" };
    const resultado = vitalisSense.analisar(petGrande, historicoCurto, leituraAtual);
    assert.strictEqual(resultado.baselineProvisorio, true);
    assert.strictEqual(resultado.porMetrica.heartRate.origemBaseline, "populacional");
  });

  it("baseline individual passa a ser usado assim que ha amostras suficientes", () => {
    const historico = Array.from({ length: vitalisSense.JANELA_MINIMA_AMOSTRAS }, () => ({ temperature: 38.5, heartRate: 90, activityLevel: 45 }));
    const baseline = vitalisSense.calcularBaselineIndividual(historico, "heartRate");
    assert.ok(baseline !== null);
    assert.strictEqual(baseline.origem, "individual");
    assert.strictEqual(baseline.media, 90);
  });
});

const { describe, it, assert } = require("./miniTest");
const insightCache = require("../src/insightCache");

describe("Vitalis Insight Cache", () => {
  it("na primeira vez para um pet, sempre precisa chamar o LLM", () => {
    insightCache.limpar();
    assert.strictEqual(insightCache.precisaChamarLLM("PET_X", "informativo"), true);
  });

  it("apos chamar o LLM, um novo poll com o MESMO nivel e dentro do cooldown NAO chama o LLM de novo", () => {
    insightCache.limpar();
    const agora = 1_000_000;
    insightCache.salvar("PET_X", { leituraTimestamp: "t1", nivel: "informativo", insight: { mensagens: { mensagemTutor: "oi" } }, chamouLLM: true }, agora);

    const precisaLogoDepois = insightCache.precisaChamarLLM("PET_X", "informativo", agora + 5_000); // 5s depois
    assert.strictEqual(precisaLogoDepois, false);
  });

  it("se o nivel de prioridade mudou, chama o LLM de novo mesmo dentro do cooldown", () => {
    insightCache.limpar();
    const agora = 1_000_000;
    insightCache.salvar("PET_X", { leituraTimestamp: "t1", nivel: "informativo", insight: {}, chamouLLM: true }, agora);

    const precisaComNivelMaior = insightCache.precisaChamarLLM("PET_X", "urgente", agora + 1_000);
    assert.strictEqual(precisaComNivelMaior, true);
  });

  it("apos o cooldown expirar, chama o LLM de novo mesmo com o mesmo nivel", () => {
    insightCache.limpar();
    const agora = 1_000_000;
    insightCache.salvar("PET_X", { leituraTimestamp: "t1", nivel: "informativo", insight: {}, chamouLLM: true }, agora);

    const depoisDoCooldown = agora + insightCache.COOLDOWN_MS + 1;
    assert.strictEqual(insightCache.precisaChamarLLM("PET_X", "informativo", depoisDoCooldown), true);
  });

  it("cache de um pet nao interfere no cache de outro pet", () => {
    insightCache.limpar();
    const agora = 1_000_000;
    insightCache.salvar("PET_A", { leituraTimestamp: "t1", nivel: "urgente", insight: {}, chamouLLM: true }, agora);
    assert.strictEqual(insightCache.precisaChamarLLM("PET_B", "urgente", agora + 1), true);
  });
});

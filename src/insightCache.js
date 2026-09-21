// Evita dois desperdicios de chamadas ao LLM:
//
// 1) O dashboard faz polling (GET /api/pets/:id/insight) a cada poucos segundos.
//    Sem cache, cada poll recalculava TUDO de novo, inclusive chamando o Gemini,
//    mesmo quando a leitura da coleira nao mudou nem um pouco desde o ultimo poll.
//    Isso e o que causou os 503 "high demand" reportados: dezenas de chamadas ao
//    Gemini por minuto, para o mesmo dado, sem necessidade nenhuma.
//
// 2) Mesmo quando chega uma leitura genuinamente nova (coleira real, a cada
//    poucos segundos), gerar uma mensagem nova toda vez que o nivel de prioridade
//    NAO mudou e desperdicio: o tutor nao precisa de uma mensagem reescrita a cada
//    5 segundos dizendo a mesma coisa. Por isso existe um cooldown por pet.
//
// Cache em memoria (Map), por processo — reinicia quando o servidor reinicia.
// Isso e proposital e documentado: nao e um cache persistente, e um cache de
// "nao repita trabalho caro (chamada de LLM) sem necessidade dentro da mesma
// sessao do servidor".

const cache = new Map(); // petId -> { leituraTimestamp, nivel, insight, ultimaChamadaLLM }

const COOLDOWN_MS = Number(process.env.VITALIS_VOICE_COOLDOWN_MS) || 60_000; // 1 min por padrao

function obter(petId) {
  return cache.get(petId) || null;
}

/**
 * Decide se vale a pena chamar o LLM de novo para este pet: sim se e a primeira
 * vez, se o nivel de prioridade mudou desde a ultima mensagem gerada, ou se ja
 * passou o tempo de cooldown desde a ultima chamada real ao LLM.
 */
function precisaChamarLLM(petId, nivelAtual, agora = Date.now()) {
  const entrada = cache.get(petId);
  if (!entrada) return true;
  if (entrada.nivel !== nivelAtual) return true;
  return agora - entrada.ultimaChamadaLLM >= COOLDOWN_MS;
}

function salvar(petId, { leituraTimestamp, nivel, insight, chamouLLM }, agora = Date.now()) {
  const anterior = cache.get(petId);
  cache.set(petId, {
    leituraTimestamp,
    nivel,
    insight,
    ultimaChamadaLLM: chamouLLM ? agora : anterior?.ultimaChamadaLLM || 0,
  });
}

function limpar() {
  cache.clear();
}

module.exports = { obter, precisaChamarLLM, salvar, limpar, COOLDOWN_MS };

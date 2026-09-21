// Vitalis Sense — Camada Preditiva (Sprint3 README, secao 7.2)
// Detecta anomalias por metrica (temperature, heartRate, activityLevel) usando
// baseline individual do pet (media movel + desvio padrao numa janela deslizante).
// Explicavel e leve, conforme justificado na secao 7.2.1: nao depende de LSTM/Isolation
// Forest, que exigiriam historico grande que ainda nao existe no dia 1 do produto.

const JANELA_MINIMA_AMOSTRAS = 7; // "janela minima configuravel, ex.: 7-14 dias" (secao 7.2.1)
const JANELA_MAXIMA_AMOSTRAS = 100; // janela deslizante: nao deixa o baseline ficar estatico
const LIMIAR_Z = 3; // "valores acima de um limiar configuravel (ex.: |z| > 3)" (secao 7.2)

// Baseline populacional por porte, usado no "cold start" (secao 7.2.1) enquanto o pet
// novo ainda nao tem amostras suficientes para um baseline individual confiavel.
const BASELINE_POPULACIONAL = {
  pequeno: { temperature: { media: 38.9, desvioPadrao: 0.4 }, heartRate: { media: 125, desvioPadrao: 15 }, activityLevel: { media: 50, desvioPadrao: 20 } },
  medio: { temperature: { media: 38.6, desvioPadrao: 0.4 }, heartRate: { media: 105, desvioPadrao: 15 }, activityLevel: { media: 50, desvioPadrao: 20 } },
  grande: { temperature: { media: 38.4, desvioPadrao: 0.4 }, heartRate: { media: 85, desvioPadrao: 12 }, activityLevel: { media: 50, desvioPadrao: 20 } },
};

const METRICAS = ["temperature", "heartRate", "activityLevel"];

function media(valores) {
  return valores.reduce((a, b) => a + b, 0) / valores.length;
}

function desvioPadrao(valores, m) {
  if (valores.length < 2) return 0;
  const variancia = valores.reduce((acc, v) => acc + Math.pow(v - m, 2), 0) / (valores.length - 1);
  return Math.sqrt(variancia);
}

/**
 * Calcula o baseline individual do pet para uma metrica, a partir do historico de
 * leituras (janela deslizante). Retorna null se nao houver amostras suficientes.
 */
function calcularBaselineIndividual(leituras, metrica) {
  const janela = leituras.slice(-JANELA_MAXIMA_AMOSTRAS).map((l) => l[metrica]).filter((v) => typeof v === "number");
  if (janela.length < JANELA_MINIMA_AMOSTRAS) return null;
  const m = media(janela);
  const dp = desvioPadrao(janela, m);
  return { media: m, desvioPadrao: dp, amostras: janela.length, origem: "individual" };
}

/**
 * Retorna o baseline aplicavel (individual se houver amostras suficientes, senao
 * populacional por porte) — implementa o "cold start" da secao 7.2.1.
 */
function obterBaseline(pet, leituras, metrica) {
  const individual = calcularBaselineIndividual(leituras, metrica);
  if (individual) return individual;
  const pop = BASELINE_POPULACIONAL[pet.porte] || BASELINE_POPULACIONAL.medio;
  return { ...pop[metrica], amostras: leituras.length, origem: "populacional" };
}

function classificarZScore(z) {
  const abs = Math.abs(z);
  if (abs > LIMIAR_Z) return "anomalia_alta";
  if (abs > LIMIAR_Z * 0.66) return "atencao";
  return "normal";
}

/**
 * Analisa a leitura mais recente do pet contra o baseline (individual ou populacional)
 * para cada metrica monitorada, e retorna o resultado do Vitalis Sense.
 *
 * @param {object} pet - perfil do pet (para porte/cold start)
 * @param {object[]} historico - leituras anteriores (sem incluir a leitura atual)
 * @param {object} leituraAtual - leitura mais recente da coleira
 */
function analisar(pet, historico, leituraAtual) {
  const porMetrica = {};
  let piorMetrica = null;
  let piorZ = 0;
  let baselineProvisorio = false;

  for (const metrica of METRICAS) {
    const baseline = obterBaseline(pet, historico, metrica);
    if (baseline.origem === "populacional") baselineProvisorio = true;

    const valorObservado = leituraAtual[metrica];
    const dp = baseline.desvioPadrao || 0.0001; // evita divisao por zero em series constantes
    const zScore = (valorObservado - baseline.media) / dp;
    const classificacao = classificarZScore(zScore);

    porMetrica[metrica] = {
      valorObservado,
      baselinePersonalizado: Number(baseline.media.toFixed(2)),
      desvioPadrao: Number(dp.toFixed(2)),
      zScore: Number(zScore.toFixed(2)),
      classificacao,
      origemBaseline: baseline.origem,
    };

    if (Math.abs(zScore) > Math.abs(piorZ)) {
      piorZ = zScore;
      piorMetrica = metrica;
    }
  }

  const classificacaoGeral = classificarZScore(piorZ);

  return {
    petId: pet.petId,
    timestamp: leituraAtual.timestamp || new Date().toISOString(),
    metricaMaisRelevante: piorMetrica,
    zScore: Number(piorZ.toFixed(2)),
    classificacao: classificacaoGeral,
    baselineProvisorio, // sinaliza time clinico, secao 7.2.1
    porMetrica,
  };
}

module.exports = {
  analisar,
  calcularBaselineIndividual,
  obterBaseline,
  JANELA_MINIMA_AMOSTRAS,
  LIMIAR_Z,
  BASELINE_POPULACIONAL,
};

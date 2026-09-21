// Vitalis Rules — Motor de Regras / Priorizacao (Sprint3 README, secao 7.3)
// Formula: scorePrioridade = 0.50*zScoreNormalizado + 0.20*fatorRiscoRacaIdade
//                           + 0.15*diasDesdeUltimaConsultaNormalizado + 0.15*(1-adesaoTratamento)
// Deterministico e auditavel de proposito (ver justificativa na secao 7.3): decisoes que
// geram alerta de urgencia nao podem depender de um LLM "caixa-preta".

const PESOS = {
  zScore: 0.5,
  riscoRacaIdade: 0.2,
  diasUltimaConsulta: 0.15,
  adesao: 0.15,
};

const IDADE_RISCO_ANOS = 7; // a partir daqui, fator de risco por idade sobe (pet senior)

function diasEntre(dataIso, agora = new Date()) {
  if (!dataIso) return 365; // sem registro = trata como "ha muito tempo", nao subestima risco
  const data = new Date(dataIso);
  return Math.max(0, Math.round((agora - data) / (1000 * 60 * 60 * 24)));
}

function idadeAnos(dataNascimentoIso, agora = new Date()) {
  const nascimento = new Date(dataNascimentoIso);
  return (agora - nascimento) / (1000 * 60 * 60 * 24 * 365.25);
}

/**
 * fatorRiscoRacaIdade (0-1): combina predisposicao racial relevante para a metrica
 * afetada + idade do pet (pets seniores tem risco basal mais alto).
 */
function calcularFatorRiscoRacaIdade(pet, metricaMaisRelevante) {
  let risco = 0;

  const predisposicoes = pet.predisposicaoRacial || [];
  if (metricaMaisRelevante === "heartRate" && predisposicoes.includes("cardiaca")) risco += 0.6;
  if (metricaMaisRelevante === "temperature" && predisposicoes.length > 0) risco += 0.2;
  if (predisposicoes.length > 0) risco += 0.1; // raca com alguma predisposicao conhecida, risco basal maior

  const idade = idadeAnos(pet.dataNascimento);
  if (idade >= IDADE_RISCO_ANOS) risco += 0.3;
  else if (idade < 0.5) risco += 0.1; // filhotes tambem sao mais frageis / cold start

  return Math.min(1, Number(risco.toFixed(2)));
}

function calcularAdesaoTratamento(pet) {
  const meds = pet.medicamentos || [];
  if (meds.length === 0) return 1; // sem tratamento ativo = nao penaliza adesao
  const taxas = meds.map((m) => (m.dosesEsperadas30d ? m.dosesRegistradas30d / m.dosesEsperadas30d : 1));
  const media = taxas.reduce((a, b) => a + b, 0) / taxas.length;
  return Math.max(0, Math.min(1, Number(media.toFixed(2))));
}

function normalizarZScore(zScore) {
  // satura em |z| = 6 -> 1.0 (evita que um outlier extremo "quebre" a escala 0-100)
  return Math.min(1, Math.abs(zScore) / 6);
}

function classificarNivel(score) {
  if (score >= 70) return "urgente";
  if (score >= 40) return "atencao";
  return "informativo";
}

/**
 * Gera recomendacoes proativas de servico (secao 3.3) cruzando dados estruturados
 * do pet (vacina, limpeza dentaria) com o evento detectado.
 */
function gerarRecomendacoes(pet) {
  const recomendacoes = [];
  const diasProxVacina = pet.proximaVacinaEm ? Math.round((new Date(pet.proximaVacinaEm) - new Date()) / (1000 * 60 * 60 * 24)) : null;
  if (diasProxVacina !== null && diasProxVacina <= 14) {
    recomendacoes.push({
      tipo: "vacina",
      mensagem: diasProxVacina < 0
        ? `Vacina de ${pet.nome} esta atrasada ha ${Math.abs(diasProxVacina)} dia(s).`
        : `Vacina de ${pet.nome} vence em ${diasProxVacina} dia(s).`,
    });
  }

  const diasLimpeza = diasEntre(pet.ultimaLimpezaDentariaEm);
  if (diasLimpeza >= 365 && (pet.predisposicaoRacial || []).length >= 0) {
    recomendacoes.push({
      tipo: "limpeza_dentaria",
      mensagem: `${pet.nome} esta ha ${diasLimpeza} dias sem limpeza dentaria, sugerir agendamento.`,
    });
  }

  const adesao = calcularAdesaoTratamento(pet);
  if (adesao < 0.8 && (pet.medicamentos || []).length > 0) {
    recomendacoes.push({
      tipo: "adesao_tratamento",
      mensagem: `Adesao ao tratamento de ${pet.nome} esta em ${Math.round(adesao * 100)}%, considerar contato proativo.`,
    });
  }

  return recomendacoes;
}

/**
 * Recebe o resultado do Vitalis Sense + o perfil do pet e calcula o evento priorizado
 * (scorePrioridade, nivel, fatores considerados, recomendacoes).
 */
function priorizar(pet, resultadoSense) {
  const zScoreNormalizado = normalizarZScore(resultadoSense.zScore);
  const fatorRiscoRacaIdade = calcularFatorRiscoRacaIdade(pet, resultadoSense.metricaMaisRelevante);
  const dias = diasEntre(pet.ultimaConsultaEm);
  const diasDesdeUltimaConsultaNormalizado = Math.min(1, dias / 365);
  const adesaoTratamento = calcularAdesaoTratamento(pet);

  const scorePrioridade = Math.round(
    100 * (
      PESOS.zScore * zScoreNormalizado +
      PESOS.riscoRacaIdade * fatorRiscoRacaIdade +
      PESOS.diasUltimaConsulta * diasDesdeUltimaConsultaNormalizado +
      PESOS.adesao * (1 - adesaoTratamento)
    )
  );

  const nivel = classificarNivel(scorePrioridade);
  const recomendacoes = gerarRecomendacoes(pet);

  const fatoresConsiderados = [
    `zScore ${resultadoSense.zScore} em ${resultadoSense.metricaMaisRelevante} (${resultadoSense.classificacao})`,
    fatorRiscoRacaIdade > 0 ? `fator de risco raca/idade ${fatorRiscoRacaIdade}` : "sem fator de risco raca/idade relevante",
    `ultima consulta ha ${dias} dias`,
    adesaoTratamento < 1 ? `adesao ao tratamento ${Math.round(adesaoTratamento * 100)}%` : "sem tratamento ativo em curso",
  ];

  return {
    eventoId: `EVT_${Date.now()}_${pet.petId}`,
    petId: pet.petId,
    timestamp: resultadoSense.timestamp,
    origem: `anomalia_${resultadoSense.metricaMaisRelevante}`,
    scorePrioridade,
    nivel,
    fatoresConsiderados,
    recomendacoes,
    baselineProvisorio: resultadoSense.baselineProvisorio,
    detalheSense: resultadoSense,
  };
}

module.exports = {
  priorizar,
  calcularFatorRiscoRacaIdade,
  calcularAdesaoTratamento,
  gerarRecomendacoes,
  normalizarZScore,
  classificarNivel,
  PESOS,
};

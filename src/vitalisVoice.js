// Vitalis Voice — IA Generativa / LLM (Sprint3 README, secao 7.4)
// Recebe o evento priorizado (Vitalis Rules) + contexto do pet e gera:
//  (a) mensagem curta e empatica para o tutor
//  (b) resumo tecnico objetivo para a equipe clinica
//
// Implementa o "Plano de validacao do LLM" da secao 7.4.1:
//  - guardrail: nunca emite diagnostico definitivo (checagem de termos proibidos)
//  - grounding: valores numericos citados devem existir no evento_json de entrada
//  - fallback de seguranca: se a geracao falhar ou for reprovada na validacao,
//    usa mensagem-template determinística baseada so no `nivel` (sem depender do LLM)
//
// Suporta dois provedores de LLM, escolhidos automaticamente pela variavel de
// ambiente presente (nao e preciso mudar codigo para trocar de provedor):
//   - GEMINI_API_KEY    -> Google Gemini (generativelanguage.googleapis.com)   [padrao]
// Se nenhuma estiver configurada, ou se a chamada falhar, usa o gerador de template
// como fallback de seguranca. Isso torna o projeto executavel para demo/avaliacao
// sem exigir credencial nenhuma, e facil de trocar de provedor so mudando o .env.

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001";

const TERMOS_PROIBIDOS = [
  /diagn[oó]stic/i,
  /est[aá] com (a )?(doen[cç]a|c[aâ]ncer|tumor|insufici[eê]ncia)/i,
  /\bcura\b/i,
  /\bconfirmad[oa]\b/i,
];

function passaGuardrail(texto) {
  return !TERMOS_PROIBIDOS.some((re) => re.test(texto));
}

/**
 * Checagem de grounding simplificada: todo numero com 2+ digitos citado na mensagem
 * deve aparecer em algum lugar do evento estruturado de entrada (nao pode ser um
 * valor "inventado" pelo modelo).
 */
function passaGrounding(texto, evento) {
  const numerosNoTexto = (texto.match(/\d{2,}/g) || []).map(Number);
  if (numerosNoTexto.length === 0) return true;
  const numerosNoEvento = new Set(
    JSON.stringify(evento).match(/\d{2,}/g)?.map(Number) || []
  );
  return numerosNoTexto.every((n) => numerosNoEvento.has(n));
}

function construirPromptSistema(pet, evento, historicoResumido) {
  return `Voce e o Vitalis, assistente de IA da CLYVO VET.

Contexto do pet: ${JSON.stringify({ nome: pet.nome, especie: pet.especie, raca: pet.raca, idade: idadeTexto(pet) })}
Evento detectado: ${JSON.stringify(evento.detalheSense)}
Prioridade calculada: ${evento.nivel} (score ${evento.scorePrioridade})
Historico resumido: ${historicoResumido}

Gere APENAS um JSON no formato {"mensagemTutor": "...", "resumoClinica": "..."}.
1. mensagemTutor: curta e empatica (max 3 frases), linguagem simples, tom "${pet.tutorPreferencias?.tom || "neutro"}",
   explicando o que foi observado e a acao recomendada.
2. resumoClinica: objetivo (max 4 frases), com prioridade e justificativa tecnica.

Regras obrigatorias:
- Nunca forneca diagnostico definitivo, apenas observacoes e recomendacao de avaliacao profissional quando aplicavel.
- Baseie-se exclusivamente nos dados fornecidos, sem inventar numeros ou fatos.
- Responda apenas com o JSON, sem markdown, sem texto adicional.`;
}

function idadeTexto(pet) {
  const anos = (new Date() - new Date(pet.dataNascimento)) / (1000 * 60 * 60 * 24 * 365.25);
  return `${anos.toFixed(1)} anos`;
}

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function chamarGemini(promptSistema, tentativa = 1) {
  const apiKey = (process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) return null;
  try {
    // Usamos a chave como query param (?key=...), que e a forma mais compativel
    // documentada pela Google — o header alternativo (x-goog-api-key) as vezes
    // retorna 401 ACCESS_TOKEN_TYPE_UNSUPPORTED dependendo do tipo/restricao da chave.
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: promptSistema }] }],
        // Pede ao Gemini para responder ja em JSON estruturado, sem precisar
        // "adivinhar" e limpar cercas de markdown na resposta.
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.4,
        },
      }),
    });
    if (!resp.ok) {
      // 503 "high demand" e explicitamente documentado pela Google como transitorio
      // (ver mensagem da propria API) — vale uma tentativa extra com um pequeno
      // atraso antes de desistir e cair no fallback.
      if (resp.status === 503 && tentativa < 2) {
        await esperar(800 + Math.random() * 400);
        return chamarGemini(promptSistema, tentativa + 1);
      }
      console.error(`Gemini respondeu com erro (tentativa ${tentativa}/2):`, resp.status, await resp.text());
      return null;
    }
    const data = await resp.json();
    const texto = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
    const parsed = JSON.parse(texto.trim());
    if (!parsed.mensagemTutor || !parsed.resumoClinica) return null;
    return { ...parsed, provedor: "gemini", modelo: GEMINI_MODEL };
  } catch (err) {
    console.error("Falha ao chamar Gemini:", err.message);
    return null; // qualquer falha cai no fallback de seguranca (secao 7.4.1)
  }
}

async function chamarAnthropic(promptSistema) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 400,
        messages: [{ role: "user", content: promptSistema }],
      }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const texto = (data.content || []).map((b) => b.text || "").join("");
    const limpo = texto.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(limpo);
    if (!parsed.mensagemTutor || !parsed.resumoClinica) return null;
    return { ...parsed, provedor: "anthropic", modelo: ANTHROPIC_MODEL };
  } catch (err) {
    return null; // qualquer falha cai no fallback de seguranca (secao 7.4.1)
  }
}

// Chama o provedor de LLM configurado. Gemini tem prioridade se GEMINI_API_KEY estiver definida (foi o provedor escolhido para este projeto)

async function chamarLLM(promptSistema) {
  if (process.env.GEMINI_API_KEY) return chamarGemini(promptSistema);
  if (process.env.ANTHROPIC_API_KEY) return chamarAnthropic(promptSistema);
  return null;
}

// Fallback de seguranca: mensagem-template sem depender do LLM
const TEMPLATES_TUTOR = {
  urgente: (pet, evento) =>
    `Oi! Notamos uma alteracao importante em ${evento.detalheSense.metricaMaisRelevante === "heartRate" ? "frequencia cardiaca" : evento.detalheSense.metricaMaisRelevante === "temperature" ? "temperatura" : "nivel de atividade"} de ${pet.nome}. Recomendamos contato com a CLYVO VET o quanto antes para avaliacao.`,
  atencao: (pet, evento) =>
    `Oi! Percebemos uma mudanca em ${pet.nome} que vale observar nas proximas horas. Se persistir, recomendamos agendar uma avaliacao com a CLYVO VET.`,
  informativo: (pet) =>
    `Tudo certo por aqui! Os sinais vitais de ${pet.nome} estao dentro do esperado.`,
};

const TEMPLATES_CLINICA = {
  urgente: (pet, evento) =>
    `${pet.nome} (${pet.raca}, ${idadeTexto(pet)}) apresentou zScore ${evento.detalheSense.zScore} em ${evento.detalheSense.metricaMaisRelevante}. Prioridade: urgente (score ${evento.scorePrioridade}). Fatores: ${evento.fatoresConsiderados.join("; ")}.`,
  atencao: (pet, evento) =>
    `${pet.nome} (${pet.raca}) com desvio moderado em ${evento.detalheSense.metricaMaisRelevante} (zScore ${evento.detalheSense.zScore}). Prioridade: atencao (score ${evento.scorePrioridade}). Sugerido monitoramento proximo.`,
  informativo: (pet, evento) =>
    `${pet.nome} sem anomalias relevantes no momento (score ${evento.scorePrioridade}).`,
};

function gerarTemplateFallback(pet, evento) {
  return {
    mensagemTutor: TEMPLATES_TUTOR[evento.nivel](pet, evento),
    resumoClinica: TEMPLATES_CLINICA[evento.nivel](pet, evento),
    origem: "fallback_template",
  };
}

/**
 * Gera as mensagens finais (tutor + clinica) para um evento priorizado, aplicando
 * o plano de validacao (guardrail + grounding) antes de aceitar a saida do LLM.
 */
async function gerarMensagens(pet, evento, historicoResumido = "sem observacoes adicionais do tutor") {
  const promptSistema = construirPromptSistema(pet, evento, historicoResumido);
  const respostaLLM = await chamarLLM(promptSistema);

  if (respostaLLM) {
    const textoCompleto = `${respostaLLM.mensagemTutor} ${respostaLLM.resumoClinica}`;
    const guardrailOk = passaGuardrail(textoCompleto);
    const groundingOk = passaGrounding(textoCompleto, evento);
    if (guardrailOk && groundingOk) {
      return { ...respostaLLM, origem: "llm", guardrailOk, groundingOk };
    }
    // reprovado na validacao -> fallback de seguranca (nunca deixa o tutor sem mensagem)
    return { ...gerarTemplateFallback(pet, evento), guardrailOk, groundingOk, motivoFallback: "reprovado_validacao" };
  }

  const algumaChaveConfigurada = process.env.GEMINI_API_KEY || process.env.ANTHROPIC_API_KEY;
  return { ...gerarTemplateFallback(pet, evento), motivoFallback: algumaChaveConfigurada ? "erro_llm" : "sem_api_key" };
}

module.exports = {
  gerarMensagens,
  passaGuardrail,
  passaGrounding,
  gerarTemplateFallback,
  construirPromptSistema,
  TERMOS_PROIBIDOS,
};

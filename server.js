// PetCare 360 (CLYVO VET) — Backend + Camada de IA Vitalis Core
// Estende o backend da Sprint 1 (antes json-server) com os modulos de IA definidos
// na Sprint 3: Vitalis Sense (deteccao de anomalias), Vitalis Rules (priorizacao) e
// Vitalis Voice (geracao de linguagem natural). Zero dependencias externas (usa so
// o modulo http nativo do Node), para rodar com `node server.js` sem `npm install`.

const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const store = require("./src/store");
const vitalisSense = require("./src/vitalisSense");
const vitalisRules = require("./src/vitalisRules");
const vitalisVoice = require("./src/vitalisVoice");
const insightCache = require("./src/insightCache");

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

/**
 * Roda o pipeline completo Vitalis Core (Sense -> Rules -> Voice) para um pet,
 * usando a leitura mais recente contra o historico anterior.
 *
 * Duas otimizacoes importantes (ver src/insightCache.js para o racional completo):
 *  1. Se a leitura mais recente e a mesma que a ultima vez que este pet foi
 *     processado, devolve o insight ja calculado sem refazer nada — evita que o
 *     polling do dashboard (a cada poucos segundos) recalcule tudo, inclusive
 *     chamando o LLM, para o mesmo dado repetidas vezes.
 *  2. Mesmo com leitura nova, so chama o LLM de novo (Vitalis Voice) se o nivel
 *     de prioridade mudou ou se ja passou o periodo de cooldown — evita gerar
 *     uma mensagem nova a cada poucos segundos dizendo essencialmente a mesma coisa.
 */
async function gerarInsight(petId) {
  const pet = store.getPet(petId);
  if (!pet) return null;

  const leituras = store.getLeituras(petId);
  if (leituras.length === 0) return null;

  const leituraAtual = leituras[leituras.length - 1];

  const cacheEntry = insightCache.obter(petId);
  if (cacheEntry && cacheEntry.leituraTimestamp === leituraAtual.timestamp) {
    return cacheEntry.insight; // nada mudou desde a ultima vez: nao recalcula, nao chama LLM
  }

  const historico = leituras.slice(0, -1);
  const resultadoSense = vitalisSense.analisar(pet, historico, leituraAtual);
  const eventoPriorizado = vitalisRules.priorizar(pet, resultadoSense);

  const chamarLLMAgora = insightCache.precisaChamarLLM(petId, eventoPriorizado.nivel);
  const mensagens = chamarLLMAgora
    ? await vitalisVoice.gerarMensagens(pet, eventoPriorizado)
    : { ...cacheEntry.insight.mensagens, reaproveitada: true };

  const insight = { ...eventoPriorizado, mensagens };
  store.addEvento(insight);
  insightCache.salvar(petId, {
    leituraTimestamp: leituraAtual.timestamp,
    nivel: eventoPriorizado.nivel,
    insight,
    chamouLLM: chamarLLMAgora,
  });

  return insight;
}

const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json" };

function servirEstatico(req, res, urlPath) {
  let filePath = urlPath === "/" ? "/index.html" : urlPath;
  filePath = path.join(PUBLIC_DIR, filePath);
  if (!filePath.startsWith(PUBLIC_DIR)) return sendJson(res, 403, { erro: "Acesso negado" });

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      return res.end("Nao encontrado");
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = url;

  if (req.method === "OPTIONS") {
    return sendJson(res, 204, {});
  }

  try {
    // Compatibilidade com a Sprint 1 (ESP32 + dashboard antigo)
    if (pathname === "/data" && req.method === "PUT") {
      const body = await readBody(req);
      const pet = body.petId ? store.getPet(body.petId) : store.getPetByColeira(body.deviceId);
      const petId = pet ? pet.petId : "PET_00123"; // fallback demo se a coleira nao mapear nenhum pet

      const leitura = {
        timestamp: new Date().toISOString(),
        temperature: Number(body.temperature),
        heartRate: Number(body.heartRate),
        activityLevel: Number(body.activityLevel),
        battery: Number(body.battery),
      };
      store.addLeitura(petId, leitura);
      const insight = await gerarInsight(petId);
      return sendJson(res, 200, { ok: true, petId, insight });
    }

    if (pathname === "/data" && req.method === "GET") {
      return sendJson(res, 200, { data: store.getLegacyData() });
    }

    // API de pets / leituras
    if (pathname === "/api/pets" && req.method === "GET") {
      return sendJson(res, 200, store.getPets());
    }

    const matchPet = pathname.match(/^\/api\/pets\/([^/]+)$/);
    if (matchPet && req.method === "GET") {
      const pet = store.getPet(matchPet[1]);
      if (!pet) return sendJson(res, 404, { erro: "Pet nao encontrado" });
      return sendJson(res, 200, pet);
    }

    const matchLeituras = pathname.match(/^\/api\/pets\/([^/]+)\/leituras$/);
    if (matchLeituras && req.method === "GET") {
      const n = Number(url.searchParams.get("n")) || undefined;
      return sendJson(res, 200, store.getLeituras(matchLeituras[1], n));
    }

    // IA: insight sob demanda para um pet
    const matchInsight = pathname.match(/^\/api\/pets\/([^/]+)\/insight$/);
    if (matchInsight && req.method === "GET") {
      const insight = await gerarInsight(matchInsight[1]);
      if (!insight) return sendJson(res, 404, { erro: "Pet ou leituras nao encontrados" });
      return sendJson(res, 200, insight);
    }

    // IA: fila de priorizacao da clinica (todos os pets)
    if (pathname === "/api/queue" && req.method === "GET") {
      const pets = store.getPets();
      const insights = [];
      for (const pet of pets) {
        const insight = await gerarInsight(pet.petId);
        if (insight) insights.push({ ...insight, petNome: pet.nome, tutorNome: pet.tutorNome });
      }
      insights.sort((a, b) => b.scorePrioridade - a.scorePrioridade);
      return sendJson(res, 200, insights);
    }

    // Simulacao (para demo sem hardware fisico)
    if (pathname === "/api/simular" && req.method === "POST") {
      const body = await readBody(req);
      const petId = body.petId || "PET_00123";
      const pet = store.getPet(petId);
      if (!pet) return sendJson(res, 404, { erro: "Pet nao encontrado" });

      const ultimaLeitura = store.getLeituras(petId).slice(-1)[0] || {};
      const leitura = {
        timestamp: new Date().toISOString(),
        temperature: body.temperature ?? ultimaLeitura.temperature ?? 38.5,
        heartRate: body.heartRate ?? ultimaLeitura.heartRate ?? 95,
        activityLevel: body.activityLevel ?? ultimaLeitura.activityLevel ?? 45,
        battery: body.battery ?? ultimaLeitura.battery ?? 90,
      };
      store.addLeitura(petId, leitura);
      const insight = await gerarInsight(petId);
      return sendJson(res, 200, insight);
    }

    // Feedback (fecha o loop, secao 5 item 7 do README Sprint3)
    if (pathname === "/api/feedback" && req.method === "POST") {
      const body = await readBody(req);
      if (!body.petId || !body.acao) return sendJson(res, 400, { erro: "petId e acao sao obrigatorios" });
      const registro = store.addFeedback(body);
      return sendJson(res, 201, registro);
    }

    if (pathname === "/api/health" && req.method === "GET") {
      return sendJson(res, 200, { status: "ok", servico: "PetCare 360 - Vitalis Core" });
    }

    // Arquivos estaticos (dashboard)
    return servirEstatico(req, res, pathname);
  } catch (err) {
    console.error(err);
    return sendJson(res, 500, { erro: "Erro interno", detalhe: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`PetCare 360 (Vitalis Core) rodando em http://localhost:${PORT}`);
  console.log(`Dashboard: http://localhost:${PORT}/`);
  console.log(`Fila da clinica: http://localhost:${PORT}/api/queue`);
});

module.exports = server;

// src/store.js
// Camada de dados simples baseada em arquivo (evolução do db.json da Sprint 1).
// Mantém em memória + persiste em disco a cada escrita, sem dependências externas.

const fs = require("fs");
const path = require("path");

const DB_PATH = path.join(__dirname, "..", "db.json");

function loadDb() {
  const raw = fs.readFileSync(DB_PATH, "utf-8");
  return JSON.parse(raw);
}

function saveDb(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf-8");
}

let db = loadDb();

function reload() {
  db = loadDb();
  return db;
}

// Pets
function getPets() {
  return db.pets;
}

function getPet(petId) {
  return db.pets.find((p) => p.petId === petId) || null;
}

function getPetByColeira(coleiraId) {
  return db.pets.find((p) => p.coleiraId === coleiraId) || null;
}

// Leituras (série temporal)
const MAX_LEITURAS_POR_PET = 500;

function getLeituras(petId, ultimasN = null) {
  const lista = db.leituras[petId] || [];
  if (ultimasN) return lista.slice(-ultimasN);
  return lista;
}

function addLeitura(petId, leitura) {
  if (!db.leituras[petId]) db.leituras[petId] = [];
  db.leituras[petId].push(leitura);
  if (db.leituras[petId].length > MAX_LEITURAS_POR_PET) {
    db.leituras[petId] = db.leituras[petId].slice(-MAX_LEITURAS_POR_PET);
  }
  // Mantém compatibilidade com o endpoint legado GET/PUT /data (Sprint 1)
  db.data = {
    deviceId: getPet(petId)?.coleiraId || db.data.deviceId,
    petId,
    ...leitura,
  };
  saveDb(db);
  return leitura;
}

// Eventos (histórico de anomalias/priorização gerados pela IA) 
function addEvento(evento) {
  db.eventos.push(evento);
  saveDb(db);
  return evento;
}

function getEventos(petId = null) {
  if (petId) return db.eventos.filter((e) => e.petId === petId);
  return db.eventos;
}

// Feedback (fecha o loop tutor/clínica -> banco)
function addFeedback(feedback) {
  db.feedback.push({ ...feedback, registradoEm: new Date().toISOString() });
  saveDb(db);
  return feedback;
}

function getLegacyData() {
  return db.data;
}

module.exports = {
  reload,
  getPets,
  getPet,
  getPetByColeira,
  getLeituras,
  addLeitura,
  addEvento,
  getEventos,
  addFeedback,
  getLegacyData,
};

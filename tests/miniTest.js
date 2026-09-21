// Mini framework de testes, zero dependencias, com suporte a async.
const assert = require("assert");

const fila = []; // [{ grupo, nome, fn }]
let grupoAtual = null;

function describe(nome, fn) {
  grupoAtual = nome;
  fn(); // apenas registra os testes (nao executa ainda)
  grupoAtual = null;
}

function it(nome, fn) {
  fila.push({ grupo: grupoAtual, nome, fn });
}

async function resumo() {
  let total = 0;
  let falhas = 0;
  let grupoImpresso = null;

  for (const teste of fila) {
    if (teste.grupo !== grupoImpresso) {
      console.log(`\n${teste.grupo}`);
      grupoImpresso = teste.grupo;
    }
    total++;
    try {
      await teste.fn();
      console.log(`  \u2713 ${teste.nome}`);
    } catch (err) {
      falhas++;
      console.log(`  \u2717 ${teste.nome}`);
      console.log(`    ${err.message}`);
    }
  }

  console.log(`\n${total - falhas}/${total} testes passaram.`);
  if (falhas > 0) process.exitCode = 1;
}

module.exports = { describe, it, assert, resumo };

# PetCare 360 — Vitalis Core (Implementação da IA)
### Sprint 4 | Disruptive Architectures: IoT, IoB & Generative AI
Cliente: **CLYVO VET**

> Este repositório é a **implementação funcional** da IA especificada na
> [Sprint 3 (documentação/arquitetura)](https://github.com/PetCare-360/Sprint3-IOT), integrada
> à aplicação construída na [Sprint 1 (IoT)](https://github.com/PetCare-360/Sprint1-IOT).
> Aqui o **Vitalis Core** (Sense + Rules + Voice) deixa de ser um diagrama e passa a ser
> código executável, testado e integrado ao backend e ao dashboard.

## Mapeamento com os critérios de avaliação

| Critério do enunciado | Onde está |
|---|---|
| Implementação da IA definida na entrega anterior | `src/vitalisSense.js`, `src/vitalisRules.js`, `src/vitalisVoice.js` |
| Integração com a aplicação (interface, banco, APIs) | `server.js` + `public/index.html` (seção [4](#4-arquitetura-implementada)) |
| Preparação e organização dos dados | `db.json` (seção [5](#5-dados-utilizados)) |
| Testes e validação em cenários reais | `tests/` — 16 testes, ver seção [6](#6-testes-automatizados) e `docs/evidencias.md` |
| Evidências de funcionamento (protótipos, telas, fluxos) | `docs/evidencias.md` |
| Vídeo pitch (~5 min) | [`Pitch.md`](./Pitch.md) (roteiro) — link do vídeo na seção [8](#8-pitch) |

---

## 1. Recapitulando o que foi especificado (Sprint 3)

A CLYVO VET precisa transformar dados contínuos da coleira IoT + histórico clínico em
cuidado **proativo**, com três camadas de IA trabalhando em conjunto:

- **Vitalis Sense** (modelo preditivo/estatístico): detecta desvios do baseline individual
  do pet nos sinais vitais.
- **Vitalis Rules** (motor de regras): transforma o desvio em uma prioridade de negócio
  (`scorePrioridade` 0–100) e em recomendações de serviço.
- **Vitalis Voice** (IA generativa / LLM): transforma o evento estruturado em linguagem
  natural — mensagem para o tutor e resumo técnico para a clínica.

O racional completo de *por que* essa arquitetura (e não um único LLM fazendo tudo) está
documentado na Sprint 3 e não é repetido aqui; este README foca no **que foi implementado**.

---

## 2. O que esta entrega implementa, de fato

| Módulo especificado | Implementado em | Técnica usada |
|---|---|---|
| Vitalis Sense | `src/vitalisSense.js` | Baseline individual (média móvel + desvio padrão em janela deslizante) + zScore; fallback para baseline populacional por porte durante o *cold start* |
| Vitalis Rules | `src/vitalisRules.js` | Motor de regras determinístico: `scorePrioridade = 0.50·zScoreNormalizado + 0.20·fatorRiscoRacaIdade + 0.15·diasDesdeUltimaConsulta + 0.15·(1-adesão)` |
| Vitalis Voice | `src/vitalisVoice.js` | Chamada real à API do **Google Gemini** (com Anthropic Claude como alternativa) quando configurada, com *prompt* estruturado e *grounding* nos dados do evento; guardrail contra diagnóstico definitivo; fallback template determinístico quando a IA generativa não está disponível ou reprova a validação |
| Integração ponta a ponta | `server.js` | Backend HTTP (Node puro, sem dependências) que recebe a leitura da coleira, roda o pipeline Sense → Rules → Voice e expõe o resultado via API REST |
| Interface para o tutor e para a clínica | `public/index.html` | Dashboard com duas visões: sinais vitais + insight da IA (tutor), e fila de priorização (clínica) |

---

## 3. Como rodar o projeto

### 3.1 Pré-requisitos
- [Node.js](https://nodejs.org/) 18+ (sem outras dependências — não é necessário `npm install`).
- Navegador (Chrome, Edge, Firefox).
- Opcional: **Wokwi Simulator** no VS Code, para rodar a coleira ESP32 (herdado da Sprint 1).

### 3.2 Subir o backend + IA
```bash
node server.js
```
O servidor sobe em `http://localhost:3000` e já expõe o dashboard em `/`.

### 3.3 Abrir o dashboard
Acesse `http://localhost:3000` no navegador. Use o seletor de pet no topo para trocar
entre Thor, Mia e Bento (pet novo, em *cold start*). O botão **"Simular pico de frequência
cardíaca (demo)"** injeta uma leitura anômala sem precisar do hardware/Wokwi — útil para
demonstração e para o vídeo pitch.

### 3.4 (Opcional) Rodar com a coleira ESP32 real via Wokwi
Mesmo passo a passo da Sprint 1 (`sketch/sketch.ino`, ajustar o IP local em `serverName`).
A única mudança é que o sketch agora também envia `petId`, então o backend já sabe de
qual pet é a leitura, sem precisar de mapeamento manual.

### 3.5 Rodar com IA generativa real (Vitalis Voice via Gemini)
Por padrão (sem nenhuma chave configurada), o projeto roda 100% localmente usando o
**fallback template determinístico** do Vitalis Voice — sem custo, sem chave, sempre
disponível. Isso é intencional (ver seção 7 abaixo), mas para a entrega valer como "IA
generativa implementada de verdade", ative o Gemini:

1. Gere uma chave gratuita em **https://aistudio.google.com/app/apikey** (tem free tier).
2. Copie `.env.example` para `.env` e cole sua chave em `GEMINI_API_KEY=`.
3. Rode o servidor carregando o `.env` (Node 20.6+ já suporta isso nativamente, sem
   dependência nenhuma):
   ```bash
   node --env-file=.env server.js
   ```
4. **Confirme que a IA generativa está de fato respondendo**, isolado do resto do
   sistema, com:
   ```bash
   node --env-file=.env scripts/testar-gemini.js
   # ou: npm run test:gemini
   ```
   Esse script chama só o Vitalis Voice com um evento de exemplo e imprime no terminal
   se a resposta veio do Gemini (`origem: llm`, `provedor: gemini`) ou do fallback — é
   a forma mais rápida de provar, na sua própria máquina, que a geração é real.
5. Com a chave ativa, abra o dashboard normalmente: o rodapé da mensagem de IA passa a
   mostrar "gerado pela IA (Google Gemini)" em vez de "mensagem de segurança (fallback)".

Alternativa: o código também aceita `ANTHROPIC_API_KEY` (Claude) como provedor, caso a
equipe prefira trocar — ver comentários em `src/vitalisVoice.js`.

> **Nota sobre este repositório:** o ambiente onde esta implementação foi desenvolvida tem
> acesso de rede restrito a uma lista de domínios (não inclui a API do Gemini), então a
> chamada real ao Gemini não pôde ser feita a partir dali. Ela **foi testada e confirmada
> funcionando** rodando `npm run test:gemini` fora desse ambiente, com uma chave real —
> resultado documentado em `docs/evidencias.md`, seção 6.2. Durante esse teste, encontramos
> e corrigimos um erro de autenticação (a chave precisa ir via `?key=` na URL, não no
> header `x-goog-api-key` — algumas contas do Gemini retornam 401 com o header).

---

## 4. Arquitetura implementada

O fluxo de dados segue exatamente o diagrama definido na Sprint 3
(`docs/diagrams/arquitetura-ia.mermaid` e `docs/diagrams/sequence-diagram.mermaid`),
agora com cada caixa correspondendo a código real:

```
Coleira (ESP32/Wokwi)  --HTTP PUT-->  server.js (/data)
                                          |
                                          v
                                   src/store.js  (grava a leitura em db.json,
                                                   evolucao do db.json da Sprint 1
                                                   para series temporais por pet)
                                          |
                                          v
                              src/vitalisSense.js  (baseline + zScore)
                                          |
                                          v
                              src/vitalisRules.js  (scorePrioridade + recomendacoes)
                                          |
                                          v
                              src/vitalisVoice.js  (mensagem tutor + resumo clinica)
                                          |
                                          v
                     API REST (/api/pets/:id/insight, /api/queue)
                                          |
                            -------------------------------
                            |                             |
                            v                             v
                 public/index.html                public/index.html
                 (Visão do Tutor)                 (Painel da Clínica)
```

O mesmo pipeline roda tanto quando a leitura chega da coleira real (`PUT /data`) quanto
quando é simulada pelo botão de demo (`POST /api/simular`) — não existe um caminho de
código "de mentira" separado para a demonstração.

---

## 5. Dados utilizados

`db.json` evolui o `db.json` da Sprint 1 (que guardava só o último estado) para um
formato com:

- `pets`: cadastro (perfil, raça, predisposições, vacinas, adesão a tratamento) — a fonte
  de dados que a Sprint 3 chamava de "banco relacional".
- `leituras`: série temporal por pet (o que a Sprint 3 chamava de "banco de séries
  temporais"), populada com histórico real o suficiente para o baseline individual entrar
  em vigor (Thor e Mia) e um pet propositalmente com pouquíssimo histórico (Bento) para
  demonstrar o *cold start*.
- `eventos`: log de todo insight gerado pelo Vitalis Core (auditoria).
- `feedback`: registrado via `POST /api/feedback`, fechando o loop tutor/clínica → banco
  de dados descrito na seção 5 (item 7) do README da Sprint 3.

---

## 6. Testes automatizados

```bash
node tests/run.js
# ou
npm test
```

16 testes, sem dependências externas (framework próprio em `tests/miniTest.js`), cobrindo:
- Vitalis Sense: classificação normal vs. anômala, cold start, transição para baseline
  individual assim que há amostras suficientes.
- Vitalis Rules: score mais alto para pet de maior risco com o mesmo zScore, recomendações
  condicionais (vacina, limpeza dentária), cálculo de adesão ao tratamento.
- Vitalis Voice: guardrail (rejeita diagnóstico definitivo), grounding (rejeita números
  inventados), fallback de segurança sempre disponível.

Resultado da última execução e chamadas reais à API estão documentados em
[`docs/evidencias.md`](./docs/evidencias.md).

---

## 7. Limitações desta implementação (transparência)

- **Cache de insight por pet, para evitar chamadas repetidas ao LLM.** O dashboard faz
  polling em `GET /api/pets/:id/insight` a cada poucos segundos; sem cuidado, isso
  chamaria o LLM de novo a cada poll, mesmo sem dado novo — foi exatamente isso que
  causou erros `503 (high demand)` nos primeiros testes com uma chave real (ver
  `docs/evidencias.md`, seção 6.3). `src/insightCache.js` resolve isso em duas camadas:
  (1) se a leitura mais recente não mudou desde o último cálculo, devolve o insight já
  pronto sem recalcular nada; (2) mesmo com leitura nova, só chama o LLM de novo se o
  **nível de prioridade** mudou ou se já passou um período de *cooldown*
  (`VITALIS_VOICE_COOLDOWN_MS`, padrão 60s) desde a última chamada real. Chamadas ao
  Gemini também têm 1 retry automático em caso de `503` (erro documentado pela própria
  Google como transitório).
- **A integração real com o Google Gemini foi testada e confirmada funcionando**
  (`origem: "llm"`, mensagem gerada dinamicamente, guardrail e grounding validados —
  ver `docs/evidencias.md`, seção 6.2). O fallback template continua sendo o
  comportamento padrão sem chave configurada, por design (custo zero, sempre disponível).
- O **grounding check** é uma heurística simplificada (compara números citados na
  mensagem com números presentes no evento estruturado) — suficiente para a demonstração,
  mas um "grounding" de produção usaria comparação semântica/RAG mais robusta, como
  descrito na Sprint 3.
- O **fator de risco por raça/idade** usa uma tabela heurística pequena (não uma base de
  dados epidemiológica real), documentado como simplificação da PoC.
- Não há autenticação/autorização nos endpoints (fora do escopo desta entrega, focada na
  camada de IA).

---

## 8. Pitch

Link do vídeo (YouTube): **[Demonstração](https://youtu.be/XwkWr996FR0)**

## 9. Continuidade

- Sprint 1/2 → PoC de hardware (coleira ESP32 + dashboard).
- Sprint 3 → especificação e arquitetura da IA (Vitalis Core).
- **Sprint 4 (este repositório)** → implementação, integração e testes da IA especificada.

## Autores

Organização responsável pelo projeto: **[PetCare 360](https://github.com/PetCare-360)**

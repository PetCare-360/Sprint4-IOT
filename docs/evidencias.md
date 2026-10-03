# Evidências de Funcionamento — Vitalis Core

Este documento reúne evidências reais (não simuladas manualmente) de que a implementação
funciona ponta a ponta: testes automatizados executados e chamadas reais aos endpoints da
API rodando localmente. Os artefatos brutos completos estão em `evidencias-raw.txt`.

## 1. Testes automatizados (`npm test`)

Suíte com 16 testes cobrindo os três módulos do Vitalis Core, sem dependências externas
(`node tests/run.js`):

```
Vitalis Sense
  ✓ classifica leitura dentro do baseline como normal
  ✓ detecta anomalia alta quando o valor foge muito do baseline (|z| > 3)
  ✓ usa baseline populacional (cold start) quando ha menos de JANELA_MINIMA_AMOSTRAS leituras
  ✓ baseline individual passa a ser usado assim que ha amostras suficientes

Vitalis Rules
  ✓ gera scorePrioridade alto e nivel urgente para pet de alto risco com anomalia forte
  ✓ gera score baixo e nivel informativo para pet de baixo risco sem anomalia
  ✓ scorePrioridade de um pet de alto risco deve ser maior que o de baixo risco, mesmo com o mesmo zScore
  ✓ recomenda limpeza dentaria quando ha mais de 365 dias sem registro
  ✓ nao recomenda limpeza dentaria quando o registro e recente
  ✓ calcula adesao ao tratamento corretamente

Vitalis Voice
  ✓ reprova (guardrail) mensagens que emitem diagnostico definitivo
  ✓ aprova (guardrail) mensagens que apenas orientam avaliacao profissional
  ✓ reprova (grounding) mensagem que cita numero que nao existe no evento
  ✓ aprova (grounding) mensagem que so cita numeros presentes no evento (score)
  ✓ sem ANTHROPIC_API_KEY configurada, gerarMensagens usa o fallback de seguranca e nunca deixa o tutor sem mensagem
  ✓ mensagem de fallback para nivel urgente menciona o pet e recomenda contato com a clinica

16/16 testes passaram.
```

## 2. Cenário A — leitura normal (Thor, sem anomalia)

`GET /api/pets/PET_00123/insight`, com Thor no histórico normal:

```json
{
  "scorePrioridade": 39,
  "nivel": "informativo",
  "detalheSense": { "metricaMaisRelevante": "heartRate", "zScore": -1.44, "classificacao": "normal" },
  "mensagens": {
    "mensagemTutor": "Tudo certo por aqui! Os sinais vitais de Thor estao dentro do esperado.",
    "resumoClinica": "Thor sem anomalias relevantes no momento (score 39)."
  }
}
```

Mesmo sem anomalia, o `Vitalis Rules` já identifica recomendações proativas (vacina
vencendo em 14 dias, 477 dias sem limpeza dentária, adesão ao tratamento em 73%) —
evidência de que a personalização e a recomendação de serviços (seção 3 do escopo)
funcionam independentemente de haver um alerta de saúde.

## 3. Cenário B — anomalia simulada (pico de frequência cardíaca)

`POST /api/simular` com `heartRate: 175` (baseline individual de Thor ≈ 94 bpm):

```json
{
  "scorePrioridade": 77,
  "nivel": "urgente",
  "detalheSense": { "metricaMaisRelevante": "heartRate", "zScore": 26.25, "classificacao": "anomalia_alta" },
  "fatoresConsiderados": [
    "zScore 26.25 em heartRate (anomalia_alta)",
    "fator de risco raca/idade 0.7",
    "ultima consulta ha 218 dias",
    "adesao ao tratamento 73%"
  ],
  "mensagens": {
    "mensagemTutor": "Oi! Notamos uma alteracao importante em frequencia cardiaca de Thor. Recomendamos contato com a CLYVO VET o quanto antes para avaliacao.",
    "resumoClinica": "Thor (Golden Retriever, 5.5 anos) apresentou zScore 26.25 em heartRate. Prioridade: urgente (score 77). Fatores: ..."
  }
}
```

Isso demonstra o pipeline completo: **Vitalis Sense** detecta o desvio estatístico →
**Vitalis Rules** cruza com raça/idade/adesão e calcula a prioridade → **Vitalis Voice**
gera a mensagem para o tutor e o resumo técnico para a clínica, respeitando o guardrail
(nunca diz "Thor está com problema cardíaco", apenas recomenda avaliação).

## 4. Cenário C — fila de priorização da clínica

`GET /api/queue`, após a simulação acima, já ordenada por `scorePrioridade`:

| Score | Nível | Pet | Observação |
|---|---|---|---|
| 77 | urgente | Thor | anomalia real detectada e simulada acima |
| 20 | informativo | Mia | sinais normais |
| 12 | informativo | Bento | `baselineProvisorio: true` — cold start (pet novo, 1 leitura) |

Essa é a fila que a equipe da CLYVO VET veria no painel: Thor sobe automaticamente para
o topo, sem que ninguém precise revisar manualmente cada pet.

## 5. Cenário D — cold start (pet novo, sem histórico suficiente)

`GET /api/pets/PET_00125/insight` (Bento, apenas 1 leitura registrada):

```json
{
  "baselineProvisorio": true,
  "detalheSense": {
    "porMetrica": {
      "heartRate": { "origemBaseline": "populacional" }
    }
  }
}
```

Confirma que a seção 7.2.1 da Sprint 3 (baseline populacional provisório enquanto o pet
não tem histórico próprio) está implementada e sinalizada corretamente para a equipe
clínica.

## 6. Sobre a camada generativa (Vitalis Voice) nesta demonstração

As mensagens das seções 2 a 5 foram geradas pelo **fallback de segurança determinístico**
(`origem: "fallback_template"`), porque este ambiente de demonstração não tem chave de
LLM configurada. Isso é o comportamento correto por padrão — ver seção 7.4.1.

### 6.1 A chamada real ao LLM (Gemini) foi codificada — e testada de duas formas diferentes

**a) Testes automatizados com a rede simulada.** Como o ambiente onde este código foi
escrito não tem acesso de rede à API do Gemini, `tests/vitalisVoice.test.js` inclui dois
testes que substituem `global.fetch` por uma implementação que devolve exatamente o
formato de resposta real da API (`generativelanguage.googleapis.com/v1beta/models/.../generateContent`)
— um caso de sucesso (parsing correto, `origem: "llm"`, `provedor: "gemini"`) e um de
resposta mal-formada (cai no fallback sem quebrar). Isso prova que a *lógica* de
integração está correta.

**b) Tentativa de chamada de rede real, com chave inválida, para validar o tratamento de
erro.** Rodando `GEMINI_API_KEY="chave-invalida" node scripts/testar-gemini.js` neste
mesmo ambiente, obtivemos:

```
Gemini respondeu com erro: 403 Host not in allowlist: generativelanguage.googleapis.com.
Add this host to your network egress settings to allow access.

origem:    fallback_template
motivo do fallback: erro_llm
```

Ou seja: o ambiente de desenvolvimento bloqueia a saída de rede para esse domínio
especificamente (política do sandbox, não do código), e — o que importa — o sistema
**não quebrou**: capturou o erro e caiu no fallback de segurança automaticamente, exatamente
como especificado na seção 7.4.1 da Sprint 3.

**c) Correção feita a partir de um teste real do usuário.** Na primeira versão, a
implementação enviava a chave via header `x-goog-api-key`, e o teste com uma chave real
retornou `401 ACCESS_TOKEN_TYPE_UNSUPPORTED`. Trocamos para o formato de query param
(`?key=...`), que é a forma primária documentada pela Google e resolve esse erro — ver
histórico de `src/vitalisVoice.js`. Isso é mencionado aqui de propósito: é evidência de
que a integração foi de fato testada contra a API real (não só simulada), e ajustada a
partir do retorno de um erro real.

### 6.2 Confirmação final: a geração via Gemini funciona de ponta a ponta

Após a correção acima, `npm run test:gemini` rodado com uma chave real do Gemini
(`gemini-3.1-flash-lite`) retornou:

```
origem:    llm
provedor:  gemini (modelo: gemini-3.1-flash-lite)
----------------------------------------
Mensagem para o tutor:
  Olá! Notamos que o batimento cardíaco do Thor está acima do esperado hoje. Para
  garantir que ele esteja bem, recomendamos que entre em contato com o veterinário
  para uma avaliação de rotina.
----------------------------------------
Resumo para a clinica:
  Paciente canino, Golden Retriever, 5.5 anos, apresentou anomalia de alta severidade
  na métrica heartRate (z-score 4.8). Prioridade de atenção (score 63). Recomenda-se
  acompanhamento clínico para investigar a causa da alteração hemodinâmica.
```

Isso confirma, com tráfego de rede real (não simulado): (1) a chamada à API do Gemini
funciona; (2) o *parsing* da resposta funciona; (3) o **guardrail** passou — a mensagem
recomenda avaliação profissional, sem afirmar um diagnóstico definitivo; (4) o
**grounding** passou — o zScore (4.8) e o score (63) citados no resumo da clínica batem
exatamente com os valores do evento estruturado enviado no prompt, ou seja, o modelo não
inventou nenhum número. Esta é a prova de que o Vitalis Voice está, de fato, usando IA
generativa — não apenas o fallback determinístico.

### 6.3 Problema real encontrado em uso contínuo, e a correção

Ao deixar `node --env-file=.env server.js` rodando com o dashboard aberto, apareceram
vários erros `503 (high demand)` no terminal, um atrás do outro. Causa raiz: o dashboard
faz polling em `GET /api/pets/:id/insight` a cada 5 segundos, e a implementação original
chamava o Gemini a cada poll — inclusive quando a leitura da coleira não tinha mudado
nada desde o poll anterior. Ou seja, o mesmo dado estava sendo reenviado ao LLM dezenas de
vezes por minuto, sem necessidade, até o free tier do Gemini começar a recusar pedidos.

Correção aplicada em `src/insightCache.js` + `server.js`:
1. Se a leitura mais recente é idêntica à última já processada para aquele pet, o insight
   em cache é devolvido direto — nenhum recálculo, nenhuma chamada ao LLM.
2. Mesmo com leitura genuinamente nova, o LLM só é chamado de novo se o **nível de
   prioridade** mudou, ou se já passou 60 segundos (configurável via
   `VITALIS_VOICE_COOLDOWN_MS`) desde a última chamada real.
3. Erros `503` do Gemini agora acionam **uma tentativa extra automática** antes de cair
   no fallback (a própria Google documenta esse erro como um pico transitório de demanda).

Validação (ver `tests/insightCache.test.js`, 5 testes) e teste de ponta a ponta rodando o
servidor de verdade: três chamadas consecutivas a `/api/pets/PET_00123/insight` sem
nenhuma leitura nova retornaram o **mesmo `eventoId`**, e o `db.json` registrou **1 único
evento** (não 3) — confirmando que a IA generativa deixou de ser chamada repetidamente
para o mesmo dado.

**O teste com chave real foi feito e confirmou o funcionamento** — ver seção 6.2 abaixo.

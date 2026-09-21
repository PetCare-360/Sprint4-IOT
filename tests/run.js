// Executa todos os testes do projeto (node tests/run.js)
const { resumo } = require("./miniTest");

require("./vitalisSense.test.js");
require("./vitalisRules.test.js");
require("./vitalisVoice.test.js");
require("./insightCache.test.js");

resumo();

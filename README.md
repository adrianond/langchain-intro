# langchain-intro

Agente simples de transformação de texto construído com [LangGraph.js](https://langchain-ai.github.io/langgraphjs/) + Anthropic (Claude), exposto tanto via um servidor HTTP próprio (Fastify) quanto via o LangGraph CLI/Studio.

## Fluxo do grafo

Todo o comportamento do agente está centralizado em [`src/graph/graph.ts`](src/graph/graph.ts), na função `buildGraph()`:

```
START → identifyIntent → (upperCase | lowerCase | fallback) → chatResponse → END
```

- [`identifyIntentNode.ts`](src/graph/nodes/identifyIntentNode.ts) — único ponto do projeto que chama a Anthropic (`claude-haiku-4-5`). Usa a mensagem do usuário como o próprio texto a ser classificado e pede uma palavra só (`uppercase` / `lowercase` / `unknown`) em texto puro, validada manualmente (sem tool-calling — veja "Notas" abaixo). Define `command` (usado no roteamento) e `output` (o texto que os próximos nós vão transformar).
- [`upperCaseNode.ts`](src/graph/nodes/upperCaseNode.ts) / [`lowercaseNode.ts`](src/graph/nodes/lowercaseNode.ts) — transformação determinística (`.toUpperCase()`/`.toLowerCase()`), sem LLM.
- [`fallbackNode.ts`](src/graph/nodes/fallbackNode.ts) — mensagem de ajuda fixa quando o comando não é reconhecido.
- [`chatResponseNode.ts`](src/graph/nodes/chatResponseNode.ts) — empacota `output` como `AIMessage` no histórico.

**A LLM só decide a intenção — a transformação do texto é sempre código determinístico.**

## Duas formas de executar o mesmo grafo

O projeto tem **dois pontos de entrada independentes**, que não se chamam entre si, mas os dois usam o mesmo `buildGraph()` por baixo:

### 1. Servidor HTTP próprio (`server.ts`)

```
npm run dev
```

`src/index.ts` chama `createServer()` (definida em [`src/server.ts`](src/server.ts)), que monta o grafo uma única vez (`const graph = buildGraph()`) e expõe:

```
POST /chat   { "question": "faça isso uppercase" }  →  200  "FAÇA ISSO UPPERCASE"
```

Cada requisição chama `graph.invoke(...)` e devolve `response.output`. Sobe na porta `3000`.

Os testes ([`tests/server.test.ts`](tests/server.test.ts)) também chamam `createServer()` diretamente, usando `app.inject(...)` do Fastify — sem abrir porta de rede de verdade.

### 2. LangGraph CLI / Studio

```
npm run langgraph:server
```

Roda `npx @langchain/langgraph-cli dev`, que:

1. Lê o [`langgraph.json`](langgraph.json) pra saber qual grafo carregar e qual `.env` usar:
   ```json
   {
     "graphs": { "agent": "./src/graph/nodes/factory.ts:graph" },
     "env": ".env"
   }
   ```
2. Importa `graph` de [`factory.ts`](src/graph/nodes/factory.ts) (que só reexporta `buildGraph()`).
3. Sobe **o servidor HTTP do próprio LangGraph** (rotas como `/threads`, `/threads/{id}/runs/wait`), na porta `2024` — não tem nada a ver com o `server.ts`/Fastify, que fica parado, sem uso, nesse caminho.

É esse servidor que alimenta o **LangGraph Studio** (a UI visual com o desenho do grafo, o painel "Interact", etc.).

### Resumo comparativo

| | Comando | Servidor usado | `server.ts` entra? |
|---|---|---|---|
| HTTP próprio | `npm run dev` | Fastify (porta 3000) | ✅ sim |
| LangGraph CLI/Studio | `npm run langgraph:server` | API do LangGraph (porta 2024) | ❌ não |

Os dois caminhos, no fim, chamam o mesmo `buildGraph()` — só trocam a "casca" HTTP por cima.

## LangSmith (tracing)

Controlado só pelas variáveis no [`.env`](.env):

```
LANGSMITH_API_KEY=...
LANGCHAIN_TRACING_V2=true
LANGCHAIN_PROJECT=langchain-intro
```

O tracing funciona **em qualquer um dos dois caminhos** (e até em scripts soltos que chamem `graph.invoke()`/`model.invoke()` diretamente), porque é feito via callbacks globais do LangChain, acionados automaticamente sempre que essas variáveis estão presentes — não depende de qual servidor HTTP está por cima.

O que é exclusivo do caminho `langgraph:server` é a **UI interativa do Studio** (visualização do grafo, execução nó a nó, "As Node", etc.) — isso é uma feature da LangGraph Platform, não do LangSmith tracing em si.

| | Aparece no Tracing do LangSmith? | Tem UI do Studio? |
|---|---|---|
| `npm run dev` (server.ts) | ✅ sim | ❌ não |
| `npm run langgraph:server` | ✅ sim | ✅ sim |

## Comandos

- `npm run dev` — servidor HTTP próprio (Fastify), porta 3000.
- `npm run langgraph:server` — servidor do LangGraph CLI/Studio, porta 2024.
- `npm test` — roda os testes uma vez (`node:test`, sem watch).
- `npm run test:dev` — mesmo teste com `--watch --inspect` (ver nota abaixo).

## Notas

- **`node --test --watch` + edição de arquivo**: se você salvar um arquivo observado enquanto um teste está em andamento, o run é abortado e contado como falha — não é bug, é o `--watch` reiniciando o processo no meio. Use `npm test` (sem watch) pra um resultado confiável.
- **`withStructuredOutput`/tool-calling da Anthropic** foi evitado de propósito no `identifyIntentNode.ts`: sob o harness de execução do `langgraph-cli dev`, a reconstrução da tool call vinha sempre vazia (`OUTPUT_PARSING_FAILURE`). A solução foi pedir resposta em texto puro e validar manualmente — mais simples e sem essa dependência frágil.
- **nvm4w (Windows)**: `nvm use <versão>` precisa rodar num PowerShell **elevado** (Administrador), senão o symlink não atualiza e a versão volta pra anterior depois de reiniciar.

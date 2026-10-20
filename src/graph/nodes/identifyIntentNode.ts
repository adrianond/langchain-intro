import { ChatAnthropic } from "@langchain/anthropic";
import { type GraphState } from "../graph.ts";

const VALID_COMMANDS: GraphState['command'][] = ['uppercase', 'lowercase', 'unknown']

const model = new ChatAnthropic({
    model: "claude-haiku-4-5",
    temperature: 0,
    disableStreaming: true,
    maxTokens: 10,
});

const SYSTEM_PROMPT = "A mensagem do usuário abaixo É o texto a ser classificado, não uma instrução separada com conteúdo à parte. " +
    "Responda com APENAS UMA PALAVRA, sem pontuação nem explicação: " +
    "'uppercase' se ela menciona transformar o texto em maiúsculas, " +
    "'lowercase' se menciona minúsculas, " +
    "ou 'unknown' se não for nenhum dos dois — " +
    "mesmo que a mensagem seja curta ou contenha só o comando, sem nenhum texto adicional."

function parseCommand(text: string): GraphState['command'] {
    const normalized = text.trim().toLowerCase().replace(/[^a-z]/g, '')
    return (VALID_COMMANDS as string[]).includes(normalized)
        ? normalized as GraphState['command']
        : 'unknown'
}

export async function identifyIntent(state: GraphState) {
    const input = state.messages.at(-1)?.text ?? ""

    // A Anthropic rejeita mensagens de usuário com conteúdo vazio (400),
    // então nem vale a pena chamar o modelo nesse caso.
    if (!input.trim()) {
        return {
            ...state,
            command: 'unknown' as const,
            output: input
        }
    }

    let command: GraphState['command']
    try {
        const result = await model.invoke([
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: input }
        ])
        command = parseCommand(result.text)
    } catch (error) {
        // Falha transitória da API (raro, mas acontece) — degrada para
        // 'unknown' em vez de derrubar o grafo inteiro.
        console.error('identifyIntent: falha ao classificar via LLM, usando fallback', error)
        command = 'unknown'
    }

    return {
        ...state,
        command,
        output: input
    }
}

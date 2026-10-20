import {
    END,
    MessagesZodMeta,
    START,
    StateGraph,
} from '@langchain/langgraph'
import { withLangGraph } from '@langchain/langgraph/zod'
import { BaseMessage } from 'langchain'
import { z } from 'zod/v3'
import { identifyIntent } from './nodes/identifyIntentNode.ts'
import { chatResponseNode } from './nodes/chatResponseNode.ts'
import { upperCaseNode } from './nodes/upperCaseNode.ts'
import { lowerCaseNode } from './nodes/lowercaseNode.ts'
import { fallbackNode } from './nodes/fallbackNode.ts'

const GraphState = z.object({
    messages: withLangGraph(
        z.custom<BaseMessage[]>(),
        MessagesZodMeta
    ),
    output: z.string(), //saida a ser utiliza no server.ts
    command: z.enum(['uppercase', 'lowercase', 'unknown'])
})

export type GraphState = z.infer<typeof GraphState>

export function buildGraph() {
    const workflow = new StateGraph({
        stateSchema: GraphState
    })

        .addNode("identifyIntent", identifyIntent)
        .addNode("chatResponse", chatResponseNode)
        
        .addNode("upperCase", upperCaseNode)
        .addNode("lowerCase", lowerCaseNode)
        .addNode("fallback", fallbackNode)

        .addEdge(START, "identifyIntent")
        .addConditionalEdges(
            "identifyIntent",
            (state: GraphState) => {
                switch (state.command) {
                    case 'uppercase':
                        return 'upperCase';
                    case 'lowercase':
                        return 'lowerCase';
                    default:
                        return 'fallback'
                }
            },
            {
                upperCase: 'upperCase',
                lowerCase: 'lowerCase',
                fallback: 'fallback'
            }
        )
        .addEdge("upperCase", "chatResponse")
        .addEdge("lowerCase", "chatResponse")
        .addEdge("fallback", "chatResponse")

        .addEdge("chatResponse", END)

    return workflow.compile()
}
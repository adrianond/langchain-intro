import { type GraphState } from "../graph.ts";

export function upperCaseNode(state: GraphState) {
    const responseText = state.output.toUpperCase()

    return {
        ...state,
        output: responseText
    }
}
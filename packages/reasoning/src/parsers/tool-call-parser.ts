import { ParsedAction } from '../types.js';

export class ToolCallParser {
  /**
   * Parses structured action blocks or JSON from LLM output.
   * Format supported:
   * Thought: <thought>
   * Action: <tool_name>
   * Action Input: <json_arguments>
   * OR
   * Final Answer: <response>
   * OR
   * JSON block ```json { "tool": "...", "args": { ... }, "thought": "..." } ```
   */
  static parse(content: string): ParsedAction {
    const trimmed = content.trim();

    // 1. Check for JSON block
    const jsonMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/) || [null, trimmed];
    const candidateJson = jsonMatch[1]?.trim();
    if (candidateJson && (candidateJson.startsWith('{') && candidateJson.endsWith('}'))) {
      try {
        const parsed = JSON.parse(candidateJson);
        if (parsed.tool && parsed.tool !== 'finish') {
          return {
            type: 'tool',
            toolName: parsed.tool,
            toolArgs: parsed.args || {},
            thought: parsed.thought,
          };
        } else if (parsed.final_answer || parsed.answer) {
          return {
            type: 'finish',
            finalResponse: parsed.final_answer || parsed.answer,
            thought: parsed.thought,
          };
        }
      } catch {
        // Fall back to text parsing
      }
    }

    // 2. Check for Classic ReAct format
    const thoughtMatch = trimmed.match(/Thought:\s*(.*?)(?=\nAction:|\nFinal Answer:|$)/s);
    const actionMatch = trimmed.match(/Action:\s*([a-zA-Z0-9_-]+)/);
    const inputMatch = trimmed.match(/Action Input:\s*(\{[\s\S]*\}|"[^"]*"|[^\n]+)/);
    const finalAnswerMatch = trimmed.match(/Final Answer:\s*([\s\S]+)/);

    const thought = thoughtMatch && thoughtMatch[1] ? thoughtMatch[1].trim() : undefined;

    if (finalAnswerMatch && finalAnswerMatch[1]) {
      return {
        type: 'finish',
        finalResponse: finalAnswerMatch[1].trim(),
        thought,
      };
    }

    if (actionMatch && actionMatch[1]) {
      const toolName = actionMatch[1].trim();
      let toolArgs: Record<string, unknown> = {};
      if (inputMatch && inputMatch[1]) {
        try {
          toolArgs = JSON.parse(inputMatch[1].trim());
        } catch {
          toolArgs = { input: inputMatch[1].trim() };
        }
      }
      return {
        type: 'tool',
        toolName,
        toolArgs,
        thought,
      };
    }

    // Default: treat plain text response as final answer
    return {
      type: 'finish',
      finalResponse: trimmed,
      thought: 'Direct response generated',
    };
  }
}

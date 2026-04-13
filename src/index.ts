import { AIChatAgent, type OnChatMessageOptions } from "@cloudflare/ai-chat";
import { routeAgentRequest } from "agents";
import { convertToModelMessages, streamText, type StreamTextOnFinishCallback, type ToolSet } from "ai";
import { createWorkersAI } from "workers-ai-provider";

export interface Env {
  AI: Ai;
  Chat: DurableObjectNamespace;
  ASSETS: Fetcher;
}

const MAX_OUTPUT_TOKENS = 8192;

export class Chat extends AIChatAgent<Env> {
  async onChatMessage(
    onFinish: StreamTextOnFinishCallback<ToolSet>,
    options?: OnChatMessageOptions
  ): Promise<Response | undefined> {
    const workersai = createWorkersAI({ binding: this.env.AI });
    const model = workersai("@cf/meta/llama-3.3-70b-instruct-fp8-fast");

    const messages = await convertToModelMessages(this.messages);

    const result = streamText({
      model,
      system: "You are a helpful assistant.",
      messages,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      abortSignal: options?.abortSignal,
      onFinish,
    });

    return result.toUIMessageStreamResponse();
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const agentResponse = await routeAgentRequest(request, env);
    if (agentResponse) return agentResponse;
    return env.ASSETS.fetch(request);
  },
};

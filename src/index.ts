import { AIChatAgent, type OnChatMessageOptions } from "@cloudflare/ai-chat";
import { routeAgentRequest } from "agents";
import { convertToModelMessages, streamText, type StreamTextOnFinishCallback, type ToolSet } from "ai";
import { createWorkersAI } from "workers-ai-provider";

export interface Env {
  AI: Ai;
  Chat: DurableObjectNamespace<Chat>;
  ASSETS: Fetcher;
}

const MAX_OUTPUT_TOKENS = 8192;

type ChatRequestBody = {
  documentMode?: boolean;
  documentTitle?: string;
  documentContent?: string;
  userRequest?: string;
};

export class Chat extends AIChatAgent<Env> {
  async onChatMessage(
    onFinish: StreamTextOnFinishCallback<ToolSet>,
    options?: OnChatMessageOptions
  ): Promise<Response | undefined> {
    const workersai = createWorkersAI({ binding: this.env.AI });
    const model = workersai("@cf/meta/llama-3.3-70b-instruct-fp8-fast");

    const messages = await convertToModelMessages(this.messages);
    const body = options?.body as ChatRequestBody | undefined;

    const system = body?.documentMode
      ? [
          "You are a helpful assistant that writes and revises documents.",
          "Return only the document text.",
          "If a draft is provided, treat it as the current working version and update it according to the user's request.",
          body.documentTitle ? `Draft title: ${body.documentTitle}` : null,
          body.documentContent ? `Current draft:\n${body.documentContent}` : null,
          body.userRequest ? `User request:\n${body.userRequest}` : null,
        ]
          .filter((part): part is string => typeof part === "string" && part.length > 0)
          .join("\n\n")
      : "You are a helpful assistant.";

    const result = streamText({
      model,
      system,
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

# Cloudflare AI Chatbot

An AI-powered chatbot built on Cloudflare's edge infrastructure. Supports text chat, voice input, and document uploads.

**Live demo:** https://cloudflare-chatbot.ccan2tesj.workers.dev

## Features

- **Chat** — multi-turn conversations with persistent memory (history survives page refreshes)
- **Chat history** — browse past chats in a sidebar and start a fresh chat with one click
- **Voice input** — click the microphone button and speak; your message is sent automatically
- **Document upload** — drag and drop or attach `.pdf`, `.txt`, `.md`, `.json` files; the model reads and answers questions about them
- **Document drafting** — ask the chatbot to write a document and an editable draft panel opens beside the chat

## Stack

| Component | Technology |
|-----------|-----------|
| LLM | Llama 3.3 70B via [Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/) |
| Coordination | [Cloudflare Durable Objects](https://developers.cloudflare.com/durable-objects/) (`AIChatAgent` from `@cloudflare/ai-chat`) |
| Frontend | React 19 + Vite, served as static assets |
| Memory | Durable Object SQLite storage (per-session conversation history) |
| Voice | Web Speech API (browser-native, Chrome/Edge) |
| PDF parsing | PDF.js (client-side, no server upload) |
| Draft editor | Side-panel textarea that syncs with document-writing requests and stays editable |

## Try it

The easiest way is the deployed link above. No sign-up required.

## Run locally

**Prerequisites:** Node.js 18+, a Cloudflare account, and a registered `workers.dev` subdomain.

```bash
# 1. Install dependencies
npm install

# 2. Authenticate with Cloudflare (required for Workers AI)
npx wrangler login

# 3. Start the dev server
npm run dev
```

Open http://localhost:5173.

> Workers AI has no local emulator — AI calls go to Cloudflare's API even in dev mode, so Cloudflare authentication is required.

## Deploy

```bash
npm run deploy
```

This builds the React app and Worker, then uploads both to Cloudflare. The Durable Object migration runs automatically on first deploy.

## Project structure

```
src/
  index.ts        # Cloudflare Worker entry + Chat Durable Object
  app.tsx         # React chat UI
  extractText.ts  # Client-side PDF and text extraction
  main.tsx        # React entry point
wrangler.jsonc    # Cloudflare bindings (Workers AI, Durable Objects, Assets)
vite.config.ts    # Vite build config
```

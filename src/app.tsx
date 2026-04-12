import { useAgentChat } from "@cloudflare/ai-chat/react";
import { isTextUIPart } from "ai";
import { useAgent } from "agents/react";
import { useState } from "react";

export default function App() {
  const agent = useAgent({ agent: "chat" });
  const { messages, sendMessage, status, isStreaming } = useAgentChat({ agent });
  const [input, setInput] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || isStreaming) return;
    sendMessage({ text });
    setInput("");
  }

  return (
    <div
      style={{
        maxWidth: 640,
        margin: "40px auto",
        fontFamily: "sans-serif",
        padding: "0 16px",
      }}
    >
      <h1>AI Chatbot</h1>

      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: 8,
          padding: 16,
          minHeight: 300,
          marginBottom: 16,
          overflowY: "auto",
          maxHeight: 500,
        }}
      >
        {messages.length === 0 && (
          <p style={{ color: "#999" }}>Start a conversation...</p>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            style={{
              marginBottom: 12,
              textAlign: m.role === "user" ? "right" : "left",
            }}
          >
            <span
              style={{
                display: "inline-block",
                background: m.role === "user" ? "#0070f3" : "#f0f0f0",
                color: m.role === "user" ? "#fff" : "#000",
                padding: "8px 12px",
                borderRadius: 8,
                maxWidth: "80%",
                wordBreak: "break-word",
              }}
            >
              {m.parts
                .filter(isTextUIPart)
                .map((p, i) => (
                  <span key={i}>{p.text}</span>
                ))}
            </span>
          </div>
        ))}
        {isStreaming && (
          <div style={{ color: "#999", fontStyle: "italic" }}>Thinking...</div>
        )}
      </div>

      <form onSubmit={handleSubmit} style={{ display: "flex", gap: 8 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message..."
          disabled={isStreaming}
          style={{
            flex: 1,
            padding: "8px 12px",
            borderRadius: 6,
            border: "1px solid #ddd",
            fontSize: 14,
          }}
        />
        <button
          type="submit"
          disabled={isStreaming || !input.trim()}
          style={{
            padding: "8px 16px",
            borderRadius: 6,
            background: "#0070f3",
            color: "#fff",
            border: "none",
            cursor: "pointer",
            fontSize: 14,
          }}
        >
          Send
        </button>
      </form>
    </div>
  );
}

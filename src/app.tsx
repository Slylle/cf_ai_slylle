import { useAgentChat } from "@cloudflare/ai-chat/react";
import { isTextUIPart } from "ai";
import { useAgent } from "agents/react";
import { useEffect, useRef, useState } from "react";

export default function App() {
  const agent = useAgent({ agent: "chat" });
  const { messages, sendMessage, isStreaming } = useAgentChat({ agent });
  const [input, setInput] = useState("");
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isStreaming]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || isStreaming) return;
    sendMessage({ text });
    setInput("");
  }

  function toggleVoice() {
    if (isListening) {
      recognitionRef.current?.stop();
      return;
    }

    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      alert("Speech recognition is not supported in this browser. Try Chrome or Edge.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.continuous = false;

    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => setIsListening(false);
    recognition.onerror = () => setIsListening(false);

    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      // Send directly instead of filling the input box
      if (transcript.trim() && !isStreaming) {
        sendMessage({ text: transcript.trim() });
      }
    };

    recognitionRef.current = recognition;
    recognition.start();
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
              {m.parts.filter(isTextUIPart).map((p, i) => (
                <span key={i}>{p.text}</span>
              ))}
            </span>
          </div>
        ))}
        {isStreaming && (
          <div style={{ color: "#999", fontStyle: "italic" }}>Thinking...</div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={handleSubmit} style={{ display: "flex", gap: 8 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={isListening ? "Listening..." : "Type a message..."}
          disabled={isStreaming || isListening}
          style={{
            flex: 1,
            padding: "8px 12px",
            borderRadius: 6,
            border: `1px solid ${isListening ? "#e53e3e" : "#ddd"}`,
            fontSize: 14,
            transition: "border-color 0.2s",
          }}
        />
        <button
          type="button"
          onClick={toggleVoice}
          disabled={isStreaming}
          title={isListening ? "Stop listening" : "Speak"}
          style={{
            padding: "8px 12px",
            borderRadius: 6,
            background: isListening ? "#e53e3e" : "#f0f0f0",
            color: isListening ? "#fff" : "#333",
            border: "none",
            cursor: isStreaming ? "not-allowed" : "pointer",
            fontSize: 18,
            transition: "background 0.2s",
          }}
        >
          {isListening ? "⏹" : "🎤"}
        </button>
        <button
          type="submit"
          disabled={isStreaming || isListening || !input.trim()}
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

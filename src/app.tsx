import { useAgentChat } from "@cloudflare/ai-chat/react";
import { isTextUIPart } from "ai";
import { useAgent } from "agents/react";
import { useEffect, useRef, useState } from "react";

// Parse the message we build in buildText() back into display parts.
// The wire format is:  [Document: name]\n\n{content}\n\n---\n\n...{question}
// We only show the question + doc names (not the raw content) in the UI.
function parseUserMessage(raw: string): { docNames: string[]; question: string } {
  const SEP = "\n\n---\n\n";
  const parts = raw.split(SEP);
  if (parts.length === 1) return { docNames: [], question: raw };
  const question = parts[parts.length - 1];
  const docNames = parts.slice(0, -1).map((p) => {
    const m = p.match(/^\[Document: (.+?)\]/);
    return m ? m[1] : "Document";
  });
  return { docNames, question };
}
import { type ExtractedFile, extractText, isSupportedFile } from "./extractText";

export default function App() {
  const agent = useAgent({ agent: "chat" });
  const { messages, sendMessage, isStreaming } = useAgentChat({ agent });

  const [input, setInput] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [attachments, setAttachments] = useState<ExtractedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isStreaming]);

  // ── Submit ────────────────────────────────────────────────────────────────

  function buildText(userText: string): string {
    if (attachments.length === 0) return userText;
    const docs = attachments
      .map((f) => `[Document: ${f.name}]\n\n${f.content}`)
      .join("\n\n---\n\n");
    return `${docs}\n\n---\n\n${userText}`;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = buildText(input.trim());
    if (!text.trim() || isStreaming) return;
    sendMessage({ text });
    setInput("");
    setAttachments([]);
  }

  // ── Voice ─────────────────────────────────────────────────────────────────

  function toggleVoice() {
    if (isListening) {
      recognitionRef.current?.stop();
      return;
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      alert("Speech recognition is not supported in this browser. Try Chrome or Edge.");
      return;
    }
    const recognition = new SR();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => setIsListening(false);
    recognition.onerror = () => setIsListening(false);
    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript.trim();
      if (transcript && !isStreaming) {
        const text = buildText(transcript);
        sendMessage({ text });
        setAttachments([]);
      }
    };
    recognitionRef.current = recognition;
    recognition.start();
  }

  // ── File handling ─────────────────────────────────────────────────────────

  async function processFiles(files: FileList | File[]) {
    const list = Array.from(files).filter(isSupportedFile);
    if (list.length === 0) return;
    setIsExtracting(true);
    try {
      const extracted = await Promise.all(list.map(extractText));
      setAttachments((prev) => [...prev, ...extracted]);
    } finally {
      setIsExtracting(false);
    }
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files) processFiles(e.target.files);
    e.target.value = "";
  }

  // Drag-and-drop on the whole chat area
  function onDragEnter(e: React.DragEvent) {
    e.preventDefault();
    dragCounterRef.current += 1;
    setIsDragging(true);
  }
  function onDragLeave(e: React.DragEvent) {
    e.preventDefault();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current === 0) setIsDragging(false);
  }
  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
  }
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    dragCounterRef.current = 0;
    setIsDragging(false);
    if (e.dataTransfer.files.length) processFiles(e.dataTransfer.files);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const canSend = !isStreaming && !isListening && !isExtracting &&
    (input.trim().length > 0 || attachments.length > 0);

  return (
    <div
      style={{ maxWidth: 640, margin: "40px auto", fontFamily: "sans-serif", padding: "0 16px" }}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <h1>AI Chatbot</h1>

      {/* Message list */}
      <div
        style={{
          border: `2px ${isDragging ? "dashed #0070f3" : "solid #ddd"}`,
          borderRadius: 8,
          padding: 16,
          minHeight: 300,
          marginBottom: 12,
          overflowY: "auto",
          maxHeight: 500,
          background: isDragging ? "#f0f7ff" : "#fff",
          transition: "border-color 0.15s, background 0.15s",
          position: "relative",
        }}
      >
        {isDragging && (
          <div style={{
            position: "absolute", inset: 0, display: "flex",
            alignItems: "center", justifyContent: "center",
            fontSize: 16, color: "#0070f3", pointerEvents: "none",
          }}>
            Drop documents here
          </div>
        )}

        {!isDragging && messages.length === 0 && (
          <p style={{ color: "#999" }}>
            Start a conversation — or drop a document anywhere to attach it.
          </p>
        )}

        {messages.map((m) => {
          const rawText = m.parts.filter(isTextUIPart).map((p) => p.text).join("");
          const { docNames, question } =
            m.role === "user" ? parseUserMessage(rawText) : { docNames: [], question: rawText };

          return (
            <div key={m.id} style={{ marginBottom: 12, textAlign: m.role === "user" ? "right" : "left" }}>
              {/* Document badges above user bubble */}
              {docNames.length > 0 && (
                <div style={{ marginBottom: 4, display: "flex", justifyContent: "flex-end", flexWrap: "wrap", gap: 4 }}>
                  {docNames.map((name, i) => (
                    <span key={i} style={{
                      display: "inline-block", fontSize: 11,
                      background: "#e8f0fe", color: "#1a56db",
                      padding: "2px 7px", borderRadius: 10,
                    }}>
                      📄 {name}
                    </span>
                  ))}
                </div>
              )}
              <span style={{
                display: "inline-block",
                background: m.role === "user" ? "#0070f3" : "#f0f0f0",
                color: m.role === "user" ? "#fff" : "#000",
                padding: "8px 12px", borderRadius: 8,
                maxWidth: "80%", wordBreak: "break-word",
                whiteSpace: "pre-wrap",
              }}>
                {question}
              </span>
            </div>
          );
        })}

        {isStreaming && (
          <div style={{ color: "#999", fontStyle: "italic" }}>Thinking...</div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Attachment chips */}
      {attachments.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
          {attachments.map((f, i) => (
            <span key={i} style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              background: "#e8f0fe", color: "#1a56db",
              padding: "3px 8px", borderRadius: 12, fontSize: 12,
            }}>
              📄 {f.name}
              <button
                onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                style={{ background: "none", border: "none", cursor: "pointer", padding: 0, color: "#1a56db", fontSize: 14, lineHeight: 1 }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Input row */}
      <form onSubmit={handleSubmit} style={{ display: "flex", gap: 8 }}>
        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.txt,.md,.markdown,.csv,.json,.xml,.yaml,.yml"
          multiple
          style={{ display: "none" }}
          onChange={handleFileInput}
        />

        {/* Attach button */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isStreaming || isExtracting}
          title="Attach document"
          style={{
            padding: "8px 12px", borderRadius: 6,
            background: "#f0f0f0", color: "#333",
            border: "none", cursor: "pointer", fontSize: 18,
          }}
        >
          {isExtracting ? "⏳" : "📎"}
        </button>

        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={isListening ? "Listening..." : "Type a message..."}
          disabled={isStreaming || isListening}
          style={{
            flex: 1, padding: "8px 12px", borderRadius: 6, fontSize: 14,
            border: `1px solid ${isListening ? "#e53e3e" : "#ddd"}`,
            transition: "border-color 0.2s",
          }}
        />

        {/* Mic button */}
        <button
          type="button"
          onClick={toggleVoice}
          disabled={isStreaming}
          title={isListening ? "Stop listening" : "Speak"}
          style={{
            padding: "8px 12px", borderRadius: 6, border: "none",
            background: isListening ? "#e53e3e" : "#f0f0f0",
            color: isListening ? "#fff" : "#333",
            cursor: isStreaming ? "not-allowed" : "pointer",
            fontSize: 18, transition: "background 0.2s",
          }}
        >
          {isListening ? "⏹" : "🎤"}
        </button>

        <button
          type="submit"
          disabled={!canSend}
          style={{
            padding: "8px 16px", borderRadius: 6,
            background: "#0070f3", color: "#fff",
            border: "none", cursor: canSend ? "pointer" : "not-allowed",
            fontSize: 14, opacity: canSend ? 1 : 0.6,
          }}
        >
          Send
        </button>
      </form>
    </div>
  );
}

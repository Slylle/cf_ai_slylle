import { useAgentChat } from "@cloudflare/ai-chat/react";
import { useAgent } from "agents/react";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { type ExtractedFile, extractText, isSupportedFile } from "./extractText";

type ChatRecord = {
  id: string;
  title: string;
  preview: string;
  createdAt: number;
  updatedAt: number;
  draftTitle: string;
  draftContent: string;
  draftOpen: boolean;
  draftDirty: boolean;
};

type PendingDocumentTurn = {
  userIndex: number;
};

// Parse the message we build in buildText() back into display parts.
// The wire format is:  [Document: name]\n\n{content}\n\n---\n\n...{question}
// We only show the question + doc names (not the raw content) in the UI.
function parseUserMessage(raw: string): { docNames: string[]; question: string } {
  const draftContextPattern = /\n\n\[DRAFT CONTEXT\][\s\S]*?\n\n\[\/DRAFT CONTEXT\]\n\n?/g;
  const withoutDraftContext = raw.replace(draftContextPattern, "\n\n");
  const SEP = "\n\n---\n\n";
  const parts = withoutDraftContext.split(SEP);
  if (parts.length === 1) return { docNames: [], question: raw };
  const question = parts[parts.length - 1];
  const docNames = parts.slice(0, -1).map((p) => {
    const m = p.match(/^\[Document: (.+?)\]/);
    return m ? m[1] : "Document";
  });
  return { docNames, question };
}

function isDocumentRequest(text: string): boolean {
  const normalized = text.toLowerCase();
  return (
    /\b(write|draft|create|compose|generate)\b.*\b(document|doc|report|proposal|letter|essay|article|email|memo|plan)\b/.test(
      normalized
    ) ||
    /\b(document|doc|report|proposal|letter|essay|article|email|memo|plan)\b.*\b(write|draft|create|compose|generate)\b/.test(
      normalized
    ) ||
    /\bwrite a document\b/.test(normalized)
  );
}

function shouldIncludeDraftContext(text: string): boolean {
  const normalized = text.toLowerCase();
  return (
    /\b(this draft|the draft|current draft|this document|the document|revise|rewrite|update|edit|modify|improve|expand|shorten|polish|continue|add to)\b/.test(
      normalized
    )
  );
}

function getMessageText(message: { parts: any[] }): string {
  return message.parts.map((part) => (typeof part?.text === "string" ? part.text : "")).join("");
}

function extractDraftContent(raw: string): string {
  const codeBlocks: string[] = [];
  const codeBlockPattern = /```[\w-]*\n([\s\S]*?)```/g;

  for (const match of raw.matchAll(codeBlockPattern)) {
    const block = (match[1] ?? "").replace(/^\n+|\n+$/g, "");
    if (block.trim().length > 0) {
      codeBlocks.push(block);
    }
  }

  if (codeBlocks.length > 0) {
    return codeBlocks.join("\n\n").trim();
  }

  return raw.replace(/^#\s*document\s+draft\s*\n+/i, "").trim();
}

function makeId(): string {
  return window.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function summarizeText(text: string, maxLength = 48): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, maxLength - 1).trimEnd()}…`;
}

function createChatRecord(id?: string): ChatRecord {
  const now = Date.now();
  return {
    id: id ?? makeId(),
    title: "New chat",
    preview: "No messages yet",
    createdAt: now,
    updatedAt: now,
    draftTitle: "Document draft",
    draftContent: "",
    draftOpen: false,
    draftDirty: false,
  };
}

function loadChatRecords(storageKey: string): ChatRecord[] {
  if (typeof window === "undefined") return [createChatRecord("default")];

  const raw = window.localStorage.getItem(storageKey);
  if (!raw) return [createChatRecord("default")];

  try {
    const parsed = JSON.parse(raw) as ChatRecord[];
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch {
    // Fall through to a fresh record list.
  }

  return [createChatRecord("default")];
}

export default function App() {
  const [browserId] = useState(() => {
    if (typeof window === "undefined") return "default";

    const storageKey = "chat-session-id";
    const existing = window.localStorage.getItem(storageKey);
    if (existing) return existing;

    const generated = makeId();
    window.localStorage.setItem(storageKey, generated);
    return generated;
  });

  const chatsStorageKey = `chat-history-${browserId}`;
  const activeChatStorageKey = `active-chat-${browserId}`;
  const [initialChatState] = useState(() => {
    const records = loadChatRecords(chatsStorageKey);
    const storedActiveChatId = typeof window === "undefined"
      ? undefined
      : window.localStorage.getItem(activeChatStorageKey);
    return {
      records,
      activeChatId: storedActiveChatId || records[0]?.id || "default",
    };
  });
  const [chatRecords, setChatRecords] = useState<ChatRecord[]>(() => initialChatState.records);
  const [activeChatId, setActiveChatId] = useState<string>(() => initialChatState.activeChatId);

  const activeChat = chatRecords.find((chat) => chat.id === activeChatId) ?? chatRecords[0] ?? createChatRecord(activeChatId);

  const agent = useAgent({ agent: "chat", name: `${browserId}:${activeChatId}` });
  const { messages, sendMessage, isStreaming } = useAgentChat({
    agent,
    prepareSendMessagesRequest: ({ messages: outgoingMessages }) => {
      const latestUserMessage = [...outgoingMessages].reverse().find((message) => message.role === "user");
      if (!latestUserMessage) return {};

      const latestUserText = getMessageText(latestUserMessage).trim();
      const documentMode = isDocumentRequest(latestUserText) || shouldIncludeDraftContext(latestUserText);
      if (!documentMode) return {};

      const hasWorkingDraft = documentContent.trim().length > 0;

      return {
        body: {
          documentMode: true,
          documentTitle,
          documentContent: hasWorkingDraft ? documentContent : "",
          userRequest: latestUserText,
        },
      };
    },
  });

  const [input, setInput] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [attachments, setAttachments] = useState<ExtractedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isDocumentPanelOpen, setIsDocumentPanelOpen] = useState(activeChat.draftOpen);
  const [documentTitle, setDocumentTitle] = useState(activeChat.draftTitle);
  const [documentContent, setDocumentContent] = useState(activeChat.draftContent);
  const [isDocumentDirty, setIsDocumentDirty] = useState(activeChat.draftDirty);
  const [pendingDocumentTurn, setPendingDocumentTurn] = useState<PendingDocumentTurn | null>(null);

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);

  useLayoutEffect(() => {
    setIsDocumentPanelOpen(activeChat.draftOpen);
    setDocumentTitle(activeChat.draftTitle);
    setDocumentContent(activeChat.draftContent);
    setIsDocumentDirty(activeChat.draftDirty);
    setPendingDocumentTurn(null);
  }, [activeChatId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isStreaming]);

  useEffect(() => {
    if (!pendingDocumentTurn) return;

    const pendingUserMessage = messages[pendingDocumentTurn.userIndex];
    if (!pendingUserMessage || pendingUserMessage.role !== "user") return;

    let currentTurnAssistantMessage: (typeof messages)[number] | undefined;
    let hasNextUserMessage = false;

    for (let index = pendingDocumentTurn.userIndex + 1; index < messages.length; index += 1) {
      const message = messages[index];
      if (message.role === "assistant") {
        currentTurnAssistantMessage = message;
        break;
      }
      if (message.role === "user") {
        hasNextUserMessage = true;
        break;
      }
    }

    if (!currentTurnAssistantMessage) {
      // If a new user turn started without an assistant reply for the pending doc turn,
      // clear pending state so later replies cannot overwrite the draft by accident.
      if (hasNextUserMessage && !isStreaming) {
        setPendingDocumentTurn(null);
      }
      return;
    }

    const text = getMessageText(currentTurnAssistantMessage);
    const nextDraftContent = isStreaming ? text : extractDraftContent(text);
    if (nextDraftContent.trim() || isStreaming) {
      setDocumentContent(nextDraftContent);
    }

    if (!isStreaming) {
      setIsDocumentDirty(false);
      setIsDocumentPanelOpen(true);
      setPendingDocumentTurn(null);
    }
  }, [messages, pendingDocumentTurn, isStreaming]);

  useEffect(() => {
    const latestMessage = [...messages].reverse().find(Boolean);
    const lastPreview = latestMessage ? summarizeText(getMessageText(latestMessage), 72) : "No messages yet";

    setChatRecords((previousRecords) =>
      previousRecords.map((chat) => {
        if (chat.id !== activeChatId) return chat;

        const nextRecord = {
          ...chat,
          title: chat.title,
          preview: lastPreview,
          updatedAt: Date.now(),
          draftTitle: documentTitle,
          draftContent: documentContent,
          draftOpen: isDocumentPanelOpen,
          draftDirty: isDocumentDirty,
        };

        const unchanged =
          chat.title === nextRecord.title &&
          chat.preview === nextRecord.preview &&
          chat.draftTitle === nextRecord.draftTitle &&
          chat.draftContent === nextRecord.draftContent &&
          chat.draftOpen === nextRecord.draftOpen &&
          chat.draftDirty === nextRecord.draftDirty;

        return unchanged ? chat : nextRecord;
      })
    );
  }, [messages, activeChatId, documentTitle, documentContent, isDocumentPanelOpen, isDocumentDirty]);

  useEffect(() => {
    window.localStorage.setItem(chatsStorageKey, JSON.stringify(chatRecords));
    window.localStorage.setItem(activeChatStorageKey, activeChatId);
  }, [chatRecords, activeChatId, chatsStorageKey, activeChatStorageKey]);

  // ── Submit ────────────────────────────────────────────────────────────────

  function buildText(userText: string): string {
    const parts: string[] = [];

    if (attachments.length > 0) {
      parts.push(
        attachments
          .map((f) => `[Document: ${f.name}]\n\n${f.content}`)
          .join("\n\n---\n\n")
      );
    }

    parts.push(userText);
    return parts.filter((part) => part.trim().length > 0).join("\n\n---\n\n");
  }

  function resetDocumentDraft(title = "Document draft") {
    setIsDocumentPanelOpen(true);
    setDocumentTitle(title);
    setDocumentContent("");
    setIsDocumentDirty(false);
  }

  function closeDocumentPanel() {
    setIsDocumentPanelOpen(false);
  }

  function openDocumentPanel() {
    setIsDocumentPanelOpen(true);
  }

  function persistCurrentChatDraft(nextState?: Partial<Pick<ChatRecord, "draftTitle" | "draftContent" | "draftOpen" | "draftDirty">>) {
    setChatRecords((previousRecords) =>
      previousRecords.map((chat) =>
        chat.id === activeChatId
          ? {
              ...chat,
              draftTitle: nextState?.draftTitle ?? documentTitle,
              draftContent: nextState?.draftContent ?? documentContent,
              draftOpen: nextState?.draftOpen ?? isDocumentPanelOpen,
              draftDirty: nextState?.draftDirty ?? isDocumentDirty,
            }
          : chat
      )
    );
  }

  function startNewChat() {
    persistCurrentChatDraft();
    const nextChat = createChatRecord();
    setChatRecords((previousRecords) => [nextChat, ...previousRecords]);
    setActiveChatId(nextChat.id);
    setInput("");
    setAttachments([]);
    setIsDocumentPanelOpen(false);
    setDocumentTitle(nextChat.draftTitle);
    setDocumentContent("");
    setIsDocumentDirty(false);
    setPendingDocumentTurn(null);
  }

  function switchChat(chatId: string) {
    if (chatId === activeChatId) return;
    persistCurrentChatDraft();
    setActiveChatId(chatId);
    setInput("");
    setAttachments([]);
  }

  function setInitialChatTitleFromPrompt(promptText: string) {
    const nextTitle = summarizeText(promptText, 36) || "New chat";
    setChatRecords((previousRecords) =>
      previousRecords.map((chat) =>
        chat.id === activeChatId && chat.title === "New chat"
          ? {
              ...chat,
              title: nextTitle,
            }
          : chat
      )
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = input.trim();
    const wantsDocument = isDocumentRequest(trimmed);
    const wantsDraftRevision = shouldIncludeDraftContext(trimmed);
    const text = buildText(trimmed);
    if (!text.trim() || isStreaming) return;

    setInitialChatTitleFromPrompt(trimmed);

    if (wantsDocument || wantsDraftRevision) {
      setPendingDocumentTurn({ userIndex: messages.length });
      setIsDocumentPanelOpen(true);
      if (wantsDocument && !wantsDraftRevision) {
        setDocumentContent("");
        setIsDocumentDirty(false);
      }
    }

    if (wantsDocument && !wantsDraftRevision) {
      setDocumentTitle("Document draft");
    }

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
        const wantsDocument = isDocumentRequest(transcript);
        const wantsDraftRevision = shouldIncludeDraftContext(transcript);
        setInitialChatTitleFromPrompt(transcript);
        if (wantsDocument || wantsDraftRevision) {
          setPendingDocumentTurn({ userIndex: messages.length });
          setIsDocumentPanelOpen(true);
          if (wantsDocument && !wantsDraftRevision) {
            setDocumentContent("");
            setIsDocumentDirty(false);
          }
        }
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

  const layoutStyle: CSSProperties = {
    maxWidth: 1200,
    margin: "40px auto",
    fontFamily: "sans-serif",
    padding: "0 16px",
  };

  const shellStyle: CSSProperties = {
    display: "flex",
    gap: 16,
    alignItems: "stretch",
    flexWrap: "wrap",
  };

  const chatPaneStyle: CSSProperties = {
    flex: "1 1 560px",
    minWidth: 0,
  };

  const historyPaneStyle: CSSProperties = {
    flex: "0 0 260px",
    minWidth: 240,
    border: "1px solid #dfe3e8",
    borderRadius: 12,
    padding: 12,
    background: "#fff",
    boxShadow: "0 8px 24px rgba(15, 23, 42, 0.04)",
    display: "flex",
    flexDirection: "column",
    gap: 12,
    maxHeight: 760,
  };

  const documentPaneStyle: CSSProperties = {
    flex: "1 1 360px",
    minWidth: 320,
    border: "1px solid #ddd",
    borderRadius: 12,
    padding: 16,
    background: "#fcfcfd",
    boxShadow: "0 8px 24px rgba(15, 23, 42, 0.06)",
    display: isDocumentPanelOpen ? "flex" : "none",
    flexDirection: "column",
    gap: 12,
  };

  const hasDocumentDraft = documentContent.trim().length > 0 || isDocumentDirty;
  const documentSyncLabel = pendingDocumentTurn
    ? "Updating draft..."
    : isDocumentDirty
      ? "Edited locally"
      : hasDocumentDraft
        ? "Draft synced"
        : "Draft empty";
  const documentSyncBackground = pendingDocumentTurn
    ? "#fff3cd"
    : isDocumentDirty
      ? "#e8f0fe"
      : hasDocumentDraft
        ? "#e6ffed"
        : "#f0f0f0";
  const documentSyncColor = pendingDocumentTurn
    ? "#8a6100"
    : isDocumentDirty
      ? "#1a56db"
      : hasDocumentDraft
        ? "#166534"
        : "#666";

  return (
    <div
      style={layoutStyle}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0 }}>AI Chatbot</h1>
          <p style={{ margin: "4px 0 0", color: "#666" }}>Chat, history, and document drafting in one workspace.</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={startNewChat}
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              border: "1px solid #d0d7de",
              background: "#fff",
              cursor: "pointer",
            }}
          >
            New chat
          </button>
          {!isDocumentPanelOpen && hasDocumentDraft && (
            <button
              type="button"
              onClick={openDocumentPanel}
              style={{
                padding: "8px 12px",
                borderRadius: 8,
                border: "1px solid #d0d7de",
                background: "#fff",
                cursor: "pointer",
              }}
            >
              Reopen document
            </button>
          )}

          {isDocumentPanelOpen && (
          <button
            type="button"
            onClick={closeDocumentPanel}
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              border: "1px solid #d0d7de",
              background: "#fff",
              cursor: "pointer",
            }}
          >
            Close document
          </button>
          )}
        </div>
      </div>

      <div style={shellStyle}>
        <aside style={historyPaneStyle}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 18 }}>Chat history</h2>
              <p style={{ margin: "4px 0 0", color: "#666", fontSize: 13 }}>Switch between saved chats.</p>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8, overflowY: "auto" }}>
            {chatRecords.map((chat) => {
              const active = chat.id === activeChatId;
              return (
                <button
                  key={chat.id}
                  type="button"
                  onClick={() => switchChat(chat.id)}
                  style={{
                    textAlign: "left",
                    padding: 10,
                    borderRadius: 10,
                    border: active ? "1px solid #0070f3" : "1px solid #d0d7de",
                    background: active ? "#eef5ff" : "#fff",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>{chat.title}</div>
                  <div style={{ fontSize: 12, color: "#666", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {chat.preview}
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        <div style={chatPaneStyle}>
          {/* Message list */}
          <div
            style={{
              border: `2px ${isDragging ? "dashed #0070f3" : "solid #ddd"}`,
              borderRadius: 12,
              padding: 16,
              minHeight: 300,
              marginBottom: 12,
              overflowY: "auto",
              maxHeight: 560,
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
                Start a conversation, or ask me to write a document and the editor will open beside the chat.
              </p>
            )}

            {messages.map((m) => {
              const rawText = getMessageText(m);
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

        <aside style={documentPaneStyle}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 18 }}>{documentTitle}</h2>
              <p style={{ margin: "4px 0 0", color: "#666", fontSize: 13 }}>
                Edit the draft directly. Changes stay local in your browser.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setDocumentContent("")}
              style={{
                padding: "6px 10px",
                borderRadius: 8,
                border: "1px solid #d0d7de",
                background: "#fff",
                cursor: "pointer",
                fontSize: 12,
              }}
            >
              Clear
            </button>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "4px 10px",
                borderRadius: 999,
                background: documentSyncBackground,
                color: documentSyncColor,
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              {documentSyncLabel}
            </span>
            {pendingDocumentTurn && (
              <span style={{ color: "#666", fontSize: 12 }}>Waiting for the assistant reply</span>
            )}
          </div>

          <textarea
            value={documentContent}
            onChange={(e) => {
              setDocumentContent(e.target.value);
              setIsDocumentDirty(true);
            }}
            placeholder="Ask the chatbot to write a document and the draft will appear here."
            style={{
              minHeight: 520,
              width: "100%",
              resize: "vertical",
              padding: 14,
              borderRadius: 10,
              border: "1px solid #d0d7de",
              fontFamily: "inherit",
              fontSize: 14,
              lineHeight: 1.6,
              boxSizing: "border-box",
              background: "#fff",
            }}
          />

          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, color: "#666", fontSize: 12 }}>
            <span>{isDocumentDirty ? "Edited locally" : "Synced with the latest assistant response"}</span>
            <button
              type="button"
              onClick={() => resetDocumentDraft(documentTitle)}
              style={{
                padding: 0,
                border: "none",
                background: "none",
                color: "#0070f3",
                cursor: "pointer",
                fontSize: 12,
              }}
            >
              New draft
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}

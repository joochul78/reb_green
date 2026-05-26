import React, { useState, useRef, useEffect } from "react";
import { Send, Cpu, BookOpen, X, Sparkles, MessageSquare } from "lucide-react";

export default function ChatArea({
  session,
  messages,
  selectedDocs,
  onSendMessage,
  loading
}) {
  const [input, setInput] = useState("");
  const [activeCitation, setActiveCitation] = useState(null);
  const messagesEndRef = useRef(null);

  // Auto-scroll to bottom of messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!input.trim() || loading) return;
    onSendMessage(input.trim());
    setInput("");
  };

  const handleCitationClick = (citation) => {
    setActiveCitation(citation);
  };

  const closeCitationModal = () => {
    setActiveCitation(null);
  };

  // Helper to format timestamps nicely
  const formatTime = (firebaseTimestamp) => {
    if (!firebaseTimestamp) return "";
    const date = firebaseTimestamp.toDate ? firebaseTimestamp.toDate() : new Date(firebaseTimestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <main className="chat-main">
      {/* Chat Area Header */}
      <header className="chat-header">
        <div className="chat-header-info">
          <h2 className="chat-header-title">
            {session ? session.title : "Gemini RAG 어시스턴트"}
          </h2>
          <p className="chat-header-subtitle">
            gemini-3.5-flash 모델 탑재
          </p>
        </div>
        
        {selectedDocs.length > 0 && (
          <div className="selected-docs-indicator">
            <BookOpen size={14} />
            <span>선택된 {selectedDocs.length}개의 문서와 대화 중</span>
          </div>
        )}
      </header>

      {/* Messages List / Welcome State */}
      <div className="messages-container">
        {!session ? (
          <div className="welcome-container">
            <div className="welcome-icon-glow">
              <Sparkles />
            </div>
            <h2 className="welcome-title">PDF RAG 에이전트 챗봇</h2>
            <p className="welcome-subtitle">
              대화를 시작하거나 기존 세션을 선택하세요. 사이드바에서 PDF를 업로드하고 선택하면 정밀한 벡터 검색을 통해 문서 내용을 기반으로 채팅할 수 있습니다.
            </p>
            <div className="welcome-steps">
              <div className="welcome-step">
                <span className="welcome-step-num">1</span>
                <span className="welcome-step-text">사이드바 우측 상단의 플러스(+) 버튼을 눌러 새 대화 세션을 만드세요.</span>
              </div>
              <div className="welcome-step">
                <span className="welcome-step-num">2</span>
                <span className="welcome-step-text">드래그 앤 드롭 영역을 통해 PDF 문서를 업로드해 주세요.</span>
              </div>
              <div className="welcome-step">
                <span className="welcome-step-num">3</span>
                <span className="welcome-step-text">컨텍스트로 사용할 문서를 라이브러리에서 선택하고 질문을 시작하세요.</span>
              </div>
            </div>
          </div>
        ) : messages.length === 0 ? (
          <div className="welcome-container">
            <div className="welcome-icon-glow" style={{ fontSize: '2rem', width: '60px', height: '60px' }}>
              <MessageSquare />
            </div>
            <h3 className="welcome-title" style={{ fontSize: '1.5rem' }}>활성화된 대화 세션</h3>
            <p className="welcome-subtitle">
              대화방이 준비되었습니다. 사이드바에서 문서(PDF)를 선택하고 아래에 질문을 입력하세요.
            </p>
          </div>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} className={`message-wrapper ${msg.role}`}>
              <div className="message-bubble">
                <div style={{ whiteSpace: 'pre-wrap' }}>
                  {msg.content}
                </div>

                {/* Citations badges */}
                {msg.citations && msg.citations.length > 0 && (
                  <div className="citations-container">
                    <div className="citations-label">
                      <Cpu size={14} />
                      <span>참조 출처</span>
                    </div>
                    <div className="citations-list">
                      {msg.citations.map((cit) => (
                        <div
                          key={cit.id}
                          className="citation-badge"
                          onClick={() => handleCitationClick(cit)}
                          title={`페이지 ${cit.pageNumber} (${cit.docName})`}
                        >
                          [{cit.id}] {cit.docName} (p. {cit.pageNumber})
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <span className="message-time">
                {formatTime(msg.timestamp)}
              </span>
            </div>
          ))
        )}

        {/* Thinking Indicator */}
        {loading && (
          <div className="message-wrapper model">
            <div className="thinking-bubble">
              <Cpu className="spinner" size={16} />
              <span>Gemini가 문서를 읽으며 답변을 구상하는 중</span>
              <div className="thinking-dots">
                <span></span>
                <span></span>
                <span></span>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Bar */}
      <footer className="chat-input-container">
        <form onSubmit={handleSubmit} className="chat-input-wrapper">
          <input
            type="text"
            className="chat-input"
            placeholder={session ? "선택한 PDF 문서에 대해 질문해 보세요..." : "대화 세션을 생성하거나 선택해 주세요."}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={!session || loading}
          />
          <button
            type="submit"
            className="send-btn"
            disabled={!session || !input.trim() || loading}
          >
            <Send size={18} />
          </button>
        </form>
      </footer>

      {/* Citation Detail Modal */}
      {activeCitation && (
        <div className="citation-detail-overlay" onClick={closeCitationModal}>
          <div className="citation-detail-card" onClick={(e) => e.stopPropagation()}>
            <div className="citation-detail-header">
              <h3 className="citation-detail-title">참조 출처 [{activeCitation.id}]</h3>
              <button className="citation-detail-close" onClick={closeCitationModal}>
                <X size={18} />
              </button>
            </div>
            <div className="citation-detail-body">
              <div className="citation-meta-row">
                <div>
                  <span style={{ color: 'var(--text-muted)', marginRight: '6px' }}>문서:</span>
                  <span className="citation-meta-pill">{activeCitation.docName}</span>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)', marginRight: '6px' }}>페이지:</span>
                  <span className="citation-meta-pill">{activeCitation.pageNumber} 페이지</span>
                </div>
              </div>
              
              <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '-8px' }}>
                추출된 본문 문장
              </div>
              <div className="citation-snippet">
                {activeCitation.snippet}
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

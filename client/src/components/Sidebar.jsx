import React from "react";
import { MessageSquare, Plus, Trash2, FileText, Database, Sparkles, AlertCircle, Loader } from "lucide-react";
import UploadZone from "./UploadZone";

export default function Sidebar({
  sessions,
  currentSessionId,
  onSelectSession,
  onCreateSession,
  onDeleteSession,
  documents,
  selectedDocIds,
  onToggleDocSelect,
  onUploadFile
}) {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="brand">
          <Sparkles className="brand-icon" />
          <h1 className="brand-title">Gemini RAG 에이전트</h1>
        </div>
      </div>

      <div className="sidebar-content">
        {/* Chat Sessions Area */}
        <div>
          <div className="section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <span className="section-title">대화 목록</span>
            <button 
              onClick={onCreateSession} 
              className="btn btn-secondary" 
              style={{ padding: '6px 10px', borderRadius: '8px', fontSize: '0.8rem' }}
              title="새 대화 시작"
            >
              <Plus size={14} />
            </button>
          </div>

          <div className="session-list">
            {sessions.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', padding: '12px 0' }}>
                활성화된 대화가 없습니다.
              </div>
            ) : (
              sessions.map((session) => (
                <div
                  key={session.id}
                  className={`session-item ${currentSessionId === session.id ? "active" : ""}`}
                  onClick={() => onSelectSession(session.id)}
                >
                  <div className="session-info">
                    <MessageSquare size={16} />
                    <span className="session-title-text">{session.title}</span>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteSession(session.id);
                    }}
                    className="session-delete-btn"
                    title="대화 삭제"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Documents Management Area */}
        <div>
          <span className="section-title">문서 라이브러리</span>
          
          {/* Upload Dropzone */}
          <UploadZone onUploadFile={onUploadFile} />

          {/* Document list */}
          <div className="doc-list">
            {documents.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', padding: '24px 0', border: '1px dashed var(--border-color)', borderRadius: '12px' }}>
                <Database size={24} style={{ margin: '0 auto 8px auto', opacity: 0.5, display: 'block' }} />
                업로드된 문서가 없습니다.
              </div>
            ) : (
              documents.map((doc) => {
                const isSelected = selectedDocIds.includes(doc.id);
                
                // Translated status labels
                let displayStatus = doc.status;
                if (doc.status === 'processing') displayStatus = '분석 중';
                if (doc.status === 'ready') displayStatus = '준비 완료';
                if (doc.status === 'error') displayStatus = '오류';

                return (
                  <div
                    key={doc.id}
                    className={`doc-item ${isSelected ? "selected" : ""}`}
                    onClick={() => {
                      if (doc.status === 'ready') {
                        onToggleDocSelect(doc.id);
                      }
                    }}
                    style={{ opacity: doc.status === 'error' ? 0.7 : 1 }}
                  >
                    {doc.status === 'processing' ? (
                      <Loader size={18} className="spinner" style={{ color: 'var(--accent-purple)', flexShrink: 0 }} />
                    ) : doc.status === 'error' ? (
                      <AlertCircle size={18} style={{ color: 'var(--accent-rose)', flexShrink: 0 }} />
                    ) : (
                      <FileText size={18} className="doc-icon" style={{ color: isSelected ? 'var(--accent-cyan)' : 'var(--text-secondary)' }} />
                    )}
                    
                    <div className="doc-info">
                      <div className="doc-name" title={doc.name}>{doc.name}</div>
                      <div className="doc-meta">
                        <span>{(doc.size / 1024).toFixed(1)} KB</span>
                        <span>•</span>
                        <span className={`doc-status-badge status-${doc.status}`}>
                          {displayStatus}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}

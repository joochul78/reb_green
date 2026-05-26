import React, { useState, useEffect } from "react";
import { 
  collection, 
  doc, 
  addDoc, 
  deleteDoc, 
  onSnapshot, 
  query, 
  orderBy, 
  serverTimestamp,
  getDocs,
  updateDoc
} from "firebase/firestore";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { httpsCallable } from "firebase/functions";
import { auth, db, storage, functions, signInAnonymously } from "./firebase";
import Sidebar from "./components/Sidebar";
import ChatArea from "./components/ChatArea";

export default function App() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [sessions, setSessions] = useState([]);
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [selectedDocIds, setSelectedDocIds] = useState([]);
  const [chatLoading, setChatLoading] = useState(false);

  // 1. Authenticate anonymously on load
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
        setAuthLoading(false);
      } else {
        try {
          await signInAnonymously(auth);
        } catch (err) {
          console.error("Anonymous authentication error:", err);
          alert("Failed to authenticate anonymously. Please refresh the page.");
          setAuthLoading(false);
        }
      }
    });
    return () => unsubscribe();
  }, []);

  // 2. Fetch Chat Sessions in real-time
  useEffect(() => {
    if (!user) return;

    const sessionsRef = collection(db, "users", user.uid, "sessions");
    const q = query(sessionsRef, orderBy("updatedAt", "desc"));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedSessions = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setSessions(fetchedSessions);
      
      // Auto-select the first session if none is selected and sessions exist
      if (fetchedSessions.length > 0 && !currentSessionId) {
        setCurrentSessionId(fetchedSessions[0].id);
      }
    }, (err) => {
      console.error("Error fetching sessions:", err);
    });

    return () => unsubscribe();
  }, [user]);

  // 3. Fetch User Documents in real-time
  useEffect(() => {
    if (!user) return;

    const docsRef = collection(db, "users", user.uid, "documents");
    const q = query(docsRef, orderBy("createdAt", "desc"));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedDocs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setDocuments(fetchedDocs);
    }, (err) => {
      console.error("Error fetching documents:", err);
    });

    return () => unsubscribe();
  }, [user]);

  // 4. Fetch Messages for the Active Session in real-time
  useEffect(() => {
    if (!user || !currentSessionId) {
      setMessages([]);
      return;
    }

    const messagesRef = collection(db, "users", user.uid, "sessions", currentSessionId, "messages");
    const q = query(messagesRef, orderBy("timestamp", "asc"));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedMessages = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setMessages(fetchedMessages);
    }, (err) => {
      console.error("Error fetching messages:", err);
    });

    return () => unsubscribe();
  }, [user, currentSessionId]);

  // Handle Session Creation
  const handleCreateSession = async () => {
    if (!user) return;
    try {
      const sessionsRef = collection(db, "users", user.uid, "sessions");
      const title = `대화 ${sessions.length + 1}`;
      const newSessionDoc = await addDoc(sessionsRef, {
        title: title,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      setCurrentSessionId(newSessionDoc.id);
    } catch (err) {
      console.error("Error creating session:", err);
    }
  };

  // Handle Session Deletion (Deletes subcollections as well)
  const handleDeleteSession = async (sessionId) => {
    if (!user) return;
    try {
      const sessionRef = doc(db, "users", user.uid, "sessions", sessionId);
      
      // Clean up subcollection messages first (needed for emulator/local testing)
      const messagesRef = collection(db, "users", user.uid, "sessions", sessionId, "messages");
      const messagesSnap = await getDocs(messagesRef);
      const deletePromises = messagesSnap.docs.map(doc => deleteDoc(doc.ref));
      await Promise.all(deletePromises);

      // Delete main session document
      await deleteDoc(sessionRef);

      if (currentSessionId === sessionId) {
        const remaining = sessions.filter(s => s.id !== sessionId);
        setCurrentSessionId(remaining.length > 0 ? remaining[0].id : null);
      }
    } catch (err) {
      console.error("Error deleting session:", err);
    }
  };

  // Toggle Document Selection
  const handleToggleDocSelect = (docId) => {
    setSelectedDocIds(prev => 
      prev.includes(docId) 
        ? prev.filter(id => id !== docId) 
        : [...prev, docId]
    );
  };

  // Handle PDF Upload to Storage
  const handleUploadFile = async (file) => {
    if (!user) return;
    
    // 1. Create a metadata document in Firestore first to generate a docId
    const docsCollRef = collection(db, "users", user.uid, "documents");
    let docRef;
    
    try {
      docRef = await addDoc(docsCollRef, {
        name: file.name,
        size: file.size,
        status: "processing",
        createdAt: serverTimestamp()
      });
    } catch (err) {
      console.error("Error creating document metadata in Firestore:", err);
      alert("문서 업로드 초기화에 실패했습니다.");
      return;
    }

    // 2. Upload the file to Firebase Storage under the generated path
    const storagePath = `users/${user.uid}/documents/${docRef.id}/${file.name}`;
    const storageRef = ref(storage, storagePath);
    const uploadTask = uploadBytesResumable(storageRef, file);

    uploadTask.on(
      "state_changed",
      (snapshot) => {
        // We could track upload percentage if desired
        const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
        console.log(`Upload progress: ${progress.toFixed(0)}%`);
      },
      async (err) => {
        console.error("Storage upload error:", err);
        const docDocRef = doc(db, "users", user.uid, "documents", docRef.id);
        await updateDoc(docDocRef, {
          status: "error",
          errorMessage: err.message || "스토리지 업로드에 실패했습니다."
        });
      },
      async () => {
        try {
          const downloadUrl = await getDownloadURL(uploadTask.snapshot.ref);
          const docDocRef = doc(db, "users", user.uid, "documents", docRef.id);
          await updateDoc(docDocRef, {
            status: "processing", // Triggers background Cloud Function
            storagePath: storagePath,
            downloadUrl: downloadUrl
          });
        } catch (err) {
          console.error("Error finalizing upload metadata:", err);
        }
      }
    );
  };

  // Send RAG chat request to backend Cloud Function
  const handleSendMessage = async (text) => {
    if (!user || !currentSessionId) return;
    setChatLoading(true);

    try {
      const chatWithPdfFn = httpsCallable(functions, "chatWithPdf");
      const res = await chatWithPdfFn({
        sessionId: currentSessionId,
        documentIds: selectedDocIds,
        message: text
      });
      console.log("Chat response returned successfully.");
    } catch (err) {
      console.error("Error calling chatWithPdf function:", err);
      alert(`채팅 오류: ${err.message}`);
    } finally {
      setChatLoading(false);
    }
  };

  if (authLoading) {
    return (
      <div className="auth-loading-overlay">
        <div className="spinner"></div>
        <p style={{ fontFamily: 'var(--font-heading)', fontWeight: 500, color: 'var(--text-secondary)' }}>
          안전한 익명 연결을 설정하는 중...
        </p>
      </div>
    );
  }

  const selectedDocs = documents.filter(doc => selectedDocIds.includes(doc.id));
  const activeSession = sessions.find(s => s.id === currentSessionId);

  return (
    <div className="app-container">
      <Sidebar
        sessions={sessions}
        currentSessionId={currentSessionId}
        onSelectSession={setCurrentSessionId}
        onCreateSession={handleCreateSession}
        onDeleteSession={handleDeleteSession}
        documents={documents}
        selectedDocIds={selectedDocIds}
        onToggleDocSelect={handleToggleDocSelect}
        onUploadFile={handleUploadFile}
      />
      
      <ChatArea
        session={activeSession}
        messages={messages}
        selectedDocs={selectedDocs}
        onSendMessage={handleSendMessage}
        loading={chatLoading}
      />
    </div>
  );
}

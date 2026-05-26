const { onObjectFinalized } = require("firebase-functions/v2/storage");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getStorage } = require("firebase-admin/storage");
const { getFirestore } = require("firebase-admin/firestore");
const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");
const os = require("os");
const pdf = require("pdf-parse");
const { GoogleGenerativeAI } = require("@google/generative-ai");

admin.initializeApp();
const db = getFirestore();

/**
 * Extracts text page-by-page from a PDF buffer.
 */
async function extractPages(buffer) {
  const pages = [];
  const options = {
    pager: function(pageData) {
      return pageData.getTextContent().then(function(textContent) {
        let lastY, text = "";
        for (const item of textContent.items) {
          if (lastY === item.transform[5] || !lastY) {
            text += item.str;
          } else {
            text += "\n" + item.str;
          }
          lastY = item.transform[5];
        }
        pages.push({
          pageNumber: pageData.pageIndex + 1,
          text: text
        });
        return text;
      });
    }
  };
  await pdf(buffer, options);
  // Sort pages by pageNumber to ensure correct order
  pages.sort((a, b) => a.pageNumber - b.pageNumber);
  return pages;
}

/**
 * Triggered when a PDF file is uploaded to Firebase Storage.
 * Extracts text, chunks it, generates embeddings, and saves to Firestore.
 */
exports.processPdfOnUpload = onObjectFinalized({
  maxInstances: 10,
  timeoutSeconds: 300,
  memory: "512MiB"
}, async (event) => {
  const filePath = event.data.name; // users/{userId}/documents/{docId}/{fileName}
  const bucketName = event.data.bucket;

  // We match users/{userId}/documents/{docId}/{fileName}
  const match = filePath.match(/^users\/([^/]+)\/documents\/([^/]+)\/(.+)$/);
  if (!match) {
    console.log(`File path ${filePath} does not match RAG pattern. Skipping.`);
    return null;
  }

  const userId = match[1];
  const docId = match[2];
  const fileName = decodeURIComponent(match[3]);

  console.log(`Processing PDF: userId=${userId}, docId=${docId}, fileName=${fileName}`);

  const docRef = db.collection("users").doc(userId).collection("documents").doc(docId);

  try {
    // 1. Download file to temporary location
    const bucket = getStorage().bucket(bucketName);
    const tempFilePath = path.join(os.tmpdir(), `${docId}.pdf`);
    await bucket.file(filePath).download({ destination: tempFilePath });

    // 2. Parse PDF page by page
    const dataBuffer = fs.readFileSync(tempFilePath);
    const pages = await extractPages(dataBuffer);

    // Clean up temp file
    fs.unlinkSync(tempFilePath);

    console.log(`Parsed ${pages.length} pages from PDF ${fileName}.`);

    // 3. Chunk text page by page
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY environment variable is not set.");
    }
    const genAI = new GoogleGenerativeAI(apiKey);
    const embedModel = genAI.getGenerativeModel({ model: "text-embedding-004" });

    const chunks = [];
    const maxChunkSize = 800;
    const overlap = 150;

    for (const page of pages) {
      const pageText = page.text.trim();
      if (!pageText) continue;

      let start = 0;
      while (start < pageText.length) {
        let end = start + maxChunkSize;
        if (end > pageText.length) end = pageText.length;

        const chunkText = pageText.substring(start, end).trim();
        if (chunkText.length > 50) { // Skip tiny fragments
          chunks.push({
            text: chunkText,
            pageNumber: page.pageNumber,
            docId: docId,
            docName: fileName
          });
        }
        start += (maxChunkSize - overlap);
      }
    }

    console.log(`Generated ${chunks.length} chunks. Generating embeddings...`);

    // 4. Generate embeddings (batched in sizes of 10)
    const batchSize = 10;
    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      await Promise.all(batch.map(async (chunk) => {
        const result = await embedModel.embedContent(chunk.text);
        chunk.embedding = result.embedding.values;
      }));
    }

    // 5. Save chunks to Firestore in batches
    console.log(`Writing chunks to Firestore...`);
    const chunksColl = docRef.collection("chunks");
    
    // Firestore batch write limit is 500 operations
    const firestoreBatchSize = 400;
    for (let i = 0; i < chunks.length; i += firestoreBatchSize) {
      const dbBatch = db.batch();
      const chunkBatch = chunks.slice(i, i + firestoreBatchSize);
      
      chunkBatch.forEach((chunk) => {
        const chunkDocRef = chunksColl.doc();
        dbBatch.set(chunkDocRef, {
          text: chunk.text,
          pageNumber: chunk.pageNumber,
          docId: chunk.docId,
          docName: chunk.docName,
          embedding: chunk.embedding,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
      });
      await dbBatch.commit();
    }

    // Update document status in Firestore
    await docRef.update({
      status: "ready",
      chunksCount: chunks.length,
      processedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    console.log(`Successfully processed document ${docId}.`);
  } catch (err) {
    console.error(`Error processing PDF:`, err);
    await docRef.update({
      status: "error",
      errorMessage: err.message,
      processedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  }

  return null;
});

/**
 * Callable function for RAG chat.
 * Retrieves top matching document chunks, builds prompt context, and queries Gemini.
 */
exports.chatWithPdf = onCall({
  maxInstances: 10,
  timeoutSeconds: 60,
  cors: true
}, async (request) => {
  // Ensure user is authenticated (using anonymous or email auth)
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "User must be authenticated.");
  }

  const userId = request.auth.uid;
  const { sessionId, documentIds, message } = request.data;

  if (!sessionId || !message) {
    throw new HttpsError("invalid-argument", "Missing sessionId or message.");
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new HttpsError("failed-precondition", "GEMINI_API_KEY is not configured on the server.");
  }

  console.log(`Chat request: userId=${userId}, session=${sessionId}, docIds=${documentIds}, messageLength=${message.length}`);

  try {
    const genAI = new GoogleGenerativeAI(apiKey);

    // 1. Generate query embedding
    const embedModel = genAI.getGenerativeModel({ model: "text-embedding-004" });
    const queryEmbedResult = await embedModel.embedContent(message);
    const queryEmbedding = queryEmbedResult.embedding.values;

    // 2. Fetch chunks from selected documents
    let chunks = [];
    let docsToQuery = [];

    if (documentIds && documentIds.length > 0) {
      docsToQuery = documentIds;
    } else {
      // Find all ready documents for this user
      const docsSnap = await db.collection("users").doc(userId).collection("documents")
        .where("status", "==", "ready")
        .get();
      docsToQuery = docsSnap.docs.map(doc => doc.id);
    }

    if (docsToQuery.length > 0) {
      const chunkPromises = docsToQuery.map(async (docId) => {
        const chunksSnap = await db.collection("users").doc(userId).collection("documents").doc(docId).collection("chunks").get();
        return chunksSnap.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
      });
      const chunksArrays = await Promise.all(chunkPromises);
      chunks = chunksArrays.flat();
    }

    console.log(`Retrieved ${chunks.length} chunks to score.`);

    if (chunks.length === 0) {
      // No documents uploaded or selected, just call Gemini standard chat
      const sessionRef = db.collection("users").doc(userId).collection("sessions").doc(sessionId);
      const messagesSnap = await sessionRef.collection("messages")
        .orderBy("timestamp", "asc")
        .limit(10)
        .get();

      const history = messagesSnap.docs.map(doc => {
        const data = doc.data();
        return {
          role: data.role,
          parts: [{ text: data.content }]
        };
      });

      const modelName = process.env.GEMINI_MODEL || "gemini-3.5-flash";
      const geminiModel = genAI.getGenerativeModel({ model: modelName });
      const contents = [...history, { role: "user", parts: [{ text: message }] }];

      const result = await geminiModel.generateContent({
        contents: contents,
        generationConfig: { maxOutputTokens: 2048, temperature: 0.7 }
      });

      const answer = result.response.text();

      // Write to Firestore
      const batch = db.batch();
      const userMsgRef = sessionRef.collection("messages").doc();
      batch.set(userMsgRef, {
        role: "user",
        content: message,
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      });
      const modelMsgRef = sessionRef.collection("messages").doc();
      batch.set(modelMsgRef, {
        role: "model",
        content: answer,
        citations: [],
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      });
      batch.update(sessionRef, {
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      await batch.commit();

      return {
        answer: answer,
        citations: []
      };
    }

    // 3. Compute cosine similarity (dot product of normalized vectors)
    function dotProduct(vecA, vecB) {
      let product = 0;
      for (let i = 0; i < vecA.length; i++) {
        product += vecA[i] * vecB[i];
      }
      return product;
    }

    const scoredChunks = chunks.map((chunk) => {
      const score = dotProduct(queryEmbedding, chunk.embedding);
      return { ...chunk, score };
    });

    // Sort by similarity score descending
    scoredChunks.sort((a, b) => b.score - a.score);
    const topChunks = scoredChunks.slice(0, 5);

    // Keep chunks with score > 0.3
    const relevantChunks = topChunks.filter(chunk => chunk.score > 0.3);

    // 4. Construct prompt with context
    let contextText = "";
    const citations = [];

    if (relevantChunks.length > 0) {
      contextText = relevantChunks.map((chunk, idx) => {
        const citationId = idx + 1;
        citations.push({
          id: citationId,
          docId: chunk.docId,
          docName: chunk.docName,
          pageNumber: chunk.pageNumber,
          snippet: chunk.text
        });
        return `[Source ${citationId}] Page ${chunk.pageNumber} of ${chunk.docName}:\n${chunk.text}`;
      }).join("\n\n");
    } else {
      contextText = "관련이 깊은 문서 컨텍스트를 찾지 못했습니다. 일반 대화 형태의 인사말을 건네거나 필요한 문서가 있는지 문의하세요.";
    }

    // 5. Fetch recent chat history
    const sessionRef = db.collection("users").doc(userId).collection("sessions").doc(sessionId);
    const messagesSnap = await sessionRef.collection("messages")
      .orderBy("timestamp", "asc")
      .limit(10)
      .get();

    const history = messagesSnap.docs.map(doc => {
      const data = doc.data();
      return {
        role: data.role,
        parts: [{ text: data.content }]
      };
    });

    const modelName = process.env.GEMINI_MODEL || "gemini-3.5-flash";
    const systemInstruction = `당신은 친절한 RAG AI 어시스턴트입니다.
반드시 제공된 PDF 컨텍스트(Context) 정보만을 바탕으로 질문에 대답해야 합니다.
답변을 문서에서 찾을 수 없거나 추론할 수 없는 경우, 해당 문서들에서는 관련 정보를 찾을 수 없다고 솔직하게 진술하십시오. 답변을 임의로 지어내지 마십시오.
답변 시 정보의 출처를 언급할 때는 컨텍스트에 제공된 출처 인덱스와 일치하도록 [Source 1], [Source 2]와 같이 대괄호 형태의 인용 번호를 반드시 매칭하여 본문 중간 또는 끝에 덧붙여주십시오.

Context:
${contextText}
`;

    const contents = [...history, { role: "user", parts: [{ text: message }] }];
    const geminiModel = genAI.getGenerativeModel({
      model: modelName,
      systemInstruction: systemInstruction
    });

    console.log(`Calling Gemini Model: ${modelName} with context size ${contextText.length}`);
    const result = await geminiModel.generateContent({
      contents: contents,
      generationConfig: {
        maxOutputTokens: 2048,
        temperature: 0.2
      }
    });

    const answer = result.response.text();

    // 6. Save message history to Firestore
    const batch = db.batch();
    const userMsgRef = sessionRef.collection("messages").doc();
    batch.set(userMsgRef, {
      role: "user",
      content: message,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });

    const modelMsgRef = sessionRef.collection("messages").doc();
    batch.set(modelMsgRef, {
      role: "model",
      content: answer,
      citations: citations,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });

    batch.update(sessionRef, {
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    await batch.commit();

    return {
      answer: answer,
      citations: citations
    };

  } catch (err) {
    console.error("Error in chatWithPdf:", err);
    throw new HttpsError("internal", err.message || "An error occurred during chat processing.");
  }
});

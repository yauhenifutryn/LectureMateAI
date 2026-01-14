import { GoogleGenAI, Chat } from "@google/genai";
import { fileToBase64 } from "../utils/fileHelper";

const SYSTEM_INSTRUCTION = `
**Role & Objective:**
You are "The Master Tutor," a rigorous, skeptical Academic Teaching Assistant specializing in Finance and Private Equity. Your perspective is "Traditional Academic": you value historical context, intellectual integrity, and "hard" economic trade-offs over modern corporate marketing narratives.

**CRITICAL OUTPUT FORMAT INSTRUCTIONS:**
You must generate the output in PLAIN TEXT. Do NOT use JSON. Do NOT use markdown code blocks to wrap the separators.

1. Begin the response immediately with this exact separator:
   ===STUDY_GUIDE===

2. Write the **Comprehensive Study Guide** in Markdown format immediately following the separator.
   - Use # for Titles, ## for Sections.
   - Follow the structure: Executive Abstract, Concepts (Intuition, Skeptical View, Math), and Modern Reality.

3. Once the study guide is complete, insert this exact separator:
   ===TRANSCRIPT===

4. Write the **Verbatim Raw Transcript** of the audio immediately following the separator.

**Core Philosophy (The "Master Tutor" Persona):**
- **Skepticism:** Treat "win-win" narratives with suspicion.
- **Systems Thinking:** Finance is an open system.
- **Incentives Matter:** Who benefits?
- **Synthesize Sources:** Merge slides and audio.
`;

const CHAT_SYSTEM_INSTRUCTION = `
You are "The Master Tutor." You have just analyzed a lecture and provided a study guide.
The user is now asking follow-up questions.
1. Answer strictly based on the provided TRANSCRIPT and STUDY GUIDE context.
2. Maintain your skeptical, academic, rigorous persona.
3. If the user asks for a revision, rewrite the specific section using your academic style.
4. Use Markdown for formatting.
`;

// Threshold: Set to 0 to FORCE File API for everything.
const MAX_INLINE_SIZE_MB = 0;

/**
 * Helper: Decides whether to Inline (Base64) or Upload (File API) a file.
 */
async function processFile(ai: GoogleGenAI, file: File, label: string): Promise<any> {
  const sizeMB = file.size / (1024 * 1024);
  console.log(`Processing ${label}: ${file.name} (${sizeMB.toFixed(2)} MB)`);

  if (sizeMB < MAX_INLINE_SIZE_MB) {
    console.log(`-> Strategy: Inline Base64`);
    const base64 = await fileToBase64(file);
    return {
      inlineData: {
        mimeType: file.type || (file.name.endsWith('.pdf') ? 'application/pdf' : 'audio/mp3'),
        data: base64,
      },
    };
  }

  console.log(`-> Strategy: File API Upload`);
  try {
    const cleanName = file.name.replace(/[^\w.-]/g, '_');
    
    const uploadResult = await ai.files.upload({
      file: file,
      config: { 
        displayName: cleanName,
        mimeType: file.type || (file.name.endsWith('.pdf') ? 'application/pdf' : 'audio/mp3')
      }
    });

    const uploadedFile = (uploadResult as any).file || uploadResult;
    if (!uploadedFile || !uploadedFile.uri) {
      throw new Error(`Failed to upload ${file.name}`);
    }
    console.log(`-> Uploaded: ${uploadedFile.uri}`);

    let remoteFile = await ai.files.get({ name: uploadedFile.name });
    let attempts = 0;
    while (remoteFile.state === 'PROCESSING' && attempts < 60) {
      console.log(`-> Waiting for processing... (${remoteFile.state})`);
      await new Promise(resolve => setTimeout(resolve, 2000));
      remoteFile = await ai.files.get({ name: uploadedFile.name });
      attempts++;
    }

    if (remoteFile.state === 'FAILED') throw new Error(`Processing failed for ${file.name}`);
    
    console.log(`-> File Active: ${remoteFile.uri}`);
    await new Promise(resolve => setTimeout(resolve, 1000));

    return {
      fileData: {
        mimeType: remoteFile.mimeType,
        fileUri: remoteFile.uri
      }
    };

  } catch (e: any) {
    console.error(`Error processing ${file.name}:`, e);
    const msg = e.toString().toLowerCase();
    if (msg.includes('xhr') || msg.includes('500') || msg.includes('failed to fetch')) {
       throw new Error(`Upload Failed for ${file.name}. Network interrupted.`);
    }
    throw e;
  }
}

/**
 * Parses the raw plain text response using the strict separators.
 */
function parseResponseText(text: string): { studyGuide: string; transcript: string } {
  const GUIDE_SEP = "===STUDY_GUIDE===";
  const TRANS_SEP = "===TRANSCRIPT===";

  const guideIdx = text.indexOf(GUIDE_SEP);
  const transIdx = text.indexOf(TRANS_SEP);

  let studyGuide = "";
  let transcript = "";

  if (guideIdx !== -1 && transIdx !== -1) {
    // Both parts found
    studyGuide = text.substring(guideIdx + GUIDE_SEP.length, transIdx).trim();
    transcript = text.substring(transIdx + TRANS_SEP.length).trim();
  } else if (guideIdx !== -1) {
    // Only guide found
    studyGuide = text.substring(guideIdx + GUIDE_SEP.length).trim();
    transcript = "Transcript generation was interrupted or missing.";
  } else {
    // Fallback: Dump everything into guide
    studyGuide = text;
    transcript = "Could not parse output structure.";
  }

  // Cleanup: Remove any accidental markdown code fences around the content
  studyGuide = studyGuide.replace(/^```markdown/, '').replace(/^```/, '').replace(/```$/, '').trim();
  
  return { studyGuide, transcript };
}

export const analyzeAudioLecture = async (
  audioFile: File, 
  slideFiles: File[],
  userContext: string
): Promise<{ studyGuide: string; transcript: string }> => {
  console.log("--- STARTING ANALYSIS (STREAMING) ---");
  
  if (!process.env.API_KEY) {
    throw new Error("API Key is missing.");
  }

  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const parts: any[] = [];

  try {
    // 1. Process Files
    try {
      const audioPart = await processFile(ai, audioFile, "Audio");
      parts.push(audioPart);

      if (slideFiles.length > 0) {
        console.log(`Processing ${slideFiles.length} slides...`);
        for (const slide of slideFiles) {
          const slidePart = await processFile(ai, slide, "Slide");
          parts.push(slidePart);
        }
      }
    } catch (e: any) {
      throw new Error(`File Processing Error: ${e.message}`);
    }

    // 2. Add Prompt
    const promptText = `
    ${slideFiles.length > 0 ? `I have attached ${slideFiles.length} lecture slide file(s) and the lecture audio.` : "I have attached the lecture audio."}
    
    **Student's Additional Context:**
    ${userContext || "None provided."}
    
    Generate the output using the strict separators defined in the System Instructions.
    `;
    parts.push({ text: promptText });

    // 3. Generate via Stream
    console.log("Initiating Stream Request...");
    
    const responseStream = await ai.models.generateContentStream({
      model: 'gemini-3-flash-preview',
      contents: { parts },
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        temperature: 0.2,
      }
    });

    let fullText = "";
    console.log("Stream connected. Receiving chunks...");
    
    for await (const chunk of responseStream) {
      if (chunk.text) {
        fullText += chunk.text;
      }
    }

    console.log("Stream Complete. Length:", fullText.length);
    
    if (!fullText) {
      throw new Error("Received empty response from AI.");
    }

    return parseResponseText(fullText);

  } catch (error: any) {
    console.error("Analysis Failed:", error);
    
    const errMsg = error.message || error.toString();
    if (errMsg.includes('413') || errMsg.includes('too large')) {
      throw new Error("Payload Too Large. Reduce file count.");
    }
    if (errMsg.includes('xhr') || errMsg.includes('500')) {
      throw new Error("Connection Error. The network stream was interrupted.");
    }
    throw error;
  }
};

/**
 * Initializes a new Chat Session seeded with the transcript and study guide.
 */
export const initializeChatSession = (transcript: string, studyGuide: string): Chat => {
  if (!process.env.API_KEY) {
    throw new Error("API Key is missing.");
  }

  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  // Seed the chat with the context as the first history turn
  // This allows the model to "remember" the lecture without re-uploading files
  const chat = ai.chats.create({
    model: 'gemini-3-flash-preview',
    history: [
      {
        role: "user",
        parts: [{ text: `
Here is the verbatim transcript of the lecture I want to discuss:
${transcript.substring(0, 500000)} 

Here is the Study Guide you generated:
${studyGuide}
        `}]
      },
      {
        role: "model",
        parts: [{ text: "I have processed the transcript and study guide. I am ready to answer your questions as The Master Tutor." }]
      }
    ],
    config: {
      systemInstruction: CHAT_SYSTEM_INSTRUCTION,
      temperature: 0.3,
    }
  });

  return chat;
};
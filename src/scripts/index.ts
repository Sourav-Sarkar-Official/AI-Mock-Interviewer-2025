import {
  GoogleGenerativeAI,
  HarmCategory,
  HarmBlockThreshold,
}
  from "@google/generative-ai";

const apiKey = import.meta.env.VITE_GEMINI_API_KEY!;
const genAI = new GoogleGenerativeAI(apiKey);

// Preferred model (may not be available for all API versions)
const preferredModel = "gemini-3-flash-preview";

const generationConfig = {
  temperature: 1,
  topP: 0.95,
  topK: 64,
  maxOutputTokens: 8192,
  responseMimeType: "text/plain",
};
const safetySettings = [
  {
    category: HarmCategory.HARM_CATEGORY_HARASSMENT,
    threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
    threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
    threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
    threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
  },
];

let internalSession: any = null;
try {
  const model = genAI.getGenerativeModel({ model: preferredModel });
  internalSession = model.startChat({ generationConfig, safetySettings });
} catch (e) {
  // If model initialization failed, we'll fallback at request time.
  console.warn("Generative model init failed, will fallback to local generator.", e);
}

function generateLocalMock(prompt: string) {
  // Simple heuristic to extract tech stack from the prompt
  const techMatch = prompt.match(/Tech Stacks:\s*-\s*(.*)/i);
  const tech = techMatch ? techMatch[1].split(".")[0] : "the specified tech stack";

  const questions = [] as { question: string; answer: string }[];
  for (let i = 1; i <= 5; i++) {
    questions.push({
      question: `${i}. Describe a common ${tech} interview question and how to solve it.`,
      answer: `Sample answer for ${tech}: Explain the approach, key trade-offs, and example code or pseudocode.`,
    });
  }
  return JSON.stringify(questions);
}

export const chatSession = {
  // Keep the same public API used across the codebase: `chatSession.sendMessage(prompt)`
  sendMessage: async (prompt: string) => {
    // If we have a real session, try it first
    if (internalSession) {
      try {
        // delegate to the real session's sendMessage
        // This may throw network/API errors which we'll catch below
        return await internalSession.sendMessage(prompt);
      } catch (err) {
        console.error("Generative AI request failed, falling back to local generator:", err);
      }
    } else {
      console.warn("No generative AI session available — using local fallback.");
    }

    // Fallback: return a local mock response with the same shape expected by callers
    const text = generateLocalMock(prompt);
    return {
      response: {
        text: () => text,
      },
    };
  },
};

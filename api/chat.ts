import 'dotenv/config';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI } from '@google/genai';
import { toPublicError } from './_lib/errors.js';
import { CHAT_SYSTEM_INSTRUCTION } from './_lib/prompts.js';

type ChatMessage = {
  role: 'user' | 'model';
  content: string;
};

type ChatBody = {
  transcript?: string;
  studyGuide?: string;
  messages?: ChatMessage[];
};

function parseBody(req: VercelRequest): ChatBody {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    return JSON.parse(req.body) as ChatBody;
  }
  return req.body as ChatBody;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res
      .status(405)
      .json({ error: { code: 'method_not_allowed', message: 'POST required.' } });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res
      .status(500)
      .json({ error: { code: 'missing_api_key', message: 'Server misconfigured.' } });
  }

  try {
    const { transcript, studyGuide, messages } = parseBody(req);
    if (!transcript || !studyGuide || !Array.isArray(messages) || messages.length === 0) {
      throw new Error('Missing chat payload.');
    }

    const lastMessage = messages[messages.length - 1];
    if (lastMessage.role !== 'user') {
      throw new Error('Last chat message must be from user.');
    }

    const ai = new GoogleGenAI({ apiKey });
    const history = [
      {
        role: 'user',
        parts: [
          {
            text: `Here is the verbatim transcript of the lecture I want to discuss:\n${transcript}\n\nHere is the Study Guide you generated:\n${studyGuide}`
          }
        ]
      },
      ...messages.slice(0, -1).map((msg) => ({
        role: msg.role,
        parts: [{ text: msg.content }]
      }))
    ];

    const chat = ai.chats.create({
      model: 'gemini-3-flash-preview',
      history,
      config: {
        systemInstruction: CHAT_SYSTEM_INSTRUCTION,
        temperature: 0.3
      }
    });

    const result = await chat.sendMessage({ message: lastMessage.content });
    const reply = result.text || '';

    return res.status(200).json({ reply });
  } catch (error) {
    const publicError = toPublicError(error);
    return res.status(500).json({ error: publicError });
  }
}

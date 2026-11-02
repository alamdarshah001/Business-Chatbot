import "dotenv/config";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleGenAI } from "@google/genai";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- Setup ---
if (!process.env.GEMINI_API_KEY) {
  console.error("GEMINI_API_KEY is missing. Add it to your .env file.");
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";
const FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL || "gemini-3.5-flash-lite";

// Busy hone par har model ko 3 baar try karo, phir fallback model par jao
async function generateWithRetry(params) {
  for (const model of [MODEL, FALLBACK_MODEL]) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const t0 = Date.now();
        const result = await ai.models.generateContent({ ...params, model });
        console.log(`${model} replied in ${Date.now() - t0} ms (attempt ${attempt})`);
        return result;
      } catch (err) {
        console.warn(`${model} (attempt ${attempt}) error:`, err.message.slice(0, 200));
        if (err.cause) console.warn("cause:", err.cause.code || err.cause.message);

        // Model maujood nahi: seedha agle model par jao
        if (/404|NOT_FOUND/.test(err.message)) break;

        const retryable = /503|429|UNAVAILABLE|RESOURCE_EXHAUSTED|fetch failed|ECONNRESET|ETIMEDOUT/.test(err.message);
        if (!retryable) throw err;

        await new Promise((r) => setTimeout(r, attempt * 1000));
      }
    }
  }
  throw new Error("All models are busy right now.");
}

// Which business data file to load (change this to serve another client)
const DATA_FILE = process.env.BUSINESS_DATA || "clinic.json";
const business = JSON.parse(
  fs.readFileSync(path.join(__dirname, "data", DATA_FILE), "utf8")
);

// --- System prompt: tells Gemini who it is and what it may talk about ---
const SYSTEM_PROMPT = `
You are the virtual assistant of "${business.businessName}", a ${business.type}.
Your job is to help visitors with questions about this business: timings, doctors, fees,
tests, appointments, location and policies.

RULES:
1. Answer ONLY using the BUSINESS DATA below. Never invent doctors, prices, timings or services.
2. If the answer is not in the data, say you don't have that information and suggest
   contacting the clinic by phone or WhatsApp (give the number from the data).
3. You are not a doctor. Never diagnose, never suggest medicines or treatments.
   For medical questions, advise the person to consult a doctor or book an appointment.
   If someone describes an emergency (chest pain, difficulty breathing, severe bleeding, etc.),
   tell them to call emergency services or go to the nearest hospital immediately.
4. If the question is unrelated to the business (politics, coding, general knowledge...),
   politely say you can only help with questions about ${business.businessName}.
5. LANGUAGE: Always reply in the same language and script the visitor writes in.
   If they write in English, reply in English. If they write in Roman Urdu (Urdu written
   in English letters, e.g. "doctor kab milte hain?"), reply in simple Roman Urdu.
   If they write in Urdu script, reply in Urdu script. Never tell the visitor that you can
   only reply in English. Keep names, phone numbers, prices and times exactly as in the data.
   Keep answers short, friendly and clear (2-4 sentences usually).
6. You cannot actually book appointments. Tell people how to book (from the data).

BUSINESS DATA (JSON):
${JSON.stringify(business, null, 2)}
`.trim();

// --- Express app ---
const app = express();
app.use(express.json({ limit: "20kb" }));
app.use(express.static(path.join(__dirname, "public")));

// Send business name to the frontend (for the chat header)
app.get("/api/info", (req, res) => {
  res.json({ name: business.businessName });
});

app.post("/api/chat", async (req, res) => {
  try {
    console.log("Request received:", req.body?.messages?.length, "messages");
    const { messages } = req.body;
    

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "messages array is required." });
    }

    // Keep only the last 10 messages, validate, and convert to Gemini format
    const contents = messages
      .slice(-10)
      .filter(
        (m) =>
          (m.role === "user" || m.role === "assistant") &&
          typeof m.text === "string" &&
          m.text.trim() !== ""
      )
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.text.slice(0, 500) }],
      }));

    // Gemini needs the conversation to start with a user message
    while (contents.length && contents[0].role !== "user") contents.shift();

    if (contents.length === 0 || contents[contents.length - 1].role !== "user") {
      return res.status(400).json({ error: "Last message must be from the user." });
    }

    const response = await generateWithRetry({
      contents,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        temperature: 0.3, // low = more factual, less creative
        maxOutputTokens: 400,
      },
    });

    res.json({ reply: response.text });
  } catch (err) {
    console.error("Gemini error:", err.message);
    res.status(500).json({
      error: "Sorry, the assistant is busy right now. Please try again in a moment.",
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Chatbot running for "${business.businessName}" at http://localhost:${PORT}`);
});
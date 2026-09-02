const db = require("../config/db");
const openai = require("../config/openai");
const { searchPlaces } = require("./places.service");
const experiencesService = require("./experiences.service");
const newsService = require("./news.service");

const LANGUAGE_NAMES = { es: "español", en: "English", pt: "português" };
const PLACE_TOOL = {
  type: "function",
  name: "search_places",
  description: "Busca lugares reales para recomendar en NYC o New Jersey.",
  strict: true,
  parameters: {
    type: "object",
    properties: { query: { type: "string", description: "Búsqueda concreta con zona o ciudad." } },
    required: ["query"],
    additionalProperties: false,
  },
};
const APP_CONTENT_TOOL = {
  type: "function",
  name: "search_app_content",
  description: "Busca primero experiencias, eventos, guías y notas ya publicadas dentro de Insight The City.",
  strict: true,
  parameters: {
    type: "object",
    properties: { query: { type: "string", description: "Lo que el usuario quiere hacer o encontrar." } },
    required: ["query"],
    additionalProperties: false,
  },
};

const firstName = (name) => String(name || "").trim().split(/\s+/)[0] || "";

function greetingFor(user) {
  const name = firstName(user?.name);
  if (user?.language === "en") return `Hi${name ? `, ${name}` : ""}. I'm your City Guide. Ask me about restaurants, plans, events, or places in NYC and New Jersey.`;
  if (user?.language === "pt") return `Olá${name ? `, ${name}` : ""}. Sou seu City Guide. Pergunte sobre restaurantes, passeios, eventos ou lugares em NYC e New Jersey.`;
  return `Hola${name ? `, ${name}` : ""}. Soy tu City Guide. Pregúntame por restaurantes, planes, eventos o lugares en NYC y New Jersey.`;
}

function instructionsFor(user) {
  const name = firstName(user?.name);
  return [
    "Eres City Guide, el asistente personal de Insight The City especializado en NYC y New Jersey.",
    `Responde siempre en ${LANGUAGE_NAMES[user?.language] || LANGUAGE_NAMES.es}.`,
    name ? `El usuario se llama ${name}. Usa su nombre con naturalidad, sin repetirlo en cada respuesta.` : "",
    "Sé cercano, útil y conciso. Haz una pregunta breve si falta una preferencia importante.",
    "Para cualquier recomendación, usa siempre search_app_content antes que cualquier fuente externa.",
    "Prioriza y menciona primero las opciones encontradas dentro de Insight The City.",
    "Usa search_places solo si el catálogo de la app no tiene opciones adecuadas o si el usuario pide más alternativas.",
    "No inventes lugares, direcciones, horarios, precios ni valoraciones. Basa esos datos solo en search_places.",
    "Si usas search_places, resume por qué encajan las opciones sin repetir toda la información de las tarjetas.",
  ].filter(Boolean).join("\n");
}

async function searchAppContent() {
  const [experiencesResult, todayResult, guidesResult] = await Promise.allSettled([
    experiencesService.list({ publishedOnly: true }),
    newsService.listNews({ section: "ny-al-dia", page: 1, perPage: 10 }),
    newsService.listNews({ section: "que-hacer", page: 1, perPage: 10 }),
  ]);
  const items = [];
  if (experiencesResult.status === "fulfilled") {
    items.push(...experiencesResult.value.rows.slice(0, 15).map((item) => ({
      kind: "experience", id: item.id, title: item.title, category: item.category,
      description: item.description, location: item.location, section: item.section,
    })));
  }
  for (const result of [todayResult, guidesResult]) {
    if (result.status !== "fulfilled") continue;
    items.push(...result.value.items.map((item) => ({
      kind: "news", id: item.id, title: item.title, description: item.excerpt,
      section: result === todayResult ? "ny-al-dia" : "que-hacer",
    })));
  }
  return items;
}

async function getHistory(userId, limit = 30) {
  const safeLimit = Math.min(Math.max(Number(limit) || 30, 1), 50);
  const { rows } = await db.query(
    `SELECT id, role, message, created_at FROM (
       SELECT id, role, message, created_at FROM chat_messages
       WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2
     ) history ORDER BY created_at ASC, id ASC`,
    [userId, safeLimit]
  );
  return rows;
}

async function saveMessage(userId, role, message) {
  const { rows } = await db.query(
    `INSERT INTO chat_messages (user_id, role, message) VALUES ($1, $2, $3)
     RETURNING id, role, message, created_at`,
    [userId, role, message]
  );
  return rows[0];
}

async function respond({ user, history, location }) {
  const input = history.slice(-12).map((item) => ({
    role: item.role === "assistant" ? "assistant" : "user",
    content: item.message,
  }));
  const request = {
    model: process.env.OPENAI_CHAT_MODEL || "gpt-4.1-mini",
    instructions: instructionsFor(user),
    tools: [APP_CONTENT_TOOL, PLACE_TOOL],
  };
  let response = await openai.responses.create({
    ...request,
    input,
    tool_choice: { type: "function", name: "search_app_content" },
  });
  const places = [];
  const appItems = [];

  for (let round = 0; round < 3; round += 1) {
    const calls = response.output.filter((item) => item.type === "function_call");
    if (!calls.length) break;
    const outputs = [];
    for (const call of calls.slice(0, 2)) {
      let args = {};
      try { args = JSON.parse(call.arguments || "{}"); } catch { args = {}; }
      if (call.name === "search_app_content") {
        const found = await searchAppContent(args.query);
        appItems.push(...found);
        outputs.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify({ items: found }) });
      } else if (call.name === "search_places") {
        const found = await searchPlaces(args.query || "places in New York City", {
          lat: location?.lat, lng: location?.lng, language: user?.language, maxResults: 5,
        });
        places.push(...found);
        outputs.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify({ places: found }) });
      }
    }
    response = await openai.responses.create({
      ...request,
      previous_response_id: response.id,
      input: outputs,
      tool_choice: round === 2 ? "none" : "auto",
    });
  }

  return {
    reply: response.output_text?.trim() || greetingFor(user),
    appItems: appItems.slice(0, 8),
    places: places.slice(0, 5),
  };
}

module.exports = { getHistory, saveMessage, respond, greetingFor };

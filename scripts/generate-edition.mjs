// ============================================================
//  SYNAPSE DAILY — Agent de publication quotidien
//  Version robuste : retry x3, extraction JSON tolérante,
//  web_search optionnel (fallback sans si échec),
//  anti-répétition sur 14 jours d'archives.
// ============================================================

import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import path from "node:path";

const client = new Anthropic();
const MODEL = process.env.MODEL || "claude-sonnet-4-6";
const MAX_ATTEMPTS = 3; // Nombre de tentatives max

// ---------- Date du jour (Paris) ----------
const now = new Date();
const frFormatter = new Intl.DateTimeFormat("fr-FR", {
  weekday: "long", day: "numeric", month: "long", year: "numeric",
  timeZone: "Europe/Paris",
});
const today = frFormatter.format(now);
const isoToday = now.toISOString().slice(0, 10);
const editionNumber = 2847 + Math.floor((now - new Date("2026-04-23")) / 86400000);

// ---------- Skip si déjà généré aujourd'hui ----------
try {
  const existing = JSON.parse(fs.readFileSync("edition.json", "utf-8"));
  if (existing.generatedAt && existing.generatedAt.startsWith(isoToday)) {
    console.log(`⏭️  Édition du ${today} déjà générée à ${existing.generatedAt}. Rien à faire.`);
    process.exit(0);
  }
} catch (_) {}

// ---------- Charger les titres passés (anti-répétition) ----------
function loadPastTitles() {
  const titles = [];
  try {
    const cur = JSON.parse(fs.readFileSync("edition.json", "utf-8"));
    if (cur.articles) cur.articles.forEach((a) => titles.push(a.title));
  } catch (_) {}
  const archiveDir = path.join(process.cwd(), "archives");
  if (fs.existsSync(archiveDir)) {
    try {
      const files = fs.readdirSync(archiveDir)
        .filter((f) => f.endsWith(".json"))
        .sort().reverse().slice(0, 14);
      for (const file of files) {
        try {
          const ed = JSON.parse(fs.readFileSync(path.join(archiveDir, file), "utf-8"));
          if (ed.articles) ed.articles.forEach((a) => titles.push(a.title));
        } catch (_) {}
      }
    } catch (_) {}
  }
  return [...new Set(titles)];
}

const pastTitles = loadPastTitles();
console.log(`📚 ${pastTitles.length} titres passés chargés\n`);

const antiRepeat = pastTitles.length > 0
  ? `\n\nSUJETS DÉJÀ PUBLIÉS — INTERDITS :\n${pastTitles.map((t, i) => `  ${i + 1}. ${t}`).join("\n")}\n`
  : "";

// ---------- Prompts ----------
const SYSTEM = `Tu es le rédacteur en chef de SYNAPSE DAILY, quotidien français rédigé par IA.
Mission : produire l'édition du ${today}, N° ${editionNumber}.
8 articles, un par rubrique : Politique, Économie, Tech, Science, Culture, Société, Sport, Idées.

RÈGLES ABSOLUES :
1. ORIGINALITÉ : sujets complètement différents des éditions précédentes (listées ci-dessous)
2. VARIÉTÉ : alterner enquête, analyse, reportage, chronique, portrait, décryptage
3. LONGUEUR : 500-800 mots par article
4. STRUCTURE de chaque article :
   - 4 à 6 paragraphes
   - EXACTEMENT 2 sous-titres <h3>...</h3>
   - EXACTEMENT 1 citation <blockquote>« ... »</blockquote> + attribution <em class="highlight">...</em>
   - Paragraphes séparés par \\n
5. AUTEURS :
   Science/Tech → Maximilian Remberger (MR, #2a3a4a)
   Politique/Société → Antoine Amodruz (AA, #4a3a2a)
   Économie/Idées → Adi-Afan Clary (AC, #2a4a3a)
   Culture/Sport → Sam Abitbol (SA, #4a2a3a)
6. TAGS : 4 par article, minuscules, sans accents
${antiRepeat}
IMPORTANT — FORMAT DE SORTIE :
Réponds UNIQUEMENT avec le JSON. Aucun texte avant ni après. Pas de backticks.
Le JSON doit commencer par { et finir par }.`;

const USER = `Produis l'édition du ${today}, N° ${editionNumber}.
Choisis 8 sujets ORIGINAUX et variés, un par rubrique.

Format JSON EXACT à respecter (commence DIRECTEMENT par {, termine par }) :
{
  "editionDate": "${today}",
  "editionNumber": ${editionNumber},
  "articles": [
    {
      "category": "Science",
      "title": "...",
      "dek": "...",
      "author": "Maximilian Remberger",
      "initials": "MR",
      "avatarColor": "#2a3a4a",
      "readTime": "7 min",
      "date": "Paris, ${today}",
      "tags": ["tag1","tag2","tag3","tag4"],
      "body": "Paragraphe 1.\\n<h3>Sous-titre 1</h3>\\nParagraphe 2.\\n<blockquote>« Citation »</blockquote>\\n<em class=\\"highlight\\">Attribution</em>, suite.\\n<h3>Sous-titre 2</h3>\\nParagraphe 3.\\nParagraphe 4."
    }
  ]
}`;

const USER_WITH_SEARCH = `${USER}

Tu peux utiliser web_search pour t'inspirer de l'actualité du jour avant d'écrire.
Fais 2-3 recherches ciblées, puis rédige les 8 articles et produis le JSON.
IMPORTANT : après tes recherches, écris UNIQUEMENT le JSON final, rien d'autre.`;

// ---------- Extraction JSON robuste ----------
function extractJson(text) {
  // Nettoyer les backticks
  text = text.replace(/^```(?:json)?\s*/im, "").replace(/\s*```\s*$/im, "").trim();

  // Tentative 1 : le texte est directement du JSON
  try {
    return JSON.parse(text);
  } catch (_) {}

  // Tentative 2 : extraire entre le premier { et le dernier }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch (_) {}
  }

  // Tentative 3 : chercher un bloc JSON valide plus agressivement
  const jsonPattern = /\{[\s\S]*"articles"\s*:\s*\[[\s\S]*\]\s*\}/;
  const match = text.match(jsonPattern);
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch (_) {}
  }

  return null;
}

// ---------- Un appel API ----------
async function callApi(withSearch) {
  const tools = withSearch ? [{ type: "web_search_20250305", name: "web_search" }] : [];
  const userContent = withSearch ? USER_WITH_SEARCH : USER;

  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    temperature: 1,
    system: SYSTEM,
    ...(tools.length > 0 ? { tools } : {}),
    messages: [{ role: "user", content: userContent }],
  });

  // Extraire uniquement les blocs texte
  const textContent = resp.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  return { textContent, usage: resp.usage };
}

// ---------- Boucle de tentatives ----------
console.log(`📰 SYNAPSE DAILY — édition du ${today}`);
console.log(`🧠 Modèle : ${MODEL} | N° ${editionNumber}\n`);

let parsed = null;
let totalTokens = { input: 0, output: 0 };

for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  // Tentative 1 et 2 avec web_search, tentative 3 sans (plus simple)
  const withSearch = attempt < 3;
  console.log(`🔄 Tentative ${attempt}/${MAX_ATTEMPTS} ${withSearch ? "(avec web_search)" : "(sans web_search)"}`);

  try {
    const { textContent, usage } = await callApi(withSearch);
    totalTokens.input += usage.input_tokens;
    totalTokens.output += usage.output_tokens;

    parsed = extractJson(textContent);

    if (!parsed || !Array.isArray(parsed.articles) || parsed.articles.length < 6) {
      console.warn(`⚠️  Tentative ${attempt} : JSON invalide ou incomplet (${parsed?.articles?.length ?? 0} articles)`);
      if (attempt < MAX_ATTEMPTS) {
        console.log(`   Pause 5s avant retry…\n`);
        await new Promise(r => setTimeout(r, 5000));
      }
      parsed = null;
      continue;
    }

    console.log(`✅ Tentative ${attempt} réussie — ${parsed.articles.length} articles\n`);
    break;

  } catch (err) {
    console.error(`❌ Tentative ${attempt} erreur API : ${err.message}`);
    if (attempt < MAX_ATTEMPTS) {
      console.log(`   Pause 10s avant retry…\n`);
      await new Promise(r => setTimeout(r, 10000));
    }
  }
}

if (!parsed) {
  console.error("❌ Toutes les tentatives ont échoué. Arrêt.");
  process.exit(1);
}

// ---------- Métadonnées ----------
parsed.generatedAt = now.toISOString();
parsed.model = MODEL;

// ---------- Archivage ----------
const archiveDir = path.join(process.cwd(), "archives");
if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, { recursive: true });

try {
  const old = fs.readFileSync("edition.json", "utf-8");
  const oldP = JSON.parse(old);
  if (oldP.generatedAt) {
    const d = oldP.generatedAt.slice(0, 10);
    const ap = path.join(archiveDir, `${d}.json`);
    if (!fs.existsSync(ap)) {
      fs.writeFileSync(ap, old, "utf-8");
      console.log(`📦 Archivé : archives/${d}.json`);
    }
  }
} catch (_) {}

// Nettoyer archives > 30 jours
try {
  const cutoff = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  for (const f of fs.readdirSync(archiveDir)) {
    if (f < cutoff && f.endsWith(".json")) {
      fs.unlinkSync(path.join(archiveDir, f));
    }
  }
} catch (_) {}

// ---------- Écriture ----------
fs.writeFileSync("edition.json", JSON.stringify(parsed, null, 2), "utf-8");

console.log(`\n📋 Résumé :`);
parsed.articles.forEach((a, i) => {
  console.log(`   ${i + 1}. [${a.category}] ${a.title.slice(0, 65)}`);
});
console.log(`\n💰 Tokens : ${totalTokens.input} in + ${totalTokens.output} out`);
console.log(`📄 edition.json écrit avec succès.`);

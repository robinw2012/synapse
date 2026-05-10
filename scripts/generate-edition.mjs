// ============================================================
//  SYNAPSE DAILY — Agent de publication quotidien v2
//  Génère 8 articles + une illustration SVG sur-mesure pour chacun.
// ============================================================

import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import path from "node:path";

const client = new Anthropic();
const MODEL = process.env.MODEL || "claude-sonnet-4-6";
const MAX_ATTEMPTS = 3;

// ---------- Date du jour (Paris) ----------
const now = new Date();
const frFormatter = new Intl.DateTimeFormat("fr-FR", {
  weekday: "long", day: "numeric", month: "long", year: "numeric",
  timeZone: "Europe/Paris",
});
const today = frFormatter.format(now);
const isoToday = now.toISOString().slice(0, 10);
const editionNumber = 2847 + Math.floor((now - new Date("2026-04-23")) / 86400000);

// ---------- Skip si déjà généré ----------
try {
  const existing = JSON.parse(fs.readFileSync("edition.json", "utf-8"));
  if (existing.generatedAt && existing.generatedAt.startsWith(isoToday)) {
    console.log(`⏭️  Édition du ${today} déjà générée. Rien à faire.`);
    process.exit(0);
  }
} catch (_) {}

// ---------- Anti-répétition ----------
function loadPastTitles() {
  const titles = [];
  try {
    const cur = JSON.parse(fs.readFileSync("edition.json", "utf-8"));
    if (cur.articles) cur.articles.forEach((a) => titles.push(a.title));
  } catch (_) {}
  const archiveDir = path.join(process.cwd(), "archives");
  if (fs.existsSync(archiveDir)) {
    try {
      const files = fs.readdirSync(archiveDir).filter(f => f.endsWith(".json")).sort().reverse().slice(0, 14);
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
const antiRepeat = pastTitles.length > 0
  ? `\n\nSUJETS DÉJÀ PUBLIÉS — INTERDITS :\n${pastTitles.map((t,i) => `  ${i+1}. ${t}`).join("\n")}\n`
  : "";

// ---------- Prompt système ----------
const SYSTEM = `Tu es le rédacteur en chef de SYNAPSE DAILY, quotidien français rédigé par IA.
Mission : édition du ${today}, N° ${editionNumber}. 8 articles, un par rubrique.
Rubriques : Politique, Économie, Tech, Science, Culture, Société, Sport, Idées.
${antiRepeat}
RÈGLES :
1. Sujets originaux, variés, inspirés de l'actualité réelle si possible
2. 500-800 mots par article, ton éditorial sobre
3. Structure : 4-6 paragraphes, 2 <h3>, 1 <blockquote> + <em class="highlight">
4. Auteurs : Science/Tech → Maximilian Remberger (MR,#2a3a4a) | Politique/Société → Antoine Amodruz (AA,#4a3a2a) | Économie/Idées → Adi-Afan Clary (AC,#2a4a3a) | Culture/Sport → Sam Abitbol (SA,#4a2a3a)
5. 4 tags par article, minuscules

ILLUSTRATION — champ "visual" obligatoire pour chaque article :
Tu dois décrire l'image éditoriale qui accompagnera l'article. Sois précis et créatif.
Format : un objet JSON avec ces champs :
  - scene : le type de scène parmi : "espace", "ville", "parlement", "nature", "laboratoire", "finance", "stade", "memorial", "concert", "galerie", "ocean", "montagne", "incendie", "tribunal", "tech"
  - palette : un mot parmi "sombre", "lumineux", "chaud", "froid", "dramatique"
  - elements : liste de 3-5 éléments visuels spécifiques à l'article (ex: ["télescope James Webb", "nébuleuse violette", "étoile géante"])
  - ambiance : une phrase courte décrivant l'atmosphère (ex: "Nuit sidérale, silence cosmique")
  - couleurAccent : couleur hexadécimale principale (#rrggbb)

FORMAT DE SORTIE : JSON strict. Aucun texte avant/après. Pas de backticks.`;

const USER = `Édition du ${today}, N° ${editionNumber}.

Produis 8 articles originaux. Pour chacun, inclure un champ "visual" avec la description de l'illustration.

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
      "body": "...",
      "visual": {
        "scene": "espace",
        "palette": "sombre",
        "elements": ["télescope James Webb", "nébuleuse colorée", "étoile en formation"],
        "ambiance": "Profondeur cosmique, nuit éternelle",
        "couleurAccent": "#4a8fc4"
      }
    }
  ]
}`;

// ---------- API call ----------
async function callApi(withSearch) {
  const tools = withSearch ? [{ type: "web_search_20250305", name: "web_search" }] : [];
  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    temperature: 1,
    system: SYSTEM,
    ...(tools.length > 0 ? { tools } : {}),
    messages: [{ role: "user", content: USER }],
  });
  const text = resp.content.filter(b => b.type === "text").map(b => b.text).join("\n").trim();
  return { text, usage: resp.usage };
}

// ---------- JSON extraction ----------
function extractJson(text) {
  text = text.replace(/^```(?:json)?\s*/im, "").replace(/\s*```\s*$/im, "").trim();
  try { return JSON.parse(text); } catch (_) {}
  const s = text.indexOf("{"), e = text.lastIndexOf("}");
  if (s >= 0 && e > s) {
    try { return JSON.parse(text.slice(s, e+1)); } catch (_) {}
  }
  const m = text.match(/\{[\s\S]*"articles"\s*:\s*\[[\s\S]*\]\s*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch (_) {} }
  return null;
}

// ---------- Main ----------
console.log(`📰 SYNAPSE DAILY — ${today} | N° ${editionNumber}\n`);

let parsed = null;
let totalTokens = { input: 0, output: 0 };

for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  const withSearch = attempt < 3;
  console.log(`🔄 Tentative ${attempt}/${MAX_ATTEMPTS} ${withSearch ? "(+ web_search)" : ""}`);
  try {
    const { text, usage } = await callApi(withSearch);
    totalTokens.input += usage.input_tokens;
    totalTokens.output += usage.output_tokens;
    parsed = extractJson(text);
    if (!parsed || !Array.isArray(parsed.articles) || parsed.articles.length < 6) {
      console.warn(`⚠️  JSON invalide (${parsed?.articles?.length ?? 0} articles)`);
      if (attempt < MAX_ATTEMPTS) await new Promise(r => setTimeout(r, 5000));
      parsed = null; continue;
    }
    console.log(`✅ ${parsed.articles.length} articles générés\n`);
    break;
  } catch (err) {
    console.error(`❌ Erreur API : ${err.message}`);
    if (attempt < MAX_ATTEMPTS) await new Promise(r => setTimeout(r, 10000));
  }
}

if (!parsed) { console.error("❌ Échec total."); process.exit(1); }

// Valider et compléter les champs "visual" manquants
const defaultVisuals = {
  'Science':    { scene:"espace",       palette:"sombre",     elements:["étoile","nébuleuse","télescope"], ambiance:"Nuit cosmique profonde",  couleurAccent:"#4a8fc4" },
  'Tech':       { scene:"tech",         palette:"sombre",     elements:["circuit","code","IA"],           ambiance:"Réseau numérique animé",  couleurAccent:"#3ab89a" },
  'Technologie':{ scene:"tech",         palette:"sombre",     elements:["circuit","code","IA"],           ambiance:"Réseau numérique animé",  couleurAccent:"#3ab89a" },
  'Économie':   { scene:"finance",      palette:"chaud",      elements:["courbes","marché","données"],    ambiance:"Tension des marchés",     couleurAccent:"#c4a23a" },
  'Politique':  { scene:"parlement",    palette:"dramatique", elements:["colonnes","drapeau","vote"],     ambiance:"Solennité institutionnelle",couleurAccent:"#c44a4a"},
  'Culture':    { scene:"galerie",      palette:"chaud",      elements:["tableau","lumière","art"],       ambiance:"Lumière dorée de musée",  couleurAccent:"#c47a3a" },
  'Société':    { scene:"ville",        palette:"sombre",     elements:["buildings","nuit","lumières"],   ambiance:"Ville qui ne dort pas",   couleurAccent:"#4a7ac4" },
  'Sport':      { scene:"stade",        palette:"dramatique", elements:["stade","lumières","foule"],      ambiance:"Tension du match",        couleurAccent:"#c4633a" },
  'Idées':      { scene:"tech",         palette:"lumineux",   elements:["idée","connexion","pensée"],     ambiance:"L'instant de la découverte",couleurAccent:"#8a4ac4"},
};

parsed.articles.forEach((a) => {
  if (!a.visual || typeof a.visual !== 'object') {
    a.visual = defaultVisuals[a.category] || defaultVisuals['Science'];
    console.log(`  → visual ajouté par défaut pour "${a.title?.slice(0,50)}"`);
  }
});

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
    if (!fs.existsSync(ap)) { fs.writeFileSync(ap, old, "utf-8"); console.log(`📦 Archivé : ${d}.json`); }
  }
} catch (_) {}
try {
  const cutoff = new Date(Date.now() - 30*86400000).toISOString().slice(0, 10);
  for (const f of fs.readdirSync(archiveDir)) {
    if (f < cutoff && f.endsWith(".json")) fs.unlinkSync(path.join(archiveDir, f));
  }
} catch (_) {}

// ---------- Écriture ----------
fs.writeFileSync("edition.json", JSON.stringify(parsed, null, 2), "utf-8");
console.log(`\n📋 Articles publiés :`);
parsed.articles.forEach((a, i) => {
  const v = a.visual;
  console.log(`  ${i+1}. [${a.category}] ${a.title?.slice(0,55)}`);
  console.log(`     🎨 ${v?.scene} | "${v?.ambiance?.slice(0,40)}" | ${v?.couleurAccent}`);
});
console.log(`\n💰 Tokens : ${totalTokens.input} in + ${totalTokens.output} out`);

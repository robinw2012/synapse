import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import path from "node:path";

const client = new Anthropic();
const MODEL = process.env.MODEL || "claude-sonnet-4-6";
const MAX_ATTEMPTS = 3;

// Date du jour (Paris)
const now = new Date();
const frFormatter = new Intl.DateTimeFormat("fr-FR", {
  weekday: "long", day: "numeric", month: "long", year: "numeric",
  timeZone: "Europe/Paris",
});
const today = frFormatter.format(now);
const isoToday = now.toISOString().slice(0, 10);
const editionNumber = 2847 + Math.floor((now - new Date("2026-04-23")) / 86400000);

console.log(`\n📅 Date : ${today}`);
console.log(`📰 N° ${editionNumber}`);
console.log(`🔑 API Key présente : ${!!process.env.ANTHROPIC_API_KEY}`);
console.log(`🧠 Modèle : ${MODEL}\n`);

// Skip si déjà généré aujourd'hui
try {
  const existing = JSON.parse(fs.readFileSync("edition.json", "utf-8"));
  if (existing.generatedAt && existing.generatedAt.startsWith(isoToday)) {
    console.log(`⏭️  Déjà générée aujourd'hui (${existing.generatedAt}). Skip.`);
    process.exit(0);
  }
  console.log(`📄 Ancienne édition datée du ${existing.generatedAt?.slice(0,10) || 'inconnu'} — on régénère.`);
} catch (e) {
  console.log(`📄 Pas d'édition existante : ${e.message}`);
}

// Anti-répétition
function loadPastTitles() {
  const titles = [];
  try {
    const cur = JSON.parse(fs.readFileSync("edition.json", "utf-8"));
    if (cur.articles) cur.articles.forEach(a => titles.push(a.title));
  } catch (_) {}
  const archiveDir = path.join(process.cwd(), "archives");
  if (fs.existsSync(archiveDir)) {
    const files = fs.readdirSync(archiveDir).filter(f => f.endsWith(".json")).sort().reverse().slice(0, 14);
    for (const file of files) {
      try {
        const ed = JSON.parse(fs.readFileSync(path.join(archiveDir, file), "utf-8"));
        if (ed.articles) ed.articles.forEach(a => titles.push(a.title));
      } catch (_) {}
    }
  }
  return [...new Set(titles)];
}

const pastTitles = loadPastTitles();
console.log(`📚 ${pastTitles.length} titres passés chargés pour anti-répétition\n`);

const antiRepeat = pastTitles.length > 0
  ? `\nSUJETS DÉJÀ PUBLIÉS (interdits) :\n${pastTitles.slice(0, 30).map((t,i) => `${i+1}. ${t}`).join("\n")}\n`
  : "";

const SYSTEM = `Tu es rédacteur en chef de SYNAPSE DAILY, quotidien français écrit par IA.
Édition du ${today}, N° ${editionNumber}. 8 articles, un par rubrique : Politique, Économie, Tech, Science, Culture, Société, Sport, Idées.
${antiRepeat}
AUTEURS : Science/Tech → Maximilian Remberger (MR,#2a3a4a) | Politique/Société → Antoine Amodruz (AA,#4a3a2a) | Économie/Idées → Adi-Afan Clary (AC,#2a4a3a) | Culture/Sport → Sam Abitbol (SA,#4a2a3a)
Structure corps : 4-6 paragraphes, 2 <h3>, 1 <blockquote>+<em class="highlight">. 500-800 mots.

ILLUSTRATION — champ "visual" OBLIGATOIRE par article :
- scene : un parmi espace|ville|nature|finance|parlement|tech|galerie|stade|memorial
- palette : sombre|lumineux|chaud|froid|dramatique
- elements : 3-4 éléments visuels précis liés au sujet de l'article
- ambiance : phrase courte (ex: "Nuit sidérale, profondeur cosmique")
- couleurAccent : couleur hex (#rrggbb) représentative du sujet

SORTIE : JSON strict, aucun texte avant/après, pas de backticks.`;

const USER = `Génère l'édition complète du ${today}. Format :
{
  "editionDate": "${today}",
  "editionNumber": ${editionNumber},
  "articles": [{
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
      "elements": ["télescope James Webb","nébuleuse","étoile naissante"],
      "ambiance": "Profondeur cosmique, lumières lointaines",
      "couleurAccent": "#3a7fc4"
    }
  }]
}`;

async function callApi(withSearch) {
  const tools = withSearch ? [{ type: "web_search_20250305", name: "web_search" }] : [];
  console.log(`  → Appel API ${withSearch ? "avec" : "sans"} web_search...`);
  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    temperature: 1,
    system: SYSTEM,
    ...(tools.length ? { tools } : {}),
    messages: [{ role: "user", content: USER }],
  });
  console.log(`  ← Réponse reçue : ${resp.usage.input_tokens} in + ${resp.usage.output_tokens} out tokens`);
  const text = resp.content.filter(b => b.type === "text").map(b => b.text).join("\n").trim();
  return { text, usage: resp.usage };
}

function extractJson(text) {
  text = text.replace(/^```(?:json)?\s*/im, "").replace(/\s*```\s*$/im, "").trim();
  try { return JSON.parse(text); } catch (_) {}
  const s = text.indexOf("{"), e = text.lastIndexOf("}");
  if (s >= 0 && e > s) { try { return JSON.parse(text.slice(s, e+1)); } catch (_) {} }
  const m = text.match(/\{[\s\S]*"articles"\s*:\s*\[[\s\S]*\]\s*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch (_) {} }
  return null;
}

let parsed = null;
let totalIn = 0, totalOut = 0;

for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  console.log(`\n🔄 Tentative ${attempt}/${MAX_ATTEMPTS}`);
  try {
    const { text, usage } = await callApi(attempt < 3);
    totalIn += usage.input_tokens;
    totalOut += usage.output_tokens;
    parsed = extractJson(text);
    if (!parsed?.articles?.length || parsed.articles.length < 6) {
      console.warn(`⚠️  JSON invalide (${parsed?.articles?.length ?? 0} articles). Contenu reçu :`);
      console.warn(text.slice(0, 300));
      if (attempt < MAX_ATTEMPTS) { console.log("  Pause 5s..."); await new Promise(r => setTimeout(r, 5000)); }
      parsed = null; continue;
    }
    console.log(`✅ ${parsed.articles.length} articles OK`);
    break;
  } catch (err) {
    console.error(`❌ Erreur API : ${err.message}`);
    console.error(err.stack?.slice(0, 400));
    if (attempt < MAX_ATTEMPTS) { console.log("  Pause 10s..."); await new Promise(r => setTimeout(r, 10000)); }
  }
}

if (!parsed) {
  console.error("\n❌ ÉCHEC TOTAL — Toutes les tentatives ont échoué.");
  process.exit(1);
}

// Visual par défaut si manquant
const defaults = {
  'Science':  {scene:"espace",  palette:"sombre",     elements:["étoile","nébuleuse"],ambiance:"Nuit cosmique",couleurAccent:"#4a8fc4"},
  'Tech':     {scene:"tech",    palette:"sombre",     elements:["réseau","code"],     ambiance:"Réseau numérique",couleurAccent:"#3ab89a"},
  'Économie': {scene:"finance", palette:"chaud",      elements:["courbes","marché"],  ambiance:"Tension des marchés",couleurAccent:"#c4a23a"},
  'Politique':{scene:"parlement",palette:"dramatique",elements:["colonnes","vote"],   ambiance:"Solennité républicaine",couleurAccent:"#c44a4a"},
  'Culture':  {scene:"galerie", palette:"chaud",      elements:["tableau","lumière"], ambiance:"Lumière de musée",couleurAccent:"#c47a3a"},
  'Société':  {scene:"ville",   palette:"sombre",     elements:["buildings","nuit"],  ambiance:"Ville qui ne dort pas",couleurAccent:"#4a7ac4"},
  'Sport':    {scene:"stade",   palette:"dramatique", elements:["stade","foule"],     ambiance:"Tension du match",couleurAccent:"#c4633a"},
  'Idées':    {scene:"tech",    palette:"lumineux",   elements:["idée","lumière"],    ambiance:"L'instant de la découverte",couleurAccent:"#8a4ac4"},
};
parsed.articles.forEach(a => {
  if (!a.visual || typeof a.visual !== 'object') {
    a.visual = defaults[a.category] || defaults['Science'];
  }
});

parsed.generatedAt = now.toISOString();
parsed.model = MODEL;

// Archivage
const archiveDir = path.join(process.cwd(), "archives");
if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, { recursive: true });
try {
  const old = JSON.parse(fs.readFileSync("edition.json", "utf-8"));
  if (old.generatedAt) {
    const ap = path.join(archiveDir, `${old.generatedAt.slice(0,10)}.json`);
    if (!fs.existsSync(ap)) { fs.writeFileSync(ap, JSON.stringify(old), "utf-8"); console.log(`\n📦 Archivé : ${old.generatedAt.slice(0,10)}.json`); }
  }
} catch (_) {}
try {
  const cutoff = new Date(Date.now() - 30*86400000).toISOString().slice(0,10);
  for (const f of fs.readdirSync(archiveDir)) if (f < cutoff && f.endsWith(".json")) fs.unlinkSync(path.join(archiveDir, f));
} catch (_) {}

fs.writeFileSync("edition.json", JSON.stringify(parsed, null, 2), "utf-8");

console.log(`\n📋 Articles publiés :`);
parsed.articles.forEach((a,i) => {
  const v = a.visual;
  console.log(`  ${i+1}. [${a.category}] ${a.title?.slice(0,55)}`);
  console.log(`     🎨 scene:${v?.scene} | palette:${v?.palette} | ${v?.couleurAccent}`);
});
console.log(`\n💰 Total tokens : ${totalIn} in + ${totalOut} out`);
console.log(`✅ edition.json écrit avec succès.`);

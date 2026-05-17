import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import path from "node:path";
import https from "node:https";

// Photos de secours par catégorie (si Unsplash échoue)
const FALLBACK_PHOTOS = {
  'Politique':  'https://images.unsplash.com/photo-1529107386315-e1a2ed48a620?w=800&h=450&fit=crop&q=80',
  'Économie':   'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=800&h=450&fit=crop&q=80',
  'Tech':       'https://images.unsplash.com/photo-1518770660439-4636190af475?w=800&h=450&fit=crop&q=80',
  'Science':    'https://images.unsplash.com/photo-1507413245164-6160d8298b31?w=800&h=450&fit=crop&q=80',
  'Culture':    'https://images.unsplash.com/photo-1499781350541-7783f6c6a0c8?w=800&h=450&fit=crop&q=80',
  'Société':    'https://images.unsplash.com/photo-1502602898657-3e91760cbb34?w=800&h=450&fit=crop&q=80',
  'Sport':      'https://images.unsplash.com/photo-1461896836934-ffe607ba8211?w=800&h=450&fit=crop&q=80',
  'Idées':      'https://images.unsplash.com/photo-1456324504439-367cee3b3c32?w=800&h=450&fit=crop&q=80',
};


const client = new Anthropic();
const MODEL = process.env.MODEL || "claude-sonnet-4-6";
const UNSPLASH_KEY = "Pj_KWKgIJzzVOEW7wRH37o1_ThDiLQqssoxwdjKxCdg";
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

console.log(`\n📅 ${today} | N° ${editionNumber}`);
console.log(`🔑 API Key: ${!!process.env.ANTHROPIC_API_KEY}`);

// Skip si déjà généré
try {
  const ex = JSON.parse(fs.readFileSync("edition.json", "utf-8"));
  if (ex.generatedAt?.startsWith(isoToday)) {
    console.log(`⏭️  Déjà générée aujourd'hui. Skip.`);
    process.exit(0);
  }
  console.log(`📄 Dernière édition : ${ex.generatedAt?.slice(0,10) || "?"} — on régénère.`);
} catch (_) {}

// Anti-répétition
function loadPastTitles() {
  const titles = [];
  try { JSON.parse(fs.readFileSync("edition.json","utf-8")).articles?.forEach(a=>titles.push(a.title)); } catch(_) {}
  const dir = path.join(process.cwd(),"archives");
  if (fs.existsSync(dir)) {
    fs.readdirSync(dir).filter(f=>f.endsWith(".json")).sort().reverse().slice(0,14).forEach(f=>{
      try { JSON.parse(fs.readFileSync(path.join(dir,f),"utf-8")).articles?.forEach(a=>titles.push(a.title)); } catch(_) {}
    });
  }
  return [...new Set(titles)];
}
const pastTitles = loadPastTitles();
const antiRepeat = pastTitles.length > 0
  ? `\nSUJETS DÉJÀ PUBLIÉS (interdits):\n${pastTitles.slice(0,25).map((t,i)=>`${i+1}. ${t}`).join("\n")}\n`
  : "";

// Fetch Unsplash photo URL côté serveur
function fetchUnsplashUrl(query) {
  return new Promise((resolve) => {
    const q = encodeURIComponent(query.slice(0,80));
    const url = `https://api.unsplash.com/photos/random?query=${q}&orientation=landscape&client_id=${UNSPLASH_KEY}`;
    const req = https.get(url, {
      headers: {
        "Accept-Version": "v1",
        "User-Agent": "SYNAPSE-DAILY/1.0"
      }
    }, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try {
          const j = JSON.parse(data);
          resolve(j?.urls?.regular || j?.urls?.small || null);
        } catch { resolve(null); }
      });
    });
    req.on("error", () => resolve(null));
    req.setTimeout(8000, () => { req.destroy(); resolve(null); });
  });
}

// Prompts
const SYSTEM = `Tu es rédacteur en chef de SYNAPSE DAILY, quotidien français écrit par IA.
Édition du ${today}, N° ${editionNumber}. 8 articles (1 par rubrique): Politique, Économie, Tech, Science, Culture, Société, Sport, Idées.
${antiRepeat}
AUTEURS: Science/Tech→Maximilian Remberger(MR,#2a3a4a) | Politique/Société→Antoine Amodruz(AA,#4a3a2a) | Économie/Idées→Adi-Afan Clary(AC,#2a4a3a) | Culture/Sport→Sam Abitbol(SA,#4a2a3a)
Structure: 4-6 paragraphes, 2 <h3>, 1 <blockquote>+<em class="highlight">. 500-800 mots.
SORTIE: JSON strict uniquement. Pas de backticks.

RÈGLES DE CLASSEMENT CATÉGORIE (très important) :
- Politique : UNIQUEMENT les articles sur les institutions, partis, élections, gouvernement, diplomatie, géopolitique, relations internationales, guerres, conflits armés
- Économie : marchés financiers, entreprises, emploi, budget, fiscalité, commerce international, BCE, FMI, croissance, inflation
- Tech : numérique, IA, startups, GAFAM, cybersécurité, innovation technologique, réseaux sociaux, logiciels
- Science : recherche scientifique, médecine, santé publique, espace, environnement, biologie, physique, climat
- Culture : arts, cinéma, musique, littérature, patrimoine, expositions, festivals culturels
- Société : faits de société, justice, éducation, immigration, logement, inégalités, phénomènes sociaux
- Sport : compétitions sportives, résultats, sportifs, Jeux olympiques, tournois, championnats
- Idées : philosophie, essais, débats intellectuels, histoire des idées, éthique, futur

Un article sur Google/Meta/Apple → Tech (pas Économie)
Un article sur Cannes → Culture (pas Société)
Un article sur Roland-Garros → Sport ✓
Un article sur le PIB → Économie ✓
Un article sur une fusillade → Société (pas Politique)`;

const USER = `Génère l'édition du ${today}.
{
  "editionDate":"${today}",
  "editionNumber":${editionNumber},
  "articles":[{
    "category":"Science",
    "title":"...",
    "dek":"...",
    "author":"Maximilian Remberger","initials":"MR","avatarColor":"#2a3a4a",
    "readTime":"7 min","date":"Paris, ${today}",
    "tags":["tag1","tag2","tag3","tag4"],
    "body":"...",
    "photoQuery":"3-5 mots anglais très précis pour recherche photo sur Unsplash, doit correspondre exactement au sujet de l'article (ex: pour Roland-Garros → 'tennis clay court Paris', pour Meta licenciements → 'tech office layoff workers', pour inflation → 'supermarket prices shopping')"
  }]
}`;

async function callApi(withSearch) {
  const tools = withSearch ? [{ type:"web_search_20250305", name:"web_search" }] : [];
  console.log(`  → API ${withSearch?"avec":"sans"} web_search...`);
  const resp = await client.messages.create({
    model: MODEL, max_tokens: 16000, temperature: 1,
    system: SYSTEM,
    ...(tools.length ? { tools } : {}),
    messages: [{ role:"user", content:USER }],
  });
  console.log(`  ← ${resp.usage.input_tokens}in + ${resp.usage.output_tokens}out tokens`);
  return { text: resp.content.filter(b=>b.type==="text").map(b=>b.text).join("\n").trim(), usage: resp.usage };
}

function extractJson(text) {
  text = text.replace(/^```(?:json)?\s*/im,"").replace(/\s*```\s*$/im,"").trim();
  try { return JSON.parse(text); } catch(_) {}
  const s=text.indexOf("{"), e=text.lastIndexOf("}");
  if (s>=0&&e>s) { try { return JSON.parse(text.slice(s,e+1)); } catch(_) {} }
  const m=text.match(/\{[\s\S]*"articles"\s*:\s*\[[\s\S]*\]\s*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch(_) {} }
  return null;
}

// Génération articles
let parsed = null, totalIn=0, totalOut=0;
for (let attempt=1; attempt<=MAX_ATTEMPTS; attempt++) {
  console.log(`\n🔄 Tentative ${attempt}/${MAX_ATTEMPTS}`);
  try {
    const { text, usage } = await callApi(attempt < 3);
    totalIn += usage.input_tokens; totalOut += usage.output_tokens;
    parsed = extractJson(text);
    if (!parsed?.articles?.length || parsed.articles.length < 6) {
      console.warn(`⚠️  ${parsed?.articles?.length||0} articles. Retry...`);
      if (attempt<MAX_ATTEMPTS) await new Promise(r=>setTimeout(r,5000));
      parsed = null; continue;
    }
    console.log(`✅ ${parsed.articles.length} articles générés`);
    break;
  } catch(err) {
    console.error(`❌ ${err.message}`);
    if (attempt<MAX_ATTEMPTS) await new Promise(r=>setTimeout(r,10000));
  }
}
if (!parsed) { console.error("❌ ÉCHEC."); process.exit(1); }

// Récupérer les photos Unsplash (côté serveur, sans restriction CORS)
console.log("\n📸 Chargement des photos Unsplash...");
const defaultQueries = {
  'Science':'space stars science',
  'Tech':'technology computer digital',
  'Technologie':'technology computer digital',
  'Économie':'finance economy business',
  'Politique':'government politics parliament',
  'Culture':'art culture museum',
  'Société':'city people society',
  'Sport':'sport stadium athlete',
  'Idées':'idea light creative thinking',
};

for (const article of parsed.articles) {
  const query = article.photoQuery || defaultQueries[article.category] || article.category;
  process.stdout.write(`  [${article.category}] "${query}" → `);
  const url = await fetchUnsplashUrl(query);
  if (url) {
    article.photoUrl = url;
    console.log("✓ photo trouvée");
  } else {
    console.log("✗ pas de photo");
  }
  // Petite pause entre requêtes
  await new Promise(r=>setTimeout(r,300));
}

parsed.generatedAt = now.toISOString();
parsed.model = MODEL;

// Archivage
const archiveDir = path.join(process.cwd(),"archives");
if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir,{recursive:true});
try {
  const old = JSON.parse(fs.readFileSync("edition.json","utf-8"));
  if (old.generatedAt) {
    const ap = path.join(archiveDir,`${old.generatedAt.slice(0,10)}.json`);
    if (!fs.existsSync(ap)) { fs.writeFileSync(ap,JSON.stringify(old),"utf-8"); console.log(`\n📦 Archivé`); }
  }
} catch(_) {}
try {
  const cutoff = new Date(Date.now()-30*86400000).toISOString().slice(0,10);
  fs.readdirSync(archiveDir).filter(f=>f<cutoff&&f.endsWith(".json")).forEach(f=>fs.unlinkSync(path.join(archiveDir,f)));
} catch(_) {}

fs.writeFileSync("edition.json",JSON.stringify(parsed,null,2),"utf-8");

console.log(`\n📋 Résultat:`);
parsed.articles.forEach((a,i)=>console.log(`  ${i+1}. [${a.category}] ${a.title?.slice(0,55)} ${a.photoUrl?'📸':'❌'}`));
console.log(`\n💰 Tokens: ${totalIn}in + ${totalOut}out`);

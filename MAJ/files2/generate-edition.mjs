// ============================================================
//  SYNAPSE DAILY — Agent de publication quotidien
//  Anti-répétition : lit les 14 dernières éditions archivées
//  et interdit à Claude de réutiliser les mêmes sujets.
//  Actualité : utilise web_search pour s'inspirer du réel.
// ============================================================

import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import path from "node:path";

const client = new Anthropic();
const MODEL = process.env.MODEL || "claude-sonnet-4-6";

// ---------- Date du jour ----------
const now = new Date();
const frFormatter = new Intl.DateTimeFormat("fr-FR", {
  weekday: "long", day: "numeric", month: "long", year: "numeric",
  timeZone: "Europe/Paris",
});
const today = frFormatter.format(now);
const editionNumber = 2847 + Math.floor((now - new Date("2026-04-23")) / 86400000);

// ---------- Charger les titres des éditions passées ----------
function loadPastTitles() {
  const titles = [];
  // Lire edition.json actuelle
  try {
    const cur = JSON.parse(fs.readFileSync("edition.json", "utf-8"));
    if (cur.articles) cur.articles.forEach((a) => titles.push(a.title));
  } catch (_) {}
  // Lire les archives
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
console.log(`📚 ${pastTitles.length} titres passés chargés comme exclusions\n`);

const antiRepeat = pastTitles.length > 0
  ? `\n\nSUJETS DÉJÀ PUBLIÉS — NE LES RÉUTILISE SOUS AUCUNE FORME :\n${pastTitles.map((t, i) => `  ${i + 1}. ${t}`).join("\n")}\n\nChoisis des sujets COMPLÈTEMENT DIFFÉRENTS. Pas de reformulation, pas de variation, pas de suite.`
  : "";

// ---------- Prompt système ----------
const SYSTEM = `Tu es le rédacteur en chef de SYNAPSE DAILY, quotidien français rédigé par IA. Édition du ${today}, N° ${editionNumber}.

MISSION : produire 8 articles, un par rubrique : Politique, Économie, Tech, Science, Culture, Société, Sport, Idées.

ORIGINALITÉ : c'est ta priorité absolue. Le monde est immense — chaque jour tu dois explorer des sujets NEUFS : climat, espace, urbanisme, alimentation, éducation, droit, santé mentale, transports, énergie, mode, architecture, philosophie, histoire, géopolitique, océans, robotique, génétique, démographie, langues, musique, cinéma, jeux vidéo, agriculture, cryptomonnaies, mobilité, biodiversité, volcanologie, sport féminin, e-sport, gastronomie, danse, BD, podcast, photographie, artisanat, IA appliquée, cybersécurité, eau, forêts, villes intelligentes, droit numérique, médecine, archéologie, astronomie, sociologie des usages...
${antiRepeat}

ACTUALITÉ : tu as accès à web_search. Utilise-le pour chercher l'actualité AVANT d'écrire. Fais au moins 4 recherches variées pour trouver des angles frais.

LANGUE : français soigné, ton éditorial sobre et nuancé.
LONGUEUR : 500–800 mots par article.

PLAUSIBILITÉ : appuie-toi sur tes recherches web pour des faits vérifiables. Pour analyses et projections, utilise des tournures prudentes. Invente des experts fictifs plausibles pour les citations (nom + institution + qualité).

STRUCTURE de chaque article :
- 4 à 6 paragraphes
- EXACTEMENT 2 sous-titres <h3>...</h3>
- EXACTEMENT 1 citation <blockquote>« ... »</blockquote> suivie de <em class="highlight">...</em>
- Paragraphes séparés par \\n
- Chaque <h3> et <blockquote> sur sa propre ligne

VARIÉTÉ DE FORMAT : alterne entre enquête, analyse, reportage, chronique, portrait, décryptage, tribune, carnet de bord.

AUTEURS IA :
| Rubrique | Auteur | Initiales | avatarColor |
| Science | Maximilian Remberger | MR | #2a3a4a |
| Tech | Maximilian Remberger | MR | #2a3a4a |
| Économie | Adi-Afan Clary | AC | #2a4a3a |
| Culture | Sam Abitbol | SA | #4a2a3a |
| Société | Antoine Amodruz | AA | #4a3a2a |
| Politique | Antoine Amodruz | AA | #4a3a2a |
| Sport | Sam Abitbol | SA | #4a2a3a |
| Idées | Adi-Afan Clary | AC | #2a4a3a |

TAGS : 4 par article, en minuscules, sans accents.

FORMAT DE SORTIE : JSON strict et valide. Aucun texte avant ou après. Pas de backticks.`;

// ---------- Prompt utilisateur ----------
const USER = `Nous sommes le ${today}. Édition N° ${editionNumber}.

ÉTAPE 1 : Fais 4 recherches web pour trouver l'actualité du jour :
- "actualité France ${today}"
- "breaking news world today"
- "science technology news this week"
- un sujet libre selon ton inspiration (culture, sport, société...)

ÉTAPE 2 : Choisis 8 sujets ORIGINAUX inspirés de tes recherches — un par rubrique. Vérifie qu'aucun ne ressemble aux sujets déjà traités.

ÉTAPE 3 : Rédige et produis le JSON :
{
  "editionDate": "${today}",
  "editionNumber": ${editionNumber},
  "articles": [
    {
      "category": "...",
      "title": "...",
      "dek": "...",
      "author": "...",
      "initials": "...",
      "avatarColor": "...",
      "readTime": "X min",
      "date": "Paris, ${today}",
      "tags": ["...", "...", "...", "..."],
      "body": "..."
    }
  ]
}`;

// ---------- Appel API ----------
console.log(`📰 SYNAPSE DAILY — édition du ${today}`);
console.log(`🧠 Modèle : ${MODEL}`);
console.log(`📅 N° ${editionNumber}\n`);

const resp = await client.messages.create({
  model: MODEL,
  max_tokens: 16000,
  temperature: 1,
  system: SYSTEM,
  tools: [{ type: "web_search_20250305", name: "web_search" }],
  messages: [{ role: "user", content: USER }],
});

// ---------- Extraction du JSON ----------
const textBlocks = resp.content
  .filter((b) => b.type === "text")
  .map((b) => b.text)
  .join("\n")
  .trim();

let jsonStr = textBlocks;
const jsonStart = textBlocks.indexOf("{");
const jsonEnd = textBlocks.lastIndexOf("}");
if (jsonStart >= 0 && jsonEnd > jsonStart) {
  jsonStr = textBlocks.slice(jsonStart, jsonEnd + 1);
}
jsonStr = jsonStr.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();

let parsed;
try {
  parsed = JSON.parse(jsonStr);
} catch (err) {
  console.error("❌ JSON invalide.");
  console.error("Début :\n", textBlocks.slice(0, 1200));
  process.exit(1);
}

if (!Array.isArray(parsed.articles) || parsed.articles.length < 3) {
  console.error("❌ Édition incomplète.");
  process.exit(1);
}

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

// Nettoyer > 30 jours
try {
  const cutoff = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  for (const f of fs.readdirSync(archiveDir)) {
    if (f < cutoff && f.endsWith(".json")) {
      fs.unlinkSync(path.join(archiveDir, f));
      console.log(`🗑️  Supprimé : ${f}`);
    }
  }
} catch (_) {}

// ---------- Écriture ----------
fs.writeFileSync("edition.json", JSON.stringify(parsed, null, 2), "utf-8");

console.log(`\n✅ ${parsed.articles.length} articles publiés`);
parsed.articles.forEach((a, i) => {
  console.log(`   ${i + 1}. [${a.category}] ${a.title.slice(0, 70)}`);
});
console.log(`\n💰 Tokens : ${resp.usage.input_tokens} in + ${resp.usage.output_tokens} out`);

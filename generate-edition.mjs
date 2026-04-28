// ============================================================
//  SYNAPSE — Agent de publication quotidien
//  Ce script est exécuté chaque matin à 7h (Paris) par GitHub
//  Actions. Il appelle l'API Claude pour produire 8 articles
//  originaux et écrit le fichier edition.json à la racine.
// ============================================================

import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import path from "node:path";

const client = new Anthropic(); // lit ANTHROPIC_API_KEY depuis l'environnement

// Choix du modèle. Par défaut Sonnet 4.6 (meilleur rapport qualité/prix).
// Pour la meilleure qualité absolue, passer à "claude-opus-4-7".
const MODEL = process.env.MODEL || "claude-sonnet-4-6";

// ---------- Date du jour, formatée en français ----------
const now = new Date();
const frFormatter = new Intl.DateTimeFormat("fr-FR", {
  weekday: "long", day: "numeric", month: "long", year: "numeric",
  timeZone: "Europe/Paris",
});
const today = frFormatter.format(now);
const editionNumber = 2847 + Math.floor((now - new Date("2026-04-23")) / 86400000);

// ---------- Prompt système : ligne éditoriale ----------
const SYSTEM = `Tu es le rédacteur en chef de SYNAPSE, un quotidien français expérimental entièrement rédigé par IA. Tu supervises une équipe d'agents journalistiques IA qui publient chaque matin à 7 heures une édition fraîche.

Ta mission : produire l'édition du jour. Exactement 8 articles, dans 8 rubriques distinctes parmi : Politique, Économie, Tech, Science, Culture, Société, Sport, Idées.

RÈGLES ÉDITORIALES STRICTES :

1. Langue : français soigné, ton éditorial (sobre, précis, nuancé, une voix perceptible sans maniérisme).

2. Longueur : 500 à 800 mots par article.

3. Plausibilité factuelle : les articles doivent ressembler à du vrai journalisme, avec des détails concrets (noms, chiffres, lieux, institutions). Mais comme tu ne peux vérifier l'actualité en temps réel :
   - N'affirme JAMAIS un événement réel précis daté du jour ou de la veille
   - Utilise des tournures prudentes pour l'actualité chaude : "pourrait", "devrait", "selon les premières indications"
   - Préfère les analyses de fond, tendances, enquêtes, décryptages — qui demandent moins de factualité brûlante
   - Invente des experts fictifs plausibles (avec nom + institution + qualité) plutôt que de citer des personnalités publiques réelles

4. Structure de chaque article :
   - 4 à 6 paragraphes au total
   - EXACTEMENT 2 sous-titres en <h3>...</h3>
   - EXACTEMENT 1 citation en <blockquote>« ... »</blockquote>, suivie d'une phrase d'attribution commençant par <em class="highlight">...</em>
   - Paragraphes séparés par \\n (une vraie nouvelle ligne, pas le texte)
   - Chaque <h3> et <blockquote> sur sa propre ligne

5. Variété : chaque rubrique doit avoir une texture distincte. Le politique n'écrit pas comme le sport, la science n'écrit pas comme la culture.

6. Attribution obligatoire des auteurs IA :
   | Rubrique | Auteur | Initiales | avatarColor |
   | Science | Maximilian Remberger | MR | #2a3a4a |
   | Tech | Maximilian Remberger | MR | #2a3a4a |
   | Économie | Adi-Afan Clary | AC | #2a4a3a |
   | Culture | Sam Abitbol | SA | #4a2a3a |
   | Société | Antoine Amodruz | AA | #4a3a2a |
   | Politique | Antoine Amodruz | AA | #4a3a2a |
   | Sport | Sam Abitbol | SA | #4a2a3a |
   | Idées | Adi-Afan Clary | AC | #2a4a3a |

7. Tags : 4 tags thématiques pertinents par article, en minuscules, sans accents.

FORMAT DE SORTIE : JSON strict et valide. Aucun texte avant ou après. Pas de backticks, pas de commentaires, pas de markdown.`;

// ---------- Prompt utilisateur ----------
const USER = `Génère l'édition de SYNAPSE pour le ${today}.

Produis exactement 8 articles, un par rubrique parmi : Politique, Économie, Tech, Science, Culture, Société, Sport, Idées.

Pour chaque rubrique, choisis un sujet éditorial original et varie les angles (enquête, analyse, reportage, chronique, portrait, décryptage).

Format JSON attendu :

{
  "editionDate": "${today}",
  "editionNumber": ${editionNumber},
  "articles": [
    {
      "category": "Science",
      "title": "Titre accrocheur (max 120 caractères)",
      "dek": "Chapeau évocateur en 1 ou 2 phrases (max 200 caractères)",
      "author": "Maximilian Remberger",
      "initials": "MR",
      "avatarColor": "#2a3a4a",
      "readTime": "7 min",
      "date": "Paris, ${today}",
      "tags": ["tag1", "tag2", "tag3", "tag4"],
      "body": "Premier paragraphe.\\n<h3>Premier sous-titre</h3>\\nDeuxième paragraphe.\\n<blockquote>« Citation marquante »</blockquote>\\n<em class=\\"highlight\\">Attribution</em>, suite.\\n<h3>Second sous-titre</h3>\\nTroisième paragraphe.\\nQuatrième paragraphe de conclusion."
    }
    // ... 7 autres articles pour les 7 autres rubriques
  ]
}

Respecte la structure à la lettre. La clé "body" doit être une seule chaîne avec des \\n pour séparer les paragraphes.`;

// ---------- Appel API ----------
console.log(`📰 SYNAPSE — génération de l'édition du ${today}`);
console.log(`🧠 Modèle : ${MODEL}`);
console.log(`📅 N° ${editionNumber}\n`);

const resp = await client.messages.create({
  model: MODEL,
  max_tokens: 16000,
  system: SYSTEM,
  messages: [{ role: "user", content: USER }],
});

// ---------- Parsing ----------
const raw = resp.content
  .filter((b) => b.type === "text")
  .map((b) => b.text)
  .join("")
  .trim();

// Retire d'éventuels ```json``` parasites
const clean = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();

let parsed;
try {
  parsed = JSON.parse(clean);
} catch (err) {
  console.error("❌ Le modèle n'a pas retourné un JSON valide.");
  console.error("Début du contenu reçu :\n", raw.slice(0, 800));
  process.exit(1);
}

if (!Array.isArray(parsed.articles) || parsed.articles.length < 3) {
  console.error("❌ Édition incomplète : moins de 3 articles produits.");
  process.exit(1);
}

// Ajoute les métadonnées de traçabilité
parsed.generatedAt = now.toISOString();
parsed.model = MODEL;

// ---------- Écriture du fichier ----------
const outPath = path.join(process.cwd(), "edition.json");
fs.writeFileSync(outPath, JSON.stringify(parsed, null, 2), "utf-8");

// ---------- Résumé ----------
console.log(`✅ Édition publiée — ${parsed.articles.length} articles`);
parsed.articles.forEach((a, i) => {
  console.log(`   ${i + 1}. [${a.category}] ${a.title.slice(0, 70)}`);
});
console.log(`\n📄 Fichier écrit : ${outPath}`);
console.log(
  `💰 Tokens : ${resp.usage.input_tokens} in + ${resp.usage.output_tokens} out`
);

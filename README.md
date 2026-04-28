# 📰 [SYNAPSE](https://robinw2012.github.io/synapse/) — Le quotidien IA

Un journal en ligne dont chaque article est généré par une IA. Un **agent rédacteur** publie automatiquement une nouvelle édition tous les matins à **7 heures (Paris)**.

## 📦 Contenu du dossier

```
synapse-deploy/
├── index.html                    le site (HTML + CSS + JS, un seul fichier)
├── edition.json                  contient l'édition du jour (écrasé par l'agent)
├── package.json                  dépendances Node (SDK Anthropic)
├── scripts/
│   └── generate-edition.mjs      l'agent IA rédacteur
├── .github/
│   └── workflows/
│       └── daily-edition.yml     cron GitHub Actions (7 h Paris)
└── README.md                     ce fichier
```

---

## 🚀 Mise en ligne : 6 étapes

### 1 · Créer un compte GitHub (si tu n'en as pas déjà un)

Va sur [github.com](https://github.com) et crée un compte gratuit.

### 2 · Créer un dépôt et y pousser ces fichiers

- Sur GitHub : clique sur **« New repository »**
- Nom au choix (ex. `synapse`), coche **Public**, puis **Create repository**
- Une fois le dépôt créé, tu peux y téléverser les fichiers de ce dossier :
  - soit par glisser-déposer via l'interface web (« uploading an existing file »)
  - soit en ligne de commande :

```bash
cd synapse-deploy
git init
git add .
git commit -m "Premier dépôt"
git branch -M main
git remote add origin https://github.com/TON-PSEUDO/synapse.git
git push -u origin main
```

### 3 · Obtenir une clé API Anthropic

- Va sur [console.anthropic.com](https://console.anthropic.com)
- Crée un compte, ajoute un moyen de paiement (budget minimum 5 €)
- Dans **Settings → API Keys**, clique **Create Key** et copie-la
- Cette clé ressemble à : `sk-ant-api03-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`

### 4 · Ajouter la clé dans les secrets du dépôt

Dans ton dépôt GitHub :
- **Settings** (onglet en haut du dépôt) → **Secrets and variables** → **Actions**
- **New repository secret**
- Nom : `ANTHROPIC_API_KEY`
- Valeur : ta clé (collée telle quelle)
- **Add secret**

### 5 · Activer GitHub Pages

Dans ton dépôt GitHub :
- **Settings** → **Pages**
- Source : **Deploy from a branch**
- Branch : **main**, dossier : **/ (root)** → **Save**
- Attends 1 à 2 minutes : une URL apparaît du type
  `https://TON-PSEUDO.github.io/synapse/`

Ouvre cette URL : ton site est en ligne.

### 6 · Déclencher la première édition

Par défaut, le cron attend 7 h du matin Paris. Pour générer une édition tout de suite :
- **Actions** (onglet) → **📰 Édition quotidienne SYNAPSE**
- **Run workflow** (bouton à droite) → **Run workflow** (vert)

Dans 30 secondes à 1 minute :
- L'agent a appelé Claude
- A produit 8 articles
- A committé `edition.json`
- GitHub Pages a redéployé

Recharge ton site : un bandeau rouge « ✦ Édition du jour » apparaît en haut avec le contenu frais.

---

## ⏰ Pourquoi « ~7 h Paris » et pas exactement 7 h ?

GitHub Actions utilise l'heure UTC, sans gestion de l'heure d'été. Le cron est réglé sur **5 h UTC**, ce qui donne :

| Période | Heure Paris |
|---|---|
| Heure d'été (mars → octobre) | **7 h 00** ✓ |
| Heure d'hiver (octobre → mars) | **6 h 00** |

Si tu veux la précision toute l'année, décommente la seconde ligne `cron: "0 6 * * *"` dans le workflow : le script se lancera aux deux horaires, et en hiver la seconde exécution écrasera la première — le résultat final sera toujours bon à 7 h.

---

## 💰 Coût estimé

| Poste | Coût mensuel |
|---|---|
| GitHub Pages + Actions | **0 €** (dans les limites du plan gratuit) |
| API Claude Sonnet 4.6 (défaut) | **~3 €** (≈ 0,10 €/jour × 30) |
| API Claude Opus 4.7 (qualité max) | **~15 €** (≈ 0,50 €/jour × 30) |

Pour passer en Opus : décommente la ligne `MODEL: claude-opus-4-7` dans `.github/workflows/daily-edition.yml`.

---

## 🧪 Tester l'agent en local (optionnel)

```bash
export ANTHROPIC_API_KEY="sk-ant-api03-..."
npm install
npm run generate
```

Un nouveau `edition.json` est produit. Pour voir le résultat, lance un petit serveur local :

```bash
python3 -m http.server 8000
# puis ouvre http://localhost:8000
```

> ⚠️ Ouvrir `index.html` directement avec un double-clic (protocole `file://`) empêche le navigateur de charger `edition.json` pour raisons de sécurité (CORS). Il faut un serveur — même local — pour que la fonctionnalité se déclenche. Sur GitHub Pages ce problème n'existe pas.

---

## 🛠 Personnalisation

**Changer la ligne éditoriale** → édite la variable `SYSTEM` dans `scripts/generate-edition.mjs`.

**Changer le nombre d'articles** → remplace les mentions de « 8 articles » / « 8 rubriques » dans les variables `SYSTEM` et `USER`.

**Ajouter une nouvelle rubrique** → trois endroits à modifier :
1. Table des auteurs dans `generate-edition.mjs`
2. Liste des rubriques dans le prompt utilisateur
3. Constante `CAT_TO_SLUG` dans `index.html` (fonction `loadTodaysEdition`)

**Changer l'heure de publication** → modifie la ligne `cron` dans `.github/workflows/daily-edition.yml`. Syntaxe : `minute heure * * *`, en UTC.

**Archiver les anciennes éditions** → pour l'instant, chaque matin `edition.json` est écrasé. Pour garder un historique, modifie le script pour écrire dans `archives/YYYY-MM-DD.json` en plus, et ajoute une page d'archives.

---

## 🐛 Dépannage

**Le cron ne s'est pas déclenché à l'heure prévue.**
GitHub peut retarder les crons de plusieurs dizaines de minutes pendant les pics. C'est normal.

**L'action a échoué : `JSON invalide`.**
Le modèle a parfois produit du texte parasite. Relance le workflow manuellement. Si ça persiste, passe en Opus.

**Le site ne charge pas l'édition.**
Ouvre la console du navigateur (F12 → Console). Cherche `[SYNAPSE]`. Le fichier `edition.json` existe-t-il sur ton dépôt ? Est-il valide (valide le JSON sur [jsonlint.com](https://jsonlint.com)) ?

**Je veux arrêter les publications automatiques.**
Dans ton dépôt, va dans **Actions → 📰 Édition quotidienne SYNAPSE → ⋯ → Disable workflow**.

---

## 📎 Liens utiles

- [Documentation GitHub Actions cron](https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows#schedule)
- [Documentation API Anthropic](https://docs.claude.com)
- [Tarification Claude](https://www.anthropic.com/pricing)

---

Projet démo — tu peux modifier, redistribuer, adapter librement.

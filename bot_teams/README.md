# Bot Teams hexarq

Un bot Microsoft Teams **simple** qui importe directement les modules blockchain de [`../new/modules`](../new/modules).

- Tu colles une **adresse** → le bot renvoie le solde.
- Tu colles un **hash de transaction** → le bot la suit jusqu'à finalisation, puis t'envoie une **notification** (message proactif).

Le bot fait lui-même la détection (adresse vs transaction, et la chaîne) puis appelle les classes `Solana` / `EVM` / `Bitcoin`. **Aucun serveur API à lancer à côté** : tout tourne dans le process du bot.

---

## 1. Installation

```bash
cd bot_teams
npm install
cp .env.example .env   # (Windows PowerShell : copy .env.example .env)
```

## 2. Lancer en local (sans Azure, sans Teams)

```bash
cd bot_teams
npm run dev
```

Ouvre ensuite **http://localhost:3979/devtools** : une interface de chat locale (fournie par `@microsoft/teams.dev`) pour tester le bot sans rien configurer côté Microsoft. Colle une adresse ou un hash et observe.

> `@microsoft/teams.dev` (DevTools) est marqué *deprecated* mais reste fonctionnel. Son remplaçant officiel est le **Microsoft 365 Agents Playground**.
>
> Pour cette étape, `.env` peut rester vide. Les `CLIENT_ID/SECRET/TENANT_ID` ne servent que pour le vrai Teams (étape 3).

## 3. Brancher sur le vrai Teams

1. **Crée une ressource Azure Bot** (type **Single Tenant**) + une **app Microsoft Entra ID** → récupère `CLIENT_ID`, crée un `CLIENT_SECRET`, note ton `TENANT_ID`.
2. Renseigne-les dans `.env`.
3. Expose le bot en **HTTPS public** (en dev : `devtunnel` ou `ngrok`), puis mets dans l'Azure Bot le **Messaging endpoint** :
   `https://<ton-tunnel>/api/messages`
4. Édite [`appPackage/manifest.json`](appPackage/manifest.json) : remplace les deux `REMPLACER-PAR-CLIENT_ID-DU-BOT` par ton `CLIENT_ID`.
5. Ajoute deux icônes dans `appPackage/` : `color.png` (192×192) et `outline.png` (32×32).
6. Zippe le contenu de `appPackage/` (les 3 fichiers, pas le dossier) → **Upload a custom app** dans Teams.

> Astuce : le **Microsoft 365 Agents Toolkit** (extension VS Code) automatise les étapes 1, 3 et 6.

## 4. Déploiement (pour que ça tourne PC éteint)

Le bot est un simple serveur Node : héberge-le là où tu veux (Azure App Service / Container Apps, Render, Railway…). Comme il importe les modules de `../new/modules`, garde ce dossier à côté lors du déploiement.

---

## Limites de cette version simple

- **Le suivi vit en mémoire.** Si le bot redémarre pendant qu'une transaction est en attente, le suivi est perdu (pas de notification). Garde le process en vie côté hébergeur.
- Pour un suivi **durable** (résistant aux redémarrages, idéal serverless), l'étape suivante est le pattern **Azure Durable Functions** : on stocke `{tx, conversationRef}` et une orchestration reprend toute seule.

## Fichiers

| Fichier | Rôle |
|---|---|
| [`bot_teams.ts`](bot_teams.ts) | Tout le bot (~75 lignes) |
| [`appPackage/manifest.json`](appPackage/manifest.json) | Manifest Teams (à compléter pour le vrai Teams) |
| `.env.example` | Variables d'environnement à copier dans `.env` |

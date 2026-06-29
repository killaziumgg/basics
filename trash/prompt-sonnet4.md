# Prompt pour Claude Sonnet 4 — vérification du statut d'une transaction Solana

Tu es un développeur TypeScript senior, expert de la blockchain Solana et de la librairie `@solana/kit`. Écris du code TypeScript pour Node.js 22 (exécution directe des .ts, donc les types s'importent avec `import type`).

## Contexte existant — réutilise ce setup tel quel, ne le modifie pas

```ts
import { createSolanaRpc, type Signature } from "@solana/kit";

(BigInt.prototype as any).toJSON = function () { return this.toString(); };

const RPC_URL = "https://api.mainnet.solana.com";
const rpc = createSolanaRpc(RPC_URL);
```

## Tâche

Écris exactement deux fonctions, sans rien d'autre autour (pas de classe, pas de dépendance externe).

### Fonction 1 : `waitForTransaction`

```ts
type TxOutcome =
  | { status: "success"; slot: bigint }
  | { status: "failed"; errors: string[] }
  | { status: "not_found" };

async function waitForTransaction(signature: string): Promise<TxOutcome>
```

Comportement, dans cet ordre exact :

1. Appelle la méthode RPC `getSignatureStatuses` ainsi :
   `await rpc.getSignatureStatuses([signature as Signature], { searchTransactionHistory: true }).send()`
   La réponse a la forme `{ context, value }` où `value` est un tableau avec une entrée par signature demandée.
2. Boucle de polling : re-vérifie toutes les 2 secondes (`await new Promise(r => setTimeout(r, 2000))`), maximum 30 tentatives (donc ~60 secondes au total).
3. À chaque itération, analyse `value[0]` :
   - **Si `value[0] === null`** → la transaction est inconnue du cluster (pas encore propagée, ou expirée). Continue le polling. Si c'est encore `null` après les 30 tentatives, retourne `{ status: "not_found" }`.
   - **Si `value[0].err !== null`** → la transaction a échoué. Arrête le polling immédiatement, appelle `getTransactionErrors(signature)` (fonction 2), sauvegarde le tableau retourné dans une variable `errors`, et retourne `{ status: "failed", errors }`.
   - **Si `value[0].confirmationStatus === "finalized"` et `value[0].err === null`** → la transaction est passée : incluse dans un bloc finalisé (irréversible) ET exécutée avec succès. Retourne `{ status: "success", slot: value[0].slot }`. C'est le cas où "on continue".
   - **Sinon** (`confirmationStatus` vaut `"processed"` ou `"confirmed"`, sans erreur) → la transaction est dans un bloc mais pas encore finalisée. Continue le polling.

### Fonction 2 : `getTransactionErrors`

```ts
async function getTransactionErrors(signature: string): Promise<string[]>
```

Comportement :

1. Appelle la méthode RPC `getTransaction` via un `fetch` POST brut JSON-RPC sur `RPC_URL` avec ce body :
   ```json
   {
     "jsonrpc": "2.0",
     "id": 1,
     "method": "getTransaction",
     "params": [
       "<signature>",
       { "encoding": "jsonParsed", "maxSupportedTransactionVersion": 0 }
     ]
   }
   ```
2. Dans la réponse, lis `result.meta.err` (l'objet d'erreur) et `result.meta.logMessages` (tableau de strings — les logs d'exécution des programmes).
3. Construis et retourne un tableau de strings contenant :
   - en première position : `JSON.stringify(meta.err)`
   - ensuite : toutes les lignes de `logMessages` qui contiennent `"Error"`, `"error"` ou `"failed"` (ce sont les lignes qui expliquent l'échec en clair).
4. Si `result` est `null` ou que `meta.logMessages` est absent, retourne un tableau avec uniquement `JSON.stringify(meta?.err ?? null)`.

## Exemples de réponses JSON réelles (mainnet) — base-toi dessus pour les types

`getSignatureStatuses` — transaction finalisée et réussie :

```json
{
  "context": { "apiVersion": "4.0.0", "slot": 425734579 },
  "value": [
    {
      "confirmationStatus": "finalized",
      "confirmations": null,
      "err": null,
      "slot": 425083578,
      "status": { "Ok": null }
    }
  ]
}
```

`getSignatureStatuses` — transaction confirmée mais pas encore finalisée (le champ `confirmations` est un entier qui monte de 0 à ~31, puis devient `null` à la finalisation) :

```json
{
  "context": { "apiVersion": "4.0.0", "slot": 425735048 },
  "value": [
    {
      "confirmationStatus": "confirmed",
      "confirmations": 11,
      "err": null,
      "slot": 425735043,
      "status": { "Ok": null }
    }
  ]
}
```

`getSignatureStatuses` — transaction échouée (notez que `err` est non-null alors qu'elle est quand même confirmée/finalisée — l'inclusion dans un bloc et le succès sont deux choses indépendantes) :

```json
{
  "context": { "apiVersion": "4.0.0", "slot": 425735060 },
  "value": [
    {
      "confirmationStatus": "finalized",
      "confirmations": null,
      "err": { "InstructionError": [5, { "Custom": 6002 }] },
      "slot": 425735043,
      "status": { "Err": { "InstructionError": [5, { "Custom": 6002 }] } }
    }
  ]
}
```

`getSignatureStatuses` — transaction inconnue du cluster :

```json
{
  "context": { "apiVersion": "4.0.0", "slot": 425735100 },
  "value": [null]
}
```

`getTransaction` — extrait pertinent d'une transaction échouée (les lignes de log à filtrer ressemblent à ça) :

```json
{
  "result": {
    "meta": {
      "err": { "InstructionError": [5, { "Custom": 6002 }] },
      "logMessages": [
        "Program ComputeBudget111111111111111111111111111111 invoke [1]",
        "Program ComputeBudget111111111111111111111111111111 success",
        "Program cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG invoke [1]",
        "Program log: Instruction: Swap2",
        "Program log: AnchorError thrown in programs/cp-amm/src/instructions/swap/swap_exact_out.rs:48. Error Code: ExceededSlippage. Error Number: 6002. Error Message: Exceeded slippage tolerance.",
        "Program cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG failed: custom program error: 0x1772"
      ]
    }
  }
}
```

## Règles importantes — ne te trompe pas là-dessus

- `err === null` signifie SUCCÈS. `confirmations === null` signifie FINALISÉE (fin du comptage, irréversible), PAS "inconnu". Ne confonds pas la signification de ces deux `null`.
- Une transaction peut être finalisée ET échouée en même temps : il faut vérifier `err` indépendamment de `confirmationStatus`.
- `searchTransactionHistory: true` est obligatoire sur `getSignatureStatuses`, sinon les transactions de plus de ~2 minutes renvoient `null` alors qu'elles existent.
- `maxSupportedTransactionVersion: 0` est obligatoire sur `getTransaction`, sinon les transactions versionnées (v0) renvoient une erreur.
- `Signature` est un export de type uniquement dans `@solana/kit` : `import { createSolanaRpc, type Signature }` (un import valeur plante au runtime sous Node).
- Les nombres renvoyés par `@solana/kit` (comme `slot`) sont des `bigint`.
- Commentaires en français, indentation 4 espaces.

## Format de réponse attendu

Réponds UNIQUEMENT avec le code TypeScript complet (imports + types + les deux fonctions + un exemple d'appel commenté à la fin), dans un seul bloc de code. Aucune explication avant ou après le bloc.

// Détection du type d'entrée saisie (miroir du detect() côté serveur).
// Renvoie { chain, kind, display? } ou null si le format est inconnu.
export function detect(v) {
    if (/^0x[0-9a-fA-F]{40}$/.test(v)) return { chain: "EVM", kind: "address" };
    if (/^0x[0-9a-fA-F]{64}$/.test(v)) return { chain: "EVM", kind: "tx" };
    // TRON : adresse Base58 'T...' (34 car.), rattachée à l'EVM. Avant Solana (même alphabet Base58).
    if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(v)) return { chain: "EVM", kind: "address", display: "Tron" };
    if (/^bc1[0-9a-z]{6,87}$/.test(v)) return { chain: "Bitcoin", kind: "address" };
    if (/^[13][1-9A-HJ-NP-Za-km-z]{25,34}$/.test(v)) return { chain: "Bitcoin", kind: "address" };
    // 64-hex : ambigu Bitcoin/TRON. Le serveur tranche ; on part sur Bitcoin pour l'affichage initial.
    if (/^[0-9a-fA-F]{64}$/.test(v)) return { chain: "Bitcoin", kind: "tx" };
    if (/^[1-9A-HJ-NP-Za-km-z]{86,90}$/.test(v)) return { chain: "Solana", kind: "tx" };
    if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v)) return { chain: "Solana", kind: "address" };
    return null;
}

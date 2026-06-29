// Configuration et accès à l'API.

// Si la page est ouverte en file:// on tape l'API directement (nécessite CORS) ;
// servie par Express, on reste en relatif (même origine).
export const API_BASE = location.protocol === "file:" ? "http://localhost:3000" : "";

// Réglages récupérés du serveur au démarrage. pollMs = intervalle de rafraîchissement (fallback 5 s).
export const settings = { pollMs: 5000 };

// Récupère un JSON depuis l'API.
export async function api(path) {
    const res = await fetch(API_BASE + path);
    return res.json();
}

// Charge la config serveur (notamment pollIntervalSeconds) avant de lancer les timers.
export async function loadConfig() {
    try {
        const cfg = await api("/config");
        if (cfg && Number(cfg.pollIntervalSeconds) > 0) {
            settings.pollMs = Number(cfg.pollIntervalSeconds) * 1000;
        }
    } catch {
        /* on garde la valeur par défaut (5 s) */
    }
}

// Fonctions de formatage pures (aucune dépendance, aucun effet de bord).

// Échappe une chaîne pour une insertion HTML sûre.
export function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// Formate un nombre selon sa magnitude (locale fr-FR).
export function fmtNum(n) {
    if (n == null || !isFinite(n)) return "—";
    if (n === 0) return "0";
    const a = Math.abs(n);
    const d = a >= 1000 ? 2 : a >= 1 ? 4 : 8;
    return Number(n).toLocaleString("fr-FR", { maximumFractionDigits: d });
}

// Durée lisible « X s » / « X min Y s » / « X h Y min ».
export function dur(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    if (s < 60) return s + " s";
    const m = Math.floor(s / 60);
    if (m < 60) return m + " min " + (s % 60) + " s";
    const h = Math.floor(m / 60);
    return h + " h " + (m % 60) + " min";
}

// Tronque un hash long pour l'affichage.
export function shortHash(h) {
    return h.length > 22 ? h.slice(0, 10) + "…" + h.slice(-8) : h;
}

// Horodatage de bloc (secondes Unix) → « 1700000000 — 24/06/2026 12:00:00 ».
export function fmtBlockTime(sec) {
    const n = Number(sec);
    if (!isFinite(n) || n <= 0) return String(sec);
    const date = new Date(n * 1000).toLocaleString("fr-FR", {
        day: "2-digit", month: "2-digit", year: "numeric",
        hour: "2-digit", minute: "2-digit", second: "2-digit"
    });
    return `${n} — ${date}`;
}

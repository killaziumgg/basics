// Horloge (1 s) : met à jour tous les libellés de temps relatif.
import { dur } from "./format.js";

export function startClock() {
    setInterval(() => {
        const now = Date.now();
        document.querySelectorAll("[data-ago]").forEach((el) => {
            el.textContent = "il y a " + dur(now - Number(el.dataset.ago));
        });
        document.querySelectorAll("[data-since]").forEach((el) => {
            el.textContent = "en attente depuis " + dur(now - Number(el.dataset.since));
        });
    }, 1000);
}

// Helpers de rendu / DOM partagés.
import { logo } from "./logos.js";
import { esc } from "./format.js";

// Raccourci de sélection.
export const $ = (sel) => document.querySelector(sel);

// En-tête commun d'une carte de résultat : logo + titre + valeur + étiquette de chaîne.
export function cardHead(chain, kind, value) {
    return `<div class="card-head">
        ${logo(chain)}
        <div class="meta">
            <div class="title">${kind}</div>
            <div class="val">${esc(value)}</div>
        </div>
        <span class="tag">${esc(chain)}</span>
    </div>`;
}

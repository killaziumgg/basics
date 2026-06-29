// Tiroir de notifications (droite) : suivi des transactions non finalisées
// et notification système quand elles atteignent leur état terminal.
import { esc, shortHash } from "./format.js";
import { logo } from "./logos.js";
import { $ } from "./dom.js";
import { jobs, trackedIds } from "./store.js";
import { on, emit } from "./events.js";

const drawer = $("#drawer");
const overlay = $("#overlay");

function openDrawer()  { drawer.classList.add("open");  overlay.classList.add("open"); }
function closeDrawer() { drawer.classList.remove("open"); overlay.classList.remove("open"); }

function addNotify(id) {
    const job = jobs[id];
    if (!job || job.notified) return;
    job.notified = true;
    trackedIds.push(id);
    if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
    emit("job:tracked", job);   // → la carte de résultat se rafraîchit
    renderDrawer();
    openDrawer();
}

function removeNotify(id) {
    const i = trackedIds.indexOf(id);
    if (i >= 0) trackedIds.splice(i, 1);
    if (jobs[id]) {
        jobs[id].notified = false;
        emit("job:tracked", jobs[id]);
    }
    renderDrawer();
}

function pillLabel(job) {
    if (job.state === "pending") return `<span class="spinner"></span>En attente`;
    if (job.state === "success") return `✓ Finalisée`;
    if (job.state === "error")   return `✗ Erreur`;
    return `✗ Échec`;
}

function renderDrawer() {
    const list = $("#notif-list");
    const badge = $("#notifBadge");
    badge.textContent = trackedIds.length;
    badge.classList.toggle("show", trackedIds.length > 0);

    if (!trackedIds.length) {
        list.innerHTML = `<div id="notif-empty">Aucune transaction suivie.<br />Recherchez une transaction non finalisée puis cliquez sur « Notifier ».</div>`;
        return;
    }

    list.innerHTML = trackedIds.map((id) => {
        const job = jobs[id];
        const desc = job.state === "pending"
            ? `<span data-since="${job.startedAt}">en attente depuis 0 s</span>`
            : esc(job.result?.status?.statusDescription || job.error || "");
        return `<div class="ni ${job.state}">
            <div class="nh">${logo(job.chain, 20)}<span class="hash">${esc(shortHash(job.value))}</span>
                <button class="x" data-remove="${id}">&times;</button></div>
            <span class="pill">${pillLabel(job)}</span>
            <div class="desc">${desc}</div>
        </div>`;
    }).join("");
}

function maybeNotifyOS(job) {
    if (!job.notified) return;
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    const title = job.state === "success" ? "✓ Transaction finalisée"
        : job.state === "error" ? "⚠ Erreur réseau"
        : "✗ Transaction échouée";
    new Notification(title, {
        body: `${job.chain} · ${shortHash(job.value)}`,
    });
}

// Câblage : ouverture/fermeture du tiroir, suppression d'un suivi, et réaction
// aux événements émis par les autres modules.
export function wireNotifications() {
    $("#notifBtn").addEventListener("click", () => drawer.classList.contains("open") ? closeDrawer() : openDrawer());
    $("#drawerClose").addEventListener("click", closeDrawer);
    overlay.addEventListener("click", closeDrawer);

    // Clic sur la croix d'une transaction suivie (délégué).
    $("#notif-list").addEventListener("click", (e) => {
        const x = e.target.closest("[data-remove]");
        if (x) removeNotify(Number(x.dataset.remove));
    });

    // Demande de suivi émise par une carte de transaction.
    on("track:add", (id) => addNotify(id));

    // Transaction arrivée à l'état terminal.
    on("job:resolved", (job) => { renderDrawer(); maybeNotifyOS(job); });
}

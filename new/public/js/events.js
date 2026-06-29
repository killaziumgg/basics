// Mini bus d'événements : permet aux modules de communiquer sans dépendre
// directement les uns des autres (ex. transactions ↔ notifications).
const handlers = {};

// Abonne une fonction à un type d'événement.
export function on(type, fn) {
    if (!handlers[type]) handlers[type] = [];
    handlers[type].push(fn);
}

// Émet un événement vers tous les abonnés.
export function emit(type, payload) {
    (handlers[type] || []).forEach((fn) => fn(payload));
}

// Point d'entrée : câble les interactions puis démarre les rafraîchissements.
import { loadConfig } from "./config.js";
import { wireTransactions } from "./transactions.js";
import { wireSearch } from "./search.js";
import { wireNotifications } from "./notifications.js";
import { startChains } from "./chains.js";
import { startClock } from "./clock.js";

async function main() {
    wireTransactions();
    wireSearch();
    wireNotifications();
    startClock();

    await loadConfig();   // récupère l'intervalle de poll avant de lancer les timers
    startChains();
}

main();

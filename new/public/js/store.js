// État partagé du suivi des transactions.
// Une « job » = une recherche de transaction : sa carte de résultat ET son entrée
// dans le tiroir de notifications pointent vers le même objet.
export const jobs = {};        // id -> job
export const trackedIds = [];  // ids suivis dans le tiroir de notifications

let seq = 0;

// Crée et enregistre une nouvelle job (état initial « en attente »).
export function createJob(value, chain) {
    const job = {
        id: ++seq,
        value,
        chain,
        state: "pending",
        startedAt: Date.now(),
        result: null,
        error: null,
        notified: false
    };
    jobs[job.id] = job;
    return job;
}

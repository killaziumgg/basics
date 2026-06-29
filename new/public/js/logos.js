// Logo SVG inline d'une chaîne, à partir d'une clé (nom de chaîne ou ticker).
export function logo(key, size) {
    const sz = size || 28;
    const k = String(key).toLowerCase();
    const wrap = (inner) => `<svg viewBox="0 0 32 32" width="${sz}" height="${sz}" style="flex:0 0 auto">${inner}</svg>`;

    if (k.includes("bitcoin") || k === "btc")
        return wrap(`<circle cx="16" cy="16" r="16" fill="#f7931a"/><text x="16" y="23" font-size="19" text-anchor="middle" fill="#fff" font-family="Arial" font-weight="bold">₿</text>`);
    if (k.includes("solana") || k === "sol")
        return wrap(`<rect width="32" height="32" rx="8" fill="#0b0b14"/><g fill="#14f195"><path d="M9 11h12l-2 2H7z"/><path d="M7 16h12l2 2H9z"/><path d="M9 21h12l-2 2H7z"/></g>`);
    if (k.includes("base"))
        return wrap(`<circle cx="16" cy="16" r="16" fill="#0052ff"/><path d="M16 7a9 9 0 100 18 9 9 0 00.5-18v3.5A5.5 5.5 0 1110.5 18H22a5.5 5.5 0 00-6-7z" fill="#fff"/>`);
    if (k.includes("tron") || k === "trx")
        return wrap(`<circle cx="16" cy="16" r="16" fill="#eb0029"/><text x="16" y="22" font-size="15" text-anchor="middle" fill="#fff" font-family="Arial" font-weight="bold">T</text>`);

    // EVM / Ethereum (générique)
    return wrap(`<circle cx="16" cy="16" r="16" fill="#627eea"/><g fill="#fff"><path d="M16 5l-7 11.2 7 4.1 7-4.1z" opacity=".95"/><path d="M9 17.5l7 4.1 7-4.1-7 9.5z" opacity=".75"/></g>`);
}

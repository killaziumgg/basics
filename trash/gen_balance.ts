import { writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"

// Même adresse sur toutes les chains, pour un jeu d'exemples cohérent
const ADDRESS = '0x21ef0939307492283E806e62AbFF8b9964edd5b5'

const CHAINS = [
  { short: 'eth',      coin: 'ETH', rpc: 'https://ethereum-rpc.publicnode.com' },
  { short: 'base',     coin: 'ETH', rpc: 'https://base-rpc.publicnode.com' },
  { short: 'optimism', coin: 'ETH', rpc: 'https://optimism-rpc.publicnode.com' },
  { short: 'arbitrum', coin: 'ETH', rpc: 'https://arbitrum-one-rpc.publicnode.com' },
  { short: 'polygon',  coin: 'POL', rpc: 'https://polygon-bor-rpc.publicnode.com' },
  { short: 'bsc',      coin: 'BNB', rpc: 'https://bsc-rpc.publicnode.com' },
]

const OUT_DIR = 'exempleresponse'

async function rpc(url: string, method: string, params: any[]) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  return res.json()
}

const only = process.argv[2]
const chains = only ? CHAINS.filter((c) => c.short === only) : CHAINS

for (const c of chains) {
  const envelope = await rpc(c.rpc, 'eth_getBalance', [ADDRESS, 'latest'])

  const dir = join(OUT_DIR, c.short)
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `eth_getBalance_${c.short}.json`)
  writeFileSync(file, JSON.stringify(envelope, null, 2) + '\n')

  const human = Number(BigInt(envelope.result)) / 1e18
  console.log(`✅ ${c.short.padEnd(9)} ${human.toFixed(6)} ${c.coin}  (${envelope.result})  -> ${file}`)
}

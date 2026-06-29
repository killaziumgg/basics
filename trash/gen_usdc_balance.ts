import { writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"

// Même adresse partout (cohérent avec les soldes natifs)
const ADDRESS = '0x21ef0939307492283E806e62AbFF8b9964edd5b5'

// Contrat USDC natif (Circle) par chain
const CHAINS = [
  { short: 'eth',      usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', rpc: 'https://ethereum-rpc.publicnode.com' },
  { short: 'base',     usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', rpc: 'https://base-rpc.publicnode.com' },
  { short: 'optimism', usdc: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', rpc: 'https://optimism-rpc.publicnode.com' },
  { short: 'arbitrum', usdc: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', rpc: 'https://arbitrum-one-rpc.publicnode.com' },
  { short: 'polygon',  usdc: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', rpc: 'https://polygon-bor-rpc.publicnode.com' },
  { short: 'bsc',      usdc: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', rpc: 'https://bsc-rpc.publicnode.com' },
]

const OUT_DIR = 'exempleresponse'

// calldata balanceOf(address) : 0x70a08231 + adresse paddée sur 32 octets
const balanceData = '0x70a08231' + ADDRESS.slice(2).toLowerCase().padStart(64, '0')

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
  const envelope = await rpc(c.rpc, 'eth_call', [{ to: c.usdc, data: balanceData }, 'latest'])

  const dir = join(OUT_DIR, c.short)
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'eth_call.json')
  writeFileSync(file, JSON.stringify(envelope, null, 2) + '\n')

  // decimals() juste pour l'affichage (6 partout, 18 sur BSC)
  const dec = await rpc(c.rpc, 'eth_call', [{ to: c.usdc, data: '0x313ce567' }, 'latest'])
  const decimals = Number(BigInt(dec.result))
  const human = Number(BigInt(envelope.result)) / 10 ** decimals
  console.log(`✅ ${c.short.padEnd(9)} ${human.toFixed(2)} USDC (dec ${decimals})  (${envelope.result})  -> ${file}`)
}

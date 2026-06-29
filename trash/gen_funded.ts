import { writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"

// Pour chaque chain : contrat USDC, RPC, et quels exemples (re)générer avec une adresse financée
// (on ne remplace QUE les fichiers qui étaient à 0 avec le wallet 0x21ef…)
const CHAINS = [
  { short: 'base',     usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', rpc: 'https://base-rpc.publicnode.com',         write: ['usdc'] },
  { short: 'optimism', usdc: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', rpc: 'https://optimism-rpc.publicnode.com',     write: ['native', 'usdc'] },
  { short: 'arbitrum', usdc: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', rpc: 'https://arbitrum-one-rpc.publicnode.com', write: ['native', 'usdc'] },
  { short: 'polygon',  usdc: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', rpc: 'https://polygon-bor-rpc.publicnode.com',   write: ['native', 'usdc'] },
  { short: 'bsc',      usdc: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', rpc: 'https://bsc-rpc.publicnode.com',          write: ['usdc'] },
]

const OUT_DIR = 'exempleresponse'
const TRANSFER = '0xa9059cbb'

async function rpc(url: string, method: string, params: any[]) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  return res.json()
}

const balanceData = (addr: string) => '0x70a08231' + addr.slice(2).toLowerCase().padStart(64, '0')

const only = process.argv[2]
const chains = only ? CHAINS.filter((c) => c.short === only) : CHAINS

for (const c of chains) {
  let blockNum = BigInt((await rpc(c.rpc, 'eth_blockNumber', [])).result)
  let funded: { address: string; nativeEnv: any; usdcEnv: any } | null = null
  const tried = new Set<string>()

  // on cherche un expéditeur d'USDC qui détient ENCORE du natif ET de l'USDC
  for (let i = 0; i < 400 && !funded; i++) {
    const block = (await rpc(c.rpc, 'eth_getBlockByNumber', ['0x' + blockNum.toString(16), true])).result
    blockNum -= 1n
    const senders: string[] = (block?.transactions ?? [])
      .filter((t: any) => t.to?.toLowerCase() === c.usdc.toLowerCase() && t.input?.startsWith(TRANSFER))
      .map((t: any) => t.from)

    for (const addr of senders) {
      if (tried.has(addr)) continue
      tried.add(addr)
      const nativeEnv = await rpc(c.rpc, 'eth_getBalance', [addr, 'latest'])
      const usdcEnv = await rpc(c.rpc, 'eth_call', [{ to: c.usdc, data: balanceData(addr) }, 'latest'])
      if (nativeEnv.result && usdcEnv.result && BigInt(nativeEnv.result) > 0n && BigInt(usdcEnv.result) > 0n) {
        funded = { address: addr, nativeEnv, usdcEnv }
        break
      }
    }
  }

  if (!funded) {
    console.log(`❌ ${c.short}: pas d'adresse financée trouvée`)
    continue
  }

  const dir = join(OUT_DIR, c.short)
  mkdirSync(dir, { recursive: true })

  if (c.write.includes('native')) {
    writeFileSync(join(dir, `eth_getBalance_${c.short}.json`), JSON.stringify(funded.nativeEnv, null, 2) + '\n')
  }
  if (c.write.includes('usdc')) {
    writeFileSync(join(dir, 'eth_call.json'), JSON.stringify(funded.usdcEnv, null, 2) + '\n')
  }

  console.log(`✅ ${c.short.padEnd(9)} ${funded.address}  [${c.write.join('+')}]  native=${funded.nativeEnv.result}  usdc=${funded.usdcEnv.result}`)
}

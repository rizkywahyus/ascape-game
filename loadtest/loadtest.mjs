// Simulates N players: each matchmakes, sends one input per tick (random walk) and a ping every 2 s,
// like the real client. Prints RTT percentiles, bandwidth, and the server's tick-duration percentiles.
//
//   node loadtest.mjs --clients 200 --seconds 60 --server http://localhost:8080
import WebSocket from 'ws'

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, arg, i, all) => (arg.startsWith('--') ? [...pairs, [arg.slice(2), all[i + 1]]] : pairs), []),
)
const CLIENTS = Number(args.clients ?? 100)
const SECONDS = Number(args.seconds ?? 60)
const SERVER = args.server ?? 'http://localhost:8080'
const RAMP_MS = Number(args.rampMs ?? 20)
const TICK_MS = 50
const PING_MS = 2000
const DIRECTION_CHANGE_MS = 1500
const WS_URL = SERVER.replace(/^http/, 'ws') + '/ws'

const stats = { connected: 0, closed: 0, errors: 0, messages: 0, bytes: 0, rtts: [], snapshots: 0 }
const sockets = []

function startClient(index) {
  const ws = new WebSocket(WS_URL)
  let seq = 1
  let direction = [0, 0]
  const timers = []
  ws.on('open', () => {
    stats.connected++
    ws.send(JSON.stringify({ t: 'queue', d: { rolePref: index % 5 === 0 ? 'monster' : 'survivor' } }))
    timers.push(setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return
      ws.send(JSON.stringify({ t: 'input', d: { seq: seq++, dx: direction[0], dy: direction[1], sprint: Math.random() < 0.2, interact: Math.random() < 0.3, actions: [] } }))
    }, TICK_MS))
    timers.push(setInterval(() => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ t: 'ping', d: { ts: performance.now() } })), PING_MS))
    timers.push(setInterval(() => { direction = [Math.floor(Math.random() * 3) - 1, Math.floor(Math.random() * 3) - 1] }, DIRECTION_CHANGE_MS))
  })
  ws.on('message', (data) => {
    stats.messages++
    stats.bytes += data.length
    const text = data.toString()
    if (text.startsWith('{"t":"pong"') || text.includes('"t":"pong"')) {
      const message = JSON.parse(text)
      stats.rtts.push(performance.now() - message.d.ts)
    } else if (text.includes('"t":"snapshot"')) {
      stats.snapshots++
    }
  })
  ws.on('error', () => stats.errors++)
  ws.on('close', () => {
    stats.closed++
    timers.forEach(clearInterval)
  })
  sockets.push(ws)
}

function percentile(values, p) {
  if (values.length === 0) return NaN
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]
}

async function serverTickQuantiles() {
  const text = await (await fetch(`${SERVER}/actuator/prometheus`)).text()
  const quantile = (q) => {
    const line = text.split('\n').find((l) => l.startsWith(`ascape_room_tick_seconds{`) && l.includes(`quantile="${q}"`))
    return line ? Number(line.split(' ').pop()) * 1000 : NaN
  }
  const max = text.split('\n').find((l) => l.startsWith('ascape_room_tick_seconds_max'))
  return { p50: quantile('0.5'), p95: quantile('0.95'), p99: quantile('0.99'), max: max ? Number(max.split(' ').pop()) * 1000 : NaN }
}

console.log(`${CLIENTS} clients → ${WS_URL} for ${SECONDS}s`)
for (let i = 0; i < CLIENTS; i++) {
  startClient(i)
  await new Promise((resolve) => setTimeout(resolve, RAMP_MS))
}
const measureStart = performance.now()
const bytesAtStart = stats.bytes
const messagesAtStart = stats.messages
stats.rtts = []
await new Promise((resolve) => setTimeout(resolve, SECONDS * 1000))
const elapsed = (performance.now() - measureStart) / 1000

const rooms = await (await fetch(`${SERVER}/api/rooms`)).json()
const tick = await serverTickQuantiles()
const bytesPerSecond = (stats.bytes - bytesAtStart) / elapsed
console.log(JSON.stringify({
  clients: CLIENTS,
  connected: stats.connected,
  closedEarly: stats.closed,
  errors: stats.errors,
  rooms: rooms.length,
  playersInRooms: rooms.reduce((sum, room) => sum + room.players, 0),
  rttMs: { p50: percentile(stats.rtts, 50).toFixed(1), p95: percentile(stats.rtts, 95).toFixed(1), p99: percentile(stats.rtts, 99).toFixed(1) },
  serverTickMs: Object.fromEntries(Object.entries(tick).map(([k, v]) => [k, Number(v.toFixed(3))])),
  downloadKBps: { total: (bytesPerSecond / 1024).toFixed(0), perClient: (bytesPerSecond / 1024 / CLIENTS).toFixed(1) },
  messagesPerSecond: ((stats.messages - messagesAtStart) / elapsed).toFixed(0),
}, null, 2))
sockets.forEach((ws) => ws.close())
process.exit(0)

# ASCII Multiplayer Game — Implementation Plan

> Nama: **@scape** (identifier kode/repo: `ascape`)
> Tujuan: game multiplayer real-time dengan visual full ASCII berwarna (2D top-down), server-authoritative di Java Spring Boot, WebSocket untuk live connection, Supabase untuk auth + persistence. Sekaligus portfolio piece (real-time netcode, concurrency, game AI, rendering).
>
> **Mode utama: Asymmetric Hunt** — 1 Monster vs 4 Survivor di map gelap, slot kosong otomatis diisi bot AI.
> Mode cadangan (backlog): Territory War (paper.io-style), 3D raycaster shooter.

---

## 0. Game Design — Asymmetric Hunt

### 0.1 Core loop
- 1 **Monster** vs 4 **Survivor**, match ± 6–10 menit, map top-down 2D gelap.
- **Survivor menang**: nyalakan 5 dari 7 generator `[≡]`, lalu gerbang keluar `▓▓` terbuka → minimal 1 survivor kabur.
- **Monster menang**: menjatuhkan semua survivor sebelum kabur (atau timer habis sebelum gerbang terbuka).
- Survivor punya 2 state HP: sehat → terluka → *downed* (bisa di-revive teman dalam X detik) → tertangkap (jadi spectator).

### 0.2 Visibilitas & warna (inti estetika)
- Map default gelap; tiap survivor punya **senter/radius cahaya** (warna hangat kuning/oranye), sel di luar radius digambar redup atau tidak terlihat.
- Senter bisa dimatikan → radius mengecil, lebih sulit terlihat monster tapi juga sulit navigasi.
- Monster tidak butuh cahaya tapi pandangan sempit; digambar merah redup, hanya terlihat oleh survivor saat dekat atau di dalam cahaya.
- **Suara** sebagai informasi: langkah lari, perbaikan generator, pintu → muncul indikator `)))` berwarna di sisi layar monster (arah, bukan posisi presisi).
- **Jejak**: survivor yang lari meninggalkan jejak `.` merah tua yang pudar dalam beberapa detik — hanya terlihat oleh monster.

### 0.3 Kemampuan
- **Survivor**: sprint (stamina), sembunyi di loker `▯`, repair generator (hold action, skill-check sederhana), revive, lempar distraksi (batu → suara palsu).
- **Monster**: sprint singkat (cooldown), pasang jebakan `^` (maks 3), **sonar** (sesaat menampilkan semua survivor dalam radius besar, cooldown panjang), serangan jarak dekat.

### 0.4 Glyph & palet (draft)
| Objek | Glyph | Warna |
|---|---|---|
| Survivor | `@` (bisa dikustom) | warna profil, terang |
| Monster | `M` / `&` | merah `#c0392b`, redup |
| Tembok | `█ ▓` | abu gelap |
| Lantai | `.` `·` | hampir hitam, terang di dalam cahaya |
| Generator | `[≡]` → `[■]` saat nyala | kuning → hijau |
| Gerbang | `▓▓` → `  ` | abu → putih berkedip |
| Loker | `▯` | cokelat |
| Jebakan | `^` | merah, hanya terlihat monster / saat dekat |
| Suara | `)))` | putih/kuning pudar |

### 0.5 Matchmaking & bot fill
- Pemain masuk lobby, pilih preferensi role (Monster / Survivor / Bebas).
- Tunggu 15–30 detik; slot kosong diisi **bot**. Solo tetap bisa main (1 manusia + 4 bot).
- **Drop-in**: pemain baru bisa mengambil alih bot di tengah match (pilih bot terdekat role yang sama).
- **Drop-out**: pemain disconnect → karakter diambil alih bot tanpa jeda (grace period reconnect 30 detik, lalu permanen bot).
- Match tidak pernah bubar karena kekurangan pemain.

---

## 1. Tech Stack

| Layer | Pilihan | Alasan |
|---|---|---|
| Backend | Java 21 + Spring Boot 3.x | Virtual threads, familiar |
| Live connection | Raw WebSocket (`spring-boot-starter-websocket`, `TextWebSocketHandler` / `BinaryWebSocketHandler`) | Latensi rendah, tanpa overhead STOMP |
| Lobby/chat (opsional) | Tetap raw WS, channel terpisah via message type | Satu koneksi saja |
| Serialization | JSON (Jackson) → nanti MessagePack/Protobuf | Mulai simpel, optimasi belakangan |
| Auth | Supabase Auth (JWT) | Verifikasi JWT di Spring saat handshake |
| DB | Supabase Postgres (via JDBC/JPA atau jOOQ) | Profil, save, leaderboard |
| Frontend | Vite + TypeScript, `<canvas>` 2D (fase awal), WebGL shader (fase lanjut) | Rendering 60fps di browser |
| Deploy | Docker; backend di Fly.io/Railway/VPS, frontend di Vercel/Cloudflare Pages | Murah, WS-friendly |
| Scaling (fase lanjut) | Redis pub/sub + room sharding | Multi-instance |

**Tidak dipakai:** MQTT (butuh broker, cocok IoT bukan game), Supabase Realtime untuk game state (tidak authoritative, latensi lebih tinggi — boleh untuk presence lobby).

---

## 2. Arsitektur

```
Browser (TS)                         Spring Boot                       Supabase
┌──────────────────┐   WS (input)   ┌─────────────────────────┐        ┌──────────────┐
│ Input capture    │ ─────────────► │ WsHandler               │        │ Auth (JWT)   │
│ Prediction       │                │  └► RoomManager         │ ◄────► │ Postgres     │
│ Interpolation    │ ◄───────────── │      └► GameRoom (tick) │ async  │  profiles    │
│ ASCII renderer   │  WS (snapshot) │           ├ World       │ persist│  scores      │
└──────────────────┘                │           └ Systems     │        │  worlds      │
                                    └─────────────────────────┘        └──────────────┘
```

Prinsip:
- **Server-authoritative**: client kirim *input* saja, bukan posisi.
- **Fixed tick** di server (20 Hz awal, target 30 Hz).
- **State in-memory** per room; DB hanya untuk data persisten (async, event-based / periodik).
- **Client render bebas** (requestAnimationFrame), interpolasi antar snapshot.

---

## 3. Struktur Repo (monorepo)

```
ascape/
├── server/                      # Spring Boot
│   ├── src/main/java/.../
│   │   ├── config/              # WebSocketConfig, SecurityConfig, SupabaseProps
│   │   ├── auth/                # JwtVerifier, HandshakeInterceptor
│   │   ├── net/                 # GameWebSocketHandler, Session, protocol DTOs
│   │   ├── game/
│   │   │   ├── room/            # RoomManager, GameRoom, TickLoop
│   │   │   ├── world/           # TileMap, Entity, components
│   │   │   ├── systems/         # Movement, Collision, Vision, Sound, Objective, Combat, Ability
│   │   │   ├── match/           # MatchStateMachine, win conditions, role assignment
│   │   │   ├── bot/             # BotController, Perception, Pathfinding (A*), MonsterBrain, SurvivorBrain
│   │   │   ├── lobby/           # Matchmaker, bot fill, drop-in/drop-out
│   │   │   └── snapshot/        # SnapshotBuilder (per-player visibility filter), delta encoding
│   │   ├── persistence/         # repositories, PersistenceQueue (async writer)
│   │   └── api/                 # REST: /api/me, /api/leaderboard, /api/rooms
│   └── src/test/...
├── client/                      # Vite + TS
│   ├── src/
│   │   ├── net/                 # socket.ts, protocol.ts, reconnect
│   │   ├── game/                # state.ts, prediction.ts, interpolation.ts
│   │   ├── render/              # asciiGrid.ts, glyphAtlas.ts, sprites/, shader/ (fase 5)
│   │   ├── input/               # keyboard.ts, touch.ts
│   │   ├── ui/                  # lobby, chat, HUD (juga ASCII-styled)
│   │   └── auth/                # supabase-js login
│   └── index.html
├── shared/
│   └── protocol.md              # spesifikasi message (source of truth)
├── supabase/
│   └── migrations/              # SQL schema + RLS
├── docker-compose.yml
└── README.md                    # + GIF demo, arsitektur, keputusan teknis
```

---

## 4. Protocol (v1, JSON)

Envelope: `{ "t": "<type>", "d": { ... } }`

**Client → Server**
| type | payload | catatan |
|---|---|---|
| `queue` | `{ rolePref: "monster"\|"survivor"\|"any" }` | masuk matchmaking |
| `join` | `{ roomId }` | join room langsung / spectate |
| `input` | `{ seq, tick, dx, dy, sprint, actions: [] }` | `seq` untuk reconciliation; actions: `interact`, `attack`, `ability:<id>`, `flashlight`, `throw` |
| `chat` | `{ text }` | rate-limited |
| `ping` | `{ ts }` | ukur RTT |

**Server → Client**
| type | payload | catatan |
|---|---|---|
| `welcome` | `{ playerId, tickRate, map, serverTick }` | map awal (tile grid) |
| `lobby` | `{ roomId, slots: [{role, playerId?, isBot}], startsIn }` | status matchmaking |
| `match` | `{ phase, role, generatorsLeft, gateOpen, timeLeft }` | phase: `lobby`/`playing`/`endgame`/`result` |
| `snapshot` | `{ tick, ackSeq, entities: [{id, x, y, glyph, color, state}], lights: [...], sounds: [...] }` | **sudah difilter per pemain** (hanya yang boleh dilihat); nanti delta |
| `event` | `{ kind, ... }` | hit, downed, revive, caught, generator_done, gate_open, sonar, trap |
| `takeover` | `{ entityId }` | pemain mengambil alih bot / dialihkan ke bot |
| `result` | `{ winner, stats: [...] }` | akhir match |
| `chat` | `{ from, text, ts }` | |
| `pong` | `{ ts, serverTs }` | |
| `error` | `{ code, msg }` | |

Aturan:
- Server validasi semua input (clamp dx/dy, rate limit ~60 input/s).
- `ackSeq` = input terakhir yang sudah diproses → dipakai client untuk reconciliation.

---

## 5. Server Detail

### 5.1 WebSocket & Auth
- `WebSocketConfig` register handler di `/ws`, allowed origins dari config.
- `JwtHandshakeInterceptor`: ambil token dari query `?token=` (browser WS tidak bisa set header), verifikasi JWT Supabase:
  - Supabase baru pakai asymmetric keys → verifikasi via JWKS (`https://<project>.supabase.co/auth/v1/.well-known/jwks.json`), cache JWKS. Fallback HS256 dengan JWT secret untuk project lama.
  - Library: `nimbus-jose-jwt` atau Spring `NimbusJwtDecoder`.
  - Simpan `userId` (claim `sub`) di session attributes.
- Tolak koneksi kalau token invalid/expired.

### 5.2 Room & Tick Loop
- `RoomManager`: `ConcurrentHashMap<String, GameRoom>`, create on demand, destroy saat kosong > N detik.
- `GameRoom`:
  - Satu thread/scheduler per room (`ScheduledExecutorService` single-thread atau virtual thread loop dengan fixed timestep).
  - Input masuk ke `ConcurrentLinkedQueue<InputMsg>`; di-drain di awal tick → **semua mutasi state hanya di thread room** (tidak perlu lock di world).
  - Urutan tick: drain inputs → systems (movement, collision, gameplay) → build snapshot → broadcast.
  - Ukur durasi tick, log warning kalau > budget.
- Broadcast: kirim ke tiap `WebSocketSession` via wrapper `ConcurrentWebSocketSessionDecorator` (send timeout + buffer limit) supaya client lambat tidak memblokir room.

### 5.3 World Model
- `TileMap`: grid char + metadata (solid, color). Load dari file teks `shared/maps/*.map.txt` (map di-design langsung sebagai ASCII — bagus untuk demo; bukan `.map` karena Vite menganggapnya source map).
- Entity simpel (tidak perlu full ECS di awal): `id, type, x, y, vx, vy, glyph, color, ownerId`.
- ~~Posisi pakai float di server~~ → **Diputuskan: gerak grid-step** (1 sel per langkah, progress akumulatif) — deterministik lintas Java/TS untuk prediction, cocok dengan grid ASCII, A*/LOS sederhana. Kehalusan dari interpolasi render.

### 5.4 Match State Machine
- `LOBBY → COUNTDOWN → PLAYING → ENDGAME (gerbang terbuka) → RESULT → (room reset / tutup)`.
- Role assignment: hormati `rolePref`, sisanya acak; bot mengisi slot kosong saat countdown habis.
- Win condition dicek tiap tick di `ObjectiveSystem`.

### 5.5 Visibility, Sound & Anti-cheat
- `VisionSystem`: hitung sel yang terlihat per entity (radius cahaya + line-of-sight via raycast/Bresenham ke tembok). Cache per tick.
- `SoundSystem`: event suara (lari, repair, pintu, batu) dengan radius; monster menerima arah + intensitas, bukan koordinat presisi.
- **Snapshot difilter per pemain di server** — client tidak pernah menerima posisi entity yang tidak boleh dilihat. Ini sekaligus anti-wallhack (poin portfolio).
- Map statis (tembok) dikirim penuh di `welcome`; yang difilter hanya entity & state dinamis.

### 5.6 Bot System
- `BotController` menghasilkan `InputMsg` yang sama persis dengan input manusia dan memasukkannya ke queue room yang sama → game loop tidak membedakan bot & manusia.
- Bot "berpikir" lebih jarang dari tick (mis. 5 Hz) untuk hemat CPU; eksekusi input tetap tiap tick.
- **Perception adil**: bot hanya membaca hasil `VisionSystem`/`SoundSystem` untuk karakternya sendiri (tidak membaca world state penuh). Punya memori: posisi terakhir target, generator yang pernah dilihat, lokasi suara.
- **Pathfinding**: A* di tile grid (precompute navgrid dari map; cache path, re-plan saat target bergerak jauh).
- **MonsterBrain (FSM)**: `Patrol` (keliling generator yang sedang dikerjakan / titik acak) → `Investigate` (menuju sumber suara/jejak) → `Chase` (target terlihat) → `Search` (kehilangan target, cek sekitar posisi terakhir & loker) → `Patrol`. Pakai sonar saat Search lama; pasang jebakan di dekat generator hampir selesai.
- **SurvivorBrain (utility AI)**: skor tiap aksi per think-tick — `RepairGenerator`, `Flee`, `Hide`, `ReviveAlly`, `GoToGate`, `ToggleFlashlight` — berdasar jarak ke monster (yang diketahui), HP, progres generator, stamina.
- **Difficulty**: `easy/normal/hard` mengatur reaction delay (300/150/60 ms), radius persepsi, akurasi skill-check, dan seberapa sering bot "salah".
- **Takeover**: saat pemain drop-in, `BotController` entity dilepas dan diganti `PlayerController`; sebaliknya saat disconnect (setelah grace period).

### 5.7 Persistence
- `PersistenceQueue`: bounded queue + worker async yang batch-write ke Postgres.
- Yang disimpan: last position/room, stats, skor saat match selesai, chat log (opsional).
- Tidak pernah query DB di dalam tick.

### 5.8 REST API
- `GET /api/me` — profil dari Supabase (buat jika belum ada).
- `GET /api/rooms` — daftar room aktif + jumlah pemain.
- `GET /api/leaderboard` — top N.
- Auth sama: `Authorization: Bearer <supabase jwt>` via Spring Security resource server.

### 5.9 Observability
- Micrometer + Actuator: jumlah room, pemain, tick duration p95, bytes out/s.
- Endpoint `/actuator/prometheus` (bonus portfolio: dashboard Grafana).

---

## 6. Client Detail

### 6.1 Networking
- `socket.ts`: connect dengan token, auto-reconnect exponential backoff, ping tiap 2s → tampilkan RTT di HUD.
- Buffer snapshot dengan timestamp server.

### 6.2 Netcode
- **Prediction** (pemain sendiri): apply input lokal langsung, simpan di buffer `{seq, input}`.
- **Reconciliation**: saat snapshot datang, set posisi = posisi server, lalu replay input dengan `seq > ackSeq`.
- **Interpolation** (entity lain): render di `now - 100ms`, lerp antara dua snapshot terdekat.
- Debug overlay (toggle `F3`): RTT, tick server, jumlah snapshot di buffer, posisi server vs predicted.

### 6.3 ASCII Renderer — Fase Awal (Canvas 2D, grid)
- Grid mis. 120×40 sel, font monospace (mis. "IBM Plex Mono" / "JetBrains Mono" / font bitmap).
- **Glyph atlas**: pre-render tiap karakter × warna ke offscreen canvas sekali, lalu `drawImage` per sel → jauh lebih cepat daripada `fillText` per frame.
- Layers: tilemap → lighting/fog → entities → effects (partikel `* . +`) → UI.
- **Lighting**: tiap sel punya brightness 0–1 dari sumber cahaya (senter survivor, generator nyala); warna glyph = warna dasar × brightness + tint hangat. Sel yang pernah terlihat tapi sekarang tidak → digambar sangat redup (memori map).
- **Indikator suara** `)))` di tepi layar sesuai arah, fade out.
- Efek: flash merah saat terkena serangan, screen shake (geser grid 1 sel), heartbeat vignette saat monster dekat (survivor), partikel percikan saat generator selesai.
- Dirty-cell rendering (hanya gambar sel yang berubah) kalau perlu.
- Sprite ASCII multi-sel untuk karakter (didefinisikan di file teks), dengan frame animasi.

### 6.4 ASCII Renderer — Fase Lanjut (efek seperti di reels)
- Render scene "normal" (Three.js / pixel art 2D) ke render target resolusi rendah.
- Fragment shader: bagi layar jadi sel, hitung luminance rata-rata per sel, pilih glyph dari texture atlas berdasarkan ramp ` .:-=+*#%@`, warnai dengan warna asli sel.
- Opsional: dithering, edge detection untuk karakter `/ \ | _`, CRT/scanline post-process.
- Referensi: Three.js `AsciiEffect` (versi CPU, untuk prototipe cepat) → custom shader untuk performa.

### 6.5 UI
- Lobby, chat, HUD juga bergaya ASCII (box drawing `┌─┐│└┘`).
- Login via `supabase-js` (email magic link / OAuth GitHub), token dikirim ke WS.
- Mobile: kontrol touch (D-pad virtual).

---

## 7. Supabase Schema (awal)

```sql
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  glyph char(1) not null default '@',
  color text not null default '#ffffff',
  created_at timestamptz default now()
);

create table player_stats (
  user_id uuid primary key references profiles(id) on delete cascade,
  matches int default 0,
  wins int default 0,
  score bigint default 0,
  last_room text,
  last_x real, last_y real,
  updated_at timestamptz default now()
);

create table matches (
  id uuid primary key default gen_random_uuid(),
  room_id text not null,
  map_id text,
  started_at timestamptz, ended_at timestamptz,
  winner text check (winner in ('monster','survivors')),
  result jsonb
);

create table match_players (
  id bigint generated always as identity primary key,
  match_id uuid not null references matches(id) on delete cascade,
  user_id uuid references profiles(id),          -- null jika bot
  is_bot boolean not null default false,
  role text check (role in ('monster','survivor')),
  escaped boolean, caught boolean,
  generators_repaired int default 0,
  hits int default 0, downs int default 0,
  score int default 0
);
```
- `player_stats` juga bisa dipecah per role (wins_as_monster, escapes, dll.) untuk leaderboard terpisah.
- Aktifkan RLS: client (supabase-js) hanya boleh read/update profil sendiri; stats & matches hanya ditulis oleh server (koneksi server pakai role terpisah/service credential, disimpan di env, **jangan** pernah di client).

---

## 8. Roadmap / Milestones

**M0 — Setup (0.5–1 hari)**
- [x] Monorepo, Spring Boot skeleton, Vite TS skeleton, docker-compose.
- [x] Supabase project + migrations.

**M1 — Single-player ASCII render (1–2 hari)**
- [x] Canvas grid renderer + glyph atlas.
- [x] Load map dari file `.map.txt`, gerakkan `@` dengan keyboard secara lokal.

**M2 — Koneksi & multiplayer dasar (2–3 hari)**
- [x] WS handler, protocol v1, RoomManager + GameRoom tick loop.
- [x] Beberapa browser tab melihat pemain lain bergerak (tanpa prediction dulu).

**M3 — Auth & persistence (1–2 hari)**
- [x] Login supabase-js, verifikasi JWT di handshake. — kode selesai; guest login menunggu anonymous sign-ins diaktifkan di Supabase.
- [x] Profil (username, glyph, warna), simpan last position & stats async.

**M4 — Netcode proper (2–3 hari)**
- [x] Prediction + reconciliation + interpolation.
- [x] Debug overlay, simulasi lag (artificial delay di server via flag) untuk demo.

**M5 — Asymmetric Hunt core (4–6 hari)**
- [x] Role Monster/Survivor, generator + gerbang, win condition, MatchStateMachine.
- [x] VisionSystem + lighting senter + fog of war di client; snapshot difilter per pemain.
- [x] Combat (hit → terluka → downed → caught), revive, loker, sprint/stamina.
- [x] SoundSystem + indikator `)))`, jejak untuk monster.

**M6 — Bot AI & matchmaking (4–6 hari)**
- [x] Matchmaker: queue, role preference, countdown, bot fill.
- [x] A* navgrid, Perception adil, MonsterBrain (FSM), SurvivorBrain (utility AI).
- [x] Difficulty easy/normal/hard.
- [x] Drop-in (ambil alih bot) & drop-out (bot ambil alih + grace period reconnect).
- [x] Debug view (dev only): tampilkan state bot, path A*, persepsi.

**M7 — Polish & juice (3–5 hari)**
- [x] Kemampuan monster (sonar, jebakan), distraksi batu survivor, skill-check.
- [x] Efek: flash, shake, heartbeat vignette, partikel; audio sederhana.
- [x] Hasil match, leaderboard per role, profil glyph/warna.
- [x] (Opsional) ASCII shader renderer + CRT post-process. — CRT post-process (CSS, F2) selesai; shader WebGL belum.

**M8 — Hardening & portfolio polish (2–3 hari)**
- [x] Rate limiting, input validation, backpressure test.
- [x] Load test (mis. Gatling / k6 WebSocket) — catat jumlah pemain/room & tick p95.
- [ ] Deploy publik, README dengan GIF, diagram arsitektur, "technical decisions" (kenapa WS bukan MQTT, kenapa server-authoritative, dsb).

**M9 — Opsional (scaling)**
- [ ] Binary protocol (MessagePack/Protobuf) + delta snapshot, bandingkan bytes/s sebelum-sesudah.
- [ ] Multi-instance: room sharding + Redis untuk room directory/presence.
- [ ] Interest management (hanya kirim entity dalam radius pandang).

---

## 9. Testing
- Unit: systems (movement/collision) deterministik, tanpa network.
- Integration: `StandardWebSocketClient` di test Spring → join, kirim input, assert snapshot.
- Load: k6 dengan modul ws, 100–500 bot per instance.
- Client: vitest untuk interpolation/reconciliation logic.

---

## 10. Portfolio Checklist
- [ ] Live demo URL (bisa langsung dimainkan, guest login).
- [ ] GIF/video pendek di README (gaya seperti reels).
- [ ] Diagram arsitektur + penjelasan netcode.
- [ ] Angka nyata: tick rate, latency, pemain concurrent, bytes/s.
- [ ] Blog post / devlog singkat ("building a multiplayer ASCII game on Spring Boot").
- [ ] Clean commit history per milestone, CI (GitHub Actions: build + test).

---

## 11. Catatan untuk Claude Code
- Mulai dari M0–M2; jangan loncat ke gameplay/bot sebelum multiplayer dasar jalan, dan jangan ke shader sebelum M6 selesai.
- `shared/protocol.md` adalah source of truth — update dulu sebelum mengubah DTO di server/client.
- Semua mutasi world state hanya di thread room.
- Secret Supabase (JWT secret / DB password / service credential) via env var, tidak di-commit.
- Bot wajib lewat jalur input yang sama dengan manusia; jangan beri bot akses langsung ke world state penuh.
- Visibility filter di server adalah fitur keamanan — tulis unit test untuk memastikan entity di luar pandangan tidak pernah masuk snapshot.

---

## 12. Backlog Mode Lain
- **Territory War**: jejak `░▒▓` berwarna, klaim area tertutup (flood-fill), jejak ditabrak = mati. Bisa reuse room/netcode/renderer.
- **3D raycaster shooter**: logic server tetap grid 2D (posisi + arah), render first-person raycast → ASCII shader di client.

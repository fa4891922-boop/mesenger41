const { io } = require('socket.io-client');

const BASE_URL = process.env.TEST_URL || 'http://localhost:3000';
const ADMIN_USER = 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin12345';
const TEST_PREFIX = 'loadtest_';

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
};

function log(color, label, msg) {
  console.log(`${color}[${label}]${colors.reset} ${msg}`);
}

async function api(path, opts = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...opts.headers },
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, ok: res.ok, json, text };
}

async function apiAuth(path, token, opts = {}) {
  return api(path, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, ...opts.headers },
  });
}

async function loginOrRegister(username, password, displayName) {
  let res = await api('/api/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  if (res.ok) return res.json;
  res = await api('/api/register', {
    method: 'POST',
    body: JSON.stringify({ username, password, displayName: displayName || username }),
  });
  if (res.ok) return res.json;
  throw new Error(`Auth failed for ${username}: ${res.text}`);
}

function connectSocket(token) {
  return new Promise((resolve, reject) => {
    const s = io(BASE_URL, {
      auth: { token },
      transports: ['websocket'],
      reconnection: false,
      timeout: 5000,
    });
    const timer = setTimeout(() => {
      s.disconnect();
      reject(new Error('Socket connect timeout'));
    }, 5000);
    s.on('connect', () => { clearTimeout(timer); resolve(s); });
    s.on('connect_error', (err) => { clearTimeout(timer); reject(err); });
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─────────────────────────────────────────────────
// Test 1: WebSocket message flood
// ─────────────────────────────────────────────────
async function testMessageFlood() {
  log(colors.bold, 'TEST 1', 'WebSocket Message Flood');
  log(colors.dim, 'INFO', 'Sending messages as fast as possible to find rate limit threshold\n');

  const sender = await loginOrRegister(`${TEST_PREFIX}sender1`, 'testpass123', 'Sender1');
  const receiver = await loginOrRegister(`${TEST_PREFIX}receiver1`, 'testpass123', 'Receiver1');

  const socket = await connectSocket(sender.accessToken);

  const results = { sent: 0, delivered: 0, rateLimited: 0, banned: false };
  const deliveredMessages = [];

  socket.on('receive_message', () => { results.delivered++; });
  socket.on('rate_limited', () => { results.rateLimited++; });
  socket.on('banned', () => { results.banned = true; });

  const startTime = Date.now();
  const DURATION_MS = 10000;
  const BATCH_SIZE = 5;
  const BATCH_DELAY_MS = 50;

  log(colors.cyan, 'RUN', `Flooding for ${DURATION_MS / 1000}s, ${BATCH_SIZE} msgs every ${BATCH_DELAY_MS}ms`);

  while (Date.now() - startTime < DURATION_MS && !results.banned) {
    for (let i = 0; i < BATCH_SIZE; i++) {
      socket.emit('send_message', {
        receiverId: receiver.user.id,
        content: `flood-${results.sent}-${Date.now()}`,
        encrypted: false,
      });
      results.sent++;
    }
    await sleep(BATCH_DELAY_MS);
  }

  await sleep(2000);
  const elapsed = (Date.now() - startTime) / 1000;

  socket.disconnect();

  log(colors.yellow, 'RESULT', `Sent: ${results.sent} msgs in ${elapsed.toFixed(1)}s (${(results.sent / elapsed).toFixed(1)} msg/s)`);
  log(colors.yellow, 'RESULT', `Delivered to DB: ${results.delivered}`);
  log(colors.yellow, 'RESULT', `Rate limited events: ${results.rateLimited}`);
  log(results.banned ? colors.red : colors.green, 'RESULT', `Auto-banned: ${results.banned}`);
  log(colors.green, 'RESULT', `Effective rate: ${(results.delivered / elapsed).toFixed(1)} msg/s actually saved\n`);

  return results;
}

// ─────────────────────────────────────────────────
// Test 2: Burst test — find exact threshold
// ─────────────────────────────────────────────────
async function testBurstThreshold() {
  log(colors.bold, 'TEST 2', 'Burst Threshold Detection');
  log(colors.dim, 'INFO', 'Sending bursts of increasing size to find exact limit\n');

  const sender = await loginOrRegister(`${TEST_PREFIX}burst1`, 'testpass123', 'Burst1');
  const receiver = await loginOrRegister(`${TEST_PREFIX}receiver1`, 'testpass123', 'Receiver1');

  const burstSizes = [5, 10, 15, 20, 30, 40, 50];

  for (const burstSize of burstSizes) {
    let socket;
    try {
      socket = await connectSocket(sender.accessToken);
    } catch {
      log(colors.red, 'BURST', `Cannot connect (banned?) — stopping`);
      break;
    }

    let delivered = 0;
    let rateLimited = 0;
    let banned = false;

    socket.on('receive_message', () => { delivered++; });
    socket.on('rate_limited', () => { rateLimited++; });
    socket.on('banned', () => { banned = true; });

    for (let i = 0; i < burstSize; i++) {
      socket.emit('send_message', {
        receiverId: receiver.user.id,
        content: `burst-${burstSize}-${i}-${Date.now()}`,
        encrypted: false,
      });
    }

    await sleep(3000);
    socket.disconnect();

    const status = banned ? colors.red + 'BANNED' :
                   rateLimited > 0 ? colors.yellow + 'RATE LIMITED' :
                   colors.green + 'OK';
    log(colors.cyan, 'BURST', `Size ${String(burstSize).padStart(3)}: delivered=${String(delivered).padStart(3)}, dropped=${String(burstSize - delivered).padStart(3)}, rateLimited=${rateLimited} ${status}${colors.reset}`);

    if (banned) {
      log(colors.red, 'BURST', `Auto-banned at burst size ${burstSize} — stopping\n`);
      break;
    }

    await sleep(11000);
  }
}

// ─────────────────────────────────────────────────
// Test 3: Connection flood per IP
// ─────────────────────────────────────────────────
async function testConnectionFlood() {
  log(colors.bold, 'TEST 3', 'Connection Flood');
  log(colors.dim, 'INFO', 'Opening many socket connections rapidly\n');

  const user = await loginOrRegister(`${TEST_PREFIX}connflood`, 'testpass123', 'ConnFlood');

  const sockets = [];
  let connected = 0;
  let rejected = 0;

  for (let i = 0; i < 20; i++) {
    try {
      const s = await connectSocket(user.accessToken);
      sockets.push(s);
      connected++;
    } catch {
      rejected++;
    }
    await sleep(100);
  }

  log(colors.yellow, 'RESULT', `Connected: ${connected}, Rejected: ${rejected}`);
  log(colors.green, 'RESULT', `Connection limit kicks in after ~${connected} connections/min\n`);

  for (const s of sockets) s.disconnect();
}

// ─────────────────────────────────────────────────
// Test 4: REST API flood
// ─────────────────────────────────────────────────
async function testRestFlood() {
  log(colors.bold, 'TEST 4', 'REST API Flood');
  log(colors.dim, 'INFO', 'Flooding GET /api/conversations\n');

  const user = await loginOrRegister(`${TEST_PREFIX}restflood`, 'testpass123', 'RestFlood');

  let ok = 0;
  let rateLimited = 0;
  let errors = 0;
  const startTime = Date.now();

  const promises = [];
  for (let i = 0; i < 100; i++) {
    promises.push(
      apiAuth('/api/conversations', user.accessToken)
        .then(res => {
          if (res.status === 429) rateLimited++;
          else if (res.ok) ok++;
          else errors++;
        })
        .catch(() => { errors++; })
    );
    if (i % 10 === 9) await sleep(100);
  }
  await Promise.all(promises);

  const elapsed = (Date.now() - startTime) / 1000;
  log(colors.yellow, 'RESULT', `100 requests in ${elapsed.toFixed(1)}s`);
  log(colors.yellow, 'RESULT', `OK: ${ok}, Rate limited (429): ${rateLimited}, Errors: ${errors}`);
  log(colors.green, 'RESULT', `REST limit: ~${ok} requests pass per minute\n`);
}

// ─────────────────────────────────────────────────
// Test 5: Registration flood
// ─────────────────────────────────────────────────
async function testRegistrationFlood() {
  log(colors.bold, 'TEST 5', 'Registration Flood');
  log(colors.dim, 'INFO', 'Trying to register many accounts rapidly\n');

  let ok = 0;
  let rateLimited = 0;
  let errors = 0;

  for (let i = 0; i < 10; i++) {
    const username = `${TEST_PREFIX}regflood_${Date.now()}_${i}`;
    const res = await api('/api/register', {
      method: 'POST',
      body: JSON.stringify({ username, password: 'testpass123', displayName: `RegFlood${i}` }),
    });
    if (res.status === 429) rateLimited++;
    else if (res.ok) ok++;
    else errors++;

    await sleep(200);
  }

  log(colors.yellow, 'RESULT', `Registered: ${ok}, Rate limited: ${rateLimited}, Errors: ${errors}`);
  log(colors.green, 'RESULT', `Registration limit: ${ok} accounts before rate limit kicks in\n`);
}

// ─────────────────────────────────────────────────
// Test 6: Duplicate message detection
// ─────────────────────────────────────────────────
async function testDuplicateDetection() {
  log(colors.bold, 'TEST 6', 'Duplicate Message Detection');
  log(colors.dim, 'INFO', 'Sending identical messages rapidly\n');

  const sender = await loginOrRegister(`${TEST_PREFIX}duptest`, 'testpass123', 'DupTest');
  const receiver = await loginOrRegister(`${TEST_PREFIX}receiver1`, 'testpass123', 'Receiver1');

  const socket = await connectSocket(sender.accessToken);

  let delivered = 0;
  socket.on('receive_message', () => { delivered++; });

  const IDENTICAL_MSG = 'This is a duplicate test message';
  for (let i = 0; i < 10; i++) {
    socket.emit('send_message', {
      receiverId: receiver.user.id,
      content: IDENTICAL_MSG,
      encrypted: false,
    });
    await sleep(200);
  }

  await sleep(2000);
  socket.disconnect();

  log(colors.yellow, 'RESULT', `Sent 10 identical messages, ${delivered} delivered`);
  log(colors.green, 'RESULT', `Duplicates blocked: ${10 - delivered}\n`);
}

// ─────────────────────────────────────────────────
// Test 7: Sustained load test
// ─────────────────────────────────────────────────
async function testSustainedLoad() {
  log(colors.bold, 'TEST 7', 'Sustained Load (30 seconds)');
  log(colors.dim, 'INFO', 'Simulating realistic but heavy usage from multiple users\n');

  const users = [];
  for (let i = 0; i < 5; i++) {
    const u = await loginOrRegister(`${TEST_PREFIX}sustained_${i}`, 'testpass123', `Sustained${i}`);
    users.push(u);
  }

  const sockets = [];
  for (const u of users) {
    try {
      const s = await connectSocket(u.accessToken);
      sockets.push({ socket: s, user: u.user, delivered: 0, rateLimited: 0 });
      s.on('receive_message', () => { sockets.find(x => x.socket === s).delivered++; });
      s.on('rate_limited', () => { sockets.find(x => x.socket === s).rateLimited++; });
    } catch {
      log(colors.red, 'WARN', `Could not connect user ${u.user.username}`);
    }
    await sleep(500);
  }

  const DURATION = 30000;
  const MSG_INTERVAL = 500;
  const startTime = Date.now();
  let totalSent = 0;

  log(colors.cyan, 'RUN', `${sockets.length} users, 1 msg every ${MSG_INTERVAL}ms each, ${DURATION / 1000}s`);

  while (Date.now() - startTime < DURATION) {
    for (const { socket, user } of sockets) {
      const targetIdx = Math.floor(Math.random() * sockets.length);
      if (sockets[targetIdx].user.id === user.id) continue;
      socket.emit('send_message', {
        receiverId: sockets[targetIdx].user.id,
        content: `sustained-${totalSent}-${Date.now()}`,
        encrypted: false,
      });
      totalSent++;
    }
    await sleep(MSG_INTERVAL);
  }

  await sleep(3000);

  const elapsed = (Date.now() - startTime) / 1000;
  let totalDelivered = 0;
  let totalRateLimited = 0;

  for (const s of sockets) {
    totalDelivered += s.delivered;
    totalRateLimited += s.rateLimited;
    s.socket.disconnect();
  }

  log(colors.yellow, 'RESULT', `Duration: ${elapsed.toFixed(1)}s, Users: ${sockets.length}`);
  log(colors.yellow, 'RESULT', `Sent: ${totalSent}, Delivered: ${totalDelivered}, Rate limited: ${totalRateLimited}`);
  log(colors.green, 'RESULT', `Throughput: ${(totalSent / elapsed).toFixed(1)} msg/s sent, ${(totalDelivered / elapsed).toFixed(1)} msg/s delivered\n`);
}

// ─────────────────────────────────────────────────
// Cleanup
// ─────────────────────────────────────────────────
async function cleanup() {
  log(colors.dim, 'CLEANUP', 'Removing test accounts...');
  try {
    const admin = await loginOrRegister(ADMIN_USER, ADMIN_PASS, 'Admin');
    const res = await apiAuth('/admin/banned-users', admin.accessToken);
    if (res.ok && Array.isArray(res.json)) {
      for (const u of res.json) {
        if (u.username?.startsWith(TEST_PREFIX)) {
          await apiAuth(`/admin/unban/${u.id}`, admin.accessToken, { method: 'POST' });
        }
      }
    }
  } catch {
    log(colors.dim, 'CLEANUP', 'Could not cleanup (admin auth failed)');
  }
}

// ─────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────
async function main() {
  console.log(`\n${colors.bold}╔══════════════════════════════════════════╗`);
  console.log(`║  PearNet Load & Rate Limit Test Suite     ║`);
  console.log(`╚══════════════════════════════════════════╝${colors.reset}\n`);
  console.log(`Target: ${BASE_URL}\n`);

  const tests = [
    { name: 'Message Flood', fn: testMessageFlood },
    { name: 'Burst Threshold', fn: testBurstThreshold },
    { name: 'Connection Flood', fn: testConnectionFlood },
    { name: 'REST API Flood', fn: testRestFlood },
    { name: 'Registration Flood', fn: testRegistrationFlood },
    { name: 'Duplicate Detection', fn: testDuplicateDetection },
    { name: 'Sustained Load', fn: testSustainedLoad },
  ];

  const selected = process.argv[2];
  const toRun = selected
    ? tests.filter((_, i) => String(i + 1) === selected)
    : tests;

  if (selected && toRun.length === 0) {
    console.log(`Usage: node load-test.js [test_number]`);
    console.log(`Tests: ${tests.map((t, i) => `${i + 1}=${t.name}`).join(', ')}`);
    process.exit(1);
  }

  for (const test of toRun) {
    try {
      await test.fn();
    } catch (err) {
      log(colors.red, 'ERROR', `${test.name} failed: ${err.message}`);
    }
    await sleep(2000);
  }

  await cleanup();

  console.log(`\n${colors.bold}Done.${colors.reset}\n`);
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});

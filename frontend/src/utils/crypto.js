const DB_NAME = 'pearnet-keys';
const DB_STORE = 'keys';
const PRIVATE_KEY_ID = 'private-key';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readonly');
    const req = tx.objectStore(DB_STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function generateKeyPair() {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey', 'deriveBits']
  );
  return keyPair;
}

export async function exportPublicKey(key) {
  const jwk = await crypto.subtle.exportKey('jwk', key);
  return jwk;
}

export async function importPublicKey(jwk) {
  return crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    []
  );
}

export async function savePrivateKey(privateKey) {
  const jwk = await crypto.subtle.exportKey('jwk', privateKey);
  await idbPut(PRIVATE_KEY_ID, jwk);
}

export async function loadPrivateKey() {
  const jwk = await idbGet(PRIVATE_KEY_ID);
  if (!jwk) return null;
  return crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey', 'deriveBits']
  );
}

export async function hasPrivateKey() {
  const jwk = await idbGet(PRIVATE_KEY_ID);
  return !!jwk;
}

export async function deriveSharedKey(privateKey, peerPublicKey) {
  const sharedBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: peerPublicKey },
    privateKey,
    256
  );
  return crypto.subtle.importKey(
    'raw',
    sharedBits,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptMessage(sharedKey, plaintext) {
  const encoder = new TextEncoder();
  const data = encoder.encode(plaintext);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    sharedKey,
    data
  );
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return btoa(String.fromCharCode(...combined));
}

export async function decryptMessage(sharedKey, encryptedBase64) {
  try {
    const binary = atob(encryptedBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const iv = bytes.slice(0, 12);
    const ciphertext = bytes.slice(12);
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      sharedKey,
      ciphertext
    );
    return new TextDecoder().decode(decrypted);
  } catch {
    return null;
  }
}

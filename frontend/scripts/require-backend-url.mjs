import fs from 'node:fs';
import path from 'node:path';

const envFiles = [
  '.env.production.local',
  '.env.production',
  '.env.local',
  '.env',
];

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};

  return Object.fromEntries(
    fs.readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const index = line.indexOf('=');
        const key = line.slice(0, index).trim();
        const value = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
        return [key, value];
      }),
  );
}

const env = {};
for (const file of envFiles) {
  Object.assign(env, parseEnvFile(path.resolve(process.cwd(), file)));
}
Object.assign(env, process.env);

const backendUrl = env.VITE_BACKEND_URL?.trim();
const invalidLocalPattern = /^https?:\/\/(localhost|127\.0\.0\.1|10\.0\.2\.2)(:\d+)?\/?$/i;

if (!backendUrl) {
  console.error('VITE_BACKEND_URL is required for a release APK. Copy .env.production.example to .env.production and set your public backend URL.');
  process.exit(1);
}

if (!/^https:\/\//i.test(backendUrl)) {
  console.error(`VITE_BACKEND_URL must be an HTTPS URL for release builds. Current value: ${backendUrl}`);
  process.exit(1);
}

if (invalidLocalPattern.test(backendUrl)) {
  console.error(`VITE_BACKEND_URL cannot point to a local development server for release builds. Current value: ${backendUrl}`);
  process.exit(1);
}

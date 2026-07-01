// Central env loader: always loads the repo-root .env regardless of cwd.
// Import this FIRST (before any provider) in every entrypoint that needs keys.
import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, '..', '.env') });

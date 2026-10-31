import { config } from 'dotenv';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import app from './app.js';

config({
  path: resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../.env'),
});

const port = Number(process.env.API_PORT ?? 3000);

app.listen(port, () => {
  console.log(`HomeGuard API listening on port ${port}`);
});
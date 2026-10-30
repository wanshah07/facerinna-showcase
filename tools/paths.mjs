import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const PAGE = (file = 'index.html') => new URL(`../${file}`, import.meta.url).href;

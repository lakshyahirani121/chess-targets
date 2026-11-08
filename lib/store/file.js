import fs from 'node:fs';
import path from 'node:path';
import { MemoryStore } from './memory.js';

/** Local development store: a JSON file. Never used on Vercel. */
export class FileStore extends MemoryStore {
  constructor(file) {
    let initial = {};
    try {
      initial = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      /* first run */
    }
    super(initial);
    this.file = file;
  }

  async persist() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 1));
  }
}

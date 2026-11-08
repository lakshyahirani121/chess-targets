// Vercel entry point. vercel.json rewrites every /api/* request here.
import { nodeHandler } from '../lib/router.js';

export default function handler(req, res) {
  return nodeHandler(req, res);
}

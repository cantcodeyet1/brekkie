// Vercel serverless entry: every /api request is handled by the Express app.
import app, { ready } from '../server/src/index.js';

export default async function handler(req, res) {
  await ready;
  return app(req, res);
}

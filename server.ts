import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Request, type Response } from 'express';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const distDir = path.resolve(__dirname, 'dist');
const indexHtmlPath = path.join(distDir, 'index.html');
const port = Number(process.env.PORT) || 3000;
const host = '0.0.0.0';

const app = express();
app.disable('x-powered-by');

app.use(
  express.static(distDir, {
    index: 'index.html',
    redirect: false,
  })
);

const STATIC_ASSET_EXT_RE = /\.[a-z0-9]{1,8}$/i;

app.use((req: Request, res: Response) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.status(404).end();
    return;
  }

  if (req.path.startsWith('/assets/') || STATIC_ASSET_EXT_RE.test(req.path)) {
    res.status(404).type('text/plain').send('Not Found');
    return;
  }

  if (!fs.existsSync(indexHtmlPath)) {
    res
      .status(503)
      .type('text/plain')
      .send('Application build not found. Run npm run build first.');
    return;
  }

  res.status(200).sendFile(indexHtmlPath);
});

app.listen(port, host, () => {
  console.log(`Server listening on http://${host}:${port}`);
});

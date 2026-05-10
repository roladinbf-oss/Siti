const express = require('express');
const path = require('path');
const apiRouter = require('./api');
const { runMigrations } = require('./db/migrate');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '50mb' }));

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  next();
});

// Health / debug endpoint — never returns the actual key value.
app.get('/healthz', (req, res) => {
  res.json({
    ok: true,
    hasClaudeKey: !!process.env.CLAUDE_API_KEY,
    nodeVersion: process.version,
    deployVersion: 'v231',
  });
});

// Anthropic proxy for the receipt-scan feature. Must be registered before the
// generic /api router below, otherwise /api/:table with table='scan' would
// shadow it and return 404.
app.post('/api/scan', async (req, res) => {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'CLAUDE_API_KEY is not set in Railway environment variables. Go to Railway dashboard → siti-eran service → Variables → add CLAUDE_API_KEY.' });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(req.body)
    });

    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Generic CRUD over Postgres for the whitelisted tables.
app.use('/api', apiRouter);

app.use(express.static(path.join(__dirname)));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

(async () => {
  try {
    await runMigrations();
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (err) {
    console.error('Startup failed:', err);
    process.exit(1);
  }
})();

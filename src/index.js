import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { config, configWarnings } from './config.js';
import { connectDb } from './db.js';
import { createApp } from './app.js';
import { Clip } from './models/Clip.js';
import { getDemoShop } from './middleware/shop.js';

async function main() {
  for (const dir of ['clips', 'frames', 'exports']) await mkdir(path.join(config.uploadDir, dir), { recursive: true });

  try {
    await connectDb();
  } catch (err) {
    console.error(`\n✖ Could not connect to MongoDB at ${config.mongoUri}\n  ${err.message}\n  Start it with: brew services start mongodb-community (or set MONGODB_URI to an Atlas URI)\n`);
    process.exit(1);
  }

  // Anything mid-processing when the server stopped will never finish.
  const stuck = await Clip.updateMany(
    { status: { $in: ['queued', 'processing'] } },
    { status: 'failed', stage: 'finished', error: 'The server restarted while this clip was processing. Press re-run.' },
  );
  if (stuck.modifiedCount) console.log(`Marked ${stuck.modifiedCount} interrupted clip(s) as failed.`);

  const shop = await getDemoShop();
  createApp().listen(config.port, () => {
    console.log(`\n${config.appName} API on http://localhost:${config.port}`);
    console.log(`Demo shop: "${shop.name}" (${shop.subscriptionStatus})`);
    console.log(`Detector: ${config.detector.url || 'mock'} | Model: ${config.openrouter.detectModel}`);
    for (const w of configWarnings()) console.warn(`⚠ ${w}`);
  });
}

main();

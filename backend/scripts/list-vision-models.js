// Lists OpenRouter models that accept image input, cheapest first.
// Usage: npm run models:list            (top 25)
//        npm run models:list -- gemini  (filter by text)
const filter = (process.argv[2] || '').toLowerCase();

const res = await fetch('https://openrouter.ai/api/v1/models');
if (!res.ok) {
  console.error(`OpenRouter returned ${res.status}`);
  process.exit(1);
}
const { data } = await res.json();

const rows = data
  .filter((m) => (m.architecture?.input_modalities || []).includes('image'))
  .filter((m) => !filter || m.id.toLowerCase().includes(filter))
  .map((m) => ({
    id: m.id,
    inputPerM: Number(m.pricing?.prompt || 0) * 1e6,
    outputPerM: Number(m.pricing?.completion || 0) * 1e6,
    context: m.context_length,
  }))
  .sort((a, b) => a.inputPerM - b.inputPerM)
  .slice(0, filter ? 100 : 25);

console.log('model id'.padEnd(52), '$/M in'.padStart(9), '$/M out'.padStart(9), 'context'.padStart(9));
for (const r of rows) {
  console.log(r.id.padEnd(52), r.inputPerM.toFixed(2).padStart(9), r.outputPerM.toFixed(2).padStart(9), String(r.context ?? '').padStart(9));
}
console.log(`\n${rows.length} vision model(s). Put one in DETECT_MODEL in .env.`);

import fs from "node:fs";

const filePath = process.argv[2];
const granularity = (process.argv[3] === "measure" || process.argv[3] === "beat") ? process.argv[3] : "beat";
const url = process.argv[4] ?? "http://localhost:3001/analyze_harmony";

if (!filePath) {
  console.error("Usage: node tests/runHarmonyTest.mjs <path-to-xml> [beat|measure] [url]");
  process.exit(1);
}

if (!fs.existsSync(filePath)) {
  console.error(`File not found: ${filePath}`);
  process.exit(1);
}

const xml = fs.readFileSync(filePath, "utf8");

const payload = {
  musicxml: xml,
  options: { granularity, ignorePercussion: true }
};

const res = await fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
});

const text = await res.text();
console.log(text);

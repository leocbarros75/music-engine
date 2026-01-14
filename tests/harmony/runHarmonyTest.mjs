import fs from "node:fs";

const filePath = process.argv[2];
const granularity =
  process.argv[3] === "measure" || process.argv[3] === "beat" ? process.argv[3] : "beat";
const url = process.argv[4] ?? "http://localhost:3001/analyze_harmony";

if (!filePath) {
  console.error("Usage: node tests/harmony/runHarmonyTest.mjs <path-to-xml> [beat|measure] [url]");
  process.exit(1);
}

if (!fs.existsSync(filePath)) {
  console.error(`File not found: ${filePath}`);
  process.exit(1);
}

const xml = fs.readFileSync(filePath, "utf8");

const payload = {
  musicxml: xml,
  options: { granularity, ignorePercussion: true },
};

let res;
try {
  res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
} catch (e) {
  console.error(`Fetch failed. Is the server running at ${url}?`);
  throw e;
}

const text = await res.text();
console.log(text);

// If the API returns ok:false, exit non-zero (helps CI later)
try {
  const parsed = JSON.parse(text);
  if (parsed && parsed.ok === false) process.exit(2);
} catch {
  // ignore if not JSON
}
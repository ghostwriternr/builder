import { execFileSync } from "node:child_process";

const expectedFiles = [
  "package/Cargo.lock",
  "package/Cargo.toml",
  "package/LICENSE",
  "package/README.md",
  "package/native/parser/Cargo.toml",
  "package/native/parser/src/lib.rs",
  "package/native/transform/Cargo.toml",
  "package/native/transform/src/lib.rs",
  "package/package.json",
  "package/rust-toolchain.toml",
  "package/src/abi/instance.ts",
  "package/src/abi/memory.ts",
  "package/src/abi/result.ts",
  "package/src/abi/utf8.ts",
  "package/src/diagnostics.ts",
  "package/src/index.ts",
  "package/src/oxc.ts",
  "package/src/parser.ts",
  "package/src/transform.ts",
  "package/src/types.ts",
  "package/src/wasm.d.ts",
  "package/src/wasm/parser.wasm",
  "package/src/wasm/transform.wasm",
];

const output = execFileSync("npm", ["pack", "--json", "--dry-run"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "inherit"],
});

const packs = JSON.parse(output);
if (!Array.isArray(packs) || packs.length !== 1) {
  console.error(
    `expected exactly one npm pack result, got ${Array.isArray(packs) ? packs.length : typeof packs}`,
  );
  process.exit(1);
}

const [pack] = packs;
const actualFiles = pack.files.map((file) => `package/${file.path}`).sort();
const expected = [...expectedFiles].sort();
const failures = [];

for (const file of expected) {
  if (!actualFiles.includes(file)) failures.push(`missing expected file: ${file}`);
}

for (const file of actualFiles) {
  if (!expected.includes(file)) failures.push(`unexpected file included: ${file}`);
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(`pack shape ok: ${actualFiles.length} files, ${pack.size} bytes`);

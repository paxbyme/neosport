import { cpSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const output = join(root, "dist");
const files = ["index.html", "styles.css", "script.js"];

rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });

for (const file of files) {
  cpSync(join(root, file), join(output, file));
}

cpSync(join(root, "assets"), join(output, "assets"), { recursive: true });

console.log(`Static production build created in ${output}`);

import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/bin/cli.ts", "src/proxy/server.ts"],
  format: ["esm"],
  dts: false,
  clean: true,
  sourcemap: true,
  splitting: false,
  target: "node18",
  banner: {
    js: "#!/usr/bin/env node",
  },
  // Use onSuccess to fix hashbang issues
  onSuccess: async () => {
    const { readFile, writeFile } = await import("node:fs/promises");
    const { join } = await import("node:path");

    // Remove hashbang from server.js completely
    const serverPath = join("dist", "proxy", "server.js");
    try {
      let content = await readFile(serverPath, "utf-8");
      // Remove the first line if it's a hashbang
      const lines = content.split("\n");
      if (lines[0]?.startsWith("#!")) {
        content = lines.slice(1).join("\n");
      }
      await writeFile(serverPath, content);
    } catch {
      // Ignore if file doesn't exist
    }

    // Fix cli.js - ensure single hashbang
    const cliPath = join("dist", "bin", "cli.js");
    try {
      let content = await readFile(cliPath, "utf-8");
      // Remove duplicate hashbangs
      const lines = content.split("\n");
      const filtered = lines.filter((line, i) => !(i < 2 && line.startsWith("#!")));
      content = "#!/usr/bin/env node\n" + filtered.join("\n");
      await writeFile(cliPath, content);
    } catch {
      // Ignore if file doesn't exist
    }
  },
  outDir: "dist",
});

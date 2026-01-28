/** @type {import("tailwindcss").Config} */
const fs = require("fs");
const path = require("path");

const CONTENT_EXTENSIONS = new Set([".js", ".ts", ".jsx", ".tsx", ".mdx"]);

const collectContentFiles = (rootDir) => {
  const files = [];
  const stack = [rootDir];

  while (stack.length) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (error) {
      continue;
    }

    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") {
        continue;
      }

      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (fullPath.includes(`${path.sep}app${path.sep}api${path.sep}`) || entry.name === "api") {
          continue;
        }
        stack.push(fullPath);
        continue;
      }

      if (CONTENT_EXTENSIONS.has(path.extname(entry.name))) {
        const relativePath = path.relative(__dirname, fullPath);
        files.push(relativePath.startsWith(".") ? relativePath : `./${relativePath}`);
      }
    }
  }

  return files;
};

const contentRoots = ["src/app", "src/components", "src/pages"];
const content = contentRoots.flatMap((root) => {
  const absoluteRoot = path.join(__dirname, root);
  return fs.existsSync(absoluteRoot) ? collectContentFiles(absoluteRoot) : [];
});

const config = {
  content,
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-space-grotesk)", "sans-serif"],
        display: ["var(--font-fraunces)", "serif"]
      },
      colors: {
        "ink": "#141414",
        "paper": "#f8f6f1",
        "gold": "#f6c44f",
        "emerald": "#0d8b6a",
        "steel": "#3b4652",
        "navy": {
          DEFAULT: "#0b1f3b",
          soft: "#1b3d63"
        }
      }
    }
  },
  plugins: []
};

module.exports = config;

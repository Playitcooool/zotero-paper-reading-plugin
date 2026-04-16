import { defineConfig } from "zotero-plugin-scaffold";
import pkg from "./package.json";

export default defineConfig({
  source: ["src", "addon"],
  dist: "build",
  name: pkg.config.addonName,
  id: pkg.config.addonID,
  namespace: pkg.config.addonRef,
  updateURL: undefined as undefined,

  build: {
    assets: ["addon/**/*.*"],
    define: {
      ...pkg.config,
      author: pkg.author,
      homepage: pkg.homepage,
      description: pkg.description,
      buildVersion: pkg.version,
      buildTime: "{{buildTime}}"
    },
    esbuildOptions: [
      {
        entryPoints: [{ in: "src/index.ts", out: pkg.config.addonRef }],
        define: {
          __env__: `"${process.env.NODE_ENV}"`
        },
        bundle: true,
        target: "firefox115",
        outdir: "build/addon/chrome/content/scripts"
      }
    ]
  }
});

import fs from "node:fs/promises";
import { createRequire } from "node:module";

export type ObsidianAppResourceOptions = {
  domain?: string;
};

export type ObsidianUiMeta = {
  domain?: string;
  prefersBorder: boolean;
  csp: {
    resourceDomains: string[];
  };
};

const require = createRequire(import.meta.url);
const extAppsBundlePath = require.resolve("@modelcontextprotocol/ext-apps/app-with-deps");
let appBundlePromise: Promise<string> | undefined;

export function obsidianUiMeta(options: ObsidianAppResourceOptions = {}): ObsidianUiMeta {
  return {
    ...(options.domain ? { domain: options.domain } : {}),
    prefersBorder: true,
    csp: {
      resourceDomains: ["https://assets.claude.ai"]
    }
  };
}

export async function loadExtAppsBundle() {
  appBundlePromise ??= fs.readFile(extAppsBundlePath, "utf8").then((source) => {
    const appSymbol = source.match(/([A-Za-z_$][\w$]*)\s+as\s+App/)?.[1];
    if (!appSymbol) {
      throw new Error("Could not locate App export in @modelcontextprotocol/ext-apps/app-with-deps");
    }

    return `${source.replace(/\/\/# sourceMappingURL=.*$/m, "")}
const __MCP_APPS_App = ${appSymbol};`;
  });

  return appBundlePromise;
}

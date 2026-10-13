import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

export default defineConfig([
  ...nextVitals,
  {
    rules: {
      // Soban's screens set a "mounted" flag in an effect to avoid hydration mismatches; keep it visible, not blocking.
      "react-hooks/set-state-in-effect": "warn",
      // ALT serves AI and profile pictures from its own media routes; next/image adds nothing here.
      "@next/next/no-img-element": "off",
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);

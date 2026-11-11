import {config} from "@remotion/eslint-config-flat";

export default [
  ...config,
  {
    // Hover and fade transitions in the editor chrome are ordinary UI. The flicker rule matters inside compositions only.
    files: ["src/**/*.tsx"],
    ignores: ["src/engine/**", "src/VideoComposition.tsx"],
    rules: {"@remotion/non-pure-animation": "off"},
  },
];

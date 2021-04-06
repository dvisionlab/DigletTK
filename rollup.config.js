import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import glsl from "rollup-plugin-glsl";
import json from "@rollup/plugin-json";

import pkg from "./package.json";

export default [
  // browser-friendly UMD build
  {
    input: "./src/index.js",
    output: {
      name: "dtk",
      file: pkg.browser,
      format: "umd",
      intro: "const global = window;" // fix global is not defined: https://github.com/rollup/rollup-plugin-commonjs/issues/6
    },
    plugins: [
      resolve(), // node modules
      commonjs(), // common js modules
      json(), // json files
      glsl({
        // By default, everything gets included
        include: "node_modules/vtk.js/Sources/Rendering/OpenGL/**/*.glsl"
      }) // gsls files
    ]
  }
];

// Log lib version and hardware info
import * as pkg from "../package.json";
import { getVideoCardInfo } from "./utils/utils";
console.groupCollapsed(
  "%c** dtk **",
  "background: #0aa658; color: #000000; line-height: 1.6"
);
console.log(`Version ${pkg.version}`);
console.log("Detected graphic card:");
console.log(getVideoCardInfo());
console.groupEnd("dtk");

// NOTE: this is necessary as workaround to this issue:
// https://github.com/Kitware/vtk-js/issues/1882
import "regenerator-runtime/runtime";

// Load the rendering pieces we want to use (for both WebGL and WebGPU)
// Without these, nothing will appear into the scene
import "vtk.js/Sources/Rendering/Profiles/Volume";
import "vtk.js/Sources/Rendering/Profiles/Geometry";
import "vtk.js/Sources/Rendering/Profiles/Glyph";

import { VRView } from "./vrView";
import { MPRManager } from "./mprManager";
import { loadDemoSerieWithLarvitar, buildVtkVolume } from "./utils/utils";

export { MPRManager, VRView, loadDemoSerieWithLarvitar, buildVtkVolume };

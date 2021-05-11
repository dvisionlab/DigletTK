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
import { loadDemoSerieWithLarvitar, buildVtkVolume } from "./utils";

export { MPRManager, VRView, loadDemoSerieWithLarvitar, buildVtkVolume };

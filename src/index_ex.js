import { VRView } from "./VRView";
import { MPRManager } from "./mprManager";
import { loadSerieWithLarvitar, buildVtkVolume } from "./utils";

const dtk = {
  VRView,
  MPRManager,
  loadSerieWithLarvitar,
  buildVtkVolume
};

window.dtk = dtk;

// Use modified MPRSlice interactor
import vtkInteractorStyleMPRWindowLevel from "./vue-mpr/vtkInteractorStyleMPRWindowLevel";
import vtkInteractorStyleMPRCrosshairs from "./vue-mpr/vtkInteractorStyleMPRCrosshairs";
import vtkCoordinate from "vtk.js/Sources/Rendering/Core/Coordinate";
import vtkMatrixBuilder from "vtk.js/Sources/Common/Core/MatrixBuilder";
// import vtkMath from "vtk.js/Sources/Common/Core/Math";

import {
  getPlaneIntersection,
  getVolumeCenter,
  createVolumeActor
} from "./utils";

import { MPRView } from "./mprView";

/**
 * MPRManager class
 *
 * global_data is more or less the internal state (this),
 * plus some other internal variable as defaultTool ecc
 *
 * methods:
 *  - onCrosshairPointSelected
 *  - updateLevels
 *  - onScrolled
 *  - onRotate
 *  - onThickness
 *  - createVolumeActor
 *
 */
export class MPRManager {
  constructor(elements) {
    this.VERBOSE = false; // TODO setter
    this.syncWindowLevels = true; // TODO setter
    this.activeTool = null; // TODO setter

    // TODO input sanity check

    this.elements = elements;

    this.volumes = [];

    this.sliceIntersection = [0, 0, 0];

    this.mprViews = {};

    this.initMPR();
  }

  initMPR() {
    Object.keys(this.elements).forEach((key, i) => {
      this.mprViews[key] = new MPRView(key, i, this.elements[key].element);
    });

    if (this.VERBOSE) console.log("initialized", global_data);
  }

  getInitialState() {
    // cycle on keys, and reduce extracting only useful properties
    // NOTE: initialize reduce with cloned object!
    let viewsState = Object.keys(this.mprViews).reduce((result, key) => {
      let {
        slicePlaneNormal,
        sliceViewUp,
        slicePlaneXRotation,
        slicePlaneYRotation,
        viewRotation,
        sliceThickness,
        blendMode,
        window
      } = result[key];
      result[key] = {
        slicePlaneNormal,
        sliceViewUp,
        slicePlaneXRotation,
        slicePlaneYRotation,
        viewRotation,
        sliceThickness,
        blendMode,
        window
      };
      return result;
    }, Object.assign({}, this.mprViews));

    return {
      sliceIntersection: [...this.sliceIntersection], // clone
      views: viewsState
    };
  }

  setImage(data, image) {
    let actor = createVolumeActor(image);
    this.volumes.push(actor);
    this.sliceIntersection = getVolumeCenter(actor.getMapper());

    Object.keys(this.elements).forEach(key => {
      this.mprViews[key].initView(actor, data);
    });

    if (this.activeTool) {
      this.setTool(this.activeTool);
    }
  }

  setTool(toolName, global_data) {
    switch (toolName) {
      case "level":
        this.setLevelTool(global_data);
        break;
      case "crosshair":
        this.setCrosshairTool(global_data);
        break;
    }
  }

  setLevelTool(global_data) {
    Object.entries(global_data.views).forEach(([key]) => {
      const istyle = vtkInteractorStyleMPRWindowLevel.newInstance();
      istyle.setOnScroll(this.onScrolled);
      istyle.setOnLevelsChanged(levels => {
        this.updateLevels({ ...levels, srcKey: key }, global_data);
      });
      this.mprViews[key].setInteractor(istyle);
    });
  }

  setCrosshairTool(global_data) {
    let self = this;
    Object.entries(global_data.views).forEach(([key]) => {
      const istyle = vtkInteractorStyleMPRCrosshairs.newInstance();
      istyle.setOnScroll(() => {
        self.onScrolled();
      });
      istyle.setOnClickCallback(({ worldPos }) => {
        self.onCrosshairPointSelected({ worldPos, srcKey: key });
      });
      this.mprViews[key].setInteractor(istyle);
    });
  }

  onCrosshairPointSelected({ srcKey, worldPos }) {
    Object.keys(this.elements).forEach(key => {
      if (key !== srcKey) {
        // We are basically doing the same as getSlice but with the world coordinate
        // that we want to jump to instead of the camera focal point.
        // I would rather do the camera adjustment directly but I keep
        // doing it wrong and so this is good enough for now.
        // ~ swerik
        const renderWindow = this.mprViews[
          key
        ].genericRenderWindow.getRenderWindow();

        const istyle = renderWindow.getInteractor().getInteractorStyle();
        const sliceNormal = istyle.getSliceNormal();
        const transform = vtkMatrixBuilder
          .buildFromDegree()
          .identity()
          .rotateFromDirections(sliceNormal, [1, 0, 0]);

        const mutatedWorldPos = worldPos.slice();
        transform.apply(mutatedWorldPos);
        const slice = mutatedWorldPos[0];

        istyle.setSlice(slice);

        renderWindow.render();
      }

      const renderer = this.mprViews[key].genericRenderWindow.getRenderer();
      const wPos = vtkCoordinate.newInstance();
      wPos.setCoordinateSystemToWorld();
      wPos.setValue(worldPos);

      const displayPosition = wPos.getComputedDisplayValue(renderer);
    });
  }

  // depends on global_data AND this.mprViews
  updateLevels({ windowCenter, windowWidth, srcKey }, global_data) {
    global_data.views[srcKey].window.center = windowCenter;
    global_data.views[srcKey].window.width = windowWidth;

    if (this.syncWindowLevels) {
      Object.keys(this.elements)
        .filter(key => key !== srcKey)
        .forEach(k => {
          global_data.views[k].window.center = windowCenter;
          global_data.views[k].window.width = windowWidth;
          this.mprViews[k].genericRenderWindow
            .getInteractor()
            .getInteractorStyle()
            .setWindowLevel(windowWidth, windowCenter);
          this.mprViews[k].genericRenderWindow.getRenderWindow().render();
        });
    }
  }

  onScrolled() {
    let planes = [];
    Object.keys(this.elements).forEach(key => {
      const camera = this.mprViews[key].genericRenderWindow
        .getRenderer()
        .getActiveCamera();

      planes.push({
        position: camera.getFocalPoint(),
        normal: camera.getDirectionOfProjection()
        // this[viewportIndex].slicePlaneNormal
      });
    });
    const newPoint = getPlaneIntersection(...planes);
    if (!Number.isNaN(newPoint)) {
      //   global_data.sliceIntersection = newPoint; TODO return sliceIntersection
      if (this.VERBOSE) console.log("updating slice intersection", newPoint);
    }
  }

  // depends on global_data and viewsArray
  // (key, axis: x or y, ABSOLUTE angle in deg)
  onRotate(key, axis, angle, global_data) {
    // Match the source axis to the associated plane
    switch (key) {
      case "top":
        if (axis === "x") global_data.views.front.slicePlaneYRotation = angle;
        else if (axis === "y")
          global_data.views.left.slicePlaneYRotation = angle;
        break;
      case "left":
        if (axis === "x") global_data.views.top.slicePlaneXRotation = angle;
        else if (axis === "y")
          global_data.views.front.slicePlaneXRotation = angle;
        break;
      case "front":
        if (axis === "x") global_data.views.top.slicePlaneYRotation = angle;
        else if (axis === "y")
          global_data.views.left.slicePlaneXRotation = angle;
        break;
    }

    // dv: this was a watcher in mpr component, update all except myself ?

    Object.keys(this.elements)
      .filter(c => c !== key)
      .forEach(k => {
        this.mprViews[k].updateSlicePlane(global_data.views[k]);
      });

    if (this.VERBOSE) console.log("afterOnRotate", global_data);
  }

  // depends on global_data and this.mprViews
  onThickness(key, axis, thickness, global_data) {
    const shouldBeMIP = thickness > 1;
    let view;
    switch (key) {
      case "top":
        if (axis === "x") view = global_data.views.front;
        else if (axis === "y") view = global_data.views.left;
        break;
      case "left":
        if (axis === "x") view = global_data.views.top;
        else if (axis === "y") view = global_data.views.front;
        break;
      case "front":
        if (axis === "x") view = global_data.views.top;
        else if (axis === "y") view = global_data.views.left;
        break;
    }

    view.sliceThickness = thickness;
    // TODO: consts instead of magic strings
    if (shouldBeMIP && view.blendMode === "none") view.blendMode = "MIP";
    // else if(!shouldBeMIP) {
    //   view.blendMode = "none"
    // }

    // dv: ex-watcher mpr
    const istyle = this.mprViews[key].renderWindow
      .getInteractor()
      .getInteractorStyle();
    // set thickness if the current interactor has it (it should, but just in case)
    istyle.setSlabThickness && istyle.setSlabThickness(thickness);
    this.mprViews[key].updateBlendMode(thickness, "MIP");
  }
}

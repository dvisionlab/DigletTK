import vtkGenericRenderWindow from "@kitware/vtk.js/Rendering/Misc/GenericRenderWindow";

import vtkInteractorStyleMPRSlice from "./vtk/vtkInteractorMPRSlice";

import { quat, vec3, mat4 } from "gl-matrix";

import { degrees2radians, fill2DView } from "./utils/utils";
import { baseView } from "./baseView";

/**
 * MPRView class
 * This is not intended to be used directly by user
 * Use MPRManager instead: it will create three instances of MPRView
 * @private
 *
 */

// TODO move to constants (calculate from image directions?)
const PLANE_NORMALS = [
  [0, 0, 1],
  [-1, 0, 0],
  [0, 1, 0]
];
const VIEW_UPS = [
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, 1]
];
export class MPRView extends baseView {
  constructor(key, i, element) {
    super();

    this.VERBOSE = false;
    this._key = key;
    this._element = element;
    this._volume = null;
    this._renderer = null;
    this._parallel = true; // TODO setter

    // init global data
    this.slicePlaneNormal = PLANE_NORMALS[i];
    this.sliceViewUp = VIEW_UPS[i];
    this.slicePlaneXRotation = 0;
    this.slicePlaneYRotation = 0;
    this.viewRotation = 0;
    this._sliceThickness = 0.1;
    this._blendMode = "MIP";
    this.window = {
      width: 0,
      center: 0
    };

    // cache the view vectors so we can apply the rotations without modifying the original value
    this._cachedSlicePlane = [...this.slicePlaneNormal];
    this._cachedSliceViewUp = [...this.sliceViewUp];

    this._genericRenderWindow = vtkGenericRenderWindow.newInstance({
      background: [0, 0, 0]
    });

    this._genericRenderWindow.setContainer(element);

    this._renderWindow = this._genericRenderWindow.getRenderWindow();
    this._renderer = this._genericRenderWindow.getRenderer();

    if (this._parallel) {
      this._renderer.getActiveCamera().setParallelProjection(true);
    }

    // update view node tree so that vtkOpenGLHardwareSelector can access the vtkOpenGLRenderer instance.
    const oglrw = this._genericRenderWindow.getOpenGLRenderWindow();
    oglrw.buildPass(true);

    /*
    // Use for maintaining clipping range for MIP (TODO)
    const interactor = this._renderWindow.getInteractor();
    //const clippingRange = renderer.getActiveCamera().getClippingRange();

    interactor.onAnimation(() => {
      renderer.getActiveCamera().setClippingRange(...r);
    });
    */

    // force the initial draw to set the canvas to the parent bounds.
    this.onResize();
  }

  /**
   * blendMode - "MIP", "MinIP", "Average"
   * @type {String}
   */
  set blendMode(blendMode) {
    this._blendMode = blendMode;
    this.updateBlendMode(this._sliceThickness, this._blendMode);
  }

  /**
   * sliceThickness
   * @type {Number}
   */
  set sliceThickness(thickness) {
    this._sliceThickness = thickness;
    const istyle = this._renderWindow.getInteractor().getInteractorStyle();
    // set thickness if the current interactor has it (it should, but just in case)
    istyle.setSlabThickness && istyle.setSlabThickness(this._sliceThickness);
    this.updateBlendMode(this._sliceThickness, this._blendMode);
  }

  /**
   * wwwl
   * @type {Array}
   */
  set wwwl([ww, wl]) {
    this.window.center = wl;
    this.window.width = ww;

    this._genericRenderWindow.getRenderWindow().render();
  }

  /**
   * camera
   * @type {vtkCamera}
   */
  get camera() {
    return this._genericRenderWindow.getRenderer().getActiveCamera();
  }

  /**
   * Initialize view: add actor to scene and setup controls & props
   * @param {vtkActor} actor
   * @param {State} data
   * @param {Function} onScrollCb
   */
  initView(actor, data, onScrollCb, onInitialized) {
    // dv: store volumes and element in viewport data
    this._volume = actor;

    const istyle = vtkInteractorStyleMPRSlice.newInstance();
    istyle.setOnScroll(onScrollCb);
    const inter = this._renderWindow.getInteractor();
    inter.setInteractorStyle(istyle);

    //  TODO: assumes the volume is always set for this mounted state...Throw an error?
    if (this.VERBOSE) console.log(this._volumes);
    const istyleVolumeMapper = this._volume.getMapper();

    istyle.setVolumeMapper(istyleVolumeMapper);

    //start with the volume center slice
    const range = istyle.getSliceRange();
    // if (this.VERBOSE) console.log('view mounted: setting the initial range', range)
    istyle.setSlice((range[0] + range[1]) / 2);

    // add the current volumes to the vtk renderer
    this.updateVolumesForRendering();

    if (this.VERBOSE) console.log("view data", this._key, data.views[this.key]);
    this.updateSlicePlane(data.views[this._key]);

    // set camera to fill viewport
    this.fill2DView(this._genericRenderWindow, this._key);

    onInitialized();
  }

  /**
   * cleanup the scene and add new volume
   * @private
   */
  updateVolumesForRendering() {
    this._renderer.removeAllVolumes();
    if (this._volume) {
      if (!this._volume.isA("vtkVolume")) {
        console.warn("Data to <Vtk2D> is not vtkVolume data");
      } else {
        this._renderer.addVolume(this._volume);
      }
    }
    this._renderWindow.render();
  }

  /**
   * Recompute slice plane after changes
   * @param {State} viewData
   */
  updateSlicePlane(viewData) {
    // cached things are in viewport data
    let cachedSlicePlane = this._cachedSlicePlane;
    let cachedSliceViewUp = this._cachedSliceViewUp;
    if (this.VERBOSE) console.log(viewData);
    // TODO: optimize so you don't have to calculate EVERYTHING every time?

    // rotate around the vector of the cross product of the plane and viewup as the X component
    let sliceXRotVector = [];
    vec3.cross(
      sliceXRotVector,
      viewData.sliceViewUp,
      viewData.slicePlaneNormal
    );
    vec3.normalize(sliceXRotVector, sliceXRotVector);

    // rotate the viewUp vector as the Y component
    let sliceYRotVector = viewData.sliceViewUp;

    const planeMat = mat4.create();
    mat4.rotate(
      planeMat,
      planeMat,
      degrees2radians(viewData.slicePlaneYRotation),
      sliceYRotVector
    );
    mat4.rotate(
      planeMat,
      planeMat,
      degrees2radians(viewData.slicePlaneXRotation),
      sliceXRotVector
    );

    if (this.VERBOSE)
      console.log(cachedSlicePlane, viewData.slicePlaneNormal, planeMat);

    vec3.transformMat4(cachedSlicePlane, viewData.slicePlaneNormal, planeMat);

    // Rotate the viewUp in 90 degree increments
    const viewRotQuat = quat.create();
    // Use - degrees since the axis of rotation should really be the direction of projection, which is the negative of the plane normal
    quat.setAxisAngle(
      viewRotQuat,
      cachedSlicePlane,
      degrees2radians(-viewData.viewRotation)
    );
    quat.normalize(viewRotQuat, viewRotQuat);

    // rotate the ViewUp with the x and z rotations
    const xQuat = quat.create();
    quat.setAxisAngle(
      xQuat,
      sliceXRotVector,
      degrees2radians(viewData.slicePlaneXRotation)
    );
    quat.normalize(xQuat, xQuat);
    const viewUpQuat = quat.create();
    quat.add(viewUpQuat, xQuat, viewRotQuat);
    vec3.transformQuat(cachedSliceViewUp, viewData.sliceViewUp, viewRotQuat);

    // update the view's slice
    const renderWindow = this._genericRenderWindow.getRenderWindow();
    const istyle = renderWindow.getInteractor().getInteractorStyle();
    if (istyle && istyle.setSliceNormal) {
      istyle.setSliceNormal(cachedSlicePlane, cachedSliceViewUp);
    }

    renderWindow.render();
  }

  // fit to window (vtk.js 11 version: https://github.com/Kitware/paraview-glance/issues/230)
  fill2DView() {
    // Based this code: https://github.com/Kitware/paraview-glance/issues/230#issuecomment-445779222
    const bounds = this._renderer.computeVisiblePropBounds();
    const dim = [
      (bounds[1] - bounds[0]) / 2,
      (bounds[3] - bounds[2]) / 2,
      (bounds[5] - bounds[4]) / 2
    ];
    const w = this._genericRenderWindow.getContainer().clientWidth;
    const h = this._genericRenderWindow.getContainer().clientHeight;
    const r = w / h;

    let x;
    let y;
    if (this._key === "left") {
      x = dim[1];
      y = dim[2];
    } else if (this._key === "front") {
      x = dim[0];
      y = dim[2];
    } else if (this._key === "top") {
      x = dim[0];
      y = dim[1];
    }
    if (r >= x / y) {
      // use width
      this._renderer.getActiveCamera().setParallelScale(y + 1);
    } else {
      // use height
      this._renderer.getActiveCamera().setParallelScale(x / r + 1);
    }
    this.onResize();
  }

  /**
   * on resize callback
   * @private
   */
  onResize() {
    // TODO: debounce for performance reasons?
    this._genericRenderWindow.resize();
  }

  /**
   * update blending after changes
   * @private
   * @param {Number} thickness
   * @param {String} blendMode
   */
  updateBlendMode(thickness, blendMode) {
    if (thickness >= 1) {
      switch (blendMode) {
        case "MIP":
          this._volume.getMapper().setBlendModeToMaximumIntensity();
          break;
        case "MINIP":
          this._volume.getMapper().setBlendModeToMinimumIntensity();
          break;
        case "AVG":
          this._volume.getMapper().setBlendModeToAverageIntensity();
          break;
        case "none":
        default:
          this._volume.getMapper().setBlendModeToComposite();
          break;
      }
    } else {
      this._volume.getMapper().setBlendModeToComposite();
    }
    this._renderWindow.render();
  }

  /**
   * Setup interactor
   * @param {vtkInteractorStyle} istyle
   */
  setInteractor(istyle) {
    const renderWindow = this._genericRenderWindow.getRenderWindow();
    // We are assuming the old style is always extended from the MPRSlice style
    const oldStyle = renderWindow.getInteractor().getInteractorStyle();

    renderWindow.getInteractor().setInteractorStyle(istyle);
    istyle.setInteractor(renderWindow.getInteractor());

    // Make sure to set the style to the interactor itself, because reasons...?!
    const inter = renderWindow.getInteractor();
    inter.setInteractorStyle(istyle);

    // Copy previous interactors styles into the new one.
    if (istyle.setSliceNormal && oldStyle.getSliceNormal()) {
      // if (VERBOSE) console.log("setting slicenormal from old normal");
      istyle.setSliceNormal(oldStyle.getSliceNormal(), oldStyle.getViewUp());
    }
    if (istyle.setSlabThickness && oldStyle.getSlabThickness()) {
      istyle.setSlabThickness(oldStyle.getSlabThickness());
    }
    istyle.setVolumeMapper(this._volume);

    // set current slice (fake) to make distance widget working
    // istyle.setCurrentImageNumber(0);
  }

  /**
   * Destroy webgl content and release listeners
   */
  destroy() {
    if (this.VERBOSE) console.log("DESTROY", this._key);

    this.VERBOSE = null;
    this._key = null;
    this._element = null;
    // mapper is in common btw views, check that it has not already been deleted by other view
    if (this._volume.getMapper()) {
      this._volume.getMapper().delete();
    }
    this._volume.delete();
    this._volume = null;

    this._renderer.delete();
    this._renderer = null;
    this._parallel = null;

    this.slicePlaneNormal = null;
    this.sliceViewUp = null;
    this.slicePlaneXRotation = null;
    this.slicePlaneYRotation = null;
    this.viewRotation = null;
    this._sliceThickness = null;
    this._blendMode = null;
    this.window = null;

    this._cachedSlicePlane = null;
    this._cachedSliceViewUp = null;

    this._genericRenderWindow.delete();

    // delete resize listener ?
  }
}

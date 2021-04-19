import vtkGenericRenderWindow from "vtk.js/Sources/Rendering/Misc/GenericRenderWindow";
import vtkWidgetManager from "vtk.js/Sources/Widgets/Core/WidgetManager";
import vtkInteractorStyleMPRSlice from "./vtk/vtkInteractorMPRSlice";

import { quat, vec3, mat4 } from "gl-matrix";

import { degrees2radians } from "./utils";

/**
 * MPRView class
 * @private
 * @todo
 *
 * viewportData is the internal state (this)
 *
 * methods:
 *  - initView OK
 *  - updateVolumesForRendering OK
 *  - updateSlicePlane OK
 *  - onResize OK
 *  - setLevelTool
 *  - setCrosshairTool
 *  - setInteractor
 *  - onCrosshairPointSelected ? must update other views -> need a just a setter for worldPos
 *  - updateLevels ? idem, just a setter for wwwl
 *  - updateBlendMode OK
 *
 *  - setter for height and width
 */

const PLANE_NORMALS = [[0, 0, 1], [1, 0, 0], [0, -1, 0]];

const VIEW_UPS = [[0, -1, 0], [0, 0, -1], [0, 0, -1]];
export class MPRView {
  constructor(key, i, element) {
    this.VERBOSE = false;
    this.key = key;
    this.volumes = [];
    this.renderer = null;
    this.parallel = false; // TODO setter
    this.onCreated = null; // TODO
    this.onDestroyed = null; // TODO check on original code
    this.element = element;

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
    this.cachedSlicePlane = [...this.slicePlaneNormal];
    this.cachedSliceViewUp = [...this.sliceViewUp];

    this.genericRenderWindow = vtkGenericRenderWindow.newInstance({
      background: [0, 0, 0]
    });

    this.genericRenderWindow.setContainer(element);

    this.renderWindow = this.genericRenderWindow.getRenderWindow();
    this.renderer = this.genericRenderWindow.getRenderer();

    if (this.parallel) {
      this.renderer.getActiveCamera().setParallelProjection(true);
    }

    // update view node tree so that vtkOpenGLHardwareSelector can access the vtkOpenGLRenderer instance.
    const oglrw = this.genericRenderWindow.getOpenGLRenderWindow();
    oglrw.buildPass(true);

    /*
    // Use for maintaining clipping range for MIP (TODO)
    const interactor = this.renderWindow.getInteractor();
    //const clippingRange = renderer.getActiveCamera().getClippingRange();

    interactor.onAnimation(() => {
      renderer.getActiveCamera().setClippingRange(...r);
    });
    */

    // force the initial draw to set the canvas to the parent bounds.
    this.onResize();

    if (this.onCreated) {
      this.onCreated();
    }
  }

  set blendMode(blendMode) {
    this._blendMode = blendMode;
    this.updateBlendMode(this._sliceThickness, this._blendMode);
  }

  set sliceThickness(thickness) {
    this._sliceThickness = thickness;
    const istyle = this.renderWindow.getInteractor().getInteractorStyle();
    // set thickness if the current interactor has it (it should, but just in case)
    istyle.setSlabThickness && istyle.setSlabThickness(this._sliceThickness);
    this.updateBlendMode(this._sliceThickness, this._blendMode);
  }

  initView(actor, data, onScrollCb) {
    // dv: store volumes and element in viewport data
    this.volumes.push(actor);

    const istyle = vtkInteractorStyleMPRSlice.newInstance();
    istyle.setOnScroll(onScrollCb);
    const inter = this.renderWindow.getInteractor();
    inter.setInteractorStyle(istyle);

    //  TODO: assumes the volume is always set for this mounted state...Throw an error?
    if (this.VERBOSE) console.log(this.volumes);
    const istyleVolumeMapper = this.volumes[0].getMapper();

    istyle.setVolumeMapper(istyleVolumeMapper);

    //start with the volume center slice
    const range = istyle.getSliceRange();
    // if (this.VERBOSE) console.log('view mounted: setting the initial range', range)
    istyle.setSlice((range[0] + range[1]) / 2);

    // add the current volumes to the vtk renderer
    this.updateVolumesForRendering();

    if (this.VERBOSE) console.log("view data", this.key, data.views[this.key]);
    this.updateSlicePlane(data.views[this.key]);

    // force the initial draw to set the canvas to the parent bounds.
    this.onResize();

    if (this.onCreated) {
      this.onCreated();
    }
  }

  updateVolumesForRendering() {
    this.renderer.removeAllVolumes();
    let volumes = this.volumes;
    if (volumes && volumes.length) {
      volumes.forEach(volume => {
        if (!volume.isA("vtkVolume")) {
          console.warn("Data to <Vtk2D> is not vtkVolume data");
        } else {
          this.renderer.addVolume(volume);
        }
      });
    }
    this.renderWindow.render();
  }

  updateSlicePlane(viewData) {
    // cached things are in viewport data
    let cachedSlicePlane = this.cachedSlicePlane;
    let cachedSliceViewUp = this.cachedSliceViewUp;
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
    const renderWindow = this.genericRenderWindow.getRenderWindow();
    const istyle = renderWindow.getInteractor().getInteractorStyle();
    if (istyle && istyle.setSliceNormal) {
      istyle.setSliceNormal(cachedSlicePlane, cachedSliceViewUp);
    }

    renderWindow.render();
  }

  onResize() {
    // TODO: debounce for performance reasons?
    this.genericRenderWindow.resize();
  }

  updateBlendMode(thickness, blendMode) {
    if (thickness >= 1) {
      switch (blendMode) {
        case "MIP":
          this.volumes[0].getMapper().setBlendModeToMaximumIntensity();
          break;
        case "MINIP":
          this.volumes[0].getMapper().setBlendModeToMinimumIntensity();
          break;
        case "AVG":
          this.volumes[0].getMapper().setBlendModeToAverageIntensity();
          break;
        case "none":
        default:
          this.volumes[0].getMapper().setBlendModeToComposite();
          break;
      }
    } else {
      this.volumes[0].getMapper().setBlendModeToComposite();
    }
    this.renderWindow.render();
  }

  setInteractor(istyle) {
    const renderWindow = this.genericRenderWindow.getRenderWindow();
    // We are assuming the old style is always extended from the MPRSlice style
    const oldStyle = renderWindow.getInteractor().getInteractorStyle();

    renderWindow.getInteractor().setInteractorStyle(istyle);
    // NOTE: react-vtk-viewport's code put this here, so we're copying it. Seems redundant?
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
    istyle.setVolumeMapper(this.volumes[0]);

    // set current slice (fake) to make distance widget working
    // istyle.setCurrentImageNumber(0);
  }
}

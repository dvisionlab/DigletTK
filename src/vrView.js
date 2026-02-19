import vtkGenericRenderWindow from "@kitware/vtk.js/Rendering/Misc/GenericRenderWindow";
import vtkColorTransferFunction from "@kitware/vtk.js/Rendering/Core/ColorTransferFunction";
import vtkPiecewiseFunction from "@kitware/vtk.js/Common/DataModel/PiecewiseFunction";
import vtkColorMaps from "@kitware/vtk.js/Rendering/Core/ColorTransferFunction/ColorMaps";

import vtkMouseCameraTrackballRotateManipulator from "@kitware/vtk.js/Interaction/Manipulators/MouseCameraTrackballRotateManipulator";
import vtkMouseCameraTrackballPanManipulator from "@kitware/vtk.js/Interaction/Manipulators/MouseCameraTrackballPanManipulator";
import vtkMouseCameraTrackballZoomManipulator from "@kitware/vtk.js/Interaction/Manipulators/MouseCameraTrackballZoomManipulator";
import vtkMouseRangeManipulator from "@kitware/vtk.js/Interaction/Manipulators/MouseRangeManipulator";
import vtkInteractorStyleManipulator from "@kitware/vtk.js/Interaction/Style/InteractorStyleManipulator";

import vtkPointPicker from "@kitware/vtk.js/Rendering/Core/PointPicker";
import vtkCoordinate from "@kitware/vtk.js/Rendering/Core/Coordinate";
import vtkSphereSource from "@kitware/vtk.js/Filters/Sources/SphereSource";
import vtkLineSource from "@kitware/vtk.js/Filters/Sources/LineSource";
import vtkActor from "@kitware/vtk.js/Rendering/Core/Actor";
import vtkImageMapper from "@kitware/vtk.js/Rendering/Core/ImageMapper";
import vtkImageReslice from "@kitware/vtk.js/Imaging/Core/ImageReslice";
import vtkImageSlice from "@kitware/vtk.js/Rendering/Core/ImageSlice";
import vtkImageProperty from "@kitware/vtk.js/Rendering/Core/ImageProperty";
import vtkPlane from "@kitware/vtk.js/Common/DataModel/Plane";
import vtkImplicitPlaneWidget from "@kitware/vtk.js/Widgets/Widgets3D/ImplicitPlaneWidget";
import vtkWidgetManager from "@kitware/vtk.js/Widgets/Core/WidgetManager";
import { dot, cross, normalize } from "@kitware/vtk.js/Common/Core/Math";
import { InterpolationType } from "@kitware/vtk.js/Rendering/Core/ImageProperty/Constants";
import vtkMapper from "@kitware/vtk.js/Rendering/Core/Mapper";

import {
  createVolumeActor,
  setupPGwidget,
  setCamera,
  setActorProperties,
  setupCropWidget,
  setupPickingPlane,
  getRelativeRange,
  createSurfaceActor
} from "./utils/utils";
import { applyStrategy } from "./utils/strategies";
import { createPreset } from "./utils/colormaps";
import { getRenderPass } from "./renderPasses";

import { baseView } from "./baseView";

// Add custom presets
vtkColorMaps.addPreset(createPreset());

/** A class representing a Volume Rendering scene */
export class VRView extends baseView {
  /**
   * Create a volume rendering scene
   * @param {HTMLElement} element - the target html element to render the scene
   */
  constructor(element) {
    super();

    this.VERBOSE = false;

    this._element = element;
    this._renderer = null;
    this._renderWindow = null;
    this._genericRenderWindow = null;
    this._actor = null;
    this._raysDistance = null;
    this._blurOnInteraction = null;

    // piecewise gaussian widget stuff
    this._PGwidgetElement = null;
    this._PGwidget = null;
    this._gaussians = null;
    this._PGwidgetLoaded = false;

    // crop widget
    this._cropWidget = null;

    // normalized ww wl
    this._ww = 0.1;
    this._wl = 0.4;

    // absolute ww wl
    this._wwwl = [0, 0];

    // LUT options
    this._rangeLUT = null;
    this._rescaleLUT = false; // cannot initialize true (must set lut before)

    // rendering passes
    this._edgeEnhancement = false;

    // measurement state
    this._measurementState = null;

    // picking state
    this._pickCb = null;
    this._pickOptions = null;
    this._pickingEnabled = false;

    // surfaces
    this._surfaces = new Map();

    // landmarks
    this._landmarks = new Map();
    this._highlightLineX = null;
    this._highlightLineY = null;
    this._highlightActorY = null;
    this._highlightActorX = null;
    this._highlightActorY = null;

    // slice plane
    this._slicePlane = null;
    this._reslice = null;
    this._sliceMapper = null;
    this._sliceActor = null;
    this._sliceProperty = null;

    this._widgetManager = null;
    this._sliceWidget = null;
    this._sliceWidgetInstance = null;

    // initialize empty scene
    this._init();
  }

  // ===========================================================
  // ====== setters & getters ==================================
  // ===========================================================

  /**
   * wwwl
   * @type {Array}
   */
  set wwwl(value) {
    if (!this._actor) {
      return;
    }

    let relativeWwwl = getRelativeRange(this._actor, value);

    this._wl = relativeWwwl.wl;
    this._ww = relativeWwwl.ww;

    if (this._PGwidget) {
      this._updateWidget();
      this._setWidgetCallbacks();
    }
  }

  get wwwl() {
    let absoluteWwwl = getAbsoluteRange(this._actor, [this._ww, this._wl]);
    return [absoluteWwwl.ww, absoluteWwwl.wl];
  }

  /**
   * raysDistance
   * @type {Number}
   */
  set resolution(value) {
    this._raysDistance = 1 / value;
    this._actor.getMapper().setSampleDistance(this._raysDistance);
    let maxSamples = value > 1 ? value * 1000 : 1000;
    this._actor.getMapper().setMaximumSamplesPerRay(maxSamples);
    this._renderWindow.render();
  }

  get resolution() {
    return Math.round(1 / this._raysDistance);
  }

  /**
   * Presets
   * @type {Array}
   */
  get presetsList() {
    return vtkColorMaps.rgbPresetNames;
  }

  /**
   * PGwidgetElement (set null to hide)
   * @type {HTMLelement}
   */
  set widgetElement(element) {
    // initalize piecewise gaussian widget
    this._PGwidgetElement = element;
    if (!this._PGwidget) {
      this._PGwidget = setupPGwidget(this._PGwidgetElement);
    }
    let h = element.offsetHeight ? element.offsetHeight - 5 : 100;
    let w = element.offsetWidth ? element.offsetWidth - 5 : 300;
    this._PGwidget.setSize(w, h);
    this._PGwidget.setContainer(this._PGwidgetElement);
    this._PGwidget.render();
  }

  /**
   * Flag to set lut rescaling on opacity range
   * @type {bool}
   */
  set rescaleLUT(bool) {
    this._rescaleLUT = bool;
    let range;
    if (this._rescaleLUT && this._PGwidget) {
      range = this._PGwidget.getOpacityRange();
    } else {
      range = this._actor
        .getMapper()
        .getInputData()
        .getPointData()
        .getScalars()
        .getRange();
    }
    this.ctfun.setMappingRange(...range);
    this.ctfun.updateRange();
  }

  /**
   * Set range to apply lut  !!! WIP
   * @type {Array}
   */
  set rangeLUT([min, max]) {
    this._rangeLUT = [min, max];
    this._actor
      .getProperty()
      .getRGBTransferFunction(0)
      .setMappingRange(min, max);
  }

  /**
   * Crop widget on / off
   * @type {bool}
   */
  set cropWidget(visible) {
    if (!this._cropWidget) this._initCropWidget();
    this._cropWidget.setVisibility(visible);
    this._widgetManager.renderWidgets();
    this._renderWindow.render();
  }

  /**
   * Set colormap and opacity function
   * lutName - as in presets list
   * @type {String}
   */
  set lut(lutName) {
    // set up color transfer function
    const lookupTable = vtkColorTransferFunction.newInstance();
    lookupTable.applyColorMap(vtkColorMaps.getPresetByName(lutName));

    // update lookup table mapping range based on input dataset
    let range;

    if (this._rescaleLUT && this._PGwidgetLoaded) {
      range = this._PGwidget.getOpacityRange();
    } else {
      range = this._actor
        .getMapper()
        .getInputData()
        .getPointData()
        .getScalars()
        .getRange();
    }

    // TODO a function to set custom mapping range (unbind from opacity)
    lookupTable.setMappingRange(...range);
    lookupTable.updateRange();

    this._actor.getProperty().setRGBTransferFunction(0, lookupTable);

    // setup opacity function (values will be set by PGwidget)
    const piecewiseFun = vtkPiecewiseFunction.newInstance();
    this._actor.getProperty().setScalarOpacity(0, piecewiseFun);

    this.ctfun = lookupTable;
    this.ofun = piecewiseFun;

    if (this._PGwidget) {
      this._updateWidget();
      this._setWidgetCallbacks();
    }
  }

  /**
   * Toggle blurring on interaction (Increase performance)
   * @type {bool} toggle - if true, blur on interaction
   */
  set blurOnInteraction(toggle) {
    this._blurOnInteraction = toggle;
    let interactor = this._renderWindow.getInteractor();
    let mapper = this._actor.getMapper();

    if (toggle) {
      interactor.onLeftButtonPress(() => {
        mapper.setSampleDistance(this._raysDistance * 5);
      });

      interactor.onLeftButtonRelease(() => {
        mapper.setSampleDistance(this._raysDistance);
        // update picking plane
        let camera = this._renderer.getActiveCamera();
        if (this._pickingPlane)
          this._pickingPlane.setNormal(camera.getDirectionOfProjection());
        this._renderWindow.render();
      });
    } else {
      interactor.onLeftButtonPress(() => {
        mapper.setSampleDistance(this._raysDistance);
      });

      interactor.onLeftButtonRelease(() => {
        mapper.setSampleDistance(this._raysDistance);
        // update picking plane
        let camera = this._renderer.getActiveCamera();
        if (this._pickingPlane)
          this._pickingPlane.setNormal(camera.getDirectionOfProjection());
        this._renderWindow.render();
      });
    }
  }

  /**
   * Toggle slice plane visibility
   * @type {bool}
   */
  set slicePlane(visible) {
    if (!this._sliceActor) this._initSlicePlane();
    if (!this._sliceWidget) this._initSliceWidget();

    this._sliceActor.setVisibility(visible);
    if (this._sliceWidgetInstance) {
      this._sliceWidgetInstance.setEnabled(visible);
    }
    this._widgetManager.renderWidgets();
    this._renderWindow.render();
  }

  /**
   * Set slice opacity
   * @type {Number}
   */
  set sliceOpacity(opacity) {
    if (!this._sliceActor) this._initSlicePlane();
    this._sliceProperty.setOpacity(opacity);
    this._renderWindow.render();
  }

  get sliceOpacity() {
    return this._sliceProperty ? this._sliceProperty.getOpacity() : 1;
  }

  /**
   * Set slice position [0, 1] along its normal
   * @type {Number}
   */
  set slicePosition(value) {
    if (!this._slicePlane || !this._actor) return;

    const bounds = this._actor.getBounds();
    const normal = this._slicePlane.getNormal();

    // Compute min/max distance along normal for all 8 corners
    let minD = Infinity;
    let maxD = -Infinity;

    for (let i = 0; i < 8; i++) {
      const corner = [
        bounds[i % 2],
        bounds[2 + (Math.floor(i / 2) % 2)],
        bounds[4 + (Math.floor(i / 4) % 2)]
      ];
      const d = dot(corner, normal);
      if (d < minD) minD = d;
      if (d > maxD) maxD = d;
    }

    const targetD = minD + value * (maxD - minD);
    const currentOrigin = this._slicePlane.getOrigin();
    const currentD = dot(currentOrigin, normal);

    // Move origin along normal to reach targetD
    const offset = targetD - currentD;
    const newOrigin = [
      currentOrigin[0] + offset * normal[0],
      currentOrigin[1] + offset * normal[1],
      currentOrigin[2] + offset * normal[2]
    ];

    this.setSlicePlane(newOrigin);
  }

  get slicePosition() {
    if (!this._slicePlane || !this._actor) return 0.5;

    const bounds = this._actor.getBounds();
    const normal = this._slicePlane.getNormal();
    const origin = this._slicePlane.getOrigin();

    let minD = Infinity;
    let maxD = -Infinity;

    for (let i = 0; i < 8; i++) {
      const corner = [
        bounds[i % 2],
        bounds[2 + (Math.floor(i / 2) % 2)],
        bounds[4 + (Math.floor(i / 4) % 2)]
      ];
      const d = dot(corner, normal);
      if (d < minD) minD = d;
      if (d > maxD) maxD = d;
    }

    const currentD = dot(origin, normal);
    const pos = (currentD - minD) / (maxD - minD);
    return Math.max(0, Math.min(1, pos));
  }

  /**
   * Set slice plane origin and normal
   * @param {Array} origin
   * @param {Array} normal
   */
  setSlicePlane(origin, normal) {
    if (!this._sliceActor) this._initSlicePlane();
    if (!this._sliceWidget) this._initSliceWidget();

    if (origin) this._slicePlane.setOrigin(origin);
    if (normal) this._slicePlane.setNormal(normal);

    // update reslice axes
    this._updateResliceAxes();

    const planeState = this._sliceWidget.getWidgetState();
    planeState.setOrigin(this._slicePlane.getOrigin());
    planeState.setNormal(this._slicePlane.getNormal());

    this._renderWindow.render();
  }

  /**
   * Get slice plane origin and normal
   * @returns {Object} {origin, normal}
   */
  getSlicePlane() {
    if (!this._slicePlane) return null;
    return {
      origin: this._slicePlane.getOrigin(),
      normal: this._slicePlane.getNormal()
    };
  }

  /**
   * Toggle edge enhancement
   */
  set edgeEnhancement([type, value]) {
    let renderPass = getRenderPass(type, value);
    let view = this._renderWindow.getViews()[0];
    view.setRenderPasses([renderPass]);
    this._renderWindow.render();
  }

  // ===========================================================
  // ====== public methods =====================================
  // ===========================================================

  /**
   * Set the image to be rendered
   * @param {ArrayBuffer} image - The image content data as buffer array
   */
  setImage(image) {
    // clean scene
    this._renderer.removeAllVolumes();
    this._actor = createVolumeActor(image);
    this.lut = "Grayscale";
    this.resolution = 2;
    this._renderer.addVolume(this._actor);

    if (this._reslice) {
      this._reslice.setInputData(this._actor.getMapper().getInputData());
      const center = this._actor.getCenter();
      this._slicePlane.setOrigin(center);
      this._updateResliceAxes();

      if (this._sliceWidget) {
        this._sliceWidget.placeWidget(this._actor.getBounds());
        const planeState = this._sliceWidget.getWidgetState();
        planeState.setOrigin(this._slicePlane.getOrigin());
        planeState.setNormal(this._slicePlane.getNormal());
      }
    }

    // center camera on new volume
    this._renderer.resetCamera();
    setCamera(this._renderer.getActiveCamera(), this._actor.getCenter());

    if (this._PGwidget) {
      this._updateWidget();
      this._setWidgetCallbacks();
    }

    // TODO if crop widget, update to new image (or set to null so that it will be initialized again)

    // TODO implement a strategy to set rays distance
    setActorProperties(this._actor);

    this._setupInteractor();

    this.blurOnInteraction = true;

    this._genericRenderWindow.resize();
    this._renderWindow.render();
  }

  // This is another method, providing the url
  //   reader.setUrl("./demo/die.stl").then(data => {
  //     console.log("read", data);
  //     const mapper = vtkMapper.newInstance({ scalarVisibility: false });
  //      ... etc ...
  //   });

  /**
   * Add surfaces to be rendered
   * @param {Object} - {buffer: bufferarray, fileType?: string, props: Object}
   * Props contains color, label, opacity, wireframe
   */
  addSurface({ buffer, fileType, props }) {
    if (this._surfaces.has(props.label)) {
      console.warn(
        `DTK: A surface with label ${props.label} is already present. I will ignore this.`
      );
      return;
    }

    const surfaceData = createSurfaceActor(buffer, fileType);
    if (!surfaceData) {
      return;
    }

    const { actor } = surfaceData;

    const properties = actor.getProperty();
    properties.setColor(...props.color);
    properties.setOpacity(props.opacity || 1);
    this._surfaces.set(props.label, actor);

    this._renderer.addActor(actor);
    this._renderer.resetCamera();
    this._renderWindow.render();
  }

  /**
   * Add landmarks to be rendered as spheres
   * @param {Array} landmarks - [{label, x, y, z, color, radius}]
   * Use replaceLandmarks() to replace existing landmarks.
   * @param {Boolean} render - Optional render toggle (default true)
   */
  addLandmarks(landmarks, render = true) {
    landmarks.forEach(landmark => {
      if (this._landmarks.has(landmark.label)) {
        console.warn(
          `DTK: A landmark with label ${landmark.label} is already present. I will ignore this.`
        );
        return;
      }

      const sphereSource = vtkSphereSource.newInstance();
      sphereSource.setCenter(landmark.x, landmark.y, landmark.z);
      sphereSource.setRadius(landmark.radius || 1.0);

      const mapper = vtkMapper.newInstance();
      mapper.setInputConnection(sphereSource.getOutputPort());

      const actor = vtkActor.newInstance();
      actor.setMapper(mapper);
      actor.getProperty().setColor(landmark.color);

      this._landmarks.set(landmark.label, { actor, sphereSource });
      this._renderer.addActor(actor);
    });

    if (render) {
      this._renderWindow.render();
    }
  }

  /**
   * Remove all landmarks from the scene
   * @param {Boolean} render - Optional render toggle (default true)
   */
  resetLandmarks(render = true) {
    if (!this._renderer || !this._renderWindow || !this._landmarks) {
      return;
    }

    // Ensure any highlight indicator is cleared when landmarks are reset.
    this.clearHighlightedLandmark(false);

    this._landmarks.forEach(({ actor, sphereSource }) => {
      if (actor) {
        this._renderer.removeActor(actor);
        const mapper = actor.getMapper();
        if (mapper) {
          mapper.delete();
        }
        actor.delete();
      }

      if (sphereSource) {
        sphereSource.delete();
      }
    });

    this._landmarks.clear();
    if (render) {
      this._renderWindow.render();
    }
  }

  /**
   * Replace all landmarks in a single render pass
   * @param {Array} landmarks - [{label, x, y, z, color, radius}]
   */
  replaceLandmarks(landmarks) {
    this.resetLandmarks(false);
    this.addLandmarks(landmarks, false);
    if (this._renderWindow) {
      this._renderWindow.render();
    }
  }

  /**
   * Highlight a landmark with a red cross indicator
   * @param {String|Object} labelOrId - Landmark label or landmark-like object
   * @param {Object} options
   * @param {Number} options.radius - Override landmark radius
   * @param {Number} options.lengthFactor - Scale factor for cross length (default 4)
   */
  setHighlightedLandmark(labelOrId, options = {}) {
    if (!this._renderer || !this._renderWindow) {
      return;
    }

    let landmark = null;
    let landmarkRadius = null;
    if (labelOrId && typeof labelOrId === "object") {
      if (
        Number.isFinite(labelOrId.x) &&
        Number.isFinite(labelOrId.y) &&
        Number.isFinite(labelOrId.z)
      ) {
        landmark = labelOrId;
        if (Number.isFinite(labelOrId.radius)) {
          landmarkRadius = labelOrId.radius;
        }
      } else if (
        labelOrId.label &&
        this._landmarks &&
        this._landmarks.has(labelOrId.label)
      ) {
        const entry = this._landmarks.get(labelOrId.label);
        const [x, y, z] = entry.sphereSource.getCenter();
        landmark = { x, y, z };
        landmarkRadius = entry.sphereSource.getRadius();
      }
    } else if (this._landmarks && this._landmarks.has(labelOrId)) {
      const entry = this._landmarks.get(labelOrId);
      const [x, y, z] = entry.sphereSource.getCenter();
      landmark = { x, y, z };
      landmarkRadius = entry.sphereSource.getRadius();
    }

    if (
      !landmark ||
      !Number.isFinite(landmark.x) ||
      !Number.isFinite(landmark.y) ||
      !Number.isFinite(landmark.z)
    ) {
      this.clearHighlightedLandmark();
      return;
    }

    if (!this._highlightLineX || !this._highlightLineY) {
      const lineX = vtkLineSource.newInstance();
      const lineY = vtkLineSource.newInstance();

      const mapperX = vtkMapper.newInstance();
      const mapperY = vtkMapper.newInstance();
      mapperX.setInputConnection(lineX.getOutputPort());
      mapperY.setInputConnection(lineY.getOutputPort());

      const actorX = vtkActor.newInstance();
      const actorY = vtkActor.newInstance();
      actorX.setMapper(mapperX);
      actorY.setMapper(mapperY);

      actorX.getProperty().setColor(1, 0, 0);
      actorY.getProperty().setColor(1, 0, 0);
      actorX.getProperty().setLineWidth(3);
      actorY.getProperty().setLineWidth(3);
      actorX.setVisibility(false);
      actorY.setVisibility(false);

      this._renderer.addActor(actorX);
      this._renderer.addActor(actorY);

      this._highlightLineX = lineX;
      this._highlightLineY = lineY;
      this._highlightActorX = actorX;
      this._highlightActorY = actorY;
    }

    const baseRadius = Number.isFinite(options.radius)
      ? options.radius
      : Number.isFinite(landmarkRadius)
        ? landmarkRadius
        : Number.isFinite(landmark.radius)
          ? landmark.radius
          : 1;
    const lengthFactor = Number.isFinite(options.lengthFactor)
      ? options.lengthFactor
      : 4;
    const length = Math.max(baseRadius * lengthFactor, 1);

    this._highlightLineX.setPoint1(landmark.x - length, landmark.y, landmark.z);
    this._highlightLineX.setPoint2(landmark.x + length, landmark.y, landmark.z);
    this._highlightLineY.setPoint1(landmark.x, landmark.y - length, landmark.z);
    this._highlightLineY.setPoint2(landmark.x, landmark.y + length, landmark.z);

    this._highlightActorX.setVisibility(true);
    this._highlightActorY.setVisibility(true);
    this._renderWindow.render();
  }

  /**
   * Hide highlighted landmark indicator
   * @param {Boolean} render - Optional render toggle (default true)
   */
  clearHighlightedLandmark(render = true) {
    if (!this._highlightActorX || !this._highlightActorY) {
      return;
    }

    this._highlightActorX.setVisibility(false);
    this._highlightActorY.setVisibility(false);
    if (render && this._renderWindow) {
      this._renderWindow.render();
    }
  }

  /**
   * Get current landmarks state (for debug)
   * @returns {Array} - [{label, x, y, z, color, radius}]
   */
  getLandmarks() {
    if (!this._landmarks) {
      return [];
    }

    const result = [];
    this._landmarks.forEach(({ actor, sphereSource }, label) => {
      const [x, y, z] = sphereSource.getCenter();
      const radius = sphereSource.getRadius();
      const color = actor.getProperty().getColor();
      result.push({ label, x, y, z, color, radius });
    });

    return result;
  }

  /**
   * Update the position of an existing landmark.
   * @param {String} label - The label of the landmark.
   * @param {Array<Number>} position - The new position as [x, y, z].
   */
  updateLandmarkPosition(label, [x, y, z]) {
    const landmark = this._landmarks.get(label);
    if (!landmark) {
      console.warn(`DTK: No landmark found with label ${label} to update.`);
      return;
    }

    const { sphereSource } = landmark;
    sphereSource.setCenter(x, y, z);
    this._renderWindow.render();
  }

  /**
   * Toggle surface visibility on/off
   * @param {String} label - The string that identifies the surface
   * @param {Boolean} toggle
   */
  setSurfaceVisibility(label, toggle) {
    this._surfaces.get(label).setVisibility(toggle);
    this._renderWindow.render();
  }

  /**
   * Update surface buffer
   * TODO maybe there is a more efficient way
   * @param {String} label - The string that identifies the surface
   * @param {ArrayBuffer} buffer
   * @param {String} fileType - Optional file type ('stl' or 'vtp')
   */
  updateSurface(label, buffer, fileType) {
    const actor = this._surfaces.get(label);
    if (!actor) {
      console.warn(`DTK: No surface found with label ${label}`);
      return;
    }

    // Get the current color from the existing actor
    const currentColor = actor.getProperty().getColor();

    const surfaceData = createSurfaceActor(buffer, fileType);
    if (!surfaceData) {
      return; // Error already logged in createSurfaceActor
    }

    const { mapper } = surfaceData;
    actor.setMapper(mapper);
    actor.getProperty().setColor(currentColor);

    this._renderer.resetCamera();
    this._renderWindow.render();
  }

  /**
   * Get vtk LUTs list
   * @returns {Array} - Lut list as array of strings
   */
  getLutList() {
    return vtkColorMaps.rgbPresetNames;
  }

  /**
   * Reset measurement state to default
   * @param {*} measurementState
   */
  resetMeasurementState(state) {
    if (this._measurementState) {
      this._measurementState.p1 = new Array(2);
      this._measurementState.p2 = new Array(2);
      this._measurementState.p3 = new Array(2);
      this._measurementState.p1_world = new Array(2);
      this._measurementState.p2_world = new Array(2);
      this._measurementState.p3_world = new Array(2);
      this._measurementState.label = null;
    } else if (state) {
      state.p1 = new Array(2);
      state.p2 = new Array(2);
      state.p3 = new Array(2);
      state.p1_world = new Array(2);
      state.p2_world = new Array(2);
      state.p3_world = new Array(2);
      state.label = null;
    }
  }

  /**
   * Set active tool
   * ("Length/Angle", {mouseButtonMask:1}, measurementState)
   * @param {*} toolName
   * @param {*} options
   * @param {*} measurementState
   */
  setTool(toolName, options, measurementState) {
    if (this._leftButtonCb) {
      this._leftButtonCb.unsubscribe();
    }

    switch (toolName) {
      case "Length":
        this._initPicker(measurementState, toolName);
        break;
      case "Angle":
        this._initPicker(measurementState, toolName);
        break;
      case "Rotation":
        this.resetMeasurementState(measurementState);
        this._setupInteractor();
        break;
      default:
        console.warn("No tool found for", toolName);
    }
  }

  /**
   * Reset view
   */
  resetView() {
    let center = this._actor.getCenter();
    let camera = this._renderer.getActiveCamera();
    setCamera(camera, center);
    this._renderWindow.render();
  }

  /**
   * on resize callback
   */
  resize() {
    // TODO: debounce for performance reasons?
    this._genericRenderWindow.resize();
  }

  /**
   * Destroy webgl content and release listeners
   */
  destroy() {
    this._element = null;
    this._genericRenderWindow.delete();
    this._genericRenderWindow = null;

    if (this._actor) {
      this._actor.getMapper().delete();
      this._actor.delete();
      this._actor = null;
    }

    if (this._planeActor) {
      this._planeActor.getMapper().delete();
      this._planeActor.delete();
      this._planeActor = null;
    }

    if (this._highlightActorX) {
      this._highlightActorX.getMapper().delete();
      this._highlightActorX.delete();
      this._highlightActorX = null;
    }
    if (this._highlightActorY) {
      this._highlightActorY.getMapper().delete();
      this._highlightActorY.delete();
      this._highlightActorY = null;
    }
    if (this._highlightLineX) {
      this._highlightLineX.delete();
      this._highlightLineX = null;
    }
    if (this._highlightLineY) {
      this._highlightLineY.delete();
      this._highlightLineY = null;
    }

    this._landmarks.forEach(({ actor, sphereSource }) => {
      actor.getMapper().delete();
      actor.delete();
      sphereSource.delete();
    });
    this._landmarks.clear();
    this._landmarks = null;

    if (this._PGwidgetElement) {
      this._PGwidgetElement = null;
      this._PGwidget.getCanvas().remove();
      this._PGwidget.delete();
      this._PGwidget = null;
      this._gaussians = null;
    }

    if (this._cropWidget) {
      this._cropWidget.delete();
      this._cropWidget = null;
    }

    if (this._sliceActor) {
      this._sliceActor.getMapper().delete();
      this._sliceActor.delete();
      this._sliceActor = null;
    }

    if (this._sliceMapper) {
      this._sliceMapper.delete();
      this._sliceMapper = null;
    }

    if (this._reslice) {
      this._reslice.delete();
      this._reslice = null;
    }

    if (this._slicePlane) {
      this._slicePlane.delete();
      this._slicePlane = null;
    }

    if (this._sliceWidget) {
      this._sliceWidget.delete();
      this._sliceWidget = null;
      this._widgetManager.delete();
      this._widgetManager = null;
    }
  }

  // ===========================================================
  // ====== private methods ====================================
  // ===========================================================

  /**
   * Initialize rendering scene
   * @private
   */
  _init() {
    const genericRenderWindow = vtkGenericRenderWindow.newInstance();
    genericRenderWindow.setContainer(this._element);
    genericRenderWindow.setBackground([0, 0, 0]);

    //add custom resize cb
    genericRenderWindow.onResize(() => {
      // bypass genericRenderWindow resize method (do not consider devicePixelRatio)
      // https://kitware.github.io/vtk-js/api/Rendering_Misc_GenericRenderWindow.html
      let size = [
        genericRenderWindow.getContainer().getBoundingClientRect().width,
        genericRenderWindow.getContainer().getBoundingClientRect().height
      ];
      genericRenderWindow.getRenderWindow().getViews()[0].setSize(size);

      if (this.VERBOSE) console.log("resize", size);
    });

    // resize callback
    window.addEventListener("resize", evt => {
      genericRenderWindow.resize();
    });

    genericRenderWindow.resize();

    this._renderer = genericRenderWindow.getRenderer();
    this._renderWindow = genericRenderWindow.getRenderWindow();
    this._genericRenderWindow = genericRenderWindow;
  }

  /**
   * Update the PGwidget after an image has been loaded
   * @private
   */
  _updateWidget() {
    const dataArray = this._actor
      .getMapper()
      .getInputData()
      .getPointData()
      .getScalars();

    this._PGwidget.setDataArray(dataArray.getData());

    let gaussians = this._PGwidget.getGaussians();

    if (gaussians.length > 0) {
      let gaussian = gaussians[0];

      gaussian.position = this._wl;
      gaussian.width = this._ww;

      this._PGwidget.setGaussians([gaussian]);
    } else {
      // TODO initilize in a smarter way
      const default_opacity = 1.0;
      const default_bias = 0.0; // xBias
      const default_skew = 1.8; // yBias
      this._PGwidget.addGaussian(
        this._wl,
        default_opacity,
        this._ww,
        default_bias,
        default_skew
      ); // x, y, ampiezza, sbilanciamento, andamento
    }

    this._PGwidget.applyOpacity(this.ofun);
    this._PGwidget.setColorTransferFunction(this.ctfun);
    this.ctfun.onModified(() => {
      this._PGwidget.render();
      this._renderWindow.render();
    });

    this._PGwidgetLoaded = true;
  }

  /**
   * Binds callbacks to user interactions on PGwidget
   * @private
   */
  _setWidgetCallbacks() {
    this._PGwidget.bindMouseListeners();

    this._PGwidget.onAnimation(start => {
      if (start) {
        this._renderWindow.getInteractor().requestAnimation(this._PGwidget);
      } else {
        this._renderWindow.getInteractor().cancelAnimation(this._PGwidget);
      }
    });

    this._PGwidget.onOpacityChange(widget => {
      this._PGwidget = widget;
      this._gaussians = widget.getGaussians().slice(); // store
      this._PGwidget.applyOpacity(this.ofun);
      if (!this._renderWindow.getInteractor().isAnimating()) {
        this._renderWindow.render();
      }

      if (this._rescaleLUT && this._PGwidget) {
        const range = this._PGwidget.getOpacityRange();
        this.ctfun.setMappingRange(...range);
        this.ctfun.updateRange();
      }
    });
  }

  /**
   * Setup crop widget
   */
  _initCropWidget() {
    let cropWidget = setupCropWidget(this._renderer, this._actor.getMapper());

    this._widgetManager = cropWidget.widgetManager;
    this._cropWidget = cropWidget.widget;

    this._renderWindow.render();
  }

  /**
   * Init interactor
   * @private
   */
  _setupInteractor() {
    // TODO setup from user
    const rotateManipulator =
      vtkMouseCameraTrackballRotateManipulator.newInstance({ button: 1 });
    const panManipulator = vtkMouseCameraTrackballPanManipulator.newInstance({
      button: 3,
      control: true
    });
    const zoomManipulator = vtkMouseCameraTrackballZoomManipulator.newInstance({
      button: 3,
      scrollEnabled: true
    });
    const rangeManipulator = vtkMouseRangeManipulator.newInstance({
      button: 1,
      shift: true
    });

    let self = this;

    function getWL() {
      return self._wl;
    }

    function getWW() {
      return self._ww;
    }

    function setWL(v) {
      self._wl = self._wl + (v - self._wl) / 25; // 25 is a tweaking parameter
      let gaussians = self._PGwidget.getGaussians().slice(); // NOTE: slice() to clone!
      gaussians[0].position = self._wl; //TODO: foreach
      self._PGwidget.setGaussians(gaussians);
    }

    function setWW(v) {
      self._ww = self._ww + (v - self._ww) / 5; // 5 is a tweaking parameter
      let gaussians = self._PGwidget.getGaussians().slice(); // NOTE: slice() to clone!
      gaussians[0].width = self._ww; //TODO: foreach
      self._PGwidget.setGaussians(gaussians);
    }

    rangeManipulator.setVerticalListener(-1, 1, 0.001, getWL, setWL);
    rangeManipulator.setHorizontalListener(0.1, 2.1, 0.001, getWW, setWW);

    const interactorStyle = vtkInteractorStyleManipulator.newInstance();
    interactorStyle.addMouseManipulator(rangeManipulator);
    interactorStyle.addMouseManipulator(rotateManipulator);
    interactorStyle.addMouseManipulator(panManipulator);
    interactorStyle.addMouseManipulator(zoomManipulator);
    interactorStyle.setCenterOfRotation(this._actor.getCenter());
    this._renderWindow.getInteractor().setInteractorStyle(interactorStyle);

    // clear measurements on interactions
    this._renderWindow
      .getInteractor()
      .onMouseWheel(() => this.resetMeasurementState());
    this._renderWindow
      .getInteractor()
      .onRightButtonPress(() => this.resetMeasurementState());
  }

  /**
   * Register a callback for picking on a list of actors.
   * The callback will receive an object with { worldPosition, displayPosition, actorLabel }
   * @param {Function} callback - The function to call on pick.
   * @param {Array<String>} targetLabels - A list of actor labels to pick from.
   */
  turnPickingOn(callback, targetLabels) {
    this.turnPickingOff(); // Remove any existing pick listener

    const targetActors = new Map();
    targetLabels.forEach(label => {
      if (this._surfaces.has(label)) {
        targetActors.set(this._surfaces.get(label), label);
      } else if (this._landmarks.has(label)) {
        targetActors.set(this._landmarks.get(label).actor, label);
      } else {
        console.warn(`DTK: No actor found with label ${label} for picking.`);
      }
    });

    if (targetActors.size === 0) {
      console.warn("DTK: onPick called with no valid target labels.");
      return;
    }

    const picker = vtkPointPicker.newInstance();
    picker.setPickFromList(1);
    picker.initializePickList();
    targetActors.forEach((label, actor) => picker.addPickList(actor));

    this._pickCb = this._renderWindow
      .getInteractor()
      .onLeftButtonPress(callData => {
        if (this._renderer !== callData.pokedRenderer) {
          return;
        }

        const pos = callData.position;
        const point = [pos.x, pos.y, 0.0];
        picker.pick(point, this._renderer);

        if (picker.getActors().length > 0) {
          const pickedActor = picker.getActors()[0];
          if (targetActors.has(pickedActor)) {
            const closestPointId = picker.getPointId();
            if (closestPointId >= 0) {
              const worldPosition = pickedActor.getMapper().getInputData()
                .getPoints()
                .getPoint(closestPointId);
              const displayPosition = point.slice(0, 2);
              const actorLabel = targetActors.get(pickedActor);

              callback({ worldPosition, displayPosition, actorLabel });
            }
          }
        }
      });
  }

  /**
   * Unregister the picking callback.
   */
  turnPickingOff() {
    if (this._pickCb) {
      this._pickCb.unsubscribe();
      this._pickCb = null;
    }
  }

  /**
   * Toggle picking with stored or provided options
   * @param {Boolean} enabled
   * @param {Object} options
   * @param {Function} options.onPick
   * @param {Array<String>} options.labels
   * @param {Boolean} options.preserveCallback - Keep previous callback when updating labels
   * labels null/[] means "all pickable actors"
   */
  setPickingEnabled(enabled, options = {}) {
    const shouldEnable = Boolean(enabled);
    if (shouldEnable) {
      const hasLabels =
        Object.prototype.hasOwnProperty.call(options, "labels") ||
        Object.prototype.hasOwnProperty.call(options, "targetLabels");

      const preserveCallback = Boolean(options.preserveCallback);
      // Backwards compatibility with { callback, targetLabels }.
      const onPick =
        typeof options.onPick === "function"
          ? options.onPick
          : typeof options.callback === "function"
            ? options.callback
            : null;
      // If preserveCallback is true, prefer the previously registered callback.
      const nextOnPick =
        preserveCallback && this._pickOptions
          ? this._pickOptions.onPick
          : onPick || (this._pickOptions ? this._pickOptions.onPick : null);

      let nextLabels;
      if (hasLabels) {
        nextLabels =
          options.labels !== undefined ? options.labels : options.targetLabels;
      } else if (this._pickOptions) {
        nextLabels = this._pickOptions.labels;
      } else {
        nextLabels = null;
      }

      if (typeof nextOnPick !== "function") {
        console.warn(
          "DTK: setPickingEnabled(true) requires { onPick, labels } (or preserveCallback)."
        );
        this.turnPickingOff();
        this._pickingEnabled = false;
        return;
      }

      let targetLabels;
      if (nextLabels == null) {
        targetLabels = this._getPickableLabels();
      } else if (Array.isArray(nextLabels)) {
        targetLabels =
          nextLabels.length === 0 ? this._getPickableLabels() : nextLabels;
      } else {
        console.warn(
          "DTK: setPickingEnabled(true) expects labels as an array (or null for all)."
        );
        this.turnPickingOff();
        this._pickingEnabled = false;
        return;
      }

      if (targetLabels.length === 0) {
        console.warn("DTK: No pickable actors found.");
        this.turnPickingOff();
        this._pickingEnabled = false;
        return;
      }

      // Re-register to rebuild the pick list (callback preserved if requested).
      this._pickOptions = { onPick: nextOnPick, labels: nextLabels };
      this.turnPickingOn(nextOnPick, targetLabels);
      this._pickingEnabled = Boolean(this._pickCb);
      return;
    }

    this.turnPickingOff();
    this._pickingEnabled = false;
  }

  /**
   * Collect labels for all pickable actors (surfaces + landmarks)
   * @private
   */
  _getPickableLabels() {
    const labels = [];
    if (this._surfaces) {
      this._surfaces.forEach((_, label) => labels.push(label));
    }
    if (this._landmarks) {
      this._landmarks.forEach((_, label) => labels.push(label));
    }
    return labels;
  }

  /**
   * initPicker
   */
  _initPicker(state, mode) {
    // no blur when measure
    this.blurOnInteraction = false;

    // de-activate rotation
    let rotateManipulator = this._renderWindow
      .getInteractor()
      .getInteractorStyle()
      .getMouseManipulators()
      .filter(i => {
        return i.getClassName() == "vtkMouseCameraTrackballRotateManipulator";
      })
      .pop();
    this._renderWindow
      .getInteractor()
      .getInteractorStyle()
      .removeMouseManipulator(rotateManipulator);

    // Setup picking interaction
    // TODO this is slow the first time we pick, maybe we could use cellPicker and decrease resolution
    const picker = vtkPointPicker.newInstance();
    picker.setPickFromList(1);
    picker.initializePickList();

    if (!this._pickingPlane) {
      // add a 1000x1000 plane
      let camera = this._renderer.getActiveCamera();
      let { plane, planeActor } = setupPickingPlane(camera, this._actor);
      this._renderer.addActor(planeActor);
      this._pickingPlane = plane;
      this._planeActor = planeActor;
    }

    // add picking plane to pick list
    picker.addPickList(this._planeActor);

    // Pick on mouse left click
    this._leftButtonCb = this._renderWindow
      .getInteractor()
      .onLeftButtonPress(callData => {
        if (this._renderer !== callData.pokedRenderer) {
          return;
        }

        const pos = callData.position;
        const point = [pos.x, pos.y, 0.0];
        picker.pick(point, this._renderer);

        if (picker.getActors().length === 0) {
          const pickedPoint = picker.getPickPosition();
          if (this.VERBOSE)
            console.log(`No point picked, default: ${pickedPoint}`);
          // addSphereInPoint(pickedPoint, this._renderer);
        } else {
          const pickedPoints = picker.getPickedPositions();
          const pickedPoint = pickedPoints[0]; // always a single point on a plane
          if (this.VERBOSE) console.log(`Picked: ${pickedPoint}`);
          // addSphereInPoint(pickedPoint, this._renderer);

          // canvas coord
          const wPos = vtkCoordinate.newInstance();
          wPos.setCoordinateSystemToWorld();
          wPos.setValue(...pickedPoint);
          const displayPosition = wPos.getComputedDisplayValue(this._renderer);

          // apply changes on state based on active tool
          applyStrategy(state, displayPosition, pickedPoint, mode);

          if (this.VERBOSE) console.log(state);
          this._measurementState = state;
        }

        this._renderWindow.render();
      });
  }

  /**
   * Initialize slice plane
   * @private
   */
  _initSlicePlane() {
    this._slicePlane = vtkPlane.newInstance();
    this._slicePlane.setNormal(0, 0, 1);

    this._reslice = vtkImageReslice.newInstance();
    this._reslice.setTransformInputSampling(false);
    this._reslice.setAutoCropOutput(true);
    this._reslice.setOutputDimensionality(2);

    this._sliceMapper = vtkImageMapper.newInstance();
    this._sliceMapper.setInputConnection(this._reslice.getOutputPort());

    this._sliceActor = vtkImageSlice.newInstance();
    this._sliceActor.setMapper(this._sliceMapper);

    this._sliceProperty = vtkImageProperty.newInstance();
    this._sliceProperty.setInterpolationType(InterpolationType.LINEAR);
    this._sliceActor.setProperty(this._sliceProperty);

    this._renderer.addActor(this._sliceActor);
    this._sliceActor.setVisibility(false);

    if (this._actor) {
      this._reslice.setInputData(this._actor.getMapper().getInputData());
      this._slicePlane.setOrigin(this._actor.getCenter());
      this._updateResliceAxes();
    }
  }

  /**
   * Update reslice axes based on plane origin and normal
   * @private
   */
  _updateResliceAxes() {
    if (!this._reslice || !this._slicePlane) return;

    const origin = this._slicePlane.getOrigin();
    const normal = this._slicePlane.getNormal();

    // Create orthonormal basis
    const z = [...normal];
    normalize(z);

    const x = [0, 0, 0];
    const y = [0, 0, 0];

    // Find a vector not parallel to z
    const tempX = [1, 0, 0];
    if (Math.abs(dot(z, tempX)) > 0.9) {
      tempX[0] = 0;
      tempX[1] = 1;
      tempX[2] = 0;
    }

    cross(z, tempX, y);
    normalize(y);
    cross(y, z, x);
    normalize(x);

    const axes = [
      x[0], x[1], x[2], 0,
      y[0], y[1], y[2], 0,
      z[0], z[1], z[2], 0,
      origin[0], origin[1], origin[2], 1
    ];

    this._reslice.setResliceAxes(axes);

    if (this._sliceActor) {
      this._sliceActor.setUserMatrix(axes);
    }
  }

  /**
   * Initialize slice widget
   * @private
   */
  _initSliceWidget() {
    this._widgetManager = vtkWidgetManager.newInstance();
    this._widgetManager.setRenderer(this._renderer);

    this._sliceWidget = vtkImplicitPlaneWidget.newInstance();
    this._sliceWidgetInstance = this._widgetManager.addWidget(this._sliceWidget);

    const planeState = this._sliceWidget.getWidgetState();
    planeState.setOrigin(this._slicePlane.getOrigin());
    planeState.setNormal(this._slicePlane.getNormal());

    planeState.onModified(() => {
      this._slicePlane.setOrigin(planeState.getOrigin());
      this._slicePlane.setNormal(planeState.getNormal());
      this._updateResliceAxes();
      this._renderWindow.render();
    });

    this._sliceWidget.setHandleVisibility(false);
    this._sliceWidget.setContextVisibility(false);
  }
}

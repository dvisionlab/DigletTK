import vtkGenericRenderWindow from "vtk.js/Sources/Rendering/Misc/GenericRenderWindow";
import vtkColorTransferFunction from "vtk.js/Sources/Rendering/Core/ColorTransferFunction";
import vtkPiecewiseFunction from "vtk.js/Sources/Common/DataModel/PiecewiseFunction";
import vtkImageCroppingWidget from "vtk.js/Sources/Widgets/Widgets3D/ImageCroppingWidget";
import vtkImageCropFilter from "vtk.js/Sources/Filters/General/ImageCropFilter";
import vtkWidgetManager from "vtk.js/Sources/Widgets/Core/WidgetManager";
import vtkColorMaps from "vtk.js/Sources/Rendering/Core/ColorTransferFunction/ColorMaps";
import vtkPiecewiseGaussianWidget from "vtk.js/Sources/Interaction/Widgets/PiecewiseGaussianWidget";

import vtkMouseCameraTrackballRotateManipulator from "vtk.js/Sources/Interaction/Manipulators/MouseCameraTrackballRotateManipulator";
import vtkMouseCameraTrackballPanManipulator from "vtk.js/Sources/Interaction/Manipulators/MouseCameraTrackballPanManipulator";
import vtkMouseCameraTrackballZoomManipulator from "vtk.js/Sources/Interaction/Manipulators/MouseCameraTrackballZoomManipulator";
import vtkMouseRangeManipulator from "vtk.js/Sources/Interaction/Manipulators/MouseRangeManipulator";
import vtkInteractorStyleManipulator from "vtk.js/Sources/Interaction/Style/InteractorStyleManipulator";

import { getVolumeCenter, createVolumeActor } from "./utils";

/** A class representing a Volume Rendering scene */
export class VRView {
  /**
   * Create a volume rendering scene
   * @param {HTMLElement} element - the target html element to render the scene
   */
  constructor(element) {
    this.element = element;
    this.renderer = null;
    this.renderWindow = null;
    this._genericRenderWindow = null;
    this.actor = null;
    this._raysDistance = 2.5;
    this._blurOnInteraction = null;
    this._rescaleLUT = false; // cannot initialize true (must set lut before)

    // piecewise gaussian widget stuff
    this.PGwidgetElement = null;
    this.PGwidget = null;
    this.gaussians = null;
    this._PGwidgetLoaded = false;

    // normalized ww wl
    this.ww = 0.25;
    this.wl = 0.3;

    // absolute ww wl
    this.wwwl = [0, 0];

    this.initVR();
    window.vr = this;
    window.vtkColorMaps = vtkColorMaps;
  }

  /**
   * wwwl
   * @type {Array}
   */
  set wwwl(value) {
    if (!this.actor) {
      return;
    }

    const dataArray = this.actor
      .getMapper()
      .getInputData()
      .getPointData()
      .getScalars();

    const range = dataArray.getRange();
    let rel_ww = value[0] / (range[1] - range[0]);
    let rel_wl = (value[1] - range[0]) / range[1];

    this.wl = rel_wl;
    this.ww = rel_ww;

    if (this.PGwidget) {
      this.updateWidget();
    }
  }

  get wwwl() {
    const dataArray = this.actor
      .getMapper()
      .getInputData()
      .getPointData()
      .getScalars();

    const range = dataArray.getRange();

    let abs_ww = rel_ww * (range[1] - range[0]);
    let abs_wl = rel_wl * range[1] + range[0];
    return [abs_ww, abs_wl];
  }

  /**
   * raysDistance
   * @type {Number}
   */
  set resolution(value) {
    this._raysDistance = 5 / value;
    this.actor.getMapper().setSampleDistance(this._raysDistance);
    this.renderWindow.render();
  }

  get resolution() {
    return Math.round(this._raysDistance * 5);
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
    this.PGwidgetElement = element;
    let h = element.offsetHeight ? element.offsetHeight - 5 : 100;
    let w = element.offsetWidth ? element.offsetWidth - 5 : 300;
    this.PGwidget.setSize(w, h);
    this.PGwidget.setContainer(this.PGwidgetElement);
    this.PGwidget.render();
  }

  /**
   * Flag to set lut rescaling on opacity range
   * @type {bool}
   */
  set rescaleLUT(bool) {
    this._rescaleLUT = bool;
    let range;
    if (this._rescaleLUT && this.PGwidget) {
      range = this.PGwidget.getOpacityRange();
    } else {
      range = this.actor
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
   * Initialize rendering scene
   * @private
   */
  initVR() {
    const genericRenderWindow = vtkGenericRenderWindow.newInstance();
    genericRenderWindow.setContainer(this.element);
    genericRenderWindow.setBackground([0, 0, 0]);
    genericRenderWindow.resize();

    this.renderer = genericRenderWindow.getRenderer();
    this.renderWindow = genericRenderWindow.getRenderWindow();
    this._genericRenderWindow = genericRenderWindow;

    this.addPGwidget();
  }

  /**
   * Set the image to be rendered
   * @param {ArrayBuffer} image - The image content data as buffer array
   */
  setImage(image) {
    // clean scene
    this.renderer.removeAllVolumes();

    let actor = createVolumeActor(image);

    this.actor = actor;

    this.lut = "Grayscale";

    this.renderer.addVolume(actor);

    this.setCamera(actor.getCenter());

    if (this.PGwidget) {
      this.updateWidget();
      this.setWidgetCallbacks();
    }

    // TODO implement a strategy to set rays distance
    // TODO interactors switching (ex. blurring or wwwl or crop)

    this.setupWwwlInteractor();

    this.blurOnInteraction = true;

    this.renderer.resetCamera();
    this.renderWindow.render();
  }

  /**
   * Set camera lookat point
   * @param {Array} center - As [x,y,z]
   */
  setCamera(center) {
    this.renderer.resetCamera();
    this.renderer.getActiveCamera().zoom(1.5);
    this.renderer.getActiveCamera().elevation(70);
    this.renderer.getActiveCamera().setViewUp(0, 0, 1);
    this.renderer
      .getActiveCamera()
      .setFocalPoint(center[0], center[1], center[2]);
    this.renderer
      .getActiveCamera()
      .setPosition(center[0], center[1] - 2000, center[2]);
    this.renderer.getActiveCamera().setThickness(10000);
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
      range = this.PGwidget.getOpacityRange();
    } else {
      range = this.actor
        .getMapper()
        .getInputData()
        .getPointData()
        .getScalars()
        .getRange();
    }

    lookupTable.setMappingRange(...range);
    lookupTable.updateRange();

    this.actor.getProperty().setRGBTransferFunction(0, lookupTable);

    // set up opacity function (values will be set by PGwidget)
    const piecewiseFun = vtkPiecewiseFunction.newInstance();
    this.actor.getProperty().setScalarOpacity(0, piecewiseFun);

    this.ctfun = lookupTable;
    this.ofun = piecewiseFun;

    this.updateWidget();
  }

  /**
   * Get vtk LUTs list
   * @returns {Array} - Lut list as array of strings
   */
  getLutList() {
    return vtkColorMaps.rgbPresetNames;
  }

  /**
   * Set actor appearance properties
   * TODO
   */
  setActorProperties() {
    // this.actor.getProperty().setRGBTransferFunction(0, lutFuncs.ctfun);
    // this.actor.getProperty().setScalarOpacity(0, lutFuncs.ofun);
    this.actor.getProperty().setScalarOpacityUnitDistance(0, 30.0);
    this.actor.getProperty().setInterpolationTypeToLinear();
    this.actor.getProperty().setUseGradientOpacity(0, true);
    this.actor.getProperty().setGradientOpacityMinimumValue(0, 2);
    this.actor.getProperty().setGradientOpacityMinimumOpacity(0, 0.0);
    this.actor.getProperty().setGradientOpacityMaximumValue(0, 20);
    this.actor.getProperty().setGradientOpacityMaximumOpacity(0, 2.0); // mod
    this.actor.getProperty().setShade(true);
    this.actor.getProperty().setAmbient(state.ambient);
    this.actor.getProperty().setDiffuse(state.diffuse);
    this.actor.getProperty().setSpecular(state.specular);
    this.actor.getProperty().setSpecularPower(state.specularPower);
  }

  setCropWidget() {
    // --- setup our widget manager and widget ---

    const widgetManager = vtkWidgetManager.newInstance();
    widgetManager.setUseSvgLayer(false);
    widgetManager.setRenderer(this.renderer);

    // this is a widget factory
    const widget = vtkImageCroppingWidget.newInstance();
    // this is an instance of a widget associated with a renderer
    const viewWidget = widgetManager.addWidget(widget);

    // --- set up crop filter

    const cropFilter = vtkImageCropFilter.newInstance();
    // we listen to cropping widget state to inform the crop filter
    const cropState = widget.getWidgetState().getCroppingPlanes();
    cropState.onModified(() => {
      cropFilter.setCroppingPlanes(cropState.getPlanes());
    });

    // wire up the reader, crop filter, and mapper
    let mapper = this.actor.getMapper();
    let image = mapper.getInputData();
    cropFilter.setCroppingPlanes(...image.getExtent());
    widget.copyImageDataDescription(image);

    // other handles does not work in vtk.js 17.5.0 (use 16.14.0 ?)
    // https://kitware.github.io/vtk-js/examples/ImageCroppingWidget.html
    widget.set({
      faceHandlesEnabled: false,
      edgeHandlesEnabled: false,
      cornerHandlesEnabled: true
    });

    cropFilter.setInputData(image);
    mapper.setInputConnection(cropFilter.getOutputPort());

    // --- Enable interactive picking of widgets ---
    widgetManager.enablePicking();
    this.renderWindow.render();
  }

  /**
   * Append a vtkPiecewiseGaussianWidget into the target element
   * @private
   * @param {HTMLElement} widgetContainer - The target element to place the widget
   */
  addPGwidget() {
    let containerWidth = this.PGwidgetElement
      ? this.PGwidgetElement.offsetWidth - 5
      : 300;
    let containerHeight = this.PGwidgetElement
      ? this.PGwidgetElement.offsetHeight - 5
      : 100;

    const PGwidget = vtkPiecewiseGaussianWidget.newInstance({
      numberOfBins: 256,
      size: [containerWidth, containerHeight]
    });
    // TODO expose style
    PGwidget.updateStyle({
      backgroundColor: "rgba(255, 255, 255, 0.6)",
      histogramColor: "rgba(50, 50, 50, 0.8)",
      strokeColor: "rgb(0, 0, 0)",
      activeColor: "rgb(255, 255, 255)",
      handleColor: "rgb(50, 150, 50)",
      buttonDisableFillColor: "rgba(255, 255, 255, 0.5)",
      buttonDisableStrokeColor: "rgba(0, 0, 0, 0.5)",
      buttonStrokeColor: "rgba(0, 0, 0, 1)",
      buttonFillColor: "rgba(255, 255, 255, 1)",
      strokeWidth: 1,
      activeStrokeWidth: 1.5,
      buttonStrokeWidth: 1,
      handleWidth: 1,
      iconSize: 0, // Can be 0 if you want to remove buttons (dblClick for (+) / rightClick for (-))
      padding: 1
    });

    // to hide widget
    PGwidget.setContainer(this.PGwidgetElement); // Set to null to hide

    // resize callback
    window.addEventListener("resize", evt => {
      PGwidget.setSize(
        widgetContainer.offsetWidth - 5,
        widgetContainer.offsetHeight - 5
      );
      PGwidget.render();
    });

    this.PGwidget = PGwidget;
  }

  /**
   * Update the PGwidget after an image has been loaded
   * @private
   */
  updateWidget() {
    const dataArray = this.actor
      .getMapper()
      .getInputData()
      .getPointData()
      .getScalars();

    this.PGwidget.setDataArray(dataArray.getData());

    let gaussians = this.PGwidget.getGaussians();

    if (gaussians.length > 0) {
      let gaussian = gaussians[0];

      gaussian.position = this.wl;
      gaussian.width = this.ww;

      this.PGwidget.setGaussians([gaussian]);
    } else {
      // TODO initilize in a smarter way
      const default_opacity = 1.0;
      const default_skew = 0.0;
      const default_bias = 0.0;
      this.PGwidget.addGaussian(
        this.wl,
        default_opacity,
        this.ww,
        default_bias,
        default_skew
      ); // x, y, ampiezza, sbilanciamento, andamento
    }

    this.PGwidget.applyOpacity(this.ofun);
    this.PGwidget.setColorTransferFunction(this.ctfun);
    this.ctfun.onModified(() => {
      this.PGwidget.render();
      this.renderWindow.render();
    });

    this._PGwidgetLoaded = true;
  }

  /**
   * Binds callbacks to user interactions on PGwidget
   * @private
   */
  setWidgetCallbacks() {
    this.PGwidget.bindMouseListeners();

    this.PGwidget.onAnimation(start => {
      if (start) {
        this.renderWindow.getInteractor().requestAnimation(this.PGwidget);
      } else {
        this.renderWindow.getInteractor().cancelAnimation(this.PGwidget);
      }
    });

    this.PGwidget.onOpacityChange(widget => {
      this.PGwidget = widget;
      this.gaussians = widget.getGaussians().slice(); // store
      this.PGwidget.applyOpacity(this.ofun);
      if (!this.renderWindow.getInteractor().isAnimating()) {
        this.renderWindow.render();
      }

      if (this._rescaleLUT && this.PGwidget) {
        const range = this.PGwidget.getOpacityRange();
        this.ctfun.setMappingRange(...range);
        this.ctfun.updateRange();
      }
    });
  }

  setSampleDistance(distance) {
    this.actor.getMapper().setSampleDistance(distance);
  }

  /**
   * Toggle blurring on interaction (Increase performance)
   * @type {bool} toggle - if true, blur on interaction
   */
  set blurOnInteraction(toggle) {
    this._blurOnInteraction = toggle;
    let interactor = this.renderWindow.getInteractor();
    let mapper = this.actor.getMapper();

    if (toggle) {
      interactor.onLeftButtonPress(() => {
        mapper.setSampleDistance(this._raysDistance * 5);
      });

      interactor.onLeftButtonRelease(() => {
        mapper.setSampleDistance(this._raysDistance);
        this.renderWindow.render();
      });
    } else {
      interactor.onLeftButtonPress(() => {
        mapper.setSampleDistance(this._raysDistance);
      });

      interactor.onLeftButtonRelease(() => {
        mapper.setSampleDistance(this._raysDistance);
      });
    }
  }

  /**
   * Init wwwl interactor
   * @private
   * LEFT DRAG : rotate
   * CTRL: pan
   * SCROLL: zoom
   * SHIFT + LEFT DRAG : wwwl
   */
  setupWwwlInteractor() {
    // TODO setup from user
    const rotateManipulator = vtkMouseCameraTrackballRotateManipulator.newInstance(
      { button: 1 }
    );
    const panManipulator = vtkMouseCameraTrackballPanManipulator.newInstance(
      { button: 1, control: true } // on ctrl press
    );
    const zoomManipulator = vtkMouseCameraTrackballZoomManipulator.newInstance(
      { scrollEnabled: true } // on scroll
    );
    const rangeManipulator = vtkMouseRangeManipulator.newInstance(
      { button: 1, shift: true } // on shift press
    );

    let self = this;

    function getWL() {
      return self.wl;
    }

    function getWW() {
      return self.ww;
    }

    function setWL(v) {
      let wl = self.wl + (v - self.wl) / 25;
      self.wl = wl;

      let gaussians = self.PGwidget.getGaussians().slice(); // NOTE: slice() to clone!
      gaussians[0].position = self.wl; //TODO: foreach
      self.PGwidget.setGaussians(gaussians);
    }

    function setWW(v) {
      let ww = self.ww + (v - self.ww) / 5;
      self.ww = ww;

      let gaussians = self.PGwidget.getGaussians().slice(); // NOTE: slice() to clone!
      gaussians[0].width = self.ww; //TODO: foreach
      self.PGwidget.setGaussians(gaussians);
    }

    rangeManipulator.setVerticalListener(-1, 1, 0.001, getWL, setWL);
    rangeManipulator.setHorizontalListener(0.1, 2.1, 0.001, getWW, setWW);

    const interactorStyle = vtkInteractorStyleManipulator.newInstance();
    interactorStyle.addMouseManipulator(rangeManipulator);
    interactorStyle.addMouseManipulator(rotateManipulator);
    interactorStyle.addMouseManipulator(panManipulator);
    interactorStyle.addMouseManipulator(zoomManipulator);
    interactorStyle.setCenterOfRotation(this.actor.getCenter());
    this.renderWindow.getInteractor().setInteractorStyle(interactorStyle);
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
    this.renderWindow.delete();
  }
}

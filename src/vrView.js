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

export class VRView {
  /**
   * Create a volume rendering scene
   */
  constructor(element) {
    this.element = element;
    this.renderer = null;
    this.renderWindow = null;
    this.actor = null;
    this.raysDistance = 1.5; // TODO set/get

    // piecewise gaussian widget stuff
    this.PGwidget = null;
    this.gaussians = null;

    this.ww = 0;
    this.wl = 0;

    this.initVR();

    window.vr = this;
  }

  initVR() {
    const genericRenderWindow = vtkGenericRenderWindow.newInstance();
    genericRenderWindow.setContainer(this.element);
    genericRenderWindow.setBackground([0, 0, 0]);
    genericRenderWindow.resize();

    this.renderer = genericRenderWindow.getRenderer();
    this.renderWindow = genericRenderWindow.getRenderWindow();
    this.genericRenderWindow = genericRenderWindow;
  }

  /**
   * Set the image to be rendered
   * @param {ArrayBuffer} image - The image content data as buffer array
   */
  setImage(image) {
    // TODO remove all volumes
    console.log(image);
    let actor = createVolumeActor(image);

    this.actor = actor;

    this.addLUT(actor);

    this.renderer.addVolume(actor);

    this.setCamera(actor.getCenter());

    this.updateWidget();
    this.setWidgetCallbacks();
    // TODO
    // - implement a strategy to set rays distance
    // - setup interactors (ex. blurring or wwwl or crop)
    // this.setupInteractor();

    this.blurOnInteraction(true);

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

  addLUT(actor) {
    // --- set up our color lookup table and opacity piecewise function

    const lookupTable = vtkColorTransferFunction.newInstance();
    const piecewiseFun = vtkPiecewiseFunction.newInstance();

    // set up color transfer function
    lookupTable.applyColorMap(vtkColorMaps.getPresetByName("Cool to Warm"));

    // set up simple linear opacity function
    // This assumes a data range of 0 -> 256
    for (let i = 0; i <= 8; i++) {
      piecewiseFun.addPoint(i * 32, i / 8);
    }

    // update lookup table mapping range based on input dataset

    const range = actor
      .getMapper()
      .getInputData()
      .getPointData()
      .getScalars()
      .getRange();

    // TODO generalize: remapping to max/min hist (as bool)
    range[1] -= 2500;
    lookupTable.setMappingRange(...range);
    lookupTable.updateRange();

    // set the actor properties
    actor.getProperty().setRGBTransferFunction(0, lookupTable);
    actor.getProperty().setScalarOpacity(0, piecewiseFun);

    this.ctfun = lookupTable;
    this.ofun = piecewiseFun;
  }

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
   * @param {HTMLElement} widgetContainer - The target element to place the widget
   */
  addPGwidget(widgetContainer) {
    const PGwidget = vtkPiecewiseGaussianWidget.newInstance({
      numberOfBins: 256,
      size: [widgetContainer.offsetWidth - 5, widgetContainer.offsetHeight - 5]
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
    PGwidget.setContainer(widgetContainer); // Set to null to hide

    // resize callback
    window.addEventListener("resize", evt => {
      PGwidget.setSize(
        widgetContainer.offsetWidth - 5,
        widgetContainer.offsetHeight - 5
      );
      PGwidget.render();
    });

    this.PGwidget = PGwidget;

    console.log(this.PGwidget);
  }

  /**
   * Update the PGwidget after an image has been loaded
   * @private
   */
  updateWidget() {
    this.PGwidget.setDataArray(
      this.actor
        .getMapper()
        .getInputData()
        .getPointData()
        .getScalars()
        .getData()
    );

    // TODO initilize in a smarter way
    this.PGwidget.addGaussian(0.33, 0.7, 0.3, -0.02, -0.1); // x, y, ampiezza, sbilanciamento, andamento
    this.PGwidget.applyOpacity(this.ofun);
    this.PGwidget.setColorTransferFunction(this.ctfun);
    this.ctfun.onModified(() => {
      this.PGwidget.render();
      this.renderWindow.render();
    });
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
    });
  }

  setSampleDistance(distance) {
    this.actor.getMapper().setSampleDistance(distance);
  }

  /**
   * Toggle blurring on interaction (Increase performance)
   * @param {bool} toggle - if true, blur on interaction
   */
  blurOnInteraction(toggle) {
    let interactor = this.renderWindow.getInteractor();
    let mapper = this.actor.getMapper();

    if (toggle) {
      interactor.onLeftButtonPress(() => {
        mapper.setSampleDistance(this.raysDistance * 5);
      });

      interactor.onLeftButtonRelease(() => {
        mapper.setSampleDistance(this.raysDistance);
        this.renderWindow.render();
      });
    } else {
      interactor.onLeftButtonPress(() => {
        mapper.setSampleDistance(this.raysDistance);
      });

      interactor.onLeftButtonRelease(() => {
        mapper.setSampleDistance(this.raysDistance);
      });
    }
  }

  /**
   * Init wwwl interactor
   * LEFT DRAG : rotate
   * CTRL: pan
   * SCROLL: zoom
   * SHIFT + LEFT DRAG : wwwl
   */
  setupInteractor() {
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

      // TODO update widget
      // let gaussians = self.PGwidget.getGaussians().slice(); // NOTE: slice() to clone!
      // gaussians[0].position = wl + self.wl; //TODO:foreach
      // self.PGwidget.setGaussians(gaussians);
    }

    function setWW(v) {
      let ww = self.ww + (v - self.ww) / 5;

      self.ww = ww;

      // TODO update widget
      // let gaussians = self.PGwidget.getGaussians().slice(); // NOTE: slice() to clone!
      // gaussians[0].width = ww * self.ww; //TODO foreach
      // self.PGwidget.setGaussians(gaussians);
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
   * Destroy webgl content and release listeners
   */
  destroy() {
    this.renderWindow.delete();
  }
}

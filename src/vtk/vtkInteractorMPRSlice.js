/**
 * Based on the vtk.js's MPR Slice interactor Style, but with improvements.
 */

// Temporarily using a modified version of this interactor to deal with a camera subscription issue
import macro from "@kitware/vtk.js/macro";
import vtkMath from "@kitware/vtk.js/Common/Core/Math";
import vtkMatrixBuilder from "@kitware/vtk.js/Common/Core/MatrixBuilder";
import vtkInteractorStyleManipulator from "@kitware/vtk.js/Interaction/Style/InteractorStyleManipulator";
import vtkMouseCameraTrackballRotateManipulator from "@kitware/vtk.js/Interaction/Manipulators/MouseCameraTrackballRotateManipulator";
import vtkMouseCameraTrackballPanManipulator from "@kitware/vtk.js/Interaction/Manipulators/MouseCameraTrackballPanManipulator";
import vtkMouseCameraTrackballZoomManipulator from "@kitware/vtk.js/Interaction/Manipulators/MouseCameraTrackballZoomManipulator";
import vtkMouseRangeManipulator from "@kitware/vtk.js/Interaction/Manipulators/MouseRangeManipulator";

// ----------------------------------------------------------------------------
// Global methods
// ----------------------------------------------------------------------------

function boundsToCorners(bounds) {
  return [
    [bounds[0], bounds[2], bounds[4]],
    [bounds[0], bounds[2], bounds[5]],
    [bounds[0], bounds[3], bounds[4]],
    [bounds[0], bounds[3], bounds[5]],
    [bounds[1], bounds[2], bounds[4]],
    [bounds[1], bounds[2], bounds[5]],
    [bounds[1], bounds[3], bounds[4]],
    [bounds[1], bounds[3], bounds[5]]
  ];
}

// ----------------------------------------------------------------------------

function clamp(value, min, max) {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

// ----------------------------------------------------------------------------
// vtkInteractorStyleMPRSlice methods
// ----------------------------------------------------------------------------

function vtkInteractorStyleMPRSlice(publicAPI, model) {
  // Set our className
  model.classHierarchy.push("vtkInteractorStyleMPRSlice");

  model.trackballManipulator =
    vtkMouseCameraTrackballRotateManipulator.newInstance({
      button: 1
    });
  model.panManipulator = vtkMouseCameraTrackballPanManipulator.newInstance({
    button: 1,
    shift: true
  });
  model.zoomManipulator = vtkMouseCameraTrackballZoomManipulator.newInstance({
    button: 3
  });

  model.scrollManipulator = vtkMouseRangeManipulator.newInstance({
    scrollEnabled: true,
    dragEnabled: false
  });

  // cache for sliceRange
  const cache = {
    sliceNormal: [0, 0, 0],
    sliceRange: [0, 0],
    slicePosition: [0, 0, 0]
  };

  function updateScrollManipulator() {
    const range = publicAPI.getSliceRange();
    // console.log("updating the manipulator", range);
    model.scrollManipulator.removeScrollListener();
    // The Scroll listener has min, max, step, and getValue setValue as params.
    // Internally, it checks that the result of the GET has changed, and only calls SET if it is new.
    model.scrollManipulator.setScrollListener(
      range[0],
      range[1],
      1,
      publicAPI.getSlice,
      publicAPI.setSlice
    );
  }

  function setManipulators() {
    publicAPI.removeAllMouseManipulators();
    publicAPI.addMouseManipulator(model.trackballManipulator);
    publicAPI.addMouseManipulator(model.panManipulator);
    publicAPI.addMouseManipulator(model.zoomManipulator);
    publicAPI.addMouseManipulator(model.scrollManipulator);
    updateScrollManipulator();
  }

  let cameraSub = null;
  let interactorSub = null;
  const superSetInteractor = publicAPI.setInteractor;
  publicAPI.setInteractor = interactor => {
    superSetInteractor(interactor);
    if (cameraSub) {
      cameraSub.unsubscribe();
      cameraSub = null;
    }

    if (interactorSub) {
      interactorSub.unsubscribe();
      interactorSub = null;
    }

    if (interactor) {
      const renderer = interactor.getCurrentRenderer();
      const camera = renderer.getActiveCamera();

      cameraSub = camera.onModified(() => {
        updateScrollManipulator();
        publicAPI.modified();
      });

      interactorSub = interactor.onAnimation(() => {
        const { slabThickness } = model;

        const dist = camera.getDistance();
        const near = dist - slabThickness / 2;
        const far = dist + slabThickness / 2;

        camera.setClippingRange(near, far);
      });
    }
  };

  publicAPI.handleMouseMove = macro.chain(publicAPI.handleMouseMove, () => {
    const renderer = model._interactor.getCurrentRenderer();
    const { slabThickness } = model;
    const camera = renderer.getActiveCamera();
    const dist = camera.getDistance();
    const near = dist - slabThickness / 2;
    const far = dist + slabThickness / 2;

    camera.setClippingRange(near, far);
  });

  const superSetVolumeMapper = publicAPI.setVolumeMapper;
  publicAPI.setVolumeMapper = mapper => {
    if (superSetVolumeMapper(mapper)) {
      const renderer = model._interactor.getCurrentRenderer();
      const camera = renderer.getActiveCamera();
      if (mapper) {
        // prevent zoom manipulator from messing with our focal point
        // TODO: remove the zoom maninipulator instead?
        camera.setFreezeFocalPoint(true);

        // NOTE: Disabling this because it makes it more difficult to switch
        // interactor styles. Need to find a better way to do this!
        //publicAPI.setSliceNormal(...publicAPI.getSliceNormal());
      } else {
        camera.setFreezeFocalPoint(false);
      }
    }
  };

  publicAPI.getSlice = () => {
    const renderer = model._interactor.getCurrentRenderer();
    const camera = renderer.getActiveCamera();
    const sliceNormal = publicAPI.getSliceNormal();

    // Get rotation matrix from normal to +X (since bounds is aligned to XYZ)
    const transform = vtkMatrixBuilder
      .buildFromDegree()
      .identity()
      .rotateFromDirections(sliceNormal, [1, 0, 0]);

    const fp = camera.getFocalPoint();
    transform.apply(fp);
    return fp[0];
  };

  publicAPI.setSlice = slice => {
    const renderer = model._interactor.getCurrentRenderer();
    const camera = renderer.getActiveCamera();

    // console.log("slice", slice);

    if (model.volumeMapper) {
      const range = publicAPI.getSliceRange();
      const bounds = model.volumeMapper.getBounds();

      const clampedSlice = clamp(slice, ...range);

      const center = [
        (bounds[0] + bounds[1]) / 2.0,
        (bounds[2] + bounds[3]) / 2.0,
        (bounds[4] + bounds[5]) / 2.0
      ];

      const distance = camera.getDistance();
      const dop = camera.getDirectionOfProjection();
      vtkMath.normalize(dop);

      const midPoint = (range[1] + range[0]) / 2.0;
      const zeroPoint = [
        center[0] - dop[0] * midPoint,
        center[1] - dop[1] * midPoint,
        center[2] - dop[2] * midPoint
      ];
      const slicePoint = [
        zeroPoint[0] + dop[0] * clampedSlice,
        zeroPoint[1] + dop[1] * clampedSlice,
        zeroPoint[2] + dop[2] * clampedSlice
      ];

      const cameraPos = [
        slicePoint[0] - dop[0] * distance,
        slicePoint[1] - dop[1] * distance,
        slicePoint[2] - dop[2] * distance
      ];

      camera.setPosition(...cameraPos);
      camera.setFocalPoint(...slicePoint);

      // run Callback
      const onScroll = publicAPI.getOnScroll();
      if (onScroll) onScroll(slicePoint);
    }
  };

  publicAPI.getSliceRange = () => {
    if (model.volumeMapper) {
      const sliceNormal = publicAPI.getSliceNormal();

      if (
        sliceNormal[0] === cache.sliceNormal[0] &&
        sliceNormal[1] === cache.sliceNormal[1] &&
        sliceNormal[2] === cache.sliceNormal[2]
      ) {
        return cache.sliceRange;
      }

      const bounds = model.volumeMapper.getBounds();
      const points = boundsToCorners(bounds);

      // Get rotation matrix from normal to +X (since bounds is aligned to XYZ)
      const transform = vtkMatrixBuilder
        .buildFromDegree()
        .identity()
        .rotateFromDirections(sliceNormal, [1, 0, 0]);

      points.forEach(pt => transform.apply(pt));

      // range is now maximum X distance
      let minX = Infinity;
      let maxX = -Infinity;
      for (let i = 0; i < 8; i++) {
        const x = points[i][0];
        if (x > maxX) {
          maxX = x;
        }
        if (x < minX) {
          minX = x;
        }
      }

      cache.sliceNormal = sliceNormal;
      cache.sliceRange = [minX, maxX];
      return cache.sliceRange;
    }
    return [0, 0];
  };

  // Slice normal is just camera DOP
  publicAPI.getSliceNormal = () => {
    if (model.volumeMapper && model._interactor) {
      const renderer = model._interactor.getCurrentRenderer();
      const camera = renderer.getActiveCamera();
      return camera.getDirectionOfProjection();
    }
    return [0, 0, 0];
  };

  // Thought this was a good idea, but no.
  // publicAPI.getSliceNormal = () => cache.sliceNormal;

  /**
   * Move the camera to the given slice normal and viewup direction. Viewup can be used to rotate the display of the image around the direction of view.
   *
   * TODO: setting the slice ALWAYS resets to the volume center, but we need to be able to rotate from an arbitrary position, AKA the intersection of all 3 slice planes.
   */
  // in world space
  publicAPI.setSliceNormal = (normal, viewUp = [0, 1, 0]) => {
    const renderer = model._interactor.getCurrentRenderer();
    const camera = renderer.getActiveCamera();

    // Copy arguments to the model, so they can be GET-ed later
    model.sliceNormal = [...normal];
    model.viewUp = [...viewUp];

    //copy arguments for internal editing so we don't cause sideeffects
    const _normal = [...normal];
    const _viewUp = [...viewUp];

    if (model.volumeMapper) {
      vtkMath.normalize(_normal);
      let mapper = model.volumeMapper;
      // get the mapper if the model is actually the actor, not the mapper
      if (!model.volumeMapper.getInputData && model.volumeMapper.getMapper) {
        mapper = model.volumeMapper.getMapper();
      }
      let volumeCoordinateSpace = vec9toMat3(
        mapper.getInputData().getDirection()
      );
      // Transpose the volume's coordinate space to create a transformation matrix
      vtkMath.transpose3x3(volumeCoordinateSpace, volumeCoordinateSpace);
      // Convert the provided normal into the volume's space
      vtkMath.multiply3x3_vect3(volumeCoordinateSpace, _normal, _normal);

      let center = camera.getFocalPoint();
      let dist = camera.getDistance();
      let angle = camera.getViewAngle();

      if (Number.isNaN(dist) || dist === undefined) {
        // Default the volume center
        const bounds = model.volumeMapper.getBounds();
        // diagonal will be used as "width" of camera scene
        const diagonal = Math.sqrt(
          vtkMath.distance2BetweenPoints(
            [bounds[0], bounds[2], bounds[4]],
            [bounds[1], bounds[3], bounds[5]]
          )
        );

        // center will be used as initial focal point
        center = [
          (bounds[0] + bounds[1]) / 2.0,
          (bounds[2] + bounds[3]) / 2.0,
          (bounds[4] + bounds[5]) / 2.0
        ];

        angle = 90;

        // distance from camera to focal point
        dist = diagonal / (2 * Math.tan((angle / 360) * Math.PI));
      }

      const cameraPos = [
        center[0] - _normal[0] * dist,
        center[1] - _normal[1] * dist,
        center[2] - _normal[2] * dist
      ];

      // set viewUp based on DOP rotation
      // const oldDop = camera.getDirectionOfProjection();
      // const transform = vtkMatrixBuilder
      //   .buildFromDegree()
      //   .identity()
      //   .rotateFromDirections(oldDop, normal);
      // const viewUp = [0, 1, 0];
      // transform.apply(viewUp);

      vtkMath.multiply3x3_vect3(volumeCoordinateSpace, _viewUp, _viewUp);

      const { slabThickness } = model;

      camera.setPosition(...cameraPos);
      camera.setDistance(dist);
      // should be set after pos and distance
      camera.setDirectionOfProjection(..._normal);
      camera.setViewUp(..._viewUp);
      camera.setViewAngle(angle);
      camera.setClippingRange(
        dist - slabThickness / 2,
        dist + slabThickness / 2
      );

      publicAPI.setCenterOfRotation(center);
    }
  };

  publicAPI.setSlabThickness = slabThickness => {
    model.slabThickness = slabThickness;

    // Update the camera clipping range if the slab
    // thickness property is changed
    const renderer = model._interactor.getCurrentRenderer();
    const camera = renderer.getActiveCamera();
    const dist = camera.getDistance();

    camera.setClippingRange(dist - slabThickness / 2, dist + slabThickness / 2);
  };

  setManipulators();
}

// ----------------------------------------------------------------------------
// Object factory
// ----------------------------------------------------------------------------

const DEFAULT_VALUES = {
  slabThickness: 0.1
};

// ----------------------------------------------------------------------------

export function extend(publicAPI, model, initialValues = {}) {
  Object.assign(model, DEFAULT_VALUES, initialValues);

  // Inheritance
  vtkInteractorStyleManipulator.extend(publicAPI, model, initialValues);

  macro.setGet(publicAPI, model, ["volumeMapper", "onScroll"]);
  macro.get(publicAPI, model, ["slabThickness", "viewUp"]);

  // Object specific methods
  vtkInteractorStyleMPRSlice(publicAPI, model);
}

// ----------------------------------------------------------------------------

export const newInstance = macro.newInstance(
  extend,
  "vtkInteractorStyleMPRSlice"
);

// ----------------------------------------------------------------------------

export default Object.assign({ newInstance, extend });

// TODO: work with VTK to change the internal formatting of arrays.
function vec9toMat3(vec9) {
  if (vec9.length !== 9) {
    throw Error("Array not length 9");
  }
  //prettier-ignore
  return [
    [vec9[0], vec9[1], vec9[2]],
    [vec9[3], vec9[4], vec9[5]],
    [vec9[6], vec9[7], vec9[8]],
  ];
}

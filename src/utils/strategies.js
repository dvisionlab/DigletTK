import * as vtkMath from "vtk.js/Sources/Common/Core/Math";

/**
 * Apply the logic to measure length between two points
 * @param {Object} state - The measurement state
 */
function applyLengthStrategy(state, displayPosition, pickedPoint) {
  if (state.p1[0] && state.p2[0]) {
    state.p1 = displayPosition;
    state.p1_world = pickedPoint;
    state.p2 = [undefined, undefined];
    state.p2_world = [undefined, undefined];
    state.label = undefined;
  } else {
    if (state.p1[0]) {
      state.p2 = displayPosition;
      state.p2_world = pickedPoint;
    } else {
      state.p1 = displayPosition;
      state.p1_world = pickedPoint;
    }
  }

  //compute distance
  if (state.p1[0] && state.p2[0]) {
    let dist2 = vtkMath.distance2BetweenPoints(state.p1_world, state.p2_world);
    let d = Math.sqrt(dist2).toFixed(1);
    state.label = `${d} mm`;
  } else {
    state.label = "";
  }
}

/**
 * Apply the logic to measure angle between two segments
 * @param {Object} state - The measurement state
 */
function applyAngleStrategy(state, displayPosition, pickedPoint) {
  if (state.p1[0] && state.p2[0] && state.p3[0]) {
    state.p1 = displayPosition;
    state.p1_world = pickedPoint;
    state.p2 = state.p3 = [undefined, undefined];
    state.p2_world = state.p3_world = [undefined, undefined];
    state.label = undefined;
  } else {
    if (state.p1[0] && state.p2[0]) {
      state.p3 = displayPosition;
      state.p3_world = pickedPoint;
    } else if (state.p1[0]) {
      state.p2 = displayPosition;
      state.p2_world = pickedPoint;
    } else {
      state.p1 = displayPosition;
      state.p1_world = pickedPoint;
    }
  }

  // compute angle
  if (state.p1[0] && state.p2[0] && state.p3[0]) {
    let vA = new Array(3);
    let vB = new Array(3);
    vtkMath.subtract(state.p2_world, state.p3_world, vA);
    vtkMath.subtract(state.p2_world, state.p1_world, vB);
    let angle = vtkMath.angleBetweenVectors(vA, vB);
    let a = vtkMath.degreesFromRadians(angle).toFixed(1);
    state.label = `${a}°`;
  } else {
    state.label = "";
  }
}

const STRATEGIES = {
  Length: applyLengthStrategy,
  Angle: applyAngleStrategy
};

export function applyStrategy(state, displayPosition, pickedPoint, mode) {
  return STRATEGIES[mode](state, displayPosition, pickedPoint);
}

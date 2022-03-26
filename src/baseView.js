/**
 * A base class to contain all props and methods we would like to share between mpr and vr views
 * These could include:
 * - setter / getters for common properties
 * - blend mode
 * - Appearance methods (ie colormaps and opacity)
 * - Picking methods (for measurements!)
 */

export class baseView {
  constructor() {}

  get _absoluteRange() {
    if (this.actor) {
      return this.actor
        .getMapper()
        .getInputData()
        .getPointData()
        .getScalars()
        .getRange();
    } else {
      // TODO error
      return null;
    }
  }
}

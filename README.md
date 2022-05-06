<p align="center">
  <img src="https://assets.pokemon.com/assets/cms2/img/pokedex/full/050.png" width="100" title="Diglett" alt="Diglett">
</p>

# DigletTK

DigletTK is a library to interact with medical images in a 3d context, such as Multi Planar Reformat, MIP and Volume Rendering. It's based on vtk.js and takes inspiration from [vue-vtksjs-viewport](https://github.com/mix3d/vue-vtkjs-viewport) and [react-vtkjs-viewport](https://github.com/OHIF/react-vtkjs-viewport), but it is built to be agnostic with respect to frontend frameworks.
It also provides glue-functions to easily integrate with cornerstone.js, via [Larvitar](https://github.com/dvisionlab/Larvitar) library.

## Install

- `yarn add diglettk`

  OR

- clone the repository and `yarn add /path/to/repository`

  OR

- `yarn add https://github.com/dvisionlab/DigletTK.git#master`

## Use

Examples and docs at http://diglettk.dvisionlab.com/. Short mpr version:

```javascript
/** 
 Define viewports as:

 {
     key: String - The view id (must be unique)
     element: HTMLElement - The target rendering div
 }

 */

const targetElements = {
  top: {
    element: document.getElementById("viewer-1"),
    key: "top"
  },
  left: {
    element: document.getElementById("viewer-2"),
    key: "left"
  },
  front: {
    element: document.getElementById("viewer-3"),
    key: "front"
  }
};

// import DigletTK
import * as dtk from "DigletTK";

// load a dicom serie using larvitar glue function
dtk.loadSerieWithLarvitar(larvitar, serie => {
  let header = larvitar.buildHeader(serie);
  let data = larvitar.buildData(serie, false);
  // build vtk volume with larvitar
  const image = dtk.buildVtkVolume(header, data);
  // run mpr
  mpr = new dtk.MPRManager(targetElements);
  // get initial state obj: this object will be used to share data updates
  state = mpr.getInitialState();
  // set image
  mpr.setImage(state, image);
  // set active tool ("level" or "crosshair")
  mpr.setTool("level", state);
  // change view rotation
  mpr.onRotate("top", "x", 30, state);
  // change view MIP thickness
  mpr.onThickness("top", "x", 50, state);
});
```

## DEV

`yarn dev && cp ./dist/diglettk.js ./docs/examples/diglettk.js` to build the lib and move it from `dist` folder to `examples`.

then load the desired example with a webserver (eg VS code liveserver).

`yarn build` to build the librery for production

`yarn generate-docs` to build the documentation in the `documentation` folder.

`yarn codehawk` to run static code analysis with [codehawk](https://github.com/sgb-io/codehawk-cli).

If you have [dependency cruiser](https://github.com/sverweij/dependency-cruiser) globally installed, you can generate dependency graphs with:
`yarn dep:svg` to build a dependency graph (.svg)
`yarn dep:html` to build an interactive dependency graph (.html)

### RoadMap

--

- [x] Volume Rendering
- [x] Measuring tools
- [ ] Segmentations (Cornerstone.js >>> data >>> vtk.js)
- [x] Colormaps
- [ ] Multi Slice Image Mapper (a different MPR implementation)

### TODO

- [x] documentation
- [x] ~~rollup config~~ webpack config
- [x] examples
- [x] npm package
- [ ] webpack-dev-server for a better dev experience

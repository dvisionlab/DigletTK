var path = require("path");
var webpack = require("webpack");
var vtkRules = require("vtk.js/Utilities/config/dependency.js").webpack.core
  .rules;

// Optional if you want to load *.css and *.module.css files
// var cssRules = require('vtk.js/Utilities/config/dependency.js').webpack.css.rules;

var entry = path.join(__dirname, "./src/index.js");
var entry_ex = path.join(__dirname, "./src/index_ex.js");
const sourcePath = path.join(__dirname, "./src");
const outputPath = path.join(__dirname, "./dist");

module.exports = {
  entry: {
    diglettk: "./src/index.js",
    diglettk_ex: "./src/index_ex.js"
  },
  output: {
    path: outputPath,
    filename: "[name].js"
  },
  module: {
    rules: [{ test: /\.html$/, loader: "html-loader" }].concat(vtkRules)
  },
  resolve: {
    modules: [path.resolve(__dirname, "node_modules"), sourcePath]
  }
};

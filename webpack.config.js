var path = require("path");

// Optional if you want to load *.css and *.module.css files
// var cssRules = require('vtk.js/Utilities/config/dependency.js').webpack.css.rules;
const sourcePath = path.join(__dirname, "./src");
const outputPath = path.join(__dirname, "./dist");
module.exports = {
  entry: "./src/index.js",
  output: {
    path: outputPath,
    filename: "diglettk.js",
    library: "diglettk",
    libraryTarget: "umd"
  },
  module: {
    rules: [{ test: /\.html$/, loader: "html-loader" }]
  },
  resolve: {
    modules: [path.resolve(__dirname, "node_modules"), sourcePath]
  }
};

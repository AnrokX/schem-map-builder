const webpack = require('webpack');

module.exports = function override(config, env) {
  // Add fallbacks for Node.js core modules
  config.resolve.fallback = {
    ...config.resolve.fallback,
    "zlib": require.resolve("browserify-zlib"),
    "buffer": require.resolve("buffer/"),
    "stream": require.resolve("stream-browserify"),
    "path": require.resolve("path-browserify"),
    "util": require.resolve("util/"),
    "assert": require.resolve("assert/"),
    "process": require.resolve("process/browser"),
    "fs": false
  };

  // Add plugins to provide global access to Buffer and process
  config.plugins = [
    ...config.plugins,
    new webpack.ProvidePlugin({
      Buffer: ['buffer', 'Buffer'],
      process: 'process/browser'
    })
  ];

  return config;
}; 
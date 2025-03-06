module.exports = function override(config, env) {
  // Add fallbacks for Node.js core modules
  config.resolve.fallback = {
    ...config.resolve.fallback,
    "zlib": require.resolve("browserify-zlib"),
    "buffer": require.resolve("buffer/"),
    "stream": require.resolve("stream-browserify"),
    "path": require.resolve("path-browserify"),
    "util": require.resolve("util/"),
    "fs": false
  };

  return config;
}; 
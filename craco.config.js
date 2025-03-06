module.exports = {
  webpack: {
    configure: {
      resolve: {
        fallback: {
          assert: require.resolve('assert/'),
          buffer: require.resolve('buffer/'),
          stream: require.resolve('stream-browserify'),
          util: require.resolve('util/'),
          process: require.resolve('process/browser'),
          path: require.resolve('path-browserify'),
          zlib: require.resolve('browserify-zlib'),
        },
      },
    },
  },
}; 
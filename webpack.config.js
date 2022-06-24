var path = require('path')
var webpack = require('webpack')

const mode = 'development'

module.exports = {
  entry: './src/index.ts',
  target: 'node',
  mode,
  devtool: mode === 'development' ? 'source-map' : undefined,
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'index.js',
    libraryTarget: 'commonjs2',
    libraryExport: 'default'
  },
  resolve: {
    extensions: ['.ts', '.js'] //resolve all the modules other than index.ts
  },
  module: {
    rules: [
      {
        use: 'ts-loader',
        test: /\.ts?$/
      }
    ]
  },
  plugins: [
    new webpack.ProvidePlugin({
      URLSearchParams: ['url', 'URLSearchParams'],
      URL: ['url', 'URL'],
    })
  ]
}

const path = require('path');
const Module = require('module');

describe('nats shim resolution', () => {
  afterEach(() => {
    jest.resetModules();
  });

  it('routes nats for service src files through the local emulator shim', () => {
    const parent = {
      filename: path.join(__dirname, '../user-service/src/config/jetstream.js'),
    };

    require('./nats-shim.js');

    const resolved = Module._resolveFilename('nats', parent);
    expect(resolved).toBe(require.resolve('./nats-shim.js'));
  });
});

/**
 * Preloaded via NODE_OPTIONS="--require <this file>" into the user-service and
 * notification-service. It registers a require-hook so any later
 * `require('nats')` inside src/ resolves to this shim, which talks to the
 * local JetStream emulator (scripts/nats-emulator-server.js) over TCP.
 *
 * Implements exactly the API surface the services use:
 *   connect({servers, user, pass}) -> nc
 *   nc.jetstreamManager().streams.add / .consumers.add
 *   nc.jetstream().publish(subject, data, {msgID}) -> PubAck (server-acked)
 *   nc.jetstream().consumers.get(stream, durable).consume() -> async iterator
 *   msg.ack() / msg.nak(ms) / msg.term(); nc.drain(); nc.status()
 */
const path = require('path');
const Module = require('module');
const net = require('net');

const EMU_HOST = process.env.NATS_EMU_HOST || '127.0.0.1';
const EMU_PORT = parseInt(process.env.NATS_EMU_PORT || '4222', 10);

let reqCounter = 0;

function makeClient() {
  let socket = null;
  let buf = '';
  const pending = new Map(); // id -> resolve(response)
  const messageHandlers = new Map(); // `stream|durable` -> fn(msg)
  let connected = false;
  let connectPromise = null;

  function connectSocket() {
    if (connectPromise) return connectPromise;
    connectPromise = new Promise((resolve, reject) => {
      socket = net.connect(EMU_PORT, EMU_HOST, () => {
        connected = true;
        resolve();
      });
      socket.on('error', (err) => {
        connected = false;
        reject(err);
      });
      socket.on('data', (chunk) => {
        buf += chunk.toString();
        let idx;
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!line) continue;
          let parsed;
          try {
            parsed = JSON.parse(line);
          } catch {
            continue;
          }
          if (parsed.event === 'message') {
            const handler = messageHandlers.get(`${parsed.stream}|${parsed.durable}`);
            if (handler) handler(parsed);
          } else if (parsed._id && pending.has(parsed._id)) {
            const resolve = pending.get(parsed._id);
            pending.delete(parsed._id);
            resolve(parsed);
          }
        }
      });
    });
    return connectPromise;
  }

  function request(obj) {
    const id = ++reqCounter;
    return new Promise((resolve) => {
      pending.set(id, resolve);
      socket.write(JSON.stringify({ ...obj, _id: id }) + '\n');
    });
  }

  async function ready() {
    await connectSocket();
  }

  const nc = {
    closed: () => Promise.resolve(undefined),
    async drain() {
      if (socket) socket.destroy();
      connected = false;
      connectPromise = null;
    },
    async close() {
      return this.drain();
    },
    status() {
      return {
        async *[Symbol.asyncIterator]() {
          /* local emulator: no connection-state events */
        },
      };
    },
    jetstreamManager() {
      return {
        streams: {
          add: async (cfg) => {
            await ready();
            const res = await request({ op: 'streams.add', cfg });
            if (!res.ok) throw new Error(res.error);
            return { config: cfg };
          },
        },
        consumers: {
          add: async (stream, cfg) => {
            await ready();
            const res = await request({ op: 'consumers.add', stream, cfg });
            if (!res.ok) throw new Error(res.error);
            return { config: cfg };
          },
        },
      };
    },
    jetstream() {
      return {
        publish: async (subject, data, opts = {}) => {
          await ready();
          const b64 = Buffer.isBuffer(data)
            ? data.toString('base64')
            : Buffer.from(data).toString('base64');
          const res = await request({ op: 'publish', subject, dataB64: b64, msgID: opts.msgID });
          if (!res.ok) throw new Error(res.error);
          return { stream: res.stream, seq: res.seq, duplicate: !!res.duplicate };
        },
        consumers: {
          get: async (stream, durable) => ({
            consume: async () => {
              await ready();
              // Register the message handler BEFORE consume.start: the emulator
              // may deliver buffered messages immediately in response.
              const iter = makeIterator(stream, durable);
              await request({ op: 'consume.start', stream, durable });
              return iter;
            },
          }),
        },
      };
    },
  };

  function makeIterator(stream, durable) {
    const queue = [];
    let wake = null;
    let stopped = false;
    let closedResolve;
    const closedPromise = new Promise((r) => {
      closedResolve = r;
    });

    messageHandlers.set(`${stream}|${durable}`, (m) => {
      if (stopped) return;
      queue.push({
        subject: m.subject,
        data: Buffer.from(m.dataB64, 'base64'),
        info: { deliveryCount: m.deliveryCount, streamSequence: m.seq },
        ack() {
          request({ op: 'ack', stream, durable, seq: m.seq, deliveryCount: m.deliveryCount });
        },
        nak(ms = 0) {
          request({ op: 'nak', stream, durable, seq: m.seq, deliveryCount: m.deliveryCount, delayMs: ms });
        },
        term() {
          request({ op: 'term', stream, durable, seq: m.seq, deliveryCount: m.deliveryCount });
        },
      });
      if (wake) wake();
    });

    return {
      async next() {
        while (queue.length === 0 && !stopped) {
          await new Promise((r) => {
            wake = r;
          });
          wake = null;
        }
        if (stopped && queue.length === 0) return { value: undefined, done: true };
        return { value: queue.shift(), done: false };
      },
      [Symbol.asyncIterator]() {
        return this;
      },
      stop() {
        stopped = true;
        if (wake) wake();
        closedResolve();
      },
      closed: closedPromise,
    };
  }

  return nc;
}

function connect(_opts) {
  return Promise.resolve(makeClient());
}

// Enum constants matching the real nats client's values, so service code like
// `const { AckPolicy } = require('nats')` keeps working under the shim.
const AckPolicy = { None: 'none', All: 'all', Explicit: 'explicit', NotSet: '' };
const DeliverPolicy = {
  All: 'all',
  Last: 'last',
  New: 'new',
  ByStartTime: 'by_start_time',
  LastPerSubject: 'last_per_subject',
};
const Events = { Disconnect: 'disconnect', Reconnect: 'reconnect', Update: 'update', LDM: 'ldm', Error: 'error' };

// ---- require hook: route src/ imports of 'nats' to this shim ----
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  const parentFile = parent && typeof parent.filename === 'string' ? parent.filename : '';
  const fromServiceSrc =
    parentFile.includes(`${path.sep}src${path.sep}`) || parentFile.includes('/src/');

  if (request === 'nats' && fromServiceSrc) {
    return { connect, AckPolicy, DeliverPolicy, Events };
  }

  return origLoad.apply(this, arguments);
};

module.exports = { connect, AckPolicy, DeliverPolicy, Events };

/**
 * Tiny line-delimited JSON TCP broker emulating the NATS JetStream surface
 * this project uses, for demo environments without the real nats-server.
 *
 * Protocol (one JSON object per line):
 *  -> {op:"ping"}                                <- {ok:true, pong:true}
 *  -> {op:"streams.add", cfg}                    <- {ok:true}
 *  -> {op:"consumers.add", stream, cfg}          <- {ok:true} | {ok:false, error:"... already in use"}
 *  -> {op:"publish", subject, dataB64, msgID}    <- {ok:true, stream, seq, duplicate}
 *  -> {op:"consume.start", stream, durable}      <- {ok:true}  (registers puller)
 *  -> {op:"ack"|"nak"|"term", stream, durable, seq, deliveryCount, delayMs}
 *  <- {event:"message", stream, durable, subject, dataB64, seq, deliveryCount}
 *
 * Durability semantics: explicit acks, ack-window redelivery, nak(ms),
 * term, max_deliver, dead-letter publishing — all in-memory.
 */
const net = require('net');

const ACK_WAIT_MS = 30000;

const streams = new Map(); // name -> {config, messages: Map<seq,{subject,data,ts,msgID}>, nextSeq, byMsgID: Map}
const consumers = new Map(); // key `stream|durable` -> state
let seqCounter = 0;

function subjectMatches(pattern, subject) {
  if (pattern === subject) return true;
  const p = pattern.split('.');
  const s = subject.split('.');
  for (let i = 0; i < p.length; i++) {
    if (p[i] === '>') return true;
    if (i >= s.length) return false;
    if (p[i] === '*') continue;
    if (p[i] !== s[i]) return false;
  }
  return p.length === s.length;
}

function findStreamForSubject(subject) {
  for (const [name, st] of streams) {
    if ((st.config.subjects || []).some((pat) => subjectMatches(pat, subject))) return name;
  }
  return null;
}

function handle(msg, socket, session) {
  switch (msg.op) {
    case 'ping':
      return { ok: true, pong: true };

    case 'streams.add': {
      if (!streams.has(msg.cfg.name)) {
        streams.set(msg.cfg.name, { config: msg.cfg, messages: new Map(), nextSeq: 1, byMsgID: new Map() });
      }
      return { ok: true };
    }

    case 'consumers.add': {
      const key = `${msg.stream}|${msg.cfg.durable_name}`;
      if (consumers.has(key)) return { ok: false, error: `consumer name "${msg.cfg.durable_name}" already in use` };
      consumers.set(key, {
        stream: msg.stream,
        cfg: msg.cfg,
        pending: [],
        inflight: new Map(), // deliveryKey -> entry
        delivered: new Set(),
        session: null, // socket currently allowed to receive
      });
      return { ok: true };
    }

    case 'publish': {
      const subject = msg.subject;
      const streamName = findStreamForSubject(subject);
      if (!streamName) return { ok: false, error: `no stream responding to ${subject}` };
      const st = streams.get(streamName);
      if (msg.msgID && st.byMsgID.has(msg.msgID)) {
        return { ok: true, stream: streamName, seq: st.byMsgID.get(msg.msgID), duplicate: true };
      }
      const seq = st.nextSeq++;
      st.messages.set(seq, { subject, data: msg.dataB64, ts: Date.now(), msgID: msg.msgID || null });
      if (msg.msgID) st.byMsgID.set(msg.msgID, seq);
      deliverToConsumers(streamName, subject, seq);
      return { ok: true, stream: streamName, seq, duplicate: false };
    }

    case 'consume.start': {
      const c = consumers.get(`${msg.stream}|${msg.durable}`);
      if (!c) return { ok: false, error: 'consumer not found' };
      c.session = socket;
      pump(c);
      return { ok: true };
    }

    case 'ack': {
      const c = consumers.get(`${msg.stream}|${msg.durable}`);
      if (c) {
        const key = `${msg.seq}#${msg.deliveryCount}`;
        const entry = c.inflight.get(key);
        if (entry) {
          clearTimeout(entry.timer);
          c.inflight.delete(key);
          c.delivered.add(msg.seq);
          pump(c);
        }
      }
      return { ok: true };
    }

    case 'nak': {
      const c = consumers.get(`${msg.stream}|${msg.durable}`);
      if (c) {
        const key = `${msg.seq}#${msg.deliveryCount}`;
        const entry = c.inflight.get(key);
        if (entry) {
          clearTimeout(entry.timer);
          c.inflight.delete(key);
          setTimeout(() => {
            c.pending.push(entry);
            pump(c);
          }, msg.delayMs || 0);
        }
      }
      return { ok: true };
    }

    case 'term': {
      const c = consumers.get(`${msg.stream}|${msg.durable}`);
      if (c) {
        const key = `${msg.seq}#${msg.deliveryCount}`;
        const entry = c.inflight.get(key);
        if (entry) {
          clearTimeout(entry.timer);
          c.inflight.delete(key);
          c.delivered.add(msg.seq); // never again
          pump(c);
        }
      }
      return { ok: true };
    }

    default:
      return { ok: false, error: `unknown op ${msg.op}` };
  }
}

function deliverToConsumers(streamName, subject, seq) {
  for (const [, c] of consumers) {
    if (c.stream !== streamName) continue;
    if (c.cfg.filter_subject && !subjectMatches(c.cfg.filter_subject, subject)) continue;
    if (c.delivered.has(seq)) continue;
    c.pending.push({ seq, subject });
    pump(c);
  }
}

function pump(c) {
  if (!c.session || c.session.destroyed) return;
  while (c.pending.length > 0) {
    const entry = c.pending.shift();
    if (c.inflight.has(`${entry.seq}#${entry.deliveryCount}`)) continue;
    const st = streams.get(c.stream);
    const stored = st.messages.get(entry.seq);
    if (!stored) continue;
    const deliveryCount = entry.deliveryCount + 1;
    entry.deliveryCount = deliveryCount;
    const key = `${entry.seq}#${deliveryCount}`;
    c.inflight.set(key, entry);
    entry.timer = setTimeout(() => {
      if (c.inflight.has(key)) {
        c.inflight.delete(key);
        if (deliveryCount < (c.cfg.max_deliver || 5)) {
          c.pending.push(entry);
          pump(c);
        }
      }
    }, ACK_WAIT_MS);
    c.session.write(
      JSON.stringify({
        event: 'message',
        stream: c.stream,
        durable: c.cfg.durable_name,
        subject: stored.subject,
        dataB64: stored.data,
        seq: entry.seq,
        deliveryCount,
      }) + '\n'
    );
  }
}

function start(port = 4222) {
  const server = net.createServer((socket) => {
    let buf = '';
    socket.on('data', (chunk) => {
      buf += chunk.toString();
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (!line.trim()) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        try {
          const res = handle(msg, socket);
          if (res) socket.write(JSON.stringify({ ...res, _id: msg._id }) + '\n');
        } catch (err) {
          socket.write(JSON.stringify({ ok: false, error: String(err.message), _id: msg._id }) + '\n');
        }
      }
    });
    socket.on('error', () => {});
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

module.exports = { start, subjectMatches };

/*
 * Online play between two browsers, straight from one to the other (WebRTC
 * through PeerJS). The PeerJS server only introduces the two browsers; the
 * game itself travels directly between them.
 *
 * The host's browser is the referee: it rolls the dice, checks every move and
 * sends the result to the guest. The guest only asks.
 */
(function (root) {
  'use strict';

  const PING_MS = 2000;
  const LOST_MS = 7000;
  const RETRY_MS = 2500;
  const PUBLIC_URL = 'https://tsvetoslav-toshev.github.io/Tabla/';

  /** `?peer=host:port` points at a private PeerJS server (used by the tests). */
  function peerOptions() {
    const q = new URLSearchParams(root.location.search).get('peer');
    const base = { debug: 0, config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] } };
    if (!q) return base;
    const [host, port] = q.split(':');
    return { ...base, host, port: Number(port) || 9000, path: '/', secure: false, config: { iceServers: [] } };
  }

  function newId() {
    const a = new Uint8Array(8);
    crypto.getRandomValues(a);
    return 'tabla-' + Array.from(a, (b) => (b % 36).toString(36)).join('');
  }

  /** What one side accepts from the other: small messages, not too many of them. */
  const MAX_MESSAGE = 16000;
  const BURST = 80; // messages per 2 s — a drag sends ~25 a second

  /**
   * One side of the connection. Callbacks: onMessage(msg), onStatus(status, detail)
   * with status one of: 'starting', 'waiting', 'connecting', 'connected', 'lost', 'error'.
   * The host also gets admit(hello): only a newcomer it admits can take part —
   * anyone else holding the link is turned away without disturbing the game.
   */
  function Link(role, { id, hostId, onMessage, onStatus, admit }) {
    let peer = null;
    let conn = null; // the connection in play
    let closed = false;
    let lastSeen = 0;
    let retryTimer = 0;
    let status = '';
    let bucket = { start: 0, n: 0 };
    const setStatus = (s, detail) => {
      if (s === status && !detail) return;
      status = s;
      onStatus(s, detail);
    };

    const pinger = setInterval(() => {
      if (!conn || !conn.open) return;
      try { conn.send({ t: 'ping' }); } catch (_) { /* reported by the close handler */ }
      if (Date.now() - lastSeen > LOST_MS) {
        setStatus('lost');
        if (role === 'guest') reconnect();
      }
    }, PING_MS);

    function acceptable(msg) {
      if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return false;
      const now = Date.now();
      if (now - bucket.start > 2000) bucket = { start: now, n: 0 };
      if (++bucket.n > BURST) return false;
      // the host's full game state is the only big message, and only the host sends it
      return role === 'guest' || JSON.stringify(msg).length <= MAX_MESSAGE;
    }

    function adopt(c) {
      if (conn && conn !== c) { try { conn.close(); } catch (_) { /* already gone */ } }
      conn = c;
      lastSeen = Date.now();
      setStatus('connected');
    }

    function watch(c) {
      c.on('open', () => {
        if (role !== 'guest') return;
        adopt(c);
        onMessage({ t: 'open' });
      });
      c.on('data', (msg) => {
        if (!acceptable(msg)) return;
        if (c !== conn) {
          if (role !== 'host' || msg.t !== 'hello') return;
          if (admit(msg)) {
            adopt(c);
            onMessage(msg);
          } else {
            try { c.send({ t: 'busy' }); } catch (_) { /* gone already */ }
            setTimeout(() => { try { c.close(); } catch (_) { /* gone */ } }, 500);
          }
          return;
        }
        lastSeen = Date.now();
        if (status !== 'connected') setStatus('connected');
        if (msg.t === 'ping') return;
        onMessage(msg);
      });
      c.on('close', () => {
        if (c !== conn || closed) return;
        setStatus('lost');
        if (role === 'guest') reconnect();
      });
      c.on('error', () => { /* followed by close */ });
    }

    function reconnect() {
      clearTimeout(retryTimer);
      retryTimer = setTimeout(() => {
        if (closed) return;
        if (!peer || peer.destroyed) { start(); return; }
        if (peer.disconnected) { peer.reconnect(); return; }
        setStatus('connecting');
        watch(peer.connect(hostId, { reliable: true, serialization: 'json' }));
      }, RETRY_MS);
    }

    function start() {
      setStatus(role === 'host' ? 'starting' : 'connecting');
      peer = role === 'host' ? new root.Peer(id, peerOptions()) : new root.Peer(peerOptions());
      peer.on('open', () => {
        if (role === 'host') setStatus(conn && conn.open ? 'connected' : 'waiting');
        else watch(peer.connect(hostId, { reliable: true, serialization: 'json' }));
      });
      peer.on('connection', (c) => { if (role === 'host') watch(c); });
      peer.on('disconnected', () => { if (!closed) setTimeout(() => !closed && !peer.destroyed && peer.reconnect(), RETRY_MS); });
      peer.on('error', (e) => {
        if (closed) return;
        const type = e && e.type;
        if (type === 'unavailable-id') {
          // our own previous page may still hold the id for a few seconds
          peer.destroy();
          setTimeout(start, RETRY_MS);
        } else if (type === 'peer-unavailable') {
          setStatus('lost', 'host-missing');
          reconnect();
        } else if (type === 'browser-incompatible') {
          setStatus('error', 'browser');
        } else if (type === 'network' || type === 'server-error' || type === 'socket-error' || type === 'socket-closed') {
          setStatus('lost', 'server');
          reconnect();
        } else {
          setStatus('lost', type);
          if (role === 'guest') reconnect();
        }
      });
    }

    if (!root.Peer) {
      setTimeout(() => setStatus('error', 'browser'));
    } else {
      start();
    }

    return {
      get id() { return id; },
      get connected() { return !!(conn && conn.open) && status === 'connected'; },
      send(msg) {
        if (!conn || !conn.open) return false;
        try { conn.send(msg); return true; } catch (_) { return false; }
      },
      close() {
        closed = true;
        clearInterval(pinger);
        clearTimeout(retryTimer);
        if (conn && conn.open) { try { conn.send({ t: 'bye' }); } catch (_) { /* leaving anyway */ } }
        setTimeout(() => { try { if (peer) peer.destroy(); } catch (_) { /* gone */ } }, 150);
      },
    };
  }

  root.TablaNet = {
    newId,
    /** A secret only this guest's browser knows: it proves the seat is theirs when they come back. */
    newToken: () => newId().slice(6) + newId().slice(6),
    host: (id, handlers) => Link('host', { id, ...handlers }),
    join: (hostId, handlers) => Link('guest', { hostId, ...handlers }),
    /** A downloaded copy (file://) has no address a friend could open: invite them to the website. */
    inviteLink: (id) => (root.location.protocol === 'file:' ? PUBLIC_URL : root.location.origin + root.location.pathname + root.location.search) + '#join=' + id,
    joinIdFromUrl() {
      const m = /[#&]join=([a-z0-9-]+)/.exec(root.location.hash);
      return m ? m[1] : null;
    },
  };
})(window);

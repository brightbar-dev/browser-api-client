import http from 'node:http';
import crypto from 'node:crypto';
const server = http.createServer((q, r) => r.end('ok'));
function frame(op, payload) {
  const len = payload.length;
  const head = len < 126 ? Buffer.from([0x80 | op, len]) : Buffer.from([0x80 | op, 126, len >> 8, len & 255]);
  return Buffer.concat([head, payload]);
}
server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  const proto = (req.headers['sec-websocket-protocol'] || '').split(/,\s*/)[0];
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n${proto ? `Sec-WebSocket-Protocol: ${proto}\r\n` : ''}\r\n`);
  socket.write(frame(1, Buffer.from(JSON.stringify({ hello: 'welcome', protocol: proto || null }))));
  let buf = Buffer.alloc(0);
  socket.on('data', (d) => {
    buf = Buffer.concat([buf, d]);
    while (buf.length >= 2) {
      let len = buf[1] & 127, off = 2;
      if (len === 126) { len = buf.readUInt16BE(2); off = 4; }
      if (buf.length < off + 4 + len) return;
      const mask = buf.subarray(off, off + 4);
      const data = Buffer.from(buf.subarray(off + 4, off + 4 + len).map((b, i) => b ^ mask[i % 4]));
      const op = buf[0] & 15;
      buf = buf.subarray(off + 4 + len);
      if (op === 8) { socket.end(frame(8, Buffer.from([3, 232]))); return; }
      if (op === 1) socket.write(frame(1, Buffer.from(JSON.stringify({ echo: data.toString() }))));
    }
  });
});
server.listen(8765, '127.0.0.1', () => console.log('listening'));

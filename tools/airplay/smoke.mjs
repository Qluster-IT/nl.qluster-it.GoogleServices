import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { AirPlayReceiver, connectRaop, RaopStreamer, RAOP_FRAMES_PER_PACKET } from '@sonn-audio/node-airplay';

const host = '127.0.0.1';
const sampleRate = 44100;
const frames = RAOP_FRAMES_PER_PACKET;
const packetCount = 32;
const expected = [];
for (let packet = 0; packet < packetCount; packet++) {
  const pcm = Buffer.alloc(frames * 4);
  for (let frame = 0; frame < frames; frame++) {
    const time = (packet * frames + frame) / sampleRate;
    pcm.writeInt16LE(Math.round(6000 * Math.sin(2 * Math.PI * 440 * time)), frame * 4);
    pcm.writeInt16LE(Math.round(3000 * Math.sin(2 * Math.PI * 660 * time)), frame * 4 + 2);
  }
  expected.push(pcm);
}

const received = [];
const receiver = new AirPlayReceiver({ name: 'Google Services AirPlay lab', port: 0 }, event => {
  if (event.type === 'pcm' && received.length < packetCount) received.push(event);
});
let session;
let sender;
try {
  // Use the advertised port directly; never publish this receiver on the LAN.
  const advertisement = await receiver.start();
  session = await connectRaop({ host, port: advertisement.port, et: advertisement.txt.et, timeoutMs: 2000 });
  sender = new RaopStreamer({ host, session });
  sender.start();
  for (const pcm of expected) {
    sender.sendPacket(pcm);
    await sleep(frames * 1000 / sampleRate);
  }

  const deadline = performance.now() + 3000;
  while (received.length < packetCount && performance.now() < deadline) await sleep(20);
  assert.equal(received.length, packetCount, 'The receiver must decode every sent packet.');
  for (const [index, event] of received.entries()) {
    assert.equal(event.sampleRate, sampleRate);
    assert.equal(event.channels, 2);
    assert.deepEqual(event.data, expected[index], `Decoded packet ${index + 1} differs from the original PCM.`);
  }
  assert.equal(receiver.stats.missed, 0);
  assert.equal(receiver.stats.undecodable, 0);
  console.log(`AirPlay 1 loopback: verified ${packetCount} packets, ${packetCount * frames} stereo frames, byte-for-byte.`);
} finally {
  try {
    if (session) {
      try { await session.rtsp.request('TEARDOWN', { url: session.sessionUrl }); }
      finally {
        session.rtsp.close();
        sender?.stop();
      }
    }
  } finally {
    receiver.stop();
  }
}

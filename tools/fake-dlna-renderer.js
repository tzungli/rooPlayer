// 測試用的假 UPnP / DLNA MediaRenderer（只給 rooPlayer 的執行期自我測試用，不在正式執行路徑上）。
// 只實作 rooPlayer 會用到的 SOAP 子集合：Stop / SetAVTransportURI / Play / Pause / Seek /
// GetPositionInfo / GetTransportInfo，以及 RenderingControl 的 SetVolume / GetVolume。
// 特色：Play 之後會先把位置停在 0 一段時間（模擬真實裝置開播前的 ramp-up），
// 並記錄收到的所有動作與時間，讓自我測試能斷言「準備中重複按播放鍵不會重送指令」。
'use strict';
const http = require('http');

function hms(sec) {
  const s = Math.max(0, Number(sec) || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = (s % 60).toFixed(3);
  return `${h}:${String(m).padStart(2, '0')}:${rest.padStart(6, '0')}`;
}

function soapResponse(action, inner) {
  return `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:${action}Response xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">
      ${inner}
    </u:${action}Response>
  </s:Body>
</s:Envelope>`;
}

const DESCRIPTION_XML = `<?xml version="1.0" encoding="utf-8"?>
<root xmlns="urn:schemas-upnp-org:device-1-0">
  <specVersion><major>1</major><minor>0</minor></specVersion>
  <device>
    <deviceType>urn:schemas-upnp-org:device:MediaRenderer:1</deviceType>
    <friendlyName>rooPlayer 測試串流器</friendlyName>
    <manufacturer>rooPlayer SelfTest</manufacturer>
    <modelName>SelfTest Renderer</modelName>
    <UDN>uuid:rooplayer-selftest-renderer</UDN>
    <serviceList>
      <service>
        <serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType>
        <serviceId>urn:upnp-org:serviceId:AVTransport</serviceId>
        <controlURL>/avt/selftest</controlURL>
        <eventSubURL>/avt/event</eventSubURL>
        <SCPDURL>/avt/scpd.xml</SCPDURL>
      </service>
      <service>
        <serviceType>urn:schemas-upnp-org:service:RenderingControl:1</serviceType>
        <serviceId>urn:upnp-org:serviceId:RenderingControl</serviceId>
        <controlURL>/rc/selftest</controlURL>
        <eventSubURL>/rc/event</eventSubURL>
        <SCPDURL>/rc/scpd.xml</SCPDURL>
      </service>
    </serviceList>
  </device>
</root>`;

function createFakeDlnaRenderer(options = {}) {
  const port = Number(options.port) || 49152;
  const holdSec = Number(options.holdPlayingSec != null ? options.holdPlayingSec : 3.0);
  const durationSec = Number(options.trackDurationSec) || 14;

  const actions = []; // { action, t, uri }
  let transportState = 'NO_MEDIA_PRESENT';
  let currentUri = '';
  let playAtMs = 0;
  let seekOffsetSec = 0;
  let volume = 50;

  const record = (action, extra) => {
    actions.push(Object.assign({ action, t: Date.now() }, extra || {}));
  };

  const handleAvTransport = (action, body) => {
    record(action, action === 'SetAVTransportURI' ? { uri: (body.match(/<CurrentURI>(.*?)<\/CurrentURI>/is) || [])[1] || '' } : undefined);
    switch (action) {
      case 'Stop':
        transportState = 'STOPPED';
        playAtMs = 0;
        seekOffsetSec = 0;
        return soapResponse(action, '');
      case 'SetAVTransportURI':
        currentUri = (body.match(/<CurrentURI>(.*?)<\/CurrentURI>/is) || [])[1] || '';
        transportState = 'STOPPED';
        return soapResponse(action, '');
      case 'Play':
        transportState = 'PLAYING';
        playAtMs = Date.now();
        return soapResponse(action, '');
      case 'Pause':
        transportState = 'PAUSED_PLAYBACK';
        playAtMs = 0;
        return soapResponse(action, '');
      case 'Seek': {
        const target = (body.match(/<Target>(.*?)<\/Target>/is) || [])[1] || '0:00:00';
        const parts = target.split(':');
        seekOffsetSec = (Number(parts[0]) || 0) * 3600 + (Number(parts[1]) || 0) * 60 + (Number(parts[2]) || 0);
        return soapResponse(action, '');
      }
      case 'GetPositionInfo': {
        let pos = 0;
        if (playAtMs) {
          const elapsed = (Date.now() - playAtMs) / 1000;
          pos = elapsed <= holdSec ? 0 : (elapsed - holdSec); // 開播前先把位置停在 0，模擬裝置 ramp-up
        }
        return soapResponse(action, [
          `<InstanceID>0</InstanceID>`,
          `<Track>1</Track>`,
          `<TrackDuration>${hms(durationSec)}</TrackDuration>`,
          `<TrackMetadata></TrackMetadata>`,
          `<CurrentTrackDuration>${hms(durationSec)}</CurrentTrackDuration>`,
          `<CurrentURI>${currentUri}</CurrentURI>`,
          `<CurrentURIMetaData></CurrentURIMetaData>`,
          `<RelTime>${hms(seekOffsetSec + pos)}</RelTime>`,
          `<CurrentTransportState>${transportState}</CurrentTransportState>`,
        ].join('\n'));
      }
      case 'GetTransportInfo':
        return soapResponse(action, `<InstanceID>0</InstanceID><CurrentTransportState>${transportState}</CurrentTransportState><CurrentTransportStatus>OK</CurrentTransportStatus><CurrentSpeed>1</CurrentSpeed>`);
      default:
        return soapResponse(action, '');
    }
  };

  const handleRenderingControl = (action, body) => {
    record(action);
    if (action === 'SetVolume') {
      const v = Number((body.match(/<DesiredValue>(.*?)<\/DesiredValue>/is) || [])[1]);
      if (Number.isFinite(v)) volume = v;
      return soapResponse('SetVolume', '');
    }
    return soapResponse('GetVolume', `<InstanceID>0</InstanceID><Channel>Master</Channel><CurrentVolume>${volume}</CurrentVolume>`);
  };

  const server = http.createServer((req, res) => {
    const url = (req.url || '').split('?')[0];
    if (req.method === 'GET' && url === '/description.xml') {
      res.writeHead(200, { 'Content-Type': 'text/xml; charset="utf-8"' });
      res.end(DESCRIPTION_XML);
      return;
    }
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const action = (body.match(/<u:([A-Za-z]+)\s/is) || [])[1] || '';
      let out = '';
      try {
        if (url === '/avt/selftest') out = handleAvTransport(action, body);
        else if (url === '/rc/selftest') out = handleRenderingControl(action, body);
        else out = soapResponse(action || 'Unknown', '');
        res.writeHead(200, { 'Content-Type': 'text/xml; charset="utf-8"' });
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        out = String(e && e.message);
      }
      res.end(out);
    });
  });

  return {
    port,
    actions,
    get transportState() { return transportState; },
    start() {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => resolve(port));
      });
    },
    stop() {
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

module.exports = { createFakeDlnaRenderer };

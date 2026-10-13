/**
 * native-audio-engine.js
 * 
 * 純本地端 (Pure Node.js / JavaScript) 高保真數位音訊引擎
 * 完全不依賴外部 FFmpeg 執行檔或任何子進程。
 * 
 * 功能涵蓋：
 * 1. 原始音訊格式剖析 (WAV / AIFF / DSF / DFF)
 * 2. 通用 PCM 樣本讀取 (WAV / AIFF / FLAC WASM 解碼)
 * 3. Native DSD 降採樣 (Decimation) 為 24-bit / 88.2kHz WAV 串流
 *
 * 註：升頻插值濾波器與 1-bit Delta-Sigma 調變器已集中至 dsp-kernel.js，
 *     由漸進式串流引擎 (native-dsp-streamer) 與 DSD 調變 worker 共同使用。
 */

const fs = require('fs');
const path = require('path');
const { FLACDecoder } = require('@wasm-audio-decoders/flac');

class NativeAudioEngine {
  constructor() {
    this.name = 'rooPlayer Native Audiophile Engine';
  }

  // ----------------------------------------------------
  // 1. 剖析 WAV 格式結構
  // ----------------------------------------------------
  parseWav(filePath) {
    const fd = fs.openSync(filePath, 'r');
    const headerBuf = Buffer.alloc(2048);
    fs.readSync(fd, headerBuf, 0, 2048, 0);
    fs.closeSync(fd);

    if (headerBuf.slice(0, 4).toString() !== 'RIFF' || headerBuf.slice(8, 12).toString() !== 'WAVE') {
      return null;
    }

    let offset = 12;
    let fmt = null;
    let dataOffset = 0;
    let dataSize = 0;

    while (offset < headerBuf.length - 8) {
      const chunkId = headerBuf.slice(offset, offset + 4).toString();
      const chunkSize = headerBuf.readUInt32LE(offset + 4);
      if (chunkId === 'fmt ') {
        fmt = {
          audioFormat: headerBuf.readUInt16LE(offset + 8),
          numChannels: headerBuf.readUInt16LE(offset + 10),
          sampleRate: headerBuf.readUInt32LE(offset + 12),
          byteRate: headerBuf.readUInt32LE(offset + 16),
          blockAlign: headerBuf.readUInt16LE(offset + 20),
          bitsPerSample: headerBuf.readUInt16LE(offset + 22)
        };
      } else if (chunkId === 'data') {
        dataOffset = offset + 8;
        dataSize = chunkSize;
        break;
      }
      offset += 8 + chunkSize;
    }

    if (!fmt) return null;
    return {
      type: 'wav',
      sampleRate: fmt.sampleRate,
      channels: fmt.numChannels,
      bitsPerSample: fmt.bitsPerSample,
      blockAlign: fmt.blockAlign,
      dataOffset,
      dataSize
    };
  }

  // ----------------------------------------------------
  // 2. 剖析 AIFF 格式結構 (含 80-bit Extended Float 採樣率轉換)
  // ----------------------------------------------------
  parseAiff(filePath) {
    const fd = fs.openSync(filePath, 'r');
    const headerBuf = Buffer.alloc(2048);
    fs.readSync(fd, headerBuf, 0, 2048, 0);
    fs.closeSync(fd);

    const form = headerBuf.slice(0, 4).toString();
    const aiff = headerBuf.slice(8, 12).toString();
    if (form !== 'FORM' || (aiff !== 'AIFF' && aiff !== 'AIFC')) {
      return null;
    }

    const parseExtended80 = (buf, off) => {
      const sign = (buf[off] >> 7) & 1;
      const exp = ((buf[off] & 0x7F) << 8) | buf[off + 1];
      let mantissa = 0n;
      for (let i = 0; i < 8; i++) {
        mantissa = (mantissa << 8n) | BigInt(buf[off + 2 + i]);
      }
      if (exp === 0 && mantissa === 0n) return 0;
      const fMantissa = Number(mantissa) / Math.pow(2, 63);
      return (sign ? -1 : 1) * fMantissa * Math.pow(2, exp - 16383);
    };

    let offset = 12;
    let comm = null;
    let ssnd = null;

    while (offset < headerBuf.length - 8) {
      const chunkId = headerBuf.slice(offset, offset + 4).toString();
      const chunkSize = headerBuf.readUInt32BE(offset + 4);
      if (chunkId === 'COMM') {
        comm = {
          numChannels: headerBuf.readUInt16BE(offset + 8),
          numSampleFrames: headerBuf.readUInt32BE(offset + 10),
          sampleSize: headerBuf.readUInt16BE(offset + 14),
          sampleRate: Math.round(parseExtended80(headerBuf, offset + 16))
        };
      } else if (chunkId === 'SSND') {
        const ssndOffset = headerBuf.readUInt32BE(offset + 8);
        ssnd = {
          dataOffset: offset + 16 + ssndOffset,
          dataSize: chunkSize - 8
        };
        break;
      }
      offset += 8 + chunkSize;
    }

    if (!comm || !ssnd) return null;
    const bytesPerSample = Math.ceil(comm.sampleSize / 8);
    return {
      type: 'aiff',
      sampleRate: comm.sampleRate,
      channels: comm.numChannels,
      bitsPerSample: comm.sampleSize,
      blockAlign: comm.numChannels * bytesPerSample,
      dataOffset: ssnd.dataOffset,
      dataSize: ssnd.dataSize
    };
  }

  // ----------------------------------------------------
  // 3. 剖析 DSF 格式結構 (Sony DSD Stream File)
  // ----------------------------------------------------
  parseDsf(filePath) {
    const fd = fs.openSync(filePath, 'r');
    const headerBuf = Buffer.alloc(128);
    fs.readSync(fd, headerBuf, 0, 128, 0);
    fs.closeSync(fd);

    if (headerBuf.slice(0, 4).toString() !== 'DSD ' || headerBuf.slice(28, 32).toString() !== 'fmt ') {
      return null;
    }

    const dsdRate = headerBuf.readUInt32LE(56);
    const channels = headerBuf.readUInt32LE(52);
    const bitsPerSample = headerBuf.readUInt32LE(60);
    const sampleCount = Number(headerBuf.readBigUInt64LE(64));
    const blockSize = headerBuf.readUInt32LE(72) || 4096;

    return {
      type: 'dsf',
      dsdRate,
      channels,
      bitsPerSample,
      sampleCount,
      blockSize,
      dataOffset: 92
    };
  }

  // ----------------------------------------------------
  // 3b. 剖析 DFF (DSDIFF / DSTFF) 格式結構 (取得 DSD 時脈與樣本總數)
  // ----------------------------------------------------
  parseDff(filePath) {
    const fd = fs.openSync(filePath, 'r');
    let bytesRead = 0;
    const headerBuf = Buffer.alloc(4096);
    try {
      bytesRead = fs.readSync(fd, headerBuf, 0, 4096, 0);
    } finally {
      fs.closeSync(fd);
    }
    if (bytesRead < 16) return null;

    if (headerBuf.slice(0, 4).toString() !== 'FORM') return null;
    const formType = headerBuf.slice(8, 12).toString();
    if (formType !== 'DSD ' && formType !== 'DSDF') return null;

    let dsdRate = 0;
    let sampleCount = 0;
    let channels = 0;

    // DSDIFF chunk 結構：4-byte ID + 4-byte 大端序 size，chunk 長度以偶數對齊。
    // 音訊屬性 (FSCH 取樣時脈 / NSCH 聲道數 / NSCP 樣本總數) 位於巢狀 FORM 'SND ' 容器內。
    const walk = (start, end) => {
      let offset = start;
      while (offset + 8 <= end) {
        const id = headerBuf.slice(offset, offset + 4).toString();
        const size = headerBuf.readUInt32BE(offset + 4);
        const dataStart = offset + 8;
        if (size > end - dataStart) break;

        if (id === 'FSCH' && size >= 4) {
          dsdRate = headerBuf.readUInt32BE(dataStart);
        } else if (id === 'NSCP' && size >= 6) {
          let count = 0n;
          for (let i = 0; i < 6; i++) count = (count << 8n) | BigInt(headerBuf[dataStart + i]);
          sampleCount = Number(count);
        } else if (id === 'NSCH' && size >= 1) {
          channels = headerBuf.readUInt8(dataStart);
        } else if (id === 'FORM') {
          const nestedType = headerBuf.slice(dataStart, dataStart + 4).toString();
          if (nestedType === 'SND ' || nestedType === 'DIIN') {
            walk(dataStart + 4, dataStart + size);
          }
        }

        offset = dataStart + size + (size % 2);
      }
    };
    walk(12, bytesRead);

    if (!dsdRate || !sampleCount) return null;
    return {
      type: 'dff',
      dsdRate,
      channels: channels || 2,
      sampleCount
    };
  }

  // ----------------------------------------------------
  // 3b. FLAC in ISOBMFF / CMAF 解封裝 (TIDAL DASH 串流)
  // TIDAL 部分曲目的 DASH 以 fragmented MP4 容器封裝 FLAC 取樣
  // (ftyp + moov[stsd 'fLaC' 樣本入口內嵌 STREAMINFO] + moof/mdat...)。
  // 還原為標準 raw FLAC 位元組流：'fLaC' + STREAMINFO + 全部 mdat FLAC 幀。
  // ----------------------------------------------------
  isIsoBmff(fileBuf) {
    return fileBuf.length > 12 && fileBuf.toString('ascii', 4, 8) === 'ftyp';
  }

  extractFlacFromIsoBmff(fileBuf) {
    const boxAt = (off) => {
      let size = fileBuf.readUInt32BE(off);
      let headerSize = 8;
      if (size === 1) {
        if (off + 16 > fileBuf.length) return null;
        size = Number(fileBuf.readBigUInt64BE(off + 8));
        headerSize = 16;
      } else if (size === 0) {
        size = fileBuf.length - off;
      }
      if (size < headerSize || off + size > fileBuf.length) return null;
      return { size, headerSize, type: fileBuf.toString('ascii', off + 4, off + 8) };
    };

    // Descend moov container chain to stsd, locate the embedded STREAMINFO
    // metadata block (last-flag block type 0, size 0x22 = 34 bytes) inside
    // the 'fLaC' sample entry (TIDAL embeds it via a dfLa box).
    let streamInfoBlock = null;
    const walkMoov = (off, end) => {
      while (off + 8 <= end && !streamInfoBlock) {
        const box = boxAt(off);
        if (!box) break;
        if (box.type === 'trak' || box.type === 'mdia' || box.type === 'minf' || box.type === 'stbl') {
          walkMoov(off + box.headerSize, off + box.size);
        } else if (box.type === 'stsd') {
          const entryCount = fileBuf.readUInt32BE(off + 12);
          let eo = off + 16;
          for (let i = 0; i < entryCount && eo + 8 <= off + box.size; i++) {
            const esize = fileBuf.readUInt32BE(eo);
            if (esize < 8) break;
            const fourcc = fileBuf.toString('ascii', eo + 4, eo + 8);
            if (fourcc === 'fLaC') {
              for (let p = eo + 8; p + 38 <= eo + esize; p++) {
                if (fileBuf[p] === 0x80 && fileBuf[p + 1] === 0x00 && fileBuf[p + 2] === 0x00 && fileBuf[p + 3] === 0x22) {
                  streamInfoBlock = Buffer.from(fileBuf.subarray(p, p + 38));
                  break;
                }
              }
            }
            eo += esize;
          }
        }
        off += box.size;
      }
    };

    // Collect every top-level mdat payload in file (decode) order
    const mdatPayloads = [];
    let off = 0;
    while (off + 8 <= fileBuf.length) {
      const box = boxAt(off);
      if (!box) break;
      if (box.type === 'moov') {
        walkMoov(off + box.headerSize, off + box.size);
      } else if (box.type === 'mdat') {
        mdatPayloads.push(fileBuf.subarray(off + box.headerSize, off + box.size));
      }
      off += box.size;
    }

    if (!mdatPayloads.length) return null;

    // FLAC frames carry full sync codes (0xFFF8); the embedded STREAMINFO is
    // mandatory for frames that inherit sample size / sample rate from it.
    if (!streamInfoBlock) {
      console.error('[NativeAudioEngine] CMAF FLAC container: embedded STREAMINFO not found in fLaC sample entry');
      return null;
    }

    return Buffer.concat([Buffer.from('fLaC', 'ascii'), streamInfoBlock, ...mdatPayloads]);
  }

  // ----------------------------------------------------
  // 4. 通用 PCM 檔案讀取器 (解出正規化 -1.0 ~ +1.0 Float32Array 左右雙聲道)
  // 支援 WAV, AIFF 及 FLAC (透過高效能 WASM libFLAC 解碼，含 TIDAL CMAF 容器)
  // ----------------------------------------------------
  async readPcmSamples(filePath, startSec = 0, maxDurationSec = 600) {
    const ext = path.extname(filePath).toLowerCase();

    // 4.1 FLAC Native WASM Decoding
    if (ext === '.flac') {
      const decoder = new FLACDecoder();
      try {
        await decoder.ready;
        let fileBuf = fs.readFileSync(filePath);

        // TIDAL DASH CMAF: FLAC samples inside a fragmented MP4 container
        if (this.isIsoBmff(fileBuf)) {
          const extracted = this.extractFlacFromIsoBmff(fileBuf);
          if (!extracted) {
            try { decoder.free(); } catch (e) {}
            return null;
          }
          fileBuf = extracted;
        }

        const decoded = await decoder.decodeFile(fileBuf);
        if (!decoded || !decoded.channelData || decoded.channelData.length === 0) {
          try { decoder.free(); } catch (e) {}
          return null;
        }

        const sampleRate = decoded.sampleRate || 44100;
        const channels = decoded.channelData.length;
        const fullFrames = decoded.channelData[0].length;

        const startFrame = Math.min(fullFrames, Math.floor(startSec * sampleRate));
        const maxFrames = Math.floor(maxDurationSec * sampleRate);
        const frameCount = Math.min(fullFrames - startFrame, maxFrames);

        const left = decoded.channelData[0].subarray(startFrame, startFrame + frameCount);
        const right = (channels > 1)
          ? decoded.channelData[1].subarray(startFrame, startFrame + frameCount)
          : left;

        try { decoder.free(); } catch (e) {}

        return {
          sampleRate,
          channels: Math.min(2, channels),
          frameCount,
          left,
          right
        };
      } catch (err) {
        try { decoder.free(); } catch (e) {}
        console.error('[NativeAudioEngine] FLAC WASM decode error:', err);
        return null;
      }
    }

    // 4.2 WAV / AIFF Direct Header & PCM Reading
    const wavInfo = this.parseWav(filePath);
    const aiffInfo = !wavInfo ? this.parseAiff(filePath) : null;
    const info = wavInfo || aiffInfo;

    if (!info) return null;

    const fd = fs.openSync(filePath, 'r');
    const bytesPerSample = Math.ceil(info.bitsPerSample / 8);
    const bytesPerFrame = info.channels * bytesPerSample;
    const startFrame = Math.floor(startSec * info.sampleRate);
    const maxFrames = Math.floor(maxDurationSec * info.sampleRate);
    const startByte = info.dataOffset + startFrame * bytesPerFrame;

    const fileStat = fs.fstatSync(fd);
    const availableBytes = Math.max(0, fileStat.size - startByte);
    const bytesToRead = Math.min(availableBytes, maxFrames * bytesPerFrame);

    const rawBuf = Buffer.alloc(bytesToRead);
    fs.readSync(fd, rawBuf, 0, bytesToRead, startByte);
    fs.closeSync(fd);

    const frameCount = Math.floor(bytesToRead / bytesPerFrame);
    const left = new Float32Array(frameCount);
    const right = new Float32Array(frameCount);
    const isBe = (info.type === 'aiff');

    if (info.bitsPerSample === 16) {
      for (let i = 0; i < frameCount; i++) {
        const off = i * bytesPerFrame;
        const sL = isBe ? rawBuf.readInt16BE(off) : rawBuf.readInt16LE(off);
        const sR = (info.channels > 1)
          ? (isBe ? rawBuf.readInt16BE(off + 2) : rawBuf.readInt16LE(off + 2))
          : sL;
        left[i] = sL / 32768.0;
        right[i] = sR / 32768.0;
      }
    } else if (info.bitsPerSample === 24) {
      for (let i = 0; i < frameCount; i++) {
        const off = i * bytesPerFrame;
        const sL = isBe ? rawBuf.readIntBE(off, 3) : rawBuf.readIntLE(off, 3);
        const sR = (info.channels > 1)
          ? (isBe ? rawBuf.readIntBE(off + 3, 3) : rawBuf.readIntLE(off + 3, 3))
          : sL;
        left[i] = sL / 8388608.0;
        right[i] = sR / 8388608.0;
      }
    } else if (info.bitsPerSample === 32) {
      for (let i = 0; i < frameCount; i++) {
        const off = i * bytesPerFrame;
        const sL = isBe ? rawBuf.readInt32BE(off) : rawBuf.readInt32LE(off);
        const sR = (info.channels > 1)
          ? (isBe ? rawBuf.readInt32BE(off + 4) : rawBuf.readInt32LE(off + 4))
          : sL;
        left[i] = sL / 2147483648.0;
        right[i] = sR / 2147483648.0;
      }
    }

    return {
      sampleRate: info.sampleRate,
      channels: info.channels,
      frameCount,
      left,
      right
    };
  }

  // ----------------------------------------------------
  // 5. Native DSF Decimation 降採樣為 24-bit / 88.2kHz WAV 緩衝區
  // ----------------------------------------------------
  decimateDsfToWav(filePath, startSec = 0, maxDurationSec = 600) {
    const dsfInfo = this.parseDsf(filePath);
    if (!dsfInfo) return null;

    const fd = fs.openSync(filePath, 'r');
    const blockSize = dsfInfo.blockSize;
    const blockPairSize = blockSize * 2;
    const samplesPerBlock = blockSize * 8; // 32768
    const decimateRatio = 32; // 2822400 / 32 = 88200 Hz
    const outSamplesPerBlock = samplesPerBlock / decimateRatio; // 1024 samples

    const totalBlocks = Math.floor(dsfInfo.sampleCount / samplesPerBlock);
    const startBlock = Math.min(totalBlocks - 1, Math.floor((startSec * dsfInfo.dsdRate) / samplesPerBlock));
    const blocksToProcess = Math.min(
      totalBlocks - startBlock,
      Math.ceil((maxDurationSec * dsfInfo.dsdRate) / samplesPerBlock)
    );

    const totalOutFrames = blocksToProcess * outSamplesPerBlock;
    const dataSize = totalOutFrames * 2 * 3; // 24-bit stereo
    const totalWavSize = 44 + dataSize;
    const outBuf = Buffer.alloc(totalWavSize);

    // Write standard 88.2kHz / 24-bit WAV Header
    outBuf.write('RIFF', 0);
    outBuf.writeUInt32LE(36 + dataSize, 4);
    outBuf.write('WAVE', 8);
    outBuf.write('fmt ', 12);
    outBuf.writeUInt32LE(16, 16);
    outBuf.writeUInt16LE(1, 20); // PCM
    outBuf.writeUInt16LE(2, 22); // Stereo
    outBuf.writeUInt32LE(88200, 24); // 88.2 kHz
    outBuf.writeUInt32LE(88200 * 6, 28); // Byte rate
    outBuf.writeUInt16LE(6, 32); // Block align
    outBuf.writeUInt16LE(24, 34); // 24-bit
    outBuf.write('data', 36);
    outBuf.writeUInt32LE(dataSize, 40);

    const blockPair = Buffer.alloc(blockPairSize);
    let outOffset = 44;

    for (let b = 0; b < blocksToProcess; b++) {
      const filePos = dsfInfo.dataOffset + (startBlock + b) * blockPairSize;
      fs.readSync(fd, blockPair, 0, blockPairSize, filePos);

      for (let s = 0; s < outSamplesPerBlock; s++) {
        let sumL = 0;
        let sumR = 0;
        const startBit = s * decimateRatio;

        for (let bit = 0; bit < decimateRatio; bit++) {
          const bitPos = startBit + bit;
          const byteIdx = Math.floor(bitPos / 8);
          const bitShift = 7 - (bitPos % 8); // DSF/DFF spec: MSB-first

          const bitL = (blockPair[byteIdx] >> bitShift) & 1;
          sumL += bitL ? 1 : -1;

          const bitR = (blockPair[blockSize + byteIdx] >> bitShift) & 1;
          sumR += bitR ? 1 : -1;
        }

        const maxVal = 8388607;
        const valL = Math.max(-maxVal, Math.min(maxVal, Math.round((sumL / 32.0) * maxVal * 1.4)));
        const valR = Math.max(-maxVal, Math.min(maxVal, Math.round((sumR / 32.0) * maxVal * 1.4)));

        outBuf.writeIntLE(valL, outOffset, 3);
        outBuf.writeIntLE(valR, outOffset + 3, 3);
        outOffset += 6;
      }
    }

    fs.closeSync(fd);
    return outBuf;
  }
}

module.exports = new NativeAudioEngine();

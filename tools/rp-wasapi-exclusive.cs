// rp-wasapi-exclusive.cs — rooPlayer WASAPI exclusive-mode output helper.
// Compiled at runtime with the Windows built-in .NET Framework csc (no third-party deps).
// Modes:
//   --probe                     : print device exclusive-mode capability JSON, exit.
//   --url URL --rate R          : play a progressive WAV stream (HTTP, Range-capable)
//                                 on the default (or --device) endpoint in WASAPI
//                                 exclusive event-callback mode.
// Control (stdin, one command per line): pause | resume | seek <byte> | quit
// Events (stdout, JSON lines):
//   {"ev":"ready","rate":..,"bits":..,"ext":..,"bufferFrames":..}
//   {"ev":"pos","fed":..,"padding":..,"audible":..,"underruns":..}
//   {"ev":"paused","audible":..}
//   {"ev":"eof"}
//   {"ev":"fail","code":"0x...","msg":"..."}
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Threading;

class RpWasapiExclusive
{
    // ---------------- COM interop (GUIDs/vtable order per Windows SDK, NAudio-verified) ----
    static readonly Guid CLSID_MMDeviceEnumerator = new Guid("BCDE0395-E52F-467C-8E3D-C4579291692E");
    static readonly Guid IID_IAudioClient = new Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2");
    static readonly Guid IID_IAudioRenderClient = new Guid("F294ACFC-3146-4483-A7BF-ADDCA7C260E2");
    static readonly Guid KSDATAFORMAT_SUBTYPE_IEEE_FLOAT = new Guid("00000003-0000-0010-8000-00AA00389B71");
    static readonly Guid KSDATAFORMAT_SUBTYPE_PCM = new Guid("00000001-0000-0010-8000-00AA00389B71");

    const int CLSCTX_ALL = 7;
    const int AUDCLNT_SHAREMODE_EXCLUSIVE = 1;
    const int AUDCLNT_STREAMFLAGS_EVENTCALLBACK = 0x00040000; // AudioSessionTypes.h 的真實值（不是 0x4）
    const int AUDCLNT_E_BUFFER_SIZE_NOT_ALIGNED = unchecked((int)0x88890019);
    const int AUDCLNT_BUFFERFLAGS_SILENT = 0x2;
    const int E_NOTFOUND = unchecked((int)0x80070490);

    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    class MMDeviceEnumeratorCoClass { }

    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceEnumerator
    {
        [PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr devices);
        [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);
        [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice device);
    }

    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDevice
    {
        [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
        [PreserveSig] int OpenPropertyStore(int stgmAccess, out IntPtr properties);
        [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
        [PreserveSig] int GetState(out int state);
    }

    [ComImport, Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioClient
    {
        [PreserveSig] int Initialize(int shareMode, int streamFlags, long hnsBufferDuration, long hnsPeriodicity, IntPtr pFormat, IntPtr audioSessionGuid);
        [PreserveSig] int GetBufferSize(out uint bufferSize);
        [PreserveSig] long GetStreamLatency();
        [PreserveSig] int GetCurrentPadding(out uint padding);
        [PreserveSig] int IsFormatSupported(int shareMode, IntPtr pFormat, IntPtr closestMatch);
        [PreserveSig] int GetMixFormat(out IntPtr formatPtr);
        [PreserveSig] int GetDevicePeriod(out long defaultPeriod, out long minimumPeriod);
        [PreserveSig] int Start();
        [PreserveSig] int Stop();
        [PreserveSig] int Reset();
        [PreserveSig] int SetEventHandle(IntPtr eventHandle);
        [PreserveSig] int GetService(ref Guid iid, out IntPtr service);
    }

    [ComImport, Guid("F294ACFC-3146-4483-A7BF-ADDCA7C260E2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioRenderClient
    {
        [PreserveSig] int GetBuffer(uint numFramesRequested, out IntPtr dataBufferPointer);
        [PreserveSig] int ReleaseBuffer(uint numFramesWritten, int bufferFlags);
    }

    [DllImport("ole32.dll")] static extern void CoTaskMemFree(IntPtr pv);

    // ---------------- format helpers ----------------
    class FormatInfo
    {
        public int tag; public int channels; public int rate; public int bits;
        public bool ext; public Guid sub;
        public int BlockAlign { get { return channels * (bits / 8); } }
    }

    static FormatInfo ParseFormat(IntPtr ptr)
    {
        FormatInfo f = new FormatInfo();
        f.tag = BitConverter.ToUInt16(ReadBytes(ptr, 18), 0);
        f.channels = BitConverter.ToUInt16(ReadBytes(ptr, 18), 2);
        f.rate = (int)BitConverter.ToUInt32(ReadBytes(ptr, 18), 4);
        f.bits = BitConverter.ToUInt16(ReadBytes(ptr, 18), 14);
        if (f.tag == 0xFFFE)
        {
            byte[] all = ReadBytes(ptr, 40);
            f.ext = true;
            f.bits = BitConverter.ToUInt16(all, 18); // wValidBitsPerSample
            byte[] g = new byte[16];
            Array.Copy(all, 24, g, 0, 16);
            f.sub = new Guid(g);
        }
        return f;
    }

    static byte[] ReadBytes(IntPtr ptr, int n)
    {
        byte[] b = new byte[n];
        Marshal.Copy(ptr, b, 0, n);
        return b;
    }

    static IntPtr BuildFormatBlock(int rate, int channels, int bits, bool ext, Guid sub)
    {
        int blockAlign = channels * (bits / 8);
        byte[] b;
        if (ext)
        {
            b = new byte[40];
            WriteU16(b, 0, 0xFFFE);                 // WAVEFORMATEXTENSIBLE
            WriteU16(b, 16, 22);                    // cbSize
            WriteU16(b, 14, 32);                    // nBitsPerSample = container size
            WriteU16(b, 18, (ushort)bits);          // wValidBitsPerSample
            WriteU32(b, 20, 3);                     // dwChannelMask: SPEAKER_FRONT_LEFT|RIGHT
            byte[] g = sub.ToByteArray();
            Array.Copy(g, 0, b, 24, 16);
        }
        else
        {
            b = new byte[18];
            WriteU16(b, 0, (ushort)(bits == 16 ? 1 : 0xFFFE)); // keep plain PCM only for 16-bit
            if (bits != 16) { return IntPtr.Zero; }
        }
        WriteU16(b, 2, (ushort)channels);
        WriteU32(b, 4, (uint)rate);
        WriteU32(b, 8, (uint)(rate * blockAlign));
        WriteU16(b, 12, (ushort)blockAlign);
        WriteU16(b, 14, (ushort)bits);
        IntPtr ptr = Marshal.AllocHGlobal(b.Length);
        Marshal.Copy(b, 0, ptr, b.Length);
        return ptr;
    }

    static void WriteU16(byte[] b, int off, ushort v) { b[off] = (byte)v; b[off + 1] = (byte)(v >> 8); }
    static void WriteU32(byte[] b, int off, uint v) { b[off] = (byte)v; b[off + 1] = (byte)(v >> 8); b[off + 2] = (byte)(v >> 16); b[off + 3] = (byte)(v >> 24); }

    static string Hex(uint hr) { return "0x" + hr.ToString("X8", CultureInfo.InvariantCulture); }

    static void Emit(string json)
    {
        Console.Out.WriteLine(json);
        Console.Out.Flush();
    }

    // ---------------- device open ----------------
    static IMMDevice OpenDevice(IMMDeviceEnumerator en, string deviceId)
    {
        IMMDevice dev;
        if (deviceId != null && deviceId.Length > 0)
        {
            int hr = en.GetDevice(deviceId, out dev);
            if (hr != 0 || dev == null) return null;
            return dev;
        }
        int h = en.GetDefaultAudioEndpoint(0 /*eRender*/, 0 /*eConsole*/, out dev);
        if (h != 0 || dev == null) return null;
        return dev;
    }

    // candidate exclusive formats, audiophile-preference order
    static List<int[]> FormatCandidates()
    {
        List<int[]> list = new List<int[]>();
        list.Add(new int[] { 32, 1 });   // IEEE float 32 extensible
        list.Add(new int[] { 24, 1 });   // PCM 24 extensible
        list.Add(new int[] { 16, 0 });   // plain PCM 16
        return list;
    }

    // ---------------- probe mode ----------------
    static int Probe(string deviceId)
    {
        IMMDeviceEnumerator en = (IMMDeviceEnumerator)new MMDeviceEnumeratorCoClass();
        IMMDevice dev = OpenDevice(en, deviceId);
        if (dev == null) { Emit("{\"ev\":\"probe\",\"ok\":false,\"msg\":\"no default render device\"}"); return 2; }
        string id; dev.GetId(out id);
        object obj;
        Guid iid = IID_IAudioClient;
        int hr = dev.Activate(ref iid, CLSCTX_ALL, IntPtr.Zero, out obj);
        if (hr != 0 || obj == null) { Emit("{\"ev\":\"probe\",\"ok\":false,\"msg\":\"activate failed\",\"code\":\"" + Hex((uint)hr) + "\"}"); return 2; }
        IAudioClient ac = (IAudioClient)obj;

        IntPtr mixPtr; ac.GetMixFormat(out mixPtr);
        FormatInfo mix = ParseFormat(mixPtr);
        CoTaskMemFree(mixPtr);

        int[] rates = new int[] { 384000, 352800, 192000, 176400, 96000, 88200, 48000, 44100 };
        List<int> rateList = new List<int>();
        for (int i = 0; i < rates.Length; i++) if (!rateList.Contains(rates[i])) rateList.Add(rates[i]);
        if (!rateList.Contains(mix.rate)) { rateList.Add(mix.rate); rateList.Sort(delegate(int a, int b) { return b.CompareTo(a); }); }

        List<string> supported = new List<string>();
        foreach (int rate in rateList)
        {
            foreach (int[] cand in FormatCandidates())
            {
                int bits = cand[0]; bool ext = cand[1] == 1;
                Guid sub = bits == 32 ? KSDATAFORMAT_SUBTYPE_IEEE_FLOAT : KSDATAFORMAT_SUBTYPE_PCM;
                IntPtr fmt = BuildFormatBlock(rate, 2, bits, ext, sub);
                if (fmt == IntPtr.Zero) continue;
                int h = ac.IsFormatSupported(AUDCLNT_SHAREMODE_EXCLUSIVE, fmt, IntPtr.Zero);
                Marshal.FreeHGlobal(fmt);
                if (h == 0)
                {
                    supported.Add("{\"rate\":" + rate + ",\"channels\":2,\"bits\":" + bits + ",\"ext\":" + (ext ? "true" : "false") + ",\"sub\":\"" + (bits == 32 ? "float" : "pcm") + "\"}");
                    break; // one format per rate is enough
                }
            }
        }
        Emit("{\"ev\":\"probe\",\"ok\":true,\"deviceId\":\"" + id.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\""
            + ",\"mixRate\":" + mix.rate + ",\"mixChannels\":" + mix.channels + ",\"mixBits\":" + mix.bits
            + ",\"supported\":[" + string.Join(",", supported.ToArray()) + "]}");
        return 0;
    }

    // ---------------- playback state ----------------
    class Ring
    {
        public byte[] buf; public int write; public int read; public int filled; public volatile bool eos;
        public Ring(int cap) { buf = new byte[cap]; }
        public object lockObj = new object();
        public int Filled() { lock (lockObj) return filled; }
        public bool Write(byte[] data, int n)
        {
            lock (lockObj)
            {
                if (n <= 0) return true;
                // 總空間不足：即時播放比來源慢，資料必須留在 HTTP 端形成 TCP 背壓。
                // 這裡若丟棄取樣會直接吃掉播放長度（實測 2.59MB > 2.30MB 環 = 少 0.5 秒）。
                if (filled + n > buf.Length) return false;
                // 總空間夠但尾端空間不夠：把未讀資料搬到緩衝開頭（單消費者，安全）。
                if (write + n > buf.Length && read > 0)
                {
                    Array.Copy(buf, read, buf, 0, filled);
                    read = 0; write = filled;
                }
                if (write + n > buf.Length) return false;
                Array.Copy(data, 0, buf, write, n);
                write += n; filled += n;
                return true;
            }
        }
        public int Read(byte[] dst, int dstOff, int maxN)
        {
            lock (lockObj)
            {
                int n = filled < maxN ? filled : maxN;
                if (n <= 0) return 0;
                Array.Copy(buf, read, dst, dstOff, n);
                read += n; filled -= n;
                return n;
            }
        }
    }

    string pendingSeekArg = "";
    volatile bool paused = false;
    volatile bool quitRequested = false;
    volatile bool seekRequested = false;
    volatile bool resumeRequested = false;

    HttpWebRequest httpReq;
    Stream httpStream;
    long httpStartByte;
    volatile int sessionId;
    Ring ring;
    long fedFrames;      // frames handed to WASAPI since current HTTP session start
    long baseFrames;     // absolute frames before current HTTP session start
    long underruns;
    int srcBlockAlign, dstBlockAlign, srcRate, dstRate, srcBits, dstBits;
    bool dstFloat;

    IAudioClient ac;
    IAudioRenderClient render;
    System.Threading.AutoResetEvent evt; // 必須是 auto-reset：ManualResetEvent 會一直保持 signaled，
                                        // WaitOne 立刻返回 ⇒ 迴圈自由跑動，把整段音源塞進小緩衝
    IntPtr fmtPtr;
    long hns;
    uint bufferFrames;
    string activeDeviceId = "";    // 供緩衝對齊流程重新取得 IAudioClient 使用
    int framesPerPeriod;
    int useRate;
    int drainPeriods = -1; // >=0: source exhausted, draining the device with silence before eof

    void StdinLoop()
    {
        try
        {
            while (true)
            {
                string line = Console.ReadLine();
                if (line == null) { quitRequested = true; return; }
                line = line.Trim();
                if (line == "pause") { paused = true; }
                else if (line == "resume") { resumeRequested = true; paused = false; }
                else if (line.StartsWith("seek ")) { pendingSeekArg = line.Substring(5).Trim(); seekRequested = true; paused = false; }
                else if (line == "quit") { quitRequested = true; return; }
            }
        }
        catch (Exception) { quitRequested = true; }
    }

    void OpenHttp(long startByte)
    {
        string url = cmdLineUrl;
        HttpWebRequest req = (HttpWebRequest)WebRequest.Create(url);
        req.ReadWriteTimeout = 30000;
        req.Timeout = 15000;
        if (startByte > 0) req.AddRange(startByte);
        httpReq = req;
        HttpWebResponse resp = (HttpWebResponse)req.GetResponse();
        httpStream = resp.GetResponseStream();
        httpStartByte = startByte;
        fedFrames = 0;
        sessionId++;
        if (startByte > 0)
        {
            // raw data from byte startByte: engine WAV header is exactly 44 bytes (verified)
            long dataByte = startByte >= 44 ? startByte - 44 : 0;
            baseFrames = dataByte / srcBlockAlign;
            if (resp.StatusCode != HttpStatusCode.PartialContent)
            {
                // Server ignored the Range header (e.g. a whole-buffer response): skip to startByte by hand.
                SkipBytesLong(startByte);
            }
        }
        else
        {
            baseFrames = 0;
            SkipWavHeader();
        }
    }

    string cmdLineUrl = "";

    void SkipWavHeader()
    {
        byte[] hdr = new byte[12];
        if (!ReadExact(hdr, 12)) throw new Exception("stream shorter than WAV header");
        if (hdr[0] != 'R' || hdr[1] != 'I' || hdr[2] != 'F' || hdr[3] != 'F' || hdr[8] != 'W' || hdr[9] != 'A' || hdr[10] != 'V' || hdr[11] != 'E')
            throw new Exception("not a RIFF/WAVE stream");
        byte[] chunk = new byte[8];
        while (true)
        {
            if (!ReadExact(chunk, 8)) throw new Exception("no data chunk found");
            string name = "" + (char)chunk[0] + (char)chunk[1] + (char)chunk[2] + (char)chunk[3];
            uint size = BitConverter.ToUInt32(chunk, 4);
            if (name == "data") return;
            int skip = (int)(size + (size & 1));
            if (skip > 0) SkipBytes(skip);
        }
    }

    bool ReadExact(byte[] dst, int n)
    {
        int off = 0;
        while (off < n)
        {
            int r = httpStream.Read(dst, off, n - off);
            if (r <= 0) return false;
            off += r;
        }
        return true;
    }

    void SkipBytes(int n)
    {
        byte[] tmp = new byte[4096];
        while (n > 0) { int r = httpStream.Read(tmp, 0, n < tmp.Length ? n : tmp.Length); if (r <= 0) return; n -= r; }
    }

    void SkipBytesLong(long n)
    {
        byte[] tmp = new byte[65536];
        while (n > 0)
        {
            int take = n > tmp.Length ? tmp.Length : (int)n;
            int r = httpStream.Read(tmp, 0, take);
            if (r <= 0) return;
            n -= r;
        }
    }

    void PrefetchLoop()
    {
      try
      {
        byte[] buf = new byte[65536];
        while (!quitRequested)
        {
            Stream s = httpStream; Ring r = ring; int sid = sessionId;
            if (s == null) { Thread.Sleep(20); continue; }
            int rlen;
            try { rlen = s.Read(buf, 0, buf.Length); }
            catch (Exception) { rlen = 0; }
            if (sid != sessionId) continue; // session swapped by seek/resume: discard, re-loop
            if (rlen <= 0) { r.eos = true; Thread.Sleep(50); continue; }
            // 環形緩衝滿 ⇒ 保留在 HTTP 端（TCP 背壓）等下游消化；不可丟棄取樣。
            int waited = 0;
            while (!r.Write(buf, rlen))
            {
                if (quitRequested || sid != sessionId) break;
                Thread.Sleep(10);
                if (++waited > 3000) break; // 30s 安全閥：下游真的卡死時才放棄這個區塊
            }
        }
      }
      catch (Exception e)
      {
        // 背景執行緒的例外不能讓行程無訊息地崩掉：回報 fail 事件讓主行程退回共享模式
        Emit("{\"ev\":\"fail\",\"code\":\"0x00000000\",\"msg\":\"prefetch thread: " + JsonEsc(e.Message) + "\"}");
      }
    }

    int FeedFrames(IntPtr dstPtr, int frames)
    {
        int need = frames * srcBlockAlign;
        byte[] src = new byte[need];
        int got = 0;
        // gather from ring, wait briefly for prefetch
        for (int waited = 0; waited < 40 && got < need; waited++)
        {
            got += ring.Read(src, got, need - got);
            if (got < need)
            {
                if (ring.eos) break;
                Thread.Sleep(5);
            }
        }
        int framesGot = got / srcBlockAlign;
        bool silent = false;
        if (framesGot < frames)
        {
            if (!ring.eos) underruns++; // natural end-of-track silence is not an underrun
            silent = true;
        }
        // convert src -> dst
        byte[] dst = new byte[frames * dstBlockAlign];
        if (srcBits == 24 && dstBits == 32 && dstFloat)
        {
            for (int i = 0; i < framesGot * srcBlockAlign; i += 3)
            {
                int v = src[i] | (src[i + 1] << 8) | (src[i + 2] << 16);
                if ((v & 0x800000) != 0) v |= unchecked((int)0xFF000000);
                float f = v / 8388608f;
                byte[] fb = BitConverter.GetBytes(f);
                int o = (i / 3) * 4;
                dst[o] = fb[0]; dst[o + 1] = fb[1]; dst[o + 2] = fb[2]; dst[o + 3] = fb[3];
            }
        }
        else if (srcBits == 24 && dstBits == 24)
        {
            Array.Copy(src, dst, framesGot * srcBlockAlign);
        }
        else if (srcBits == 24 && dstBits == 16)
        {
            for (int i = 0; i < framesGot; i++)
            {
                int v = src[i * 3] | (src[i * 3 + 1] << 8) | (src[i * 3 + 2] << 16);
                if ((v & 0x800000) != 0) v |= unchecked((int)0xFF000000);
                if (v > 8388479) v = 8388479; else if (v < -8388608) v = -8388608;
                short s16 = (short)((v + 0x80) >> 8);
                dst[i * 2] = (byte)(s16 & 0xFF); dst[i * 2 + 1] = (byte)((s16 >> 8) & 0xFF);
            }
        }
        else if (srcBits == 32 && dstBits == 32)
        {
            Array.Copy(src, dst, framesGot * srcBlockAlign);
        }
        else
        {
            throw new Exception("unsupported conversion " + srcBits + "->" + dstBits);
        }
        Marshal.Copy(dst, 0, dstPtr, dst.Length);
        fedFrames += framesGot; // real audio only; silent padding must not advance the position
        return silent ? 1 : 0;
    }

    [STAThread]
    static int Main(string[] args)
    {
        string deviceId = null, url = null;
        int rate = 0;
        long startByte = 0;
        bool probeMode = false;
        for (int i = 0; i < args.Length; i++)
        {
            string a = args[i];
            if (a == "--probe") probeMode = true;
            else if (a == "--device" && i + 1 < args.Length) deviceId = args[++i];
            else if (a == "--url" && i + 1 < args.Length) url = args[++i];
            else if (a == "--rate" && i + 1 < args.Length) rate = int.Parse(args[++i], CultureInfo.InvariantCulture);
            else if (a == "--start-byte" && i + 1 < args.Length) startByte = long.Parse(args[++i], CultureInfo.InvariantCulture);
        }
        try
        {
            if (probeMode) return Probe(deviceId);
            RpWasapiExclusive app = new RpWasapiExclusive();
            return app.Play(deviceId, url, rate, startByte);
        }
        catch (Exception e)
        {
            Emit("{\"ev\":\"fail\",\"code\":\"0x00000000\",\"msg\":\"" + JsonEsc(e.Message) + "\"}");
            return 1;
        }
    }

    static string JsonEsc(string s)
    {
        if (s == null) return "";
        return s.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", " ").Replace("\n", " ");
    }

    int Play(string deviceId, string url, int rate, long startByte)
    {
        cmdLineUrl = url;
        activeDeviceId = deviceId ?? "";
        if (url == null || url.Length == 0) { Emit("{\"ev\":\"fail\",\"code\":\"0x00000000\",\"msg\":\"missing --url\"}"); return 1; }

        IMMDeviceEnumerator en = (IMMDeviceEnumerator)new MMDeviceEnumeratorCoClass();
        IMMDevice dev = OpenDevice(en, deviceId);
        if (dev == null) { Emit("{\"ev\":\"fail\",\"code\":\"0x00000000\",\"msg\":\"no default render device\"}"); return 2; }
        object obj;
        Guid iid = IID_IAudioClient;
        int hr = dev.Activate(ref iid, CLSCTX_ALL, IntPtr.Zero, out obj);
        if (hr != 0 || obj == null) { Emit("{\"ev\":\"fail\",\"code\":\"" + Hex((uint)hr) + "\",\"msg\":\"activate failed\"}"); return 2; }
        ac = (IAudioClient)obj;

        // pick exclusive format at requested rate (or mix rate if 0)
        useRate = rate;
        if (useRate <= 0)
        {
            IntPtr mixPtr; ac.GetMixFormat(out mixPtr);
            FormatInfo mix = ParseFormat(mixPtr);
            CoTaskMemFree(mixPtr);
            useRate = mix.rate;
        }
        fmtPtr = IntPtr.Zero;
        FormatInfo chosen = new FormatInfo();
        chosen.rate = useRate; chosen.channels = 2;
        foreach (int[] cand in FormatCandidates())
        {
            int bits = cand[0]; bool ext = cand[1] == 1;
            Guid sub = bits == 32 ? KSDATAFORMAT_SUBTYPE_IEEE_FLOAT : KSDATAFORMAT_SUBTYPE_PCM;
            IntPtr fp = BuildFormatBlock(useRate, 2, bits, ext, sub);
            if (fp == IntPtr.Zero) continue;
            int h = ac.IsFormatSupported(AUDCLNT_SHAREMODE_EXCLUSIVE, fp, IntPtr.Zero);
            if (h == 0) { fmtPtr = fp; chosen.bits = bits; chosen.ext = ext; break; }
            Marshal.FreeHGlobal(fp);
        }
        if (fmtPtr == IntPtr.Zero)
        {
            Emit("{\"ev\":\"fail\",\"code\":\"RP-NOFORMAT\",\"msg\":\"no exclusive format at rate " + useRate + "\"}");
            return 3;
        }

        // aligned buffer: use device default period (doubled for safety) to avoid BUFFER_SIZE_NOT_ALIGNED
        long defPeriod, minPeriod;
        ac.GetDevicePeriod(out defPeriod, out minPeriod);
        hns = defPeriod > 0 ? defPeriod * 2 : 200000;
        if (hns > 1000000) hns = 1000000; // <=100ms
        Emit("{\"ev\":\"diag\",\"defPeriod\":" + defPeriod + ",\"minPeriod\":" + minPeriod + ",\"hns\":" + hns + ",\"rate\":" + useRate + "}");

        srcRate = useRate; dstRate = useRate;
        srcBits = 24; srcBlockAlign = 2 * 3;      // engine serves 24-bit stereo WAV
        dstBits = chosen.bits; dstFloat = chosen.bits == 32;
        dstBlockAlign = 2 * (chosen.bits / 8);

        evt = new System.Threading.AutoResetEvent(false);

        Thread prefetch = new Thread(new ThreadStart(PrefetchLoop));
        prefetch.IsBackground = true; prefetch.Start();
        Thread stdinT = new Thread(new ThreadStart(StdinLoop));
        stdinT.IsBackground = true; stdinT.Start();

        int rc = ReinitAndStart(startByte);
        if (rc != 0) return rc;

        Emit("{\"ev\":\"ready\",\"rate\":" + useRate + ",\"bits\":" + chosen.bits + ",\"ext\":" + (chosen.ext ? "true" : "false") + ",\"bufferFrames\":" + bufferFrames + ",\"hns\":" + hns + ",\"defPeriod\":" + defPeriod + ",\"minPeriod\":" + minPeriod + "}");

        DateTime lastPos = DateTime.MinValue;
        bool pausedEmitted = false;
        // 診斷：事件驅動 vs 100ms 逾時驅動（獨佔模式若事件不觸發，播放就會被逾時節流拖慢）
        int evtHits = 0, timeoutHits = 0, bodyMsMax = 0;

        while (!quitRequested)
        {
            if (evt.WaitOne(100)) evtHits++; else timeoutHits++;
            int bodyT0 = Environment.TickCount;
            if (quitRequested) break;

            // ---- seek / resume: reopen the HTTP source at the target byte. The WASAPI stream is
            //      NOT stopped/re-initialized: exclusive-mode pause feeds silence and keeps the
            //      event-callback stream alive (Stop/Reset/Initialize re-handshake is unreliable
            //      across drivers and caused AUDCLNT 0x88890002-class failures). ----
            if (seekRequested || resumeRequested)
            {
                long bytePos;
                if (seekRequested)
                {
                    try { bytePos = long.Parse(pendingSeekArg, CultureInfo.InvariantCulture); } catch (Exception) { bytePos = 44; }
                    seekRequested = false; pendingSeekArg = "";
                }
                else
                {
                    // continue right after the last frame handed to the device; frames still queued
                    // in the device buffer (padding) belong to the old stream and play out first.
                    bytePos = 44 + (baseFrames + fedFrames) * srcBlockAlign;
                    resumeRequested = false;
                }
                paused = false; pausedEmitted = false;
                ReopenStream(bytePos);
            }
            else if (paused)
            {
                if (!pausedEmitted)
                {
                    uint padNow; ac.GetCurrentPadding(out padNow);
                    long audible = baseFrames + fedFrames - padNow;
                    Emit("{\"ev\":\"paused\",\"audible\":" + audible + "}");
                    pausedEmitted = true;
                }
                IntPtr ps;
                int phr = render.GetBuffer((uint)framesPerPeriod, out ps);
                if (phr != 0)
                {
                    Emit("{\"ev\":\"fail\",\"code\":\"" + Hex((uint)phr) + "\",\"msg\":\"GetBuffer failed while paused (device invalidated?)\"}");
                    try { ac.Stop(); } catch (Exception) { }
                    return 7;
                }
                render.ReleaseBuffer((uint)framesPerPeriod, AUDCLNT_BUFFERFLAGS_SILENT);
                continue;
            }

            // ---- EOF: source exhausted -> drain the device with a bounded silence tail, then report.
            //      (GetCurrentPadding never reaches exactly 0 under event-callback pacing, so a
            //      deterministic drain count is used instead of waiting for padding == 0.) ----
            if (!paused && drainPeriods >= 0)
            {
                IntPtr ds;
                int dhr = render.GetBuffer((uint)framesPerPeriod, out ds);
                if (dhr != 0)
                {
                    Emit("{\"ev\":\"fail\",\"code\":\"" + Hex((uint)dhr) + "\",\"msg\":\"GetBuffer failed while draining\"}");
                    try { ac.Stop(); } catch (Exception) { }
                    return 7;
                }
                render.ReleaseBuffer((uint)framesPerPeriod, AUDCLNT_BUFFERFLAGS_SILENT);
                drainPeriods--;
                if (drainPeriods < 0)
                {
                    Emit("{\"ev\":\"eof\",\"fed\":" + (baseFrames + fedFrames) + "}");
                    break;
                }
                continue;
            }
            if (!paused && ring.eos && ring.Filled() <= 0)
            {
                drainPeriods = 2 + 2 * (int)(bufferFrames / (uint)Math.Max(1, framesPerPeriod));
                continue;
            }

            // ---- feed next period ----
            IntPtr dataPtr;
            int ghr2 = render.GetBuffer((uint)framesPerPeriod, out dataPtr);
            if (ghr2 != 0)
            {
                Emit("{\"ev\":\"fail\",\"code\":\"" + Hex((uint)ghr2) + "\",\"msg\":\"GetBuffer failed (device invalidated?)\"}");
                try { ac.Stop(); } catch (Exception) { }
                return 7;
            }
            int silent = 0;
            try { silent = FeedFrames(dataPtr, framesPerPeriod); }
            catch (Exception e)
            {
                render.ReleaseBuffer((uint)framesPerPeriod, AUDCLNT_BUFFERFLAGS_SILENT);
                Emit("{\"ev\":\"fail\",\"code\":\"0x00000000\",\"msg\":\"" + JsonEsc(e.Message) + "\"}");
                try { ac.Stop(); } catch (Exception) { }
                return 8;
            }
            render.ReleaseBuffer((uint)framesPerPeriod, silent != 0 ? AUDCLNT_BUFFERFLAGS_SILENT : 0);

            // ---- position events ----
            int bodyMs = Environment.TickCount - bodyT0;
            if (bodyMs > bodyMsMax) bodyMsMax = bodyMs;
            DateTime now = DateTime.Now;
            if ((now - lastPos).TotalMilliseconds >= 250)
            {
                lastPos = now;
                uint padding; ac.GetCurrentPadding(out padding);
                long audible = baseFrames + fedFrames - padding;
                Emit("{\"ev\":\"pos\",\"fed\":" + (baseFrames + fedFrames) + ",\"padding\":" + padding + ",\"audible\":" + audible + ",\"underruns\":" + underruns + ",\"evtHits\":" + evtHits + ",\"timeoutHits\":" + timeoutHits + ",\"bodyMsMax\":" + bodyMsMax + "}");
            }
        }

        try { ac.Stop(); } catch (Exception) { }
        try { ac.Reset(); } catch (Exception) { }
        return 0;
    }

    // Re-point the HTTP source without touching the WASAPI stream state machine.
    void ReopenStream(long startByte)
    {
        sessionId++;
        drainPeriods = -1;
        try { if (httpStream != null) httpStream.Close(); } catch (Exception) { }
        httpStream = null;
        ring = new Ring(Math.Max(1 << 20, useRate * srcBlockAlign * 4));
        fedFrames = 0;
        OpenHttp(startByte);
    }

    // 重新取得 IAudioClient：緩衝對齊流程需要全新的初始化狀態（Reset 不會解除已初始化狀態）
    bool ReactivateClient()
    {
        try
        {
            IMMDeviceEnumerator en = (IMMDeviceEnumerator)new MMDeviceEnumeratorCoClass();
            IMMDevice dev = OpenDevice(en, activeDeviceId);
            if (dev == null) return false;
            object obj;
            Guid iid = IID_IAudioClient;
            int hr = dev.Activate(ref iid, CLSCTX_ALL, IntPtr.Zero, out obj);
            if (hr != 0 || obj == null) return false;
            ac = (IAudioClient)obj;
            return true;
        }
        catch (Exception) { return false; }
    }

    // Full exclusive-mode start sequence: Stop → Reset → Initialize → SetEventHandle → GetService → fill → Start.
    // Used for the initial start only; pause/seek/resume never re-initialize the stream.
    int ReinitAndStart(long startByte)
    {
        try { ac.Stop(); } catch (Exception) { }
        try { ac.Reset(); } catch (Exception) { }
        if (render != null) { try { Marshal.ReleaseComObject(render); } catch (Exception) { } render = null; }

        // 事件回呼模式要求 hnsPeriodicity == hnsBufferDuration。若驅動把緩衝對齊到别的長度會回
        // AUDCLNT_E_BUFFER_SIZE_NOT_ALIGNED：標準流程是 GetBufferSize 取得實際框架數、換算精確 hns、
        // 重新取得 IAudioClient 後再初始化一次（Reset 不會清除已初始化狀態，會得到 0x88890002）。
        long tryHns = hns;
        int hr = ac.Initialize(AUDCLNT_SHAREMODE_EXCLUSIVE, AUDCLNT_STREAMFLAGS_EVENTCALLBACK, tryHns, tryHns, fmtPtr, IntPtr.Zero);
        if (hr == AUDCLNT_E_BUFFER_SIZE_NOT_ALIGNED)
        {
            uint alignedFrames;
            ac.GetBufferSize(out alignedFrames);
            long aligned = (long)Math.Round(10000000.0 * (double)Math.Max(1u, alignedFrames) / (double)Math.Max(1, useRate));
            try { Marshal.ReleaseComObject(ac); } catch (Exception) { }
            ac = null;
            if (aligned < 10000 || !ReactivateClient())
            {
                Emit("{\"ev\":\"fail\",\"code\":\"" + Hex((uint)hr) + "\",\"msg\":\"buffer alignment re-init failed at rate " + useRate + "\"}");
                return 4;
            }
            tryHns = hns = aligned;
            hr = ac.Initialize(AUDCLNT_SHAREMODE_EXCLUSIVE, AUDCLNT_STREAMFLAGS_EVENTCALLBACK, tryHns, tryHns, fmtPtr, IntPtr.Zero);
        }
        if (hr != 0)
        {
            Emit("{\"ev\":\"fail\",\"code\":\"" + Hex((uint)hr) + "\",\"msg\":\"Initialize failed at rate " + useRate + "\"}");
            return 4;
        }
        ac.GetBufferSize(out bufferFrames);
        if (bufferFrames == 0)
        {
            Emit("{\"ev\":\"fail\",\"code\":\"0x00000000\",\"msg\":\"GetBufferSize returned 0\"}");
            return 4;
        }
        framesPerPeriod = (int)bufferFrames;
        int ehr = ac.SetEventHandle(evt.SafeWaitHandle.DangerousGetHandle());
        if (ehr != 0)
        {
            Emit("{\"ev\":\"fail\",\"code\":\"" + Hex((uint)ehr) + "\",\"msg\":\"SetEventHandle failed (event-callback mode unavailable)\"}");
            return 9;
        }
        Guid rid = IID_IAudioRenderClient;
        IntPtr renderPtr;
        int ghr = ac.GetService(ref rid, out renderPtr);
        if (ghr != 0 || renderPtr == IntPtr.Zero)
        {
            Emit("{\"ev\":\"fail\",\"code\":\"" + Hex((uint)ghr) + "\",\"msg\":\"GetService(IAudioRenderClient) failed\"}");
            return 5;
        }
        render = (IAudioRenderClient)Marshal.GetObjectForIUnknown(renderPtr);
        ring = new Ring(Math.Max(1 << 20, useRate * srcBlockAlign * 4));
        OpenHttp(startByte);
        IntPtr p0;
        if (render.GetBuffer(bufferFrames, out p0) != 0)
        {
            Emit("{\"ev\":\"fail\",\"code\":\"0x00000000\",\"msg\":\"initial GetBuffer failed\"}");
            return 6;
        }
        FeedFrames(p0, framesPerPeriod);
        render.ReleaseBuffer(bufferFrames, 0);
        int shr = ac.Start();
        if (shr != 0)
        {
            Emit("{\"ev\":\"fail\",\"code\":\"" + Hex((uint)shr) + "\",\"msg\":\"Start failed\"}");
            return 10;
        }
        return 0;
    }
}

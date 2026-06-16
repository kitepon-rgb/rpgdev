// RPGDev デスクトップ窓 — Windows / WSL2 ホスト（macOS の desktop/RPGDevWindow.swift と機能等価）。
//
// 設計方針（docs/windows-wsl.md・design-todo-rpg.md 参照）:
//  - C# WinForms + WebView2。在来 .NET Framework 4.x の csc.exe で必要時コンパイルする
//    （swiftc 方式と同型＝npm 依存ゼロ・重量ランタイム非同梱）。C# 5 互換で書く
//    （string 補間 / ?. / 式本体 / out var を使わない）＝古い csc でも通すため。
//  - 参照 DLL は desktop/webview2/ に同梱した Microsoft.Web.WebView2.Core.dll と
//    native WebView2Loader.dll の2つだけ（WinForms ラッパは使わず HWND から直接 Controller を作る）。
//  - ネイティブ音声ブリッジは作らない。BGM/SFX は overlay 側の <audio>/WebAudio が鳴らす。
//    BGM 自動再生のため AdditionalBrowserArguments に --autoplay-policy=no-user-gesture-required。
//  - リサイズ品質: (A) Window-to-Visual hosting（env COREWEBVIEW2_FORCED_HOSTING_MODE）で
//    子 HWND 由来のちらつき/DPI 問題を回避。(B) ドット絵は ZoomFactor 再ラスタライズ＋
//    BoundsMode=UseRawPixels / RasterizationScale=1 で「層拡大」を避け、整数倍 letterbox で配置。
//
// 引数: argv[0]=URL, argv[1]=WebView2 userDataFolder, argv[2]=窓状態 JSON のパス, argv[3]=単一インスタンスキー。
//
// 注意（正直な境界）: 本ファイルは macOS では csc が無くコンパイルできないため未検証。
// DPI 実挙動・WM_SIZING のエッジ計算・透過の見え方は実機 Windows/WSL2 で要検証（docs 参照）。

using System;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;

namespace RPGDev
{
    internal static class Program
    {
        [STAThread]
        private static void Main(string[] args)
        {
            string url = args.Length > 0 && args[0].Length > 0 ? args[0] : "http://127.0.0.1:37373/overlay.html";
            string userDataFolder = args.Length > 1 && args[1].Length > 0 ? args[1] : Path.Combine(Path.GetTempPath(), "rpgdev-webview2");
            string stateFile = args.Length > 2 && args[2].Length > 0 ? args[2] : Path.Combine(Path.GetTempPath(), "rpgdev-window.json");
            string instanceKey = args.Length > 3 && args[3].Length > 0 ? args[3] : "rpgdev-default";

            // 単一インスタンス: 既存窓があれば、その窓を前面化させて自分は退場する（二重窓防止）。
            // セッション内で十分なので Local\ 名前空間を使う（Global\ の権限問題を避ける）。
            bool createdNew;
            Mutex mutex = new Mutex(true, "Local\\" + instanceKey + ".mutex", out createdNew);
            bool eventCreated;
            EventWaitHandle showEvent = new EventWaitHandle(false, EventResetMode.AutoReset, "Local\\" + instanceKey + ".show", out eventCreated);
            if (!createdNew)
            {
                showEvent.Set(); // 既存インスタンスに「前面に出ろ」と通知
                return;
            }

            // Window-to-Visual hosting（DComp Visual 経由＝子 HWND 直描きのちらつき/DPI を回避）。
            // 環境変数は WebView2 環境作成より前に設定する必要がある。
            Environment.SetEnvironmentVariable("COREWEBVIEW2_FORCED_HOSTING_MODE", "COREWEBVIEW2_HOSTING_MODE_WINDOW_TO_VISUAL");

            // PerMonitorV2 DPI 認識（ClientRectangle を生ピクセルにし、DPI 仮想化のボケを避ける）。
            // 古い OS では失敗し得るので握りつぶす（窓自体は動く）。
            TryEnablePerMonitorV2();

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            MainForm form = new MainForm(url, userDataFolder, stateFile);

            // 別インスタンスからの「前面化」要求を待つリスナ。
            Thread listener = new Thread(delegate()
            {
                while (true)
                {
                    showEvent.WaitOne();
                    try
                    {
                        if (!form.IsDisposed)
                        {
                            form.BeginInvoke((MethodInvoker)delegate() { form.BringToForeground(); });
                        }
                    }
                    catch { }
                }
            });
            listener.IsBackground = true;
            listener.Start();

            Application.Run(form);
            GC.KeepAlive(mutex);
        }

        [DllImport("user32.dll")]
        private static extern bool SetProcessDpiAwarenessContext(IntPtr value);

        private static void TryEnablePerMonitorV2()
        {
            try
            {
                // DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 == -4
                SetProcessDpiAwarenessContext(new IntPtr(-4));
            }
            catch { }
        }
    }

    internal sealed class MainForm : Form
    {
        private const int DesignWidth = 1024;
        private const int DesignHeight = 768;
        private const int MinClientWidth = 512;
        private const int MinClientHeight = 384;

        private readonly string _url;
        private readonly string _userDataFolder;
        private readonly string _stateFile;

        private CoreWebView2Controller _controller;
        private bool _ready;

        public MainForm(string url, string userDataFolder, string stateFile)
        {
            _url = url;
            _userDataFolder = userDataFolder;
            _stateFile = stateFile;

            Text = "RPGDev";
            FormBorderStyle = FormBorderStyle.Sizable;
            TopMost = true;          // 常に最前面（Swift の .floating 相当）
            ShowInTaskbar = false;   // タスクバー非表示（Swift の LSUIElement 相当）
            BackColor = Color.Black; // letterbox の余白色（透過の代替＝v1 は枠付き窓）
            StartPosition = FormStartPosition.Manual;
            DoubleBuffered = true;

            Rectangle bounds;
            if (!TryRestoreBounds(out bounds))
            {
                bounds = DefaultBounds();
            }
            Bounds = bounds;
        }

        protected override async void OnLoad(EventArgs e)
        {
            base.OnLoad(e);

            // 最小サイズ＝クライアント 512x384 になるよう非クライアント枠ぶんを足す。
            int borderW = Width - ClientSize.Width;
            int borderH = Height - ClientSize.Height;
            MinimumSize = new Size(MinClientWidth + borderW, MinClientHeight + borderH);

            try
            {
                await InitWebView();
            }
            catch (Exception ex)
            {
                // 沈黙フォールバックしない＝原因を見せて落とす（CLAUDE.md 規約）。
                MessageBox.Show("WebView2 init failed:\n" + ex, "RPGDev", MessageBoxButtons.OK, MessageBoxIcon.Error);
                Close();
            }
        }

        private async Task InitWebView()
        {
            CoreWebView2EnvironmentOptions options = new CoreWebView2EnvironmentOptions();
            // BGM/SFX をユーザー操作なしで鳴らす（overlay は最初の state effect で audio.enabled=true にする）。
            options.AdditionalBrowserArguments = "--autoplay-policy=no-user-gesture-required";

            CoreWebView2Environment env = await CoreWebView2Environment.CreateAsync(null, _userDataFolder, options);
            _controller = await env.CreateCoreWebView2ControllerAsync(Handle);

            // ドット絵を溶かさないための肝: 生ピクセル境界＋ラスタライズ倍率1にして、
            // ZoomFactor を「整数倍の再ラスタライズ」として効かせる（層拡大にしない）。
            _controller.BoundsMode = CoreWebView2BoundsMode.UseRawPixels;
            _controller.RasterizationScale = 1.0;
            _controller.ShouldDetectMonitorScaleChanges = false;
            // 透過（overlay が背景を描く前提。v1 は枠付き窓なので余白は BackColor 黒）。
            _controller.DefaultBackgroundColor = Color.Transparent;

            _controller.CoreWebView2.Navigate(_url);
            _ready = true;
            LayoutWebView();
        }

        // クライアント領域に 1024x768 の「整数倍」を中央配置し、余白は letterbox。
        // ZoomFactor=k と Bounds=k*design でページが生ピクセル等倍に再ラスタライズされる。
        private void LayoutWebView()
        {
            if (!_ready || _controller == null)
            {
                return;
            }
            Rectangle c = ClientRectangle;
            int k = Math.Max(1, Math.Min(c.Width / DesignWidth, c.Height / DesignHeight));
            int w = k * DesignWidth;
            int h = k * DesignHeight;
            int x = (c.Width - w) / 2;
            int y = (c.Height - h) / 2;
            _controller.Bounds = new Rectangle(x, y, w, h);
            _controller.ZoomFactor = k;
        }

        // --- リサイズ中の 4:3 維持（Swift の windowWillResize 相当） ---
        // WM_SIZING で掴んだ辺に応じてクライアントを 4:3 にスナップする。整数倍 letterbox は
        // LayoutWebView 側が吸収するので、ここは「窓の縦横比を 4:3 に保つ」だけ。
        // 注意: エッジ別の固定辺計算は実機で要確認。
        private const int WM_SIZING = 0x0214;
        private const int WMSZ_LEFT = 1;
        private const int WMSZ_RIGHT = 2;
        private const int WMSZ_TOP = 3;
        private const int WMSZ_TOPLEFT = 4;
        private const int WMSZ_TOPRIGHT = 5;
        private const int WMSZ_BOTTOM = 6;
        private const int WMSZ_BOTTOMLEFT = 7;
        private const int WMSZ_BOTTOMRIGHT = 8;

        protected override void WndProc(ref Message m)
        {
            if (m.Msg == WM_SIZING)
            {
                RECT r = (RECT)Marshal.PtrToStructure(m.LParam, typeof(RECT));
                int edge = m.WParam.ToInt32();
                int borderW = Width - ClientSize.Width;
                int borderH = Height - ClientSize.Height;

                int cw = (r.Right - r.Left) - borderW;
                int ch = (r.Bottom - r.Top) - borderH;
                if (cw < MinClientWidth) { cw = MinClientWidth; }
                if (ch < MinClientHeight) { ch = MinClientHeight; }

                bool horizOnly = edge == WMSZ_LEFT || edge == WMSZ_RIGHT;
                bool vertOnly = edge == WMSZ_TOP || edge == WMSZ_BOTTOM;
                if (horizOnly)
                {
                    ch = (int)Math.Round(cw * (double)DesignHeight / DesignWidth);
                }
                else if (vertOnly)
                {
                    cw = (int)Math.Round(ch * (double)DesignWidth / DesignHeight);
                }
                else
                {
                    // 角ドラッグは幅基準で高さを合わせる。
                    ch = (int)Math.Round(cw * (double)DesignHeight / DesignWidth);
                }

                int newW = cw + borderW;
                int newH = ch + borderH;

                if (edge == WMSZ_LEFT || edge == WMSZ_TOPLEFT || edge == WMSZ_BOTTOMLEFT)
                {
                    r.Left = r.Right - newW;
                }
                else
                {
                    r.Right = r.Left + newW;
                }
                if (edge == WMSZ_TOP || edge == WMSZ_TOPLEFT || edge == WMSZ_TOPRIGHT)
                {
                    r.Top = r.Bottom - newH;
                }
                else
                {
                    r.Bottom = r.Top + newH;
                }

                Marshal.StructureToPtr(r, m.LParam, false);
                m.Result = (IntPtr)1;
                return;
            }
            base.WndProc(ref m);
        }

        protected override void OnResize(EventArgs e)
        {
            base.OnResize(e);
            LayoutWebView();
        }

        protected override void OnResizeEnd(EventArgs e)
        {
            base.OnResizeEnd(e);
            LayoutWebView();
            SaveState();
        }

        protected override void OnMove(EventArgs e)
        {
            base.OnMove(e);
            SaveState();
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            SaveState();
            base.OnFormClosing(e);
        }

        public void BringToForeground()
        {
            if (WindowState == FormWindowState.Minimized)
            {
                WindowState = FormWindowState.Normal;
            }
            Show();
            Activate();
            BringToFront();
            // TopMost を一度落として戻すと確実に前面化する。
            TopMost = false;
            TopMost = true;
        }

        // --- 位置・サイズの永続化（Swift の UserDefaults 相当。.rpgdev 配下の JSON）。 ---
        // ディスプレイ構成が変わったら復元しない（既定位置へ）。画面外/小さすぎも復元しない。

        private Rectangle DefaultBounds()
        {
            Rectangle wa = Screen.PrimaryScreen.WorkingArea;
            int x = wa.Right - DesignWidth - 24;
            int y = wa.Top + 24;
            return new Rectangle(x, y, DesignWidth, DesignHeight);
        }

        private string ScreenSignature()
        {
            string s = "";
            Screen[] screens = Screen.AllScreens;
            for (int i = 0; i < screens.Length; i++)
            {
                Rectangle b = screens[i].Bounds;
                if (i > 0) { s += "|"; }
                s += b.X + "," + b.Y + "," + b.Width + "," + b.Height;
            }
            return s;
        }

        private void SaveState()
        {
            try
            {
                if (WindowState != FormWindowState.Normal)
                {
                    return; // 最大化/最小化中は保存しない
                }
                Rectangle b = Bounds;
                string json = "{"
                    + "\"x\":" + b.X.ToString(CultureInfo.InvariantCulture) + ","
                    + "\"y\":" + b.Y.ToString(CultureInfo.InvariantCulture) + ","
                    + "\"w\":" + b.Width.ToString(CultureInfo.InvariantCulture) + ","
                    + "\"h\":" + b.Height.ToString(CultureInfo.InvariantCulture) + ","
                    + "\"sig\":\"" + JsonEscape(ScreenSignature()) + "\""
                    + "}";
                string dir = Path.GetDirectoryName(_stateFile);
                if (dir != null && dir.Length > 0 && !Directory.Exists(dir))
                {
                    Directory.CreateDirectory(dir);
                }
                File.WriteAllText(_stateFile, json);
            }
            catch { }
        }

        private bool TryRestoreBounds(out Rectangle bounds)
        {
            bounds = Rectangle.Empty;
            try
            {
                if (!File.Exists(_stateFile))
                {
                    return false;
                }
                string json = File.ReadAllText(_stateFile);
                int x, y, w, h;
                string sig;
                if (!TryParseState(json, out x, out y, out w, out h, out sig))
                {
                    return false;
                }
                if (sig != ScreenSignature())
                {
                    return false; // ディスプレイ構成が変わった
                }
                if (w < DesignWidth - 0 || h < DesignHeight - 0)
                {
                    // 最小チェック（クライアント基準ではなく窓基準だが、設計サイズ未満は弾く）。
                    if (w < MinClientWidth || h < MinClientHeight)
                    {
                        return false;
                    }
                }
                Rectangle rect = new Rectangle(x, y, w, h);
                bool onScreen = false;
                Screen[] screens = Screen.AllScreens;
                for (int i = 0; i < screens.Length; i++)
                {
                    if (screens[i].WorkingArea.IntersectsWith(rect))
                    {
                        onScreen = true;
                        break;
                    }
                }
                if (!onScreen)
                {
                    return false;
                }
                bounds = rect;
                return true;
            }
            catch
            {
                return false;
            }
        }

        // 固定形（{"x":..,"y":..,"w":..,"h":..,"sig":".."}）だけ読む最小パーサ（依存追加を避ける）。
        private static bool TryParseState(string json, out int x, out int y, out int w, out int h, out string sig)
        {
            x = 0; y = 0; w = 0; h = 0; sig = "";
            bool ok = TryReadInt(json, "\"x\"", out x)
                && TryReadInt(json, "\"y\"", out y)
                && TryReadInt(json, "\"w\"", out w)
                && TryReadInt(json, "\"h\"", out h);
            TryReadString(json, "\"sig\"", out sig);
            return ok;
        }

        private static bool TryReadInt(string json, string key, out int value)
        {
            value = 0;
            int ki = json.IndexOf(key, StringComparison.Ordinal);
            if (ki < 0) { return false; }
            int ci = json.IndexOf(':', ki + key.Length);
            if (ci < 0) { return false; }
            int i = ci + 1;
            while (i < json.Length && (json[i] == ' ' || json[i] == '\t')) { i++; }
            int start = i;
            if (i < json.Length && (json[i] == '-' || json[i] == '+')) { i++; }
            while (i < json.Length && char.IsDigit(json[i])) { i++; }
            string num = json.Substring(start, i - start);
            return int.TryParse(num, NumberStyles.Integer, CultureInfo.InvariantCulture, out value);
        }

        private static bool TryReadString(string json, string key, out string value)
        {
            value = "";
            int ki = json.IndexOf(key, StringComparison.Ordinal);
            if (ki < 0) { return false; }
            int q1 = json.IndexOf('"', ki + key.Length);
            if (q1 < 0) { return false; }
            int q2 = json.IndexOf('"', q1 + 1);
            if (q2 < 0) { return false; }
            value = json.Substring(q1 + 1, q2 - q1 - 1);
            return true;
        }

        private static string JsonEscape(string s)
        {
            return s.Replace("\\", "\\\\").Replace("\"", "\\\"");
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct RECT
        {
            public int Left;
            public int Top;
            public int Right;
            public int Bottom;
        }
    }
}

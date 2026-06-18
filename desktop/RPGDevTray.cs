// RPGDev タスクトレイ常駐（Windows）。
// 目的：ハブ（rpgdev サーバ）が起動しているかを一目で分かるようにする。常駐していれば稼働中、消えていれば停止。
// アイコンは水の精霊 Aqua の「顔」をスプライト PNG から実行時に切り出して使う（外部の画像ツール不要＝System.Drawing）。
// /health を定期監視し、ハブが落ちたら自分も退場する（＝トレイの有無 = ハブの稼働）。右クリックで窓を開く/街に戻る/終了。
// ビルド・起動は scripts/desktop.mjs が csc で行う（RPGDevWindow.cs と同型）。窓 exe(RPGDev.exe) とは別プロセス（RPGDevTray.exe）。
using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace RPGDevTray
{
    internal static class Program
    {
        private static string _hubUrl;
        private static string _instanceKey;
        private static string _windowExe;
        private static string _windowUrl;
        private static string _windowData;
        private static string _windowState;
        private static NotifyIcon _icon;
        private static int _healthFails;
        private static FileStream _lock; // 単一インスタンスロック（プロセス生存中保持）

        [DllImport("user32.dll")]
        private static extern bool DestroyIcon(IntPtr handle);

        [STAThread]
        private static void Main(string[] args)
        {
            // アイコン生成モード：スタートメニューのショートカット用に Aqua の顔から .ico を書き出して終了。
            // RPGDevTray.exe --make-ico <spritePng> <outIco>
            if (args.Length >= 3 && args[0] == "--make-ico")
            {
                MakeIco(args[1], args[2]);
                return;
            }

            _hubUrl = args.Length > 0 && args[0].Length > 0 ? args[0].TrimEnd('/') : "http://127.0.0.1:37373";
            string spritePath = args.Length > 1 ? args[1] : "";
            _instanceKey = args.Length > 2 && args[2].Length > 0 ? args[2] : "rpgdev-hub";
            _windowExe = args.Length > 3 ? args[3] : "";
            _windowUrl = args.Length > 4 ? args[4] : _hubUrl + "/overlay.html";
            _windowData = args.Length > 5 ? args[5] : "";
            _windowState = args.Length > 6 ? args[6] : "";

            // 単一インスタンス：ハブ dir（窓 state と同じ場所）の lock ファイルを排他で握る。窓のファイルロックと同型。
            string hubDir = _windowState.Length > 0 ? Path.GetDirectoryName(_windowState) : Path.GetTempPath();
            if (string.IsNullOrEmpty(hubDir)) hubDir = Path.GetTempPath();
            try { Directory.CreateDirectory(hubDir); }
            catch { }
            try
            {
                _lock = new FileStream(Path.Combine(hubDir, _instanceKey + ".tray.lock"),
                    FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None, 8, FileOptions.DeleteOnClose);
            }
            catch (IOException)
            {
                return; // 既にトレイが常駐している＝二重に出さない
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            _icon = new NotifyIcon();
            _icon.Icon = BuildAquaFaceIcon(spritePath);
            _icon.Text = "RPGDev — ハブ稼働中"; // tooltip（最大63文字）
            _icon.Visible = true;
            _icon.DoubleClick += delegate { OpenWindow(); };

            ContextMenuStrip menu = new ContextMenuStrip();
            menu.Items.Add("ウィンドウを開く", null, delegate { OpenWindow(); });
            menu.Items.Add("街に戻る", null, delegate { Post("/control/return-town"); });
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("終了（ハブを停止）", null, delegate { QuitHub(); });
            _icon.ContextMenuStrip = menu;

            // /health 監視：3秒ごと。連続で落ちたらハブ停止と見なしてトレイも退場する。
            // System.Windows.Forms.Timer を明示（System.Threading.Timer と曖昧にしない）。
            System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer();
            timer.Interval = 3000;
            timer.Tick += delegate { CheckHealth(); };
            timer.Start();

            Application.ApplicationExit += delegate
            {
                try { _icon.Visible = false; _icon.Dispose(); }
                catch { }
            };

            Application.Run();
            GC.KeepAlive(_lock);
        }

        // Aqua スプライト PNG の「顔」（上部中央）を機械的に切り出して 32x32 アイコンにする。
        // 画像内容は創作・改変しない（切り出し・縮小のみ＝許可された機械処理）。読めない時は黙ってそれっぽい別物を作らず、
        // システムアプリアイコンで代替（常駐＝稼働の表示は維持）。
        private static Icon BuildAquaFaceIcon(string spritePath)
        {
            try
            {
                using (Bitmap src = new Bitmap(spritePath))
                {
                    int w = src.Width, h = src.Height;
                    int side = (int)(Math.Min(w, h) * 0.24); // 顔まわりの正方形
                    int cx = (int)(w * 0.52); // 顔の中心（3/4 後ろ向きで上部中央やや右）
                    int cy = (int)(h * 0.15);
                    int x = Math.Max(0, Math.Min(w - side, cx - side / 2));
                    int y = Math.Max(0, Math.Min(h - side, cy - side / 2));
                    using (Bitmap face = new Bitmap(32, 32, PixelFormat.Format32bppArgb))
                    {
                        using (Graphics g = Graphics.FromImage(face))
                        {
                            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                            g.DrawImage(src, new Rectangle(0, 0, 32, 32), new Rectangle(x, y, side, side), GraphicsUnit.Pixel);
                        }
                        IntPtr hicon = face.GetHicon();
                        try { return (Icon)Icon.FromHandle(hicon).Clone(); }
                        finally { DestroyIcon(hicon); }
                    }
                }
            }
            catch
            {
                return SystemIcons.Application; // スプライトが読めない環境でも常駐表示は出す（顔は出ないが稼働は分かる）
            }
        }

        // 顔を 256x256 に切り出し、PNG-in-ICO（Vista+ が読む形式）として .ico を書き出す。
        // スタートメニューのショートカット用。画像内容は改変せず切り出し・縮小のみ。
        private static void MakeIco(string spritePath, string outPath)
        {
            using (Bitmap src = new Bitmap(spritePath))
            {
                int w = src.Width, h = src.Height;
                int side = (int)(Math.Min(w, h) * 0.24);
                int cx = (int)(w * 0.52);
                int cy = (int)(h * 0.15);
                int x = Math.Max(0, Math.Min(w - side, cx - side / 2));
                int y = Math.Max(0, Math.Min(h - side, cy - side / 2));
                using (Bitmap face = new Bitmap(256, 256, PixelFormat.Format32bppArgb))
                {
                    using (Graphics g = Graphics.FromImage(face))
                    {
                        g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                        g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                        g.DrawImage(src, new Rectangle(0, 0, 256, 256), new Rectangle(x, y, side, side), GraphicsUnit.Pixel);
                    }
                    byte[] png;
                    using (MemoryStream ms = new MemoryStream())
                    {
                        face.Save(ms, ImageFormat.Png);
                        png = ms.ToArray();
                    }
                    using (FileStream fs = new FileStream(outPath, FileMode.Create, FileAccess.Write))
                    using (BinaryWriter bw = new BinaryWriter(fs))
                    {
                        bw.Write((short)0);          // reserved
                        bw.Write((short)1);          // type = icon
                        bw.Write((short)1);          // image count
                        bw.Write((byte)0);           // width 0 = 256
                        bw.Write((byte)0);           // height 0 = 256
                        bw.Write((byte)0);           // palette
                        bw.Write((byte)0);           // reserved
                        bw.Write((short)1);          // color planes
                        bw.Write((short)32);         // bits per pixel
                        bw.Write(png.Length);        // size of image data
                        bw.Write(22);                // offset (6 + 16)
                        bw.Write(png);
                    }
                }
            }
        }

        private static void OpenWindow()
        {
            if (_windowExe.Length == 0 || !File.Exists(_windowExe)) return;
            try
            {
                Process.Start(new ProcessStartInfo(_windowExe,
                    Quote(_windowUrl) + " " + Quote(_windowData) + " " + Quote(_windowState) + " " + Quote(_instanceKey))
                { UseShellExecute = false });
            }
            catch { }
        }

        private static void QuitHub()
        {
            Post("/control/shutdown"); // ハブをきれいに停止（サーバ側 process.exit）
            try
            {
                foreach (Process p in Process.GetProcessesByName("RPGDev")) // 窓も閉じる（トレイ RPGDevTray は対象外）
                {
                    try { p.Kill(); } catch { }
                }
            }
            catch { }
            Application.Exit();
        }

        private static void CheckHealth()
        {
            if (HttpOk(_hubUrl + "/health"))
            {
                _healthFails = 0;
                _icon.Text = "RPGDev — ハブ稼働中";
            }
            else
            {
                _healthFails += 1;
                _icon.Text = "RPGDev — 応答なし…";
                if (_healthFails >= 3) Application.Exit(); // ハブ停止＝トレイも消える
            }
        }

        private static bool HttpOk(string url)
        {
            try
            {
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create(url);
                req.Method = "GET";
                req.Timeout = 1500;
                using (HttpWebResponse res = (HttpWebResponse)req.GetResponse())
                {
                    return (int)res.StatusCode >= 200 && (int)res.StatusCode < 300;
                }
            }
            catch { return false; }
        }

        private static void Post(string path)
        {
            try
            {
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create(_hubUrl + path);
                req.Method = "POST";
                req.Timeout = 2000;
                req.ContentLength = 0;
                using (req.GetResponse()) { }
            }
            catch { }
        }

        private static string Quote(string value)
        {
            return "\"" + (value ?? "").Replace("\"", "\\\"") + "\"";
        }
    }
}

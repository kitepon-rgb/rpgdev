import Cocoa
import WebKit
import AVFoundation

final class RPGDevAppDelegate: NSObject, NSApplicationDelegate, WKScriptMessageHandler, NSWindowDelegate {
    private var window: NSWindow?
    private var webView: WKWebView?
    private var container: NSView?
    private var stageView: NSView?
    private let designSize = NSSize(width: 1024, height: 768)
    private var players: [String: AVPlayer] = [:]
    private var sfxPlayers: [String: AVAudioPlayer] = [:]
    private var loopObservers: [NSObjectProtocol] = []
    private var audioEnabled = false
    private var activeTrack = "silence"

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)

        let urlString = CommandLine.arguments.dropFirst().first ?? "http://127.0.0.1:37373/overlay.html"
        let config = WKWebViewConfiguration()
        let userContentController = WKUserContentController()
        userContentController.add(self, name: "rpgdev")
        config.userContentController = userContentController
        config.preferences.javaScriptCanOpenWindowsAutomatically = false

        if #available(macOS 10.12, *) {
            config.mediaTypesRequiringUserActionForPlayback = []
        }

        let screenFrame = NSScreen.main?.visibleFrame ?? NSRect(x: 80, y: 80, width: 1280, height: 800)
        // 内部解像度は 1024x768 (4:3) で固定。ウィンドウは掴んでリサイズでき、リサイズしても
        // キャンバスを広げず内部 1024x768 をそのまま等倍で拡大縮小する（全体ズーム）。4:3 を維持。
        let size = designSize
        let origin = NSPoint(
            x: screenFrame.maxX - size.width - 24,
            y: screenFrame.maxY - size.height - 24
        )

        let window = NSWindow(
            contentRect: NSRect(origin: origin, size: size),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "RPGDev"
        window.titlebarAppearsTransparent = false
        window.isMovableByWindowBackground = false
        window.level = .floating
        window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        window.backgroundColor = NSColor.black
        // 4:3 維持は contentAspectRatio ではなく windowWillResize で行う（contentAspectRatio だと
        // 一部の辺からしか掴めなくなることがあるため）。これで全辺・全角から自然にリサイズできる。
        window.contentMinSize = NSSize(width: 512, height: 384)
        window.delegate = self

        // contentView(container) は素の座標系のまま（全辺リサイズを邪魔しない）。中の stageView を
        // 内部 1024x768 座標に固定し、コンテンツ領域に合わせて等倍スケール＝中身は 1024x768 の
        // まま見た目だけ拡大縮小（reflow しない）。クリック座標も bounds 変換を通って正しく対応。
        let container = NSView(frame: NSRect(origin: .zero, size: size))
        container.wantsLayer = true
        container.autoresizesSubviews = false
        window.contentView = container

        let stageView = NSView(frame: NSRect(origin: .zero, size: designSize))
        stageView.wantsLayer = true
        stageView.autoresizingMask = []
        container.addSubview(stageView)

        let webView = WKWebView(frame: NSRect(origin: .zero, size: designSize), configuration: config)
        webView.autoresizingMask = []
        webView.setValue(false, forKey: "drawsBackground")
        stageView.addSubview(webView)

        self.window = window
        self.webView = webView
        self.container = container
        self.stageView = stageView
        applyScale()

        if let url = URL(string: urlString) {
            webView.load(URLRequest(url: url))
            prepareAudioPlayers(baseUrl: baseUrl(from: url))
        }

        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return true
    }

    // 掴んだ方向（幅優先/高さ優先）に応じてコンテンツを 4:3 にスナップする。
    // これで上下左右どの辺・角からでも自然にリサイズでき、常に 4:3 を保つ。
    func windowWillResize(_ sender: NSWindow, to frameSize: NSSize) -> NSSize {
        let current = sender.frame.size
        let dw = abs(frameSize.width - current.width)
        let dh = abs(frameSize.height - current.height)
        var content = sender.contentRect(forFrameRect: NSRect(origin: .zero, size: frameSize)).size
        let ratioH = designSize.height / designSize.width
        let ratioW = designSize.width / designSize.height
        if dw >= dh {
            content.height = (content.width * ratioH).rounded()
        } else {
            content.width = (content.height * ratioW).rounded()
        }
        let minW: CGFloat = 512
        let minH: CGFloat = (minW * ratioH).rounded()
        if content.width < minW { content = NSSize(width: minW, height: minH) }
        return sender.frameRect(forContentRect: NSRect(origin: .zero, size: content)).size
    }

    func windowDidResize(_ notification: Notification) {
        applyScale()
    }

    // コンテンツ領域に合わせ、内部 1024x768 を等倍スケールで配置する（中身は 1024x768 のまま
    // 見た目だけ拡大縮小＝reflow しない）。4:3 を保っているので基本ぴったり収まる。
    private func applyScale() {
        guard let container = container, let stageView = stageView else { return }
        let avail = container.bounds.size
        let scale = min(avail.width / designSize.width, avail.height / designSize.height)
        let w = (designSize.width * scale).rounded()
        let h = (designSize.height * scale).rounded()
        let x = ((avail.width - w) / 2).rounded()
        let y = ((avail.height - h) / 2).rounded()
        stageView.frame = NSRect(x: x, y: y, width: w, height: h)
        stageView.bounds = NSRect(origin: .zero, size: designSize)
        webView?.frame = NSRect(origin: .zero, size: designSize)
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "rpgdev", let body = message.body as? [String: Any] else {
            return
        }

        if let track = body["track"] as? String {
            activeTrack = track
        }

        if let enabled = body["enabled"] as? Bool {
            audioEnabled = enabled
        }

        if let sfx = body["sfx"] as? String {
            playSfx(name: sfx)
        }

        if audioEnabled {
            play(track: activeTrack)
        } else {
            stopAllAudio()
        }
    }

    private func prepareAudioPlayers(baseUrl: String) {
        let urls = [
            "field",
            "adventure",
            "battle",
            "dungeon-adventure",
            "dungeon-battle",
            "castle-adventure",
            "castle-battle"
        ]

        for name in urls {
            guard let url = audioUrl(name: name, baseUrl: baseUrl) else { continue }
            let player = AVPlayer(url: url)
            players[name] = player

            if let item = player.currentItem {
                let observer = NotificationCenter.default.addObserver(
                    forName: .AVPlayerItemDidPlayToEndTime,
                    object: item,
                    queue: .main
                ) { [weak player] _ in
                    player?.seek(to: .zero)
                    player?.play()
                }
                loopObservers.append(observer)
            }
        }

        for name in ["monster-appear", "monster-defeat"] {
            guard let url = audioUrl(name: name, baseUrl: baseUrl),
                  let player = try? AVAudioPlayer(contentsOf: url) else { continue }
            player.prepareToPlay()
            sfxPlayers[name] = player
        }
    }

    private func audioUrl(name: String, baseUrl: String) -> URL? {
        if let root = projectRootUrl() {
            let localUrl = root.appendingPathComponent("public/audio/\(name).wav")
            if FileManager.default.fileExists(atPath: localUrl.path) {
                return localUrl
            }
        }
        return URL(string: "\(baseUrl)/audio/\(name).wav")
    }

    private func projectRootUrl() -> URL? {
        let appUrl = Bundle.main.bundleURL
        let rpgdevDir = appUrl.deletingLastPathComponent()
        return rpgdevDir.deletingLastPathComponent()
    }

    private func play(track: String) {
        guard track != "silence", let selectedPlayer = players[track] else {
            stopAllAudio()
            return
        }

        for (name, player) in players {
            if name != track {
                player.pause()
                player.seek(to: .zero)
            }
        }

        selectedPlayer.volume = track == "dungeon-adventure" ? 0.86 : track.contains("battle") ? 0.74 : track.contains("adventure") ? 0.72 : 0.68
        selectedPlayer.play()
    }

    private func playSfx(name: String) {
        guard let player = sfxPlayers[name] else { return }
        player.stop()
        player.currentTime = 0
        player.volume = 1.0
        player.play()
    }

    private func stopAllAudio() {
        for player in players.values {
            player.pause()
        }
    }

    private func baseUrl(from url: URL) -> String {
        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        components?.path = ""
        components?.query = nil
        components?.fragment = nil
        return components?.url?.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")) ?? "http://127.0.0.1:37373"
    }
}

let app = NSApplication.shared
let delegate = RPGDevAppDelegate()
app.delegate = delegate
app.run()

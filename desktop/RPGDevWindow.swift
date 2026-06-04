import Cocoa
import WebKit
import AVFoundation

final class RPGDevAppDelegate: NSObject, NSApplicationDelegate, WKScriptMessageHandler {
    private var window: NSWindow?
    private var webView: WKWebView?
    private var players: [String: AVPlayer] = [:]
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
        let size = NSSize(width: 440, height: 300)
        let origin = NSPoint(
            x: screenFrame.maxX - size.width - 24,
            y: screenFrame.maxY - size.height - 24
        )

        let window = NSWindow(
            contentRect: NSRect(origin: origin, size: size),
            styleMask: [.titled, .closable, .miniaturizable],
            backing: .buffered,
            defer: false
        )
        window.title = "RPGDev"
        window.titlebarAppearsTransparent = false
        window.isMovableByWindowBackground = false
        window.level = .floating
        window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        window.backgroundColor = NSColor.black
        window.minSize = NSSize(width: 360, height: 240)
        window.maxSize = NSSize(width: 620, height: 420)

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.autoresizingMask = [.width, .height]
        webView.setValue(false, forKey: "drawsBackground")
        window.contentView = webView

        if let url = URL(string: urlString) {
            webView.load(URLRequest(url: url))
            prepareAudioPlayers(baseUrl: baseUrl(from: url))
        }

        self.window = window
        self.webView = webView

        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return true
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

        if audioEnabled {
            play(track: activeTrack)
        } else {
            stopAllAudio()
        }
    }

    private func prepareAudioPlayers(baseUrl: String) {
        let urls = ["field", "adventure", "battle"]

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

        selectedPlayer.volume = track == "field" ? 0.68 : 0.74
        selectedPlayer.play()
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

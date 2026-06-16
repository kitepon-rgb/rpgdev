# desktop/webview2/

WebView2 SDK files **bundled** with RPGDev so the Windows / WSL2 desktop window builds
with no manual download. The C# host (`desktop/RPGDevWindow.cs`) creates the WebView2
controller directly on the window handle, so it needs exactly two files:

- `Microsoft.Web.WebView2.Core.dll` — managed Core wrapper (AnyCPU, targets .NET
  Framework 4.6.2; runs on the .NET Framework 4.8 that ships with Windows 10/11).
- `WebView2Loader.dll` — native loader, **x64**.

These are **not** the WebView2 runtime (the Evergreen Runtime, preinstalled on
Windows 11, does the actual rendering). They are the SDK loader/wrapper. Microsoft's
[distribution docs](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution#files-to-ship-with-the-app)
explicitly require shipping `WebView2Loader.dll` and `Microsoft.Web.WebView2.Core.dll`
with the app, so redistributing them here is sanctioned.

## Provenance / how to update

Sourced from the `Microsoft.Web.WebView2` NuGet package (v1.0.4022.49):

```bash
curl -sL -o wv2.nupkg https://www.nuget.org/api/v2/package/Microsoft.Web.WebView2
unzip -j wv2.nupkg lib/net462/Microsoft.Web.WebView2.Core.dll          -d desktop/webview2/
unzip -j wv2.nupkg runtimes/win-x64/native/WebView2Loader.dll          -d desktop/webview2/
```

To bump the SDK, re-run the above with a newer package and commit the result.

> **arm64 Windows:** swap in `runtimes/win-arm64/native/WebView2Loader.dll` and change
> `/platform:x64` → `/platform:arm64` in `scripts/desktop.mjs` (untested; x64 is the
> shipped default).

If either DLL is missing, `scripts/desktop.mjs` stops the build with a clear error (it
never silently skips the window).

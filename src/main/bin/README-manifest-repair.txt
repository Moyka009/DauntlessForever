manifest-repair.bin (copied out as manifest-repair.exe) - used by the launcher's More > "Check the game files"

Build of meszmate/manifest v0.1.0 (MIT licence, https://github.com/meszmate/manifest, commit 23f0568)
with three changes, all in manifest-repair.patch:
  1. the plain-chunk fix (chunks Epic stored uncompressed), as in resources/tools/manifest.exe;
  2. "verify --progress": prints CHECK n/total <file> to stderr before each file;
  3. "download --files <list>": downloads only the manifest files named in the list (repair).
Built with Go 1.24.7: GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" ./cmd/manifest

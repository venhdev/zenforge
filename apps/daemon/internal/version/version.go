package version

// Version is the canonical Single Source of Truth (SSOT) version string for ZenForge.
// Declared as var so link-time ldflags (-X) can inject the build version during release.
var Version = "0.1.1"

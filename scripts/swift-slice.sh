#!/bin/zsh
# Shared per-arch swiftc helper for the universal builds.
#
# Command-Line-Tools-only machines ship Swift compatibility archives
# (libswiftCompatibility56.a & friends) without an x86_64 slice, so a plain
# x86_64 cross-link fails on the `__swift_FORCE_LOAD_$_swiftCompatibility56`
# trigger symbol even though every real dependency comes from the SDK. This
# codebase uses no Swift concurrency, so the 5.6 runtime overrides those
# archives provide are never invoked at runtime. When — and only when — the
# toolchain library genuinely lacks x86_64 AND the link failed on that exact
# symbol, retry once with a stub archive defining only the trigger. Full
# Xcode environments link normally and never reach the fallback.

build_swift_slice() {
  local SDK="$1" TARGET="$2" OUTPUT="$3"
  shift 3
  local LOG="${OUTPUT}.link.log"
  if swiftc "$@" -o "$OUTPUT" -sdk "$SDK" -target "$TARGET" 2> "$LOG"; then
    rm -f "$LOG"
    return 0
  fi
  local COMPAT="/Library/Developer/CommandLineTools/usr/lib/swift/macosx/libswiftCompatibility56.a"
  if [[ "$TARGET" == x86_64-* ]] \
     && grep -qF '__swift_FORCE_LOAD_$_swiftCompatibility56' "$LOG" \
     && [[ -f "$COMPAT" ]] && ! lipo -info "$COMPAT" | grep -qw x86_64; then
    local STUB_DIR="${OUTPUT:h}/swift56-stub"
    mkdir -p "$STUB_DIR"
    printf '.data\n.globl __swift_FORCE_LOAD_$_swiftCompatibility56\n__swift_FORCE_LOAD_$_swiftCompatibility56:\n  .quad 0\n' > "$STUB_DIR/stub.s"
    as -arch x86_64 -mmacosx-version-min=12.0 "$STUB_DIR/stub.s" -o "$STUB_DIR/stub.o"
    ar rcs "$STUB_DIR/libswiftCompatibility56.a" "$STUB_DIR/stub.o"
    echo "warning: toolchain libswiftCompatibility56.a lacks x86_64; retrying with a force-load stub. Install full Xcode to link a complete Intel slice." >&2
    swiftc "$@" "$STUB_DIR/libswiftCompatibility56.a" -o "$OUTPUT" -sdk "$SDK" -target "$TARGET" 2> "$LOG"
    rm -f "$LOG"
    return 0
  fi
  cat "$LOG" >&2
  rm -f "$LOG"
  return 1
}

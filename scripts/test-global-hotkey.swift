import AppKit

@main
struct GlobalHotKeyChecks {
    static func main() {
        precondition(GlobalHotKey.carbonModifiers(from: [.control, .option]) == 0x1800)
        precondition(GlobalHotKey.carbonModifiers(from: [.command, .control]) == 0x1100)
        precondition(GlobalHotKey.modifierSymbols(0x1800) == "⌃⌥")
        precondition(GlobalHotKey.modifierSymbols(0x1900) == "⌃⌥⌘")
        print("global hotkey checks passed")
    }
}

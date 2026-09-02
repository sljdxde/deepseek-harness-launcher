import AppKit
import Carbon

final class GlobalHotKeyManager {
    private var hotKeyRef: EventHotKeyRef?
    private var eventHandlerRef: EventHandlerRef?
    private let onHotKey: () -> Void

    init(onHotKey: @escaping () -> Void) {
        self.onHotKey = onHotKey
    }

    deinit {
        unregister()
    }

    @discardableResult
    func apply(enabled: Bool, modifiers: UInt32, keyCode: UInt32) -> Bool {
        unregister()
        guard enabled else { return true }

        if eventHandlerRef == nil {
            var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
            let handler: EventHandlerUPP = { _, _, userData in
                guard let userData else { return noErr }
                let manager = Unmanaged<GlobalHotKeyManager>.fromOpaque(userData).takeUnretainedValue()
                manager.onHotKey()
                return noErr
            }
            let status = InstallEventHandler(
                GetApplicationEventTarget(),
                handler,
                1,
                &spec,
                Unmanaged.passUnretained(self).toOpaque(),
                &eventHandlerRef
            )
            guard status == noErr else { return false }
        }

        let hotKeyID = EventHotKeyID(signature: OSType(0x44484C48), id: 1)
        var ref: EventHotKeyRef?
        let status = RegisterEventHotKey(keyCode, UInt32(modifiers), hotKeyID, GetApplicationEventTarget(), 0, &ref)
        guard status == noErr, let ref else { return false }
        hotKeyRef = ref
        return true
    }

    func unregister() {
        if let hotKeyRef {
            UnregisterEventHotKey(hotKeyRef)
            self.hotKeyRef = nil
        }
    }
}

enum GlobalHotKey {
    static let commandModifier: UInt32 = 0x0100
    static let shiftModifier: UInt32 = 0x0200
    static let optionModifier: UInt32 = 0x0800
    static let controlModifier: UInt32 = 0x1000

    static func carbonModifiers(from flags: NSEvent.ModifierFlags) -> UInt32 {
        var value: UInt32 = 0
        if flags.contains(.command) { value |= commandModifier }
        if flags.contains(.shift) { value |= shiftModifier }
        if flags.contains(.option) { value |= optionModifier }
        if flags.contains(.control) { value |= controlModifier }
        return value
    }

    static func modifierSymbols(_ modifiers: UInt32) -> String {
        var symbols = ""
        if modifiers & controlModifier != 0 { symbols += "⌃" }
        if modifiers & optionModifier != 0 { symbols += "⌥" }
        if modifiers & shiftModifier != 0 { symbols += "⇧" }
        if modifiers & commandModifier != 0 { symbols += "⌘" }
        return symbols
    }
}

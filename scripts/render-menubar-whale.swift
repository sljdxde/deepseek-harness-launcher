import AppKit
import Foundation

// 模拟 main.swift 的 makeStatusImage，把菜单栏鲸鱼（带挖空细节）渲染到 PNG 便于核验。
let out = CommandLine.arguments[1]
let size = 18
let image = NSImage(size: NSSize(width: size, height: size), flipped: false) { _ in
    drawWhale(in: NSRect(x: 1, y: 1, width: 16, height: 16), color: .black)
    return true
}
image.isTemplate = true
guard let tiff = image.tiffRepresentation,
      let rep = NSBitmapImageRep(data: tiff) else { fatalError("render failed") }
rep.representation(using: .png, properties: [:])?.write(to: URL(fileURLWithPath: out))
print("rendered -> \(out)")
